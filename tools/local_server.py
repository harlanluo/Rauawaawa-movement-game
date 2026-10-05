"""Local static preview plus asynchronous reference-pose extraction.

Run with tools/reference-pose/.venv/Scripts/python tools/local_server.py
"""
import json
import base64
import time
import shutil
import os
import re
import subprocess
import sys
import tempfile
import threading
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
MAX_UPLOAD = 200 * 1024 * 1024
JOBS = {}
LOCK = threading.Lock()
BUSY = threading.Semaphore(1)
STORE = ROOT / 'local-games'
CONFIG = ROOT / 'local-settings.json'
if CONFIG.exists():
    STORE = Path(json.loads(CONFIG.read_text(encoding='utf-8'))['libraryPath'])
STORE_LOCK = threading.Lock()
PICKER_LOCK = threading.Lock()


def choose_library_folder():
    if sys.platform != 'win32':
        raise ValueError('Folder selection currently requires Windows. Enter the path instead.')
    # Fixed script; the initial folder is passed as data, never interpolated into code.
    script = """
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Choose the movement game library folder'
    $dialog.SelectedPath = $env:MOVEMENT_LIBRARY_INITIAL
    $dialog.ShowNewFolderButton = $true
    try {
        if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            [Console]::Write($dialog.SelectedPath)
        }
    } finally { $dialog.Dispose() }
    """
    environment = {**os.environ, 'MOVEMENT_LIBRARY_INITIAL': str(STORE)}
    result = subprocess.run(['powershell.exe', '-NoProfile', '-STA', '-Command', script],
                            env=environment, capture_output=True, text=True, encoding='utf-8',
                            creationflags=subprocess.CREATE_NO_WINDOW, timeout=300)
    if result.returncode:
        raise ValueError('Could not open the folder chooser. Enter the path instead.')
    return result.stdout.strip() or None


def game_folder(game_id):
    if not str(game_id).isdigit():
        raise ValueError('Invalid game ID')
    for metadata in STORE.glob('*/game.json'):
        if json.loads(metadata.read_text(encoding='utf-8')).get('id') == int(game_id):
            return metadata.parent
    return STORE / str(game_id)


def named_folder(name, current=None):
    label = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name).strip(' .')[:80] or 'Game'
    if label.split('.')[0].upper() in {'CON', 'PRN', 'AUX', 'NUL', *[f'COM{i}' for i in range(1, 10)], *[f'LPT{i}' for i in range(1, 10)]}:
        label = '_' + label
    candidate, index = STORE / label, 2
    while candidate.exists() and candidate != current:
        candidate = STORE / f'{label} ({index})'
        index += 1
    if not candidate.resolve().is_relative_to(STORE.resolve()):
        raise ValueError('Folder must remain within library')
    return candidate


def saved_games():
    STORE.mkdir(exist_ok=True)
    games = []
    for path in sorted(STORE.glob('*/game.json')):
        game = json.loads(path.read_text(encoding='utf-8'))
        if path.parent.name == str(game['id']):
            if not path.parent.resolve().is_relative_to(STORE.resolve()):
                raise ValueError('Folder must remain within library')
            path.parent.rename(named_folder(game['name']))
        games.append(game)
    return games


def save_game(data):
    if not data.get('name', '').strip() or data.get('mode') not in ('Seated', 'Standing', 'Both'):
        raise ValueError('A game name and exercise mode are required')
    game_id = int(time.time() * 1000)
    while game_folder(game_id).exists():
        game_id += 1
    STORE.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.saving-', dir=STORE) as temp:
        folder = Path(temp)
        game = dict(id=game_id, name=data['name'].strip()[:60], mode=data['mode'],
                    description=data.get('description', '')[:2000], persistent=True)
        if data.get('video'):
            (folder / 'video.mp4').write_bytes(base64.b64decode(data['video'], validate=True))
            reference = data.get('reference')
            if not isinstance(reference, dict) or not reference.get('frames'):
                raise ValueError('Movement reference is required')
            (folder / 'reference-pose.json').write_text(json.dumps(reference), encoding='utf-8')
            game.update(videoSrc=f'local-games/{game_id}/video.mp4',
                        referencePoseSrc=f'local-games/{game_id}/reference-pose.json')
        else:
            game.update(videoSrc=data['videoSrc'], referencePoseSrc=data['referencePoseSrc'])
        (folder / 'game.json').write_text(json.dumps(game, ensure_ascii=False), encoding='utf-8')
        # Commit the complete folder, leaving no partially published entry.
        shutil.move(str(folder), str(named_folder(game['name'])))
    return game


