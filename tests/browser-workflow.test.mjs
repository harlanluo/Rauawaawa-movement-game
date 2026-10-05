import { test } from 'node:test';
import assert from 'node:assert/strict';
import { referenceFeatures, referenceDistance, selectReference } from '../js/browser-reference.js';
import { chooseDirectory, authorizeDirectory, libraryApi, safeFolderName } from '../js/browser-library.js';

function pose() {
    const points=Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:1}));
    for(const [i,x,y] of [[11,.4,.3],[12,.6,.3],[13,.3,.4],[14,.7,.4],[15,.25,.5],[16,.75,.5],[23,.45,.6],[24,.55,.6]]) points[i]={x,y,z:0,visibility:1};
    return points;
}
test('browser seated extraction accepts upper body and standing rejects missing hips',()=>{
    const p=pose(); for(let i=23;i<33;i++)p[i].visibility=0;
    assert.ok(referenceFeatures(p,'seated',1));
    assert.equal(referenceFeatures(p,'standing',1),null);
    p[11].visibility=0;
    assert.equal(referenceFeatures(p,'seated',1),null);
});
test('browser reference continuity preserves framing invariance and honest missing poses',()=>{
    const p=pose(),q=pose().map(point=>({...point,x:point.x*.7+.1,y:point.y*.7+.2}));
    const a=referenceFeatures(p,'seated',1),b=referenceFeatures(q,'seated',1);
    assert.ok(referenceDistance(a,b)<1e-9);
    assert.ok(selectReference([q],a,100,'seated',1));
    assert.equal(selectReference([],a,100,'seated',1),null);
});

class Directory {
    kind='directory'; files=new Map(); folders=new Map(); allowed=true;
    constructor(name){this.name=name;}
    queryPermission(){return Promise.resolve(this.allowed?'granted':'prompt');}
    requestPermission(){return this.queryPermission();}
    async getDirectoryHandle(name,{create=false}={}) {
        if(!this.folders.has(name)) {
            if(!create)throw new DOMException('Missing','NotFoundError');
            this.folders.set(name,new Directory(name));
        }
        return this.folders.get(name);
    }
    async getFileHandle(name,{create=false}={}) {
        if(!this.files.has(name)&&!create)throw new DOMException('Missing','NotFoundError');
        const self=this;
        return {kind:'file',name,getFile:async()=>new File([self.files.get(name)||''],name),
            createWritable:async()=>({write:async data=>self.files.set(name,data),close:async()=>{},abort:async()=>{}})};
    }
    async *entries(){for(const entry of this.folders)yield entry;}
    async removeEntry(name){
        const dir=this.folders.get(name);
        if(dir&&(dir.files.size||dir.folders.size))throw new DOMException('Not empty','InvalidModificationError');
        this.folders.delete(name);this.files.delete(name);
    }
}
test('browser library saves, reloads, renames and archives without storing raw footage',async()=>{
    const root=new Directory('Exercises'),settings=new Map();
    globalThis.showDirectoryPicker=async()=>root;
    globalThis.indexedDB={open(){
        const opening={result:{close(){},transaction(){
            const tx={objectStore:()=>({put(value,key){settings.set(key,value);return{};},get:key=>({result:settings.get(key)})})};
            setImmediate(()=>tx.oncomplete());return tx;
        }}};
        setImmediate(()=>opening.onsuccess());return opening;
    }};
    await chooseDirectory();
    await authorizeDirectory();
    const data={name:'My exercise',mode:'Seated',description:'',video:btoa('converted'),original:btoa('private'),reference:{frames:[{timeMs:0,landmarks:pose()}]}};
    const saved=await libraryApi('/api/games',{method:'POST',body:JSON.stringify(data)});
    assert.ok(root.folders.has('My exercise'));
    assert.equal(root.folders.get('My exercise').files.has('original.mp4'),false);
    const loaded=await libraryApi('/api/games');
    assert.equal(loaded.games[0].id,saved.id);
    assert.equal(await fetch(loaded.games[0].videoSrc).then(r=>r.text()),'converted');
    await libraryApi(`/api/games/${saved.id}`,{method:'POST',body:JSON.stringify({name:'Renamed',mode:'Seated',description:''})});
    assert.ok(root.folders.has('Renamed'));
    await libraryApi(`/api/games/${saved.id}`,{method:'DELETE'});
    assert.equal((await libraryApi('/api/games')).games.length,0);
    assert.ok(root.folders.get('.trash').folders.size>=2);
    root.allowed=false;
    await assert.rejects(libraryApi('/api/games'),/reconnect/);
    assert.equal(safeFolderName('a/b:c'),'a_b_c');
    assert.equal(safeFolderName('CON'),'_CON');
    delete globalThis.showDirectoryPicker;delete globalThis.indexedDB;
});
