import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import '../history-classification.js';
import '../history-flow.js';
import '../history-flow-source.js';
import {csv} from '../scripts/validate-study-data.mjs';
const rows=csv((await readFile(new URL('../tests/fixtures/flow-admin.synthetic.csv',import.meta.url),'utf8')).replace(/^\uFEFF/,''));
const master=HistoryClassification.validateMaster(JSON.parse(await readFile(new URL('../history-regions.json',import.meta.url),'utf8')));
const values=[HistoryFlowSource.HEADERS,...rows.map(r=>HistoryFlowSource.HEADERS.map(k=>r[k]))];
const config={mode:'sheets',spreadsheetId:'mock-flow-public',sheetName:'history_flow_public',apiKey:'mock-public-key'};

test('all 61 synthetic draft questions project to independent public schema and grade by stable IDs',()=>{
    const before=structuredClone(rows);
    assert.equal(rows.length,61);assert.ok(rows.every(r=>r.status==='draft'));
    // Simulate the post-approval public projection only; never changes the source CSV.
    const loaded=HistoryFlowSource.parseValues(values,master);
    assert.equal(loaded.questions.length,61);
    assert.equal(loaded.questions.filter(q=>q.type==='contemporary').length,31);
    assert.equal(loaded.questions.filter(q=>q.type==='ordering').length,30);
    const session=HistoryFlow.session(HistoryFlow.shuffle(loaded.questions,()=>0),()=>0);
    while(session.current){
        const q=session.current;assert.ok(q.explanation);assert.equal(q.source,undefined);
        assert.deepEqual(new Set(session.options().map(i=>i.id)),new Set((q.choices||q.events).map(i=>i.id)));
        assert.equal(session.submit(q.answer),true);assert.equal(session.submit(q.answer),null);session.next();
    }
    assert.deepEqual(session.summary,{total:61,correct:61,incorrect:0,accuracy:100});
    assert.ok(HistoryFlow.filter(loaded.questions,{periods:['ancient']},master).length);
    assert.ok(HistoryFlow.filter(loaded.questions,{areas:['geo.europe']},master).length);
    assert.ok(HistoryFlow.filter(loaded.questions,{centuries:['bce_05']},master).length);
    assert.deepEqual(rows,before);
});
test('private/admin headers, duplicates, malformed public rows and partial ordering fail closed',()=>{
    assert.throws(()=>HistoryFlowSource.parseValues([[...HistoryFlowSource.HEADERS,'source','status']],master),/21列/);
    assert.throws(()=>HistoryFlowSource.parseValues([...values,values[1]],master),/重複/);
    const wrong=structuredClone(values);wrong[1][HistoryFlowSource.HEADERS.indexOf('answer')]='missing';
    assert.throws(()=>HistoryFlowSource.parseValues(wrong,master),/不正データ/);
    const excess=structuredClone(values);excess[1].push('private');assert.throws(()=>HistoryFlowSource.parseValues(excess,master));
    const formula=structuredClone(values);formula[1][2]='=QUERY(A1)';assert.throws(()=>HistoryFlowSource.parseValues(formula,master),/式/);
    assert.equal(HistoryFlowSource.parseValues([HistoryFlowSource.HEADERS],master).questions.length,0);
});
test('Sheets fetch uses one public source with no static fallback or merging',async()=>{
    const requests=[];
    const loaded=await HistoryFlowSource.load(master,config,async(url,options)=>{requests.push(url);assert.equal(options.cache,'no-store');return {ok:true,json:async()=>({values})};});
    assert.equal(loaded.questions.length,61);assert.equal(requests.length,1);assert.match(requests[0],/^https:\/\/sheets.googleapis.com/);
    await assert.rejects(HistoryFlowSource.load(master,config,async()=>{throw Error('private transport details');}),/ネットワーク/);
    for(const [status,pattern]of [[403,/許可/],[404,/見つかりません/],[500,/取得できません/]]){
        let calls=0;await assert.rejects(HistoryFlowSource.load(master,config,async()=>{calls++;return {ok:false,status};}),pattern);assert.equal(calls,1);
    }
    let path;
    await HistoryFlowSource.load(master,{mode:'static'},async url=>{path=url;return {ok:true,json:async()=>({schema_version:'1.0',questions:[]})};});
    assert.equal(path,'history-flow-data.json');
});
test('source selection is explicit and rejects private settings or one-question sheet reuse',()=>{
    for(const c of [{},{mode:'sheets'}, {...config,adminSpreadsheetId:'private'}, {...config,sheetName:'history_flow_admin'}, {mode:'static',fallback:true}])assert.throws(()=>HistoryFlowSource.validateConfig(c));
    globalThis.HISTORY_QUESTIONS_CONFIG={spreadsheetId:config.spreadsheetId};
    try{assert.throws(()=>HistoryFlowSource.validateConfig(config));}finally{delete globalThis.HISTORY_QUESTIONS_CONFIG;}
});