def extract_job(job_id, content, body_mode='standing'):
    job = JOBS[job_id]
    try:
        with tempfile.TemporaryDirectory(prefix='pose-') as folder:
            source = Path(folder) / 'source.mp4'
            output = Path(folder) / 'reference.json'
            source.write_bytes(content)
            command = [sys.executable, str(ROOT / 'tools/reference-pose/extract_reference_pose.py'),
                       '--input', str(source), '--output', str(output), '--fps', '10', '--body-mode', body_mode]
            with LOCK:
                if job['state'] == 'cancelled':
                    return
                process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                           cwd=ROOT, text=True)
                job['process'] = process
            try:
                stdout, stderr = process.communicate(timeout=600)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate()
                raise RuntimeError('Movement extraction timed out. Try a shorter video.')
            with LOCK:
                if job['state'] == 'cancelled':
                    return
                if process.returncode:
                    detail = (stderr or stdout)[-2000:]
                    raise RuntimeError('Movement extraction failed: ' + detail)
                data = json.loads(output.read_text(encoding='utf-8'))
                # Match the stylizer's first-60-second timeline, without retiming samples.
                data['frames'] = [frame for frame in data['frames'] if frame['timeMs'] < 60000]
                if not any(frame['landmarks'] for frame in data['frames']):
                    raise RuntimeError('No reliable movement found in this clip. ' +
                        ('Keep both shoulders and arms visible for seated exercise.' if body_mode == 'seated'
                         else 'Keep shoulders, hips and limbs visible for standing exercise.'))
                data['sourceVideo'] = 'uploaded-original-video'
                job.update(state='complete', reference=data)
    except Exception as error:
        with LOCK:
            if job['state'] != 'cancelled':
                job.update(state='failed', error=str(error))
    finally:
        with LOCK:
            job.pop('process', None)
        BUSY.release()


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        decoded = unquote(urlsplit(path).path).replace('\\', '/')
        if decoded.startswith('/local-games/'):
            relative = decoded.removeprefix('/local-games/')
            first, _, remainder = relative.partition('/')
            target = ((game_folder(first) / remainder) if first.isdigit() else (STORE / relative)).resolve()
            if target.is_relative_to(STORE.resolve()):
                return str(target)
            return str(ROOT / '.invalid-path')
        return super().translate_path(path)
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def reply(self, status, data):
        encoded = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def local_request(self):
        host = self.headers.get('Host', '')
        expected = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        origin = self.headers.get('Origin')
        return host in expected and (origin is None or origin == 'http://' + host)

    def do_POST(self):
        global STORE
        if not self.local_request():
            return self.reply(403, {'error': 'Only same-origin local requests are allowed.'})
        if self.path == '/api/library-folder-picker':
            if not PICKER_LOCK.acquire(blocking=False):
                return self.reply(409, {'error': 'A folder chooser is already open.'})
            try:
                return self.reply(200, {'libraryPath': choose_library_folder()})
            except (ValueError, OSError, subprocess.TimeoutExpired) as error:
                return self.reply(400, {'error': str(error)})
            finally:
                PICKER_LOCK.release()
        if self.path == '/api/settings':
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 8192:
                    raise ValueError('Invalid settings')
                path = Path(json.loads(self.rfile.read(length))['libraryPath'].strip())
                if not path.is_absolute():
                    raise ValueError('Enter an absolute folder path')
                with STORE_LOCK:
                    path.mkdir(parents=True, exist_ok=True)
                    # Test writable access before committing configuration.
                    with tempfile.TemporaryFile(dir=path):
                        pass
                    temporary = CONFIG.with_suffix('.tmp')
                    temporary.write_text(json.dumps({'libraryPath': str(path.resolve())}), encoding='utf-8')
                    temporary.replace(CONFIG)
                    STORE = path.resolve()
                return self.reply(200, {'libraryPath': str(STORE)})
            except (ValueError, KeyError, OSError) as error:
                return self.reply(400, {'error': str(error)})
        if self.path == '/api/games' or self.path.startswith('/api/games/'):
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= MAX_UPLOAD * 3:
                    raise ValueError('Game data is too large')
                data = json.loads(self.rfile.read(length))
                with STORE_LOCK:
                    if self.path == '/api/games':
                        game = save_game(data)
                    else:
                        folder = game_folder(self.path.removeprefix('/api/games/'))
                        game = json.loads((folder / 'game.json').read_text(encoding='utf-8'))
                        if not data.get('name', '').strip() or data.get('mode') not in ('Seated', 'Standing', 'Both'):
                            raise ValueError('Invalid game details')
                        game.update(name=data['name'].strip()[:60], mode=data['mode'], description=data.get('description', '')[:2000])
                        temporary = folder / '.game.tmp'
                        temporary.write_text(json.dumps(game, ensure_ascii=False), encoding='utf-8')
                        temporary.replace(folder / 'game.json')
                        destination = named_folder(game['name'], folder)
                        if destination != folder:
                            if not folder.resolve().is_relative_to(STORE.resolve()):
                                raise ValueError('Folder must remain within library')
                            folder.rename(destination)
                return self.reply(200, game)
            except (ValueError, KeyError, OSError) as error:
                return self.reply(400, {'error': str(error)})
        if self.path != '/api/reference-pose':
            return self.reply(404, {'error': 'Unknown endpoint'})
        body_mode = self.headers.get('X-Body-Mode', 'standing')
        if body_mode not in ('seated', 'standing'):
            return self.reply(400, {'error': 'Choose seated or standing exercise.'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            length = 0
        if not 0 < length <= MAX_UPLOAD:
            return self.reply(413, {'error': 'Choose a video under 200 MB.'})
        if not BUSY.acquire(blocking=False):
            return self.reply(409, {'error': 'Another video is being processed. Please wait and retry.'})
        content = self.rfile.read(length)
        if len(content) != length:
            BUSY.release()
            return self.reply(400, {'error': 'Incomplete video upload'})
        job_id = uuid.uuid4().hex
        with LOCK:
            # Keep only the current job; completed references are copied into the browser.
            JOBS.clear()
            JOBS[job_id] = {'state': 'processing'}
        threading.Thread(target=extract_job, args=(job_id, content, body_mode), daemon=True).start()
        self.reply(202, {'id': job_id})

    def do_GET(self):
        if urlsplit(self.path).path.startswith('/api/'):
            if not self.local_request():
                return self.reply(403, {'error': 'Only local requests are allowed.'})
            if self.path == '/api/settings':
                return self.reply(200, {'libraryPath': str(STORE)})
            if self.path == '/api/games':
                with STORE_LOCK:
                    return self.reply(200, {'games': saved_games()})
            job_id = self.path.removeprefix('/api/reference-pose/')
            with LOCK:
                job = JOBS.get(job_id)
                data = {key: value for key, value in job.items() if key != 'process'} if job else None
            return self.reply(200 if data else 404, data or {'error': 'Job not found'})
        # Prevent serving repository metadata, virtual environments, and cached models.
        parts = unquote(urlsplit(self.path).path).replace('\\', '/').split('/')
        if any(part.startswith('.') for part in parts):
            return self.send_error(404)
        super().do_GET()

    def do_DELETE(self):
        if not self.local_request():
            return self.reply(403, {'error': 'Only same-origin local requests are allowed.'})
        if self.path.startswith('/api/games/'):
            try:
                with STORE_LOCK:
                    folder = game_folder(self.path.removeprefix('/api/games/'))
                    trash = STORE / '.trash'
                    trash.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(folder), str(trash / (folder.name + '-' + uuid.uuid4().hex)))
                return self.reply(200, {'deleted': True})
            except (ValueError, OSError) as error:
                return self.reply(400, {'error': str(error)})
        job_id = self.path.removeprefix('/api/reference-pose/')
        with LOCK:
            job = JOBS.get(job_id)
            if job:
                job['state'] = 'cancelled'
                process = job.get('process')
                if process and process.poll() is None:
                    process.kill()
                job.pop('reference', None)
        self.reply(200, {'state': 'cancelled'})


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 8001), Handler)
    print('Local movement game: http://127.0.0.1:8001/', flush=True)
    server.serve_forever()
