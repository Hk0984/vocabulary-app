import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { buildWeb, WEB_FILES } from '../scripts/build-web.mjs';
import { checkPagesSource } from '../scripts/check-pages-release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function fixture(t) {
    const dir = await mkdtemp(path.join(tmpdir(), 'vocab-web-'));
    t.after(async () => {
        assert.equal(path.dirname(dir), path.resolve(tmpdir()));
        assert.ok(path.basename(dir).startsWith('vocab-web-'));
        await rm(dir, { recursive: true, force: true });
    });
    const sourceDir = path.join(dir, 'source');
    for (const name of WEB_FILES) {
        await mkdir(path.dirname(path.join(sourceDir, name)), { recursive: true });
        await copyFile(path.join(root, name), path.join(sourceDir, name));
    }
    return { dir, sourceDir, outputDir: path.join(dir, 'web') };
}

async function filesIn(dir, prefix = '') {
    const names = [];
    for (const item of await readdir(dir, { withFileTypes: true })) {
        const name = prefix + item.name;
        if (item.isDirectory()) names.push(...await filesIn(path.join(dir, item.name), name + '/'));
        else names.push(name);
    }
    return names.sort();
}

test('artifact contains exactly the reviewed web assets and excludes operational directories', async t => {
    const options = await fixture(t);
    for (const name of ['bot/operations.txt', 'tests/private-fixture.txt', 'node_modules/example.txt', 'local-config.txt']) {
        await mkdir(path.dirname(path.join(options.sourceDir, name)), {recursive:true});
        await writeFile(path.join(options.sourceDir, name), 'not for publication');
    }
    const result = await buildWeb(options);
    const expected = ['index.html','style.css','script.js','history-config.js','history_questions.js',
        'pwa.js','sw.js','manifest.json','icons/icon-192.png','icons/icon-512.png','release.json'].sort();
    assert.deepEqual(await filesIn(options.outputDir), expected);
    assert.deepEqual(result.files.sort(), expected);
    const inventory = JSON.parse(await readFile(path.join(options.outputDir,'release.json'),'utf8'));
    for (const item of inventory.files) {
        const data = await readFile(path.join(options.outputDir,item.name));
        assert.equal(createHash('sha256').update(data).digest('hex'), item.sha256);
    }
    const worker=await readFile(path.join(options.outputDir,'sw.js'),'utf8');
    const hashes=JSON.parse(worker.match(/const ASSET_HASHES = (\{[^\n]+\});/)[1]);
    for(const item of inventory.files.filter(item=>item.name!=='sw.js')) {
        assert.equal(hashes['./'+item.name],item.sha256);
    }
    assert.equal(hashes['./'],hashes['./index.html']);
});

test('artifact preserves application data connections byte for byte', async t => {
    const options = await fixture(t);
    await buildWeb(options);
    for (const name of ['script.js','history-config.js']) {
        const before = await readFile(path.join(options.sourceDir,name));
        const after = await readFile(path.join(options.outputDir,name));
        assert.equal(before.equals(after), true, `${name} must retain its connection settings`);
    }
});

test('source digest is deterministic and changes the worker cache version when assets change', async t => {
    const options = await fixture(t);
    const first = await buildWeb(options);
    const second = await buildWeb({...options, outputDir:path.join(options.dir,'second')});
    assert.equal(first.buildId, second.buildId);
    await writeFile(path.join(options.sourceDir,'style.css'),'/* changed test asset */');
    const third = await buildWeb({...options, outputDir:path.join(options.dir,'third')});
    assert.notEqual(first.buildId, third.buildId);
    assert.ok((await readFile(path.join(options.dir,'third/sw.js'),'utf8')).includes(third.buildId));
});

test('existing output is preserved and never recursively removed', async t => {
    const options = await fixture(t);
    await mkdir(options.outputDir);
    await writeFile(path.join(options.outputDir,'keep.txt'),'keep');
    await assert.rejects(buildWeb(options), /new or empty directory/);
    assert.equal(await readFile(path.join(options.outputDir,'keep.txt'),'utf8'),'keep');
});

