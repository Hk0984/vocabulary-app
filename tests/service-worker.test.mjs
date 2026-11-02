import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';

const source = readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const scope = 'https://hk0984.github.io/vocabulary-app/';
function worker() {
    const handlers = {}, deleted = [], installed = [], opened = [];
    const prefix = 'vocab-app:' + scope + ':';
    const cache = { async put(request) {installed.push(request);}, async match() {return 'current version';} };
    const assets=['./','./index.html','./style.css','./script.js','./history-config.js','./history_questions.js',
        './pwa.js','./manifest.json','./icons/icon-192.png','./icons/icon-512.png'];
    const hashes=Object.fromEntries(assets.map(asset=>[asset,createHash('sha256').update('asset:'+new URL(asset,scope).href).digest('hex')]));
    let skipped = 0, claimed = 0;
    const context = {URL,Request,Response,crypto:webcrypto,fetch:async request=> new Response('asset:'+request.url),
        self:{registration:{scope},addEventListener(name,fn){handlers[name]=fn;},skipWaiting(){skipped++;},clients:{claim(){claimed++;}}},
        caches:{async open(name){opened.push(name);return cache;},
            async keys(){return [prefix+'old',prefix+'source-v3','vocab-app-v2','other-app-cache','vocab-app:https://hk0984.github.io/other/:old'];},
            async delete(name){deleted.push(name);},match(){throw new Error('Global cache lookup is forbidden');}}
    };
    vm.runInNewContext(source.replace('const ASSET_HASHES = null;','const ASSET_HASHES = '+JSON.stringify(hashes)+';'),context);
    return {handlers,cache,context,deleted,installed,opened,get skipped(){return skipped;},get claimed(){return claimed;}};
}
async function lifecycle(handler) {let task;handler({waitUntil(promise){task=promise;}});await task;}

test('install refreshes all shell assets but does not force an update onto open study tabs', async () => {
    const app = worker();
    await lifecycle(app.handlers.install);
    assert.equal(app.installed.length,10);
    assert.ok(app.installed.every(request=>request.url.startsWith(scope)&&request.cache==='reload'));
    assert.equal(app.skipped,0);
    assert.equal(app.claimed,0);
});

test('activation removes only this application scope and leaves unrelated and legacy caches alone', async () => {
    const app = worker();
    await lifecycle(app.handlers.activate);
    assert.deepEqual(app.deleted,['vocab-app:'+scope+':old']);
});

test('backend requests and non-allowlisted same-origin files bypass the worker cache', () => {
    const app = worker();
    for(const [url,method] of [
        ['https://sheets.googleapis.com/v4/spreadsheets/test','GET'],
        ['https://firestore.googleapis.com/test','GET'],
        [scope+'bot/operations.txt','GET'], [scope+'script.js','POST']
    ]) app.handlers.fetch({request:{url,method},respondWith(){assert.fail('Unexpected interception');}});
    assert.equal(app.opened.length,0);
});

test('shell fetch uses only the current cache and fails closed instead of mixing versions on a cache miss', async () => {
    const app = worker();let response;
    app.handlers.fetch({request:{url:scope+'script.js',method:'GET'},respondWith(p){response=p;}});
    assert.equal(await response,'current version');
    assert.deepEqual(app.opened,['vocab-app:'+scope+':source-v3']);
    app.cache.match=async()=>undefined;
    app.handlers.fetch({request:{url:scope+'script.js',method:'GET'},respondWith(p){response=p;}});
    assert.equal((await response).status,503);
    app.handlers.fetch({request:{url:scope+'script.js?cachebuster=new',method:'GET'},respondWith(p){response=p;}});
    assert.equal((await response).status,503);
});

test('waiting update is shown without automatically reloading the current session', async () => {
    let load,options;
    const status={textContent:''};
    const registration={waiting:{},addEventListener(){}};
    vm.runInNewContext(readFileSync(new URL('../pwa.js',import.meta.url),'utf8'),{
        window:{addEventListener(name,fn){assert.equal(name,'load');load=fn;}},
        navigator:{serviceWorker:{async register(url,opts){assert.equal(url,'./sw.js');options=opts;return registration;}}},
        document:{getElementById(){return status;}}
    });
    await load();
    assert.match(status.textContent,/すべて閉じて/);
    assert.equal(options.scope,'./');
    assert.equal(options.updateViaCache,'none');
});

test('incomplete precache rejects installation without deleting the currently usable caches', async () => {
    const app=worker();
    app.context.fetch=async()=>new Response('unavailable',{status:503});
    await assert.rejects(lifecycle(app.handlers.install),/asset unavailable/);
    assert.equal(app.skipped,0);
    assert.deepEqual(app.deleted,[]);
});

test('mixed-version CDN responses fail verification before any cache is written', async () => {
    const app=worker();
    app.context.fetch=async()=>new Response('different release');
    await assert.rejects(lifecycle(app.handlers.install),/version mismatch/);
    assert.equal(app.opened.length,0);
    assert.equal(app.installed.length,0);
    assert.deepEqual(app.deleted,[]);
});

test('registration failure gives a user message without exposing transport details', async () => {
    let load;const status={textContent:''};
    vm.runInNewContext(readFileSync(new URL('../pwa.js',import.meta.url),'utf8'),{
        window:{addEventListener(name,fn){load=fn;}},
        navigator:{serviceWorker:{async register(){throw new Error('private transport details');}}},
        document:{getElementById(){return status;}}
    });
    await load();
    assert.match(status.textContent,/オンラインでの学習は続けられます/);
    assert.doesNotMatch(status.textContent,/private transport details/);
});
