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
import { buildIphonePreview } from '../scripts/build-iphone-preview.mjs';
import { loadHistoryQuizCsv } from '../scripts/history-quiz-details.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('world history pilot joins reviewed details by the unchanged question and shuffles whole choices', async () => {
    const csv = await readFile(path.join(root, 'templates/history-quiz-pilot.sample.csv'), 'utf8');
    const regions = JSON.parse(await readFile(path.join(root, 'history-regions.json'), 'utf8'));
    const { values, details, atlas } = await loadHistoryQuizCsv(csv, regions);
    assert.equal(values[0].length, 13);
    assert.equal(values.length, 4);
    assert.deepEqual(details.pilot_sample_002.locations[0], [28.9802, 41.0086]);
    assert.equal(details.pilot_sample_003.kind, '');
    assert.ok(atlas.some(([code]) => code === 'FRA'));
    const context = { HISTORY_QUIZ_DETAILS: { details, atlas } };
    vm.runInNewContext(await readFile(path.join(root, 'history_questions.js'), 'utf8'), context);
    const [source] = values.slice(1).map(row => Object.fromEntries(values[0].map((header, index) => [header, row[index]])));
    const [session] = context.HistoryQuestionCore.createSession([source], 10, () => 0);
    assert.equal(session.mapKind, 'country');
    assert.equal(session.choices[0].text, source.choice2);
    assert.equal(session.choices[0].correct, true);
    assert.equal(session.choices[0].location, 'FRA');
    assert.equal(session.choices[0].explanation, details[source.id].explanations[1]);
    const [stale] = context.HistoryQuestionCore.createSession([{ ...source, choice1: '変更済み' }]);
    assert.equal(stale.mapKind, undefined);
    assert.ok(stale.choices.every(choice => !choice.explanation));
    await assert.rejects(loadHistoryQuizCsv(csv.replace('explanation1,explanation2', 'explanation2,explanation1'), regions), /列名または列順/);
    await assert.rejects(loadHistoryQuizCsv(csv.replace('41.0086|28.9802', '91|28.98'), regions), /緯度/);
    await assert.rejects(loadHistoryQuizCsv(csv.replace('country,DEU,FRA', 'country,ZZZ,FRA'), regions), /国コード/);
});
test('production flow config reuses the browser key and Actions builds the same allowlist',async()=>{
    const source=await readFile(path.join(root,'history-flow-config.js'),'utf8');
    const context={window:{HISTORY_QUESTIONS_CONFIG:{apiKey:'mock-existing-browser-key'}}};
    vm.runInNewContext(source,context);
    const config=context.window.HISTORY_FLOW_CONFIG;
    assert.deepEqual(Object.keys(config).sort(),['apiKey','mode','sheetName','spreadsheetId']);
    assert.equal(config.mode,'sheets');assert.equal(config.spreadsheetId,'1CUqOaYi0PcPrWOmrPvf_C5NYAjZ1krB24FYdG_lImak');
    assert.equal(config.sheetName,'history_flow_public');assert.equal(config.apiKey,'mock-existing-browser-key');
    const workflow=JSON.parse(await readFile(path.join(root,'.github/workflows/web-release.yml'),'utf8'));
    const steps=workflow.jobs.build.steps;
    assert.ok(steps.some(s=>s.run?.includes('node --test tests/web-build.test.mjs tests/service-worker.test.mjs')));
    assert.ok(steps.some(s=>s.run?.includes('scripts/build-web.mjs --history-public-config config/history-public-rebuild.json')));
    for(const name of ['history-flow-config.js','history-flow-source.js','history-flow-ui.js','history-flow.js'])assert.ok(WEB_FILES.includes(name));
    assert.ok(!WEB_FILES.some(n=>n.startsWith('materials/')||n.startsWith('bot/')));
});
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
    for (const name of ['bot/operations.txt', 'docs/ai-handoff/HANDOFF.md',
        'scripts/print-ai-handoff.mjs', 'tests/private-fixture.txt', 'node_modules/example.txt', 'local-config.txt']) {
        await mkdir(path.dirname(path.join(options.sourceDir, name)), {recursive:true});
        await writeFile(path.join(options.sourceDir, name), 'not for publication');
    }
    const result = await buildWeb(options);
    const expected = ['index.html','style.css','script.js','history-config.js','history_questions.js',
        'history-classification.js','history-regions.json',
        'attribute-tags.js','choice-dictionary.json','history-flow.js','history-flow-ui.js','history-flow-data.json',
        'history-flow-config.js','history-flow-source.js',
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

test('new public environment build changes only public connection and retains the original config',async t=>{
    const options=await fixture(t);
    const config='window.HISTORY_QUESTIONS_CONFIG={spreadsheetId:"old-public",sheetName:"old",apiKey:"test-public-key"};\n';
    await writeFile(path.join(options.sourceDir,'history-config.js'),config);
    const override={spreadsheetId:'new-public',sheetName:'new',expectedIdPrefix:'hv1_rebuild1_',requireCurrentSchema:true};
    await buildWeb({...options,publicConfig:override});
    const context={window:{}};vm.runInNewContext(await readFile(path.join(options.outputDir,'history-config.js'),'utf8'),context);
    assert.equal(context.window.HISTORY_QUESTIONS_CONFIG.spreadsheetId,'new-public');
    assert.equal(context.window.HISTORY_QUESTIONS_CONFIG.expectedIdPrefix,'hv1_rebuild1_');
    assert.equal(context.window.HISTORY_QUESTIONS_CONFIG.apiKey,'test-public-key');
    assert.equal(await readFile(path.join(options.sourceDir,'history-config.js'),'utf8'),config);
    assert.equal((await filesIn(options.outputDir)).length,20);
    await buildWeb({...options,outputDir:path.join(options.dir,'rollback')});
    assert.equal(await readFile(path.join(options.dir,'rollback/history-config.js'),'utf8'),config);
});

test('invalid or private new-environment overrides fail before creating an artifact',async t=>{
    const options=await fixture(t);
    await writeFile(path.join(options.sourceDir,'history-config.js'),'window.HISTORY_QUESTIONS_CONFIG={spreadsheetId:"old-public",apiKey:"test-public-key"};');
    const base={spreadsheetId:'new-public',sheetName:'new',expectedIdPrefix:'hv1_rebuild1_',requireCurrentSchema:true};
    for(const change of [{spreadsheetId:''},{spreadsheetId:'old-public'},{expectedIdPrefix:'legacy_'},{requireCurrentSchema:false},{management_spreadsheet_id:'private'},{sheetName:'-----BEGIN PRIVATE KEY----- SYNTHETIC_TEST_ONLY'}])await assert.rejects(buildWeb({...options,publicConfig:{...base,...change}}));
    await assert.rejects(readdir(options.outputDir),{code:'ENOENT'});
});

test('environment choice remains manual, legacy by default, with a fixed public-only config path',async()=>{
    const workflow=JSON.parse(await readFile(new URL('../.github/workflows/web-release.yml',import.meta.url),'utf8'));
    assert.deepEqual(Object.keys(workflow.on),['workflow_dispatch']);
    assert.equal(workflow.on.workflow_dispatch.inputs.history_environment.default,'legacy');
    assert.deepEqual(workflow.on.workflow_dispatch.inputs.history_environment.options,['legacy','rebuild_v1']);
    const build=workflow.jobs.build.steps.find(s=>s.name==='Build allowlisted web assets');
    assert.match(build.run,/--history-public-config config\/history-public-rebuild.json/);
    assert.equal(build.env.HISTORY_ENVIRONMENT,'${{ inputs.history_environment }}');
});

test('iPhone artifact is distinct and contains only synthetic data and same-origin connections', async t => {
    const {outputDir,sourceDir} = await fixture(t);
    const preview = await buildIphonePreview(outputDir);
    const production = await buildWeb({sourceDir,outputDir:path.join(outputDir,'../production')});
    assert.notEqual(preview.buildId,production.buildId);
    assert.deepEqual(preview.files.sort(),production.files.sort());
    const read = name => readFile(path.join(outputDir,name),'utf8');
    const html = await read('index.html');
    assert.match(html,/iPhone検証用・架空データ・履歴保存なし/);
    assert.match(html,/connect-src 'self'/);
    assert.doesNotMatch(html,/gstatic|<script src="https?:/);
    const code = [await read('script.js'), await read('history-config.js'), await read('history-flow-config.js')].join('\n');
    assert.match(code,/const FIREBASE_CONFIG = \{\}/);
    assert.match(code,/iphone-review-history/);
    assert.doesNotMatch(code,/AIza[A-Za-z0-9_-]{35}|firebaseapp\.com|appspot\.com/);
    const data = JSON.parse(await read('history-flow-data.json'));
    assert.deepEqual(data.questions.map(q=>q.type),['contemporary','ordering','cloze']);
    assert.ok(data.questions.every(q=>q.id.startsWith('sample_')));
    assert.equal(JSON.parse(await read('choice-dictionary.json')).reviewed_numeric,undefined);
    const release = JSON.parse(await read('release.json'));
    for (const asset of release.files) {
        assert.equal(createHash('sha256').update(await readFile(path.join(outputDir,asset.name))).digest('hex'),asset.sha256);
    }
});
