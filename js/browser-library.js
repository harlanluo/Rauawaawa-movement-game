let directory = null;
let pendingDirectory = null;
let objects = [];
const entries = new Map();

function handleStore(write, value) {
    return new Promise((resolve, reject) => {
        const open = indexedDB.open('movement-game-library', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('settings');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const transaction = db.transaction('settings', write ? 'readwrite' : 'readonly');
            const request = write ? transaction.objectStore('settings').put(value, 'directory')
                : transaction.objectStore('settings').get('directory');
            transaction.oncomplete = () => { resolve(request.result); db.close(); };
            transaction.onerror = () => { reject(transaction.error); db.close(); };
        };
    });
}
export async function restoreDirectory() {
    directory ||= await handleStore(false);
    return directory;
}
export async function chooseDirectory() {
    if (!globalThis.showDirectoryPicker) throw new Error('Use desktop Chrome or Edge to choose a library folder.');
    // This must be invoked directly from the user's click, before awaiting other work.
    const picked = await showDirectoryPicker({ mode: 'readwrite', id: 'movement-library' });
    pendingDirectory = picked;
    return { libraryPath: picked.name };
}
export async function authorizeDirectory() {
    const target = pendingDirectory || directory;
    if (!target) throw new Error('Choose a library folder first.');
    if (await target.requestPermission({ mode: 'readwrite' }) !== 'granted') {
        throw new Error('Allow access to the library folder to save and load games.');
    }
    directory = target;
    pendingDirectory = null;
    await handleStore(true, directory);
}

async function requireDirectory() {
    await restoreDirectory();
    if (!directory) throw new Error('Choose your library folder in Game Library → Settings.');
    if (await directory.queryPermission({ mode: 'readwrite' }) !== 'granted') {
        throw new Error('Open Settings and click Save and Load Library to reconnect your folder.');
    }
    return directory;
}
export function safeFolderName(name) {
    let label = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[ .]+|[ .]+$/g, '').slice(0, 80) || 'Game';
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(label)) label = '_' + label;
    return label;
}
async function newFolder(root, name) {
    const label = safeFolderName(name);
    for (let count = 1; ; count++) {
        const candidate = count === 1 ? label : `${label} (${count})`;
        try { await root.getDirectoryHandle(candidate); }
        catch (error) {
            if (error.name !== 'NotFoundError') throw error;
            return root.getDirectoryHandle(candidate, { create: true });
        }
    }
}
async function write(folder, name, value) {
    const file = await folder.getFileHandle(name, { create: true });
    const stream = await file.createWritable();
    try { await stream.write(value); await stream.close(); }
    catch (error) { await stream.abort().catch(() => {}); throw error; }
}
async function json(folder, name) {
    return JSON.parse(await (await folder.getFileHandle(name)).getFile().then(file => file.text()));
}
function mediaURL(file) { const url = URL.createObjectURL(file); objects.push(url); return url; }
async function playable(folder, game) {
    if (game.hasVideo || game.videoSrc?.startsWith('local-games/')) {
        game.videoSrc = mediaURL(await (await folder.getFileHandle('video.mp4')).getFile());
        game.referencePoseSrc = mediaURL(await (await folder.getFileHandle('reference-pose.json')).getFile());
    }
    return { ...game, persistent: true };
}
async function list() {
    const root = await requireDirectory();
    objects.forEach(URL.revokeObjectURL); objects = []; entries.clear();
    const games = [];
    for await (const [name, folder] of root.entries()) {
        if (folder.kind !== 'directory' || name.startsWith('.')) continue;
        try {
            const game = await json(folder, 'game.json');
            entries.set(String(game.id), folder);
            games.push(await playable(folder, game));
        } catch (error) { console.warn(`Could not load library game ${name}`, error); }
    }
    return { games };
}
async function archive(root, folder) {
    const trash = await root.getDirectoryHandle('.trash', { create: true });
    const copy = await newFolder(trash, `${folder.name}-${Date.now()}`);
    for (const name of ['video.mp4', 'reference-pose.json', 'game.json']) {
        try { await write(copy, name, await (await folder.getFileHandle(name)).getFile()); }
        catch (error) { if (error.name !== 'NotFoundError') throw error; }
    }
    // Only remove the known game files; unrelated user files are never removed.
    for (const name of ['video.mp4', 'reference-pose.json', 'game.json']) {
        try { await folder.removeEntry(name); } catch (error) { if (error.name !== 'NotFoundError') throw error; }
    }
    try { await root.removeEntry(folder.name); } catch (error) { if (error.name !== 'InvalidModificationError') throw error; }
}
export async function libraryApi(url, options = {}) {
    if (url === '/api/settings') {
        await restoreDirectory();
        return { libraryPath: directory?.name || 'No folder selected' };
    }
    if (url === '/api/games' && !options.method) return list();
    const root = await requireDirectory();
    const data = options.body ? JSON.parse(options.body) : null;
    if (url === '/api/games') {
        const folder = await newFolder(root, data.name);
        const game = { id: Date.now(), name: data.name, mode: data.mode, description: data.description,
            hasVideo: !!data.video, persistent: true, videoSrc: data.videoSrc, referencePoseSrc: data.referencePoseSrc };
        if (data.video) {
            const bytes = Uint8Array.from(atob(data.video), char => char.charCodeAt(0));
            await write(folder, 'video.mp4', bytes);
            await write(folder, 'reference-pose.json', JSON.stringify(data.reference));
        }
        // Metadata is the commit marker: incomplete saves never appear in the list.
        await write(folder, 'game.json', JSON.stringify(game));
        entries.set(String(game.id), folder);
        return playable(folder, game);
    }
    const id = url.split('/').at(-1), folder = entries.get(id);
    if (!folder) throw new Error('Reload the library before editing this game.');
    if (options.method === 'DELETE') {
        await archive(root, folder); entries.delete(id); return { deleted: true };
    }
    const game = { ...await json(folder, 'game.json'), ...data };
    let target = folder;
    if (safeFolderName(game.name) !== folder.name) {
        target = await newFolder(root, game.name);
        for (const name of ['video.mp4', 'reference-pose.json']) {
            try { await write(target, name, await (await folder.getFileHandle(name)).getFile()); }
            catch (error) { if (error.name !== 'NotFoundError') throw error; }
        }
    }
    await write(target, 'game.json', JSON.stringify(game));
    if (target !== folder) await archive(root, folder);
    entries.set(id, target);
    return playable(target, game);
}
