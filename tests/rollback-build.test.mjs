import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {buildRollback,OLD_ASSETS} from '../scripts/build-rollback-web.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const headers=['id','source_id','question','choice1','choice2','choice3','choice4','answer','explanation'];
async function output(){await mkdir(path.join(root,'dist'),{recursive:true});const p=await mkdtemp(path.join(root,'dist/rollback-test-'));return path.join(p,'release');}
const mock=values=>async(url,options)=>{
    assert.equal(decodeURIComponent(new URL(url).pathname.split('/').at(-1)),"'history_questions'!1:1");
    assert.equal(options.method,undefined);return {status:200,json:async()=>({values})};};
test('pinned old builder deterministically builds eleven verified assets with explicit public target',async()=>{
    const options={publicSheet:'synthetic-old-public',fetchImpl:mock([headers])};
    const a=await output(),b=await output();
    const first=await buildRollback({...options,outputDir:a}),second=await buildRollback({...options,outputDir:b});
    assert.equal(first.buildId,second.buildId);assert.equal(first.files.length,11);
    assert.ok(first.wordAndFirebaseSourceUnchanged);assert.deepEqual(first.files,[...OLD_ASSETS,'release.json']);
    const context={window:{}};vm.runInNewContext(await readFile(path.join(a,'web/history-config.js'),'utf8'),context);
    assert.equal(context.window.HISTORY_QUESTIONS_CONFIG.spreadsheetId,options.publicSheet);
});
test('management or current schemas are rejected before artifact generation',async()=>{
    for(const extra of [['status','batch_id','created_at'],['period_codes','century_codes','area_codes','time_ranges'],['status','batch_id','created_at','period_codes','century_codes','area_codes','time_ranges']]){
        await assert.rejects(buildRollback({publicSheet:'synthetic-rejected',outputDir:await output(),fetchImpl:mock([[...headers,...extra]])}),/nine-column public/);
    }
});
test('failed public header request stops instead of using the original historical target',async()=>{
    await assert.rejects(buildRollback({publicSheet:'synthetic-public',outputDir:await output(),fetchImpl:async()=>({status:403})}),/header request failed/);
});
