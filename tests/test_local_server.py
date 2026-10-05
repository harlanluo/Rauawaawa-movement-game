"""HTTP contract tests for local extraction: isolate inference, exercise real routes."""
import importlib.util
import json
import base64
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('local_server', Path(__file__).parents[1] / 'tools/local_server.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class LocalServerTests(unittest.TestCase):
    def test_folder_picker_selection_cancel_and_foreign_origin(self):
        with patch.object(app, 'choose_library_folder', return_value='D:/Selected Library') as picker:
            status, body = self.request('/api/library-folder-picker', method='POST')
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)['libraryPath'], 'D:/Selected Library')
            status, _ = self.request('/api/library-folder-picker', method='POST', headers={'Origin': 'https://example.com'})
            self.assertEqual(status, 403)
            self.assertEqual(picker.call_count, 1)
        with patch.object(app, 'choose_library_folder', return_value=None):
            _, body = self.request('/api/library-folder-picker', method='POST')
            self.assertIsNone(json.loads(body)['libraryPath'])

    @classmethod
    def setUpClass(cls):
        cls.server = app.ThreadingHTTPServer(('127.0.0.1', 0), app.Handler)
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def request(self, path, data=None, method=None, headers=None):
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=headers or {})
        try:
            response = urllib.request.urlopen(request)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.read()

    def test_upload_poll_and_cancel(self):
        completed = threading.Event()

        def fake_extract(job_id, content, body_mode):
            self.assertEqual(body_mode, 'seated')
            self.assertEqual(content, b'original video bytes')
            with app.LOCK:
                app.JOBS[job_id].update(state='complete', reference={'frames': [{'timeMs': 0, 'landmarks': []}]})
            app.BUSY.release()
            completed.set()

        with patch.object(app, 'extract_job', fake_extract):
            status, body = self.request('/api/reference-pose', b'original video bytes', 'POST', {'X-Body-Mode': 'seated'})
            self.assertEqual(status, 202)
            job_id = json.loads(body)['id']
            self.assertTrue(completed.wait(2))
            status, body = self.request('/api/reference-pose/' + job_id)
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)['reference']['frames'][0]['timeMs'], 0)
            self.request('/api/reference-pose/' + job_id, method='DELETE')
            _, body = self.request('/api/reference-pose/' + job_id)
            self.assertEqual(json.loads(body), {'state': 'cancelled'})

    def test_rejects_foreign_origin(self):
        status, _ = self.request('/api/reference-pose', b'video', 'POST', {'Origin': 'https://example.com'})
        self.assertEqual(status, 403)

    def test_rejects_empty_upload_and_concurrent_work(self):
        status, _ = self.request('/api/reference-pose', b'', 'POST')
        self.assertEqual(status, 413)
        app.BUSY.acquire()
        try:
            status, _ = self.request('/api/reference-pose', b'video', 'POST')
            self.assertEqual(status, 409)
        finally:
            app.BUSY.release()

    def test_missing_job_and_hidden_files(self):
        for path in ['/api/reference-pose/missing', '/.git/config', '/%2egit/config', '/tools/reference-pose/.venv/pyvenv.cfg']:
            status, _ = self.request(path)
            self.assertEqual(status, 404)

    def test_saved_video_survives_reload_and_delete_is_recoverable(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(app, 'STORE', Path(folder)):
            payload = dict(name='Seated recording', mode='Seated', description='test',
                video=base64.b64encode(b'mp4 bytes').decode(), original=base64.b64encode(b'original').decode(),
                reference={'frames': [{'timeMs': 0, 'landmarks': []}]})
            status, body = self.request('/api/games', json.dumps(payload).encode(), 'POST')
            self.assertEqual(status, 200)
            game = json.loads(body)
            self.assertEqual(app.game_folder(game['id']).name, 'Seated recording')
            self.assertFalse((app.game_folder(game['id']) / 'original.mp4').exists())
            # Read fresh state from disk rather than any browser/session cache.
            _, body = self.request('/api/games')
            self.assertEqual(json.loads(body)['games'], [game])
            status, video = self.request('/' + game['videoSrc'])
            self.assertEqual((status, video), (200, b'mp4 bytes'))
            updated = dict(name='Renamed', mode='Seated', description='updated')
            self.request('/api/games/' + str(game['id']), json.dumps(updated).encode(), 'POST')
            self.assertEqual(app.saved_games()[0]['name'], 'Renamed')
            self.assertEqual(app.game_folder(game['id']).name, 'Renamed')
            self.assertEqual(self.request('/' + game['videoSrc'])[1], b'mp4 bytes')
            self.request('/api/games/' + str(game['id']), method='DELETE')
            self.assertEqual(app.saved_games(), [])
            self.assertEqual(len(list((Path(folder) / '.trash').glob('*/video.mp4'))), 1)

    def test_configured_library_switches_without_moving_previous_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch.object(app, 'STORE', root / 'old'), patch.object(app, 'CONFIG', root / 'settings.json'):
                app.STORE.mkdir()
                (app.STORE / 'keep.txt').write_text('keep')
                status, body = self.request('/api/settings', json.dumps({'libraryPath': str(root / 'new')}).encode(), 'POST')
                self.assertEqual(status, 200)
                self.assertTrue((root / 'old/keep.txt').exists())
                self.assertEqual(Path(json.loads(body)['libraryPath']), (root / 'new').resolve())
                self.assertTrue(app.CONFIG.exists())
                _, body = self.request('/api/games')
                self.assertEqual(json.loads(body)['games'], [])


if __name__ == '__main__':
    unittest.main()


class FolderNamesTests(unittest.TestCase):
    def test_reserved_names_and_duplicates(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(app, 'STORE', Path(folder)):
            self.assertEqual(app.named_folder('CON').name, '_CON')
            self.assertEqual(app.named_folder('a/b:c').name, 'a_b_c')
            (app.STORE / 'Exercise').mkdir()
            self.assertEqual(app.named_folder('Exercise').name, 'Exercise (2)')

    def test_migrate_numeric_folder_keeps_game_identity(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(app, 'STORE', Path(folder)):
            old = app.STORE / '123'
            old.mkdir()
            (old / 'game.json').write_text(json.dumps({'id':123,'name':'My exercise'}))
            (old / 'video.mp4').write_bytes(b'video')
            self.assertEqual(app.saved_games()[0]['id'], 123)
            self.assertEqual(app.game_folder(123).name, 'My exercise')
            self.assertEqual((app.game_folder(123) / 'video.mp4').read_bytes(), b'video')