test('a private-key marker fails before any output is created and without printing its value', async t => {
    const options = await fixture(t);
    await writeFile(path.join(options.sourceDir,'script.js'),'-----BEGIN PRIVATE KEY-----\nSYNTHETIC_TEST_ONLY');
    await assert.rejects(buildWeb(options), error => {
        assert.match(error.message, /Possible credential/);
        assert.doesNotMatch(error.message, /SYNTHETIC_TEST_ONLY/);
        return true;
    });
    await assert.rejects(readdir(options.outputDir), {code:'ENOENT'});
});

test('missing assets fail closed rather than silently publishing an incomplete app', async t => {
    const options = await fixture(t);
    await rm(path.join(options.sourceDir,'pwa.js'));
    await assert.rejects(buildWeb(options), {code:'ENOENT'});
    await assert.rejects(readdir(options.outputDir), {code:'ENOENT'});
});

test('manual workflow cannot deploy a feature branch or deploy without explicit confirmation', async () => {
    // JSON is a YAML subset; this workflow needs no extra parser dependency.
    const workflow = JSON.parse(await readFile(new URL('../.github/workflows/web-release.yml',import.meta.url),'utf8'));
    assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
    assert.equal(workflow.on.workflow_dispatch.inputs.deploy.default, false);
    assert.deepEqual(workflow.permissions, {contents:'read'});
    const allowed = (ref,deploy,confirmation,repository='Hk0984/vocabulary-app') => vm.runInNewContext(workflow.jobs.deploy.if,
        {github:{ref,repository},inputs:{deploy,confirmation}});
    assert.equal(allowed('refs/heads/main',false,'REPLACE_PRODUCTION'),false);
    assert.equal(allowed('refs/heads/main',true,''),false);
    assert.equal(allowed('refs/heads/feature/history-quiz-cloud',true,'REPLACE_PRODUCTION'),false);
    assert.equal(allowed('refs/heads/main',true,'REPLACE_PRODUCTION','other/repo'),false);
    assert.equal(allowed('refs/heads/main',true,'REPLACE_PRODUCTION'),true);
    for (const step of workflow.jobs.build.steps.filter(step=>step.uses?.includes('upload-'))) {
        assert.equal(step.with.path,'dist/web');
    }
    assert.equal(workflow.jobs.deploy.environment.name,'github-pages');
    assert.deepEqual(workflow.jobs.build.permissions,{contents:'read',pages:'read'});
    const gate=workflow.jobs.build.steps.find(step=>step.run==='node scripts/check-pages-release.mjs');
    assert.ok(gate);
    assert.ok(workflow.jobs.build.steps.indexOf(gate)<workflow.jobs.build.steps.findIndex(step=>step.uses==='actions/upload-pages-artifact@v4'));
});

test('release gate stops legacy Pages publishing and unreadable settings without exposing authentication', async () => {
    const token='synthetic-test-token';
    for(const [status,build_type,pass]of [[200,'workflow',true],[200,'legacy',false],[404,null,false],[403,null,false]]) {
        const check=checkPagesSource({repository:'Hk0984/vocabulary-app',token,fetchImpl:async()=>({ok:status===200,status,json:async()=>({build_type})})});
        if(pass)await check;
        else await assert.rejects(check,error=>{assert.doesNotMatch(error.message,/synthetic-test-token/);return true;});
    }
});

test('rollback reruns create a fresh artifact and deploy the matching run attempt', async () => {
    const workflow=JSON.parse(await readFile(new URL('../.github/workflows/web-release.yml',import.meta.url),'utf8'));
    const review=workflow.jobs.build.steps.find(step=>step.uses==='actions/upload-artifact@v4').with.name;
    const pages=workflow.jobs.build.steps.find(step=>step.uses==='actions/upload-pages-artifact@v4').with.name;
    const deployed=workflow.jobs.deploy.steps[0].with.artifact_name;
    const render=(template,attempt)=>template.replace(/\$\{\{\s*github\.(run_id|run_attempt)\s*\}\}/g,(_,key)=>String({run_id:123,run_attempt:attempt}[key]));
    assert.notEqual(render(review,1),render(review,2));
    assert.notEqual(render(pages,1),render(pages,2));
    assert.equal(render(pages,2),render(deployed,2));
});
