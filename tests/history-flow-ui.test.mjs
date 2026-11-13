import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const read=path=>readFile(new URL(path,import.meta.url),'utf8');
const sample=JSON.parse(await read('../templates/history-flow.sample.json'));
const regions=JSON.parse(await read('../history-regions.json'));
class Node {
    constructor(){this.children=[];this.listeners={};this.textContent='';this.hidden=false;this.disabled=false;this.value='';this.selectedOptions=[];}
    appendChild(n){this.children.push(n);}
    replaceChildren(){this.children=[];}
    setAttribute(){}
    addEventListener(name,fn){this.listeners[name]=fn;}
    click(){if(!this.disabled)(this.onclick||this.listeners.click)?.();}
    querySelectorAll(){return this.children.filter(n=>n.tag==='button');}
}
async function app(data=sample) {
    const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};let ready;
    const context=vm.createContext({document:{getElementById:get,createElement(tag){const n=new Node();n.tag=tag;return n;},addEventListener(_,fn){ready=fn;}},fetch:async url=>({ok:true,json:async()=>url.includes('regions')?regions:data})});
    context.window=context;
    vm.runInContext('let pageGeneration=0; function showPage(){pageGeneration++;}',context);
    for(const file of ['history-classification.js','history-flow.js','history-flow-config.js','history-flow-source.js','history-flow-ui.js'])vm.runInContext(await read('../'+file),context);
    context.HISTORY_FLOW_CONFIG={mode:'static'};
    get('flow_type').value='mixed';get('flow_count').value='all';ready();await context.openHistoryFlow();
    return {get,context,buttons:()=>get('flowChoices').children.filter(n=>n.tag==='button')};
}
test('UI: empty dataset and registration notice, no demo injection',async()=>{
    const a=await app({schema_version:'1.0',questions:[]});assert.equal(a.get('flowStart').disabled,true);assert.match(a.get('flowStatus').textContent,/まだ問題が登録されていません/);
});
test('UI: touch buttons, undo/reset, submit guard, summary, retry and settings',async()=>{
    const a=await app({schema_version:'1.0',questions:[sample.questions[1]]});a.get('flowStart').click();
    let b=a.buttons();b[0].click();assert.equal(b[0].disabled,true);b[3].click();assert.equal(b[0].disabled,false);
    b[0].click();b[4].click();assert.equal(b[0].disabled,false);
    assert.equal(b[5].disabled,true);
    b.slice(0,3).forEach(n=>n.click());assert.equal(b[5].disabled,false);b[5].click();
    assert.match(a.get('flowExplanation').textContent,/正解：/);assert.equal(a.get('flowNext').hidden,false);
    b[5].click();a.get('flowNext').click();assert.match(a.get('flowStatus').textContent,/出題数 1問/);
    a.get('flowNext').click();assert.match(a.get('flowStatus').textContent,/出題数 1問/);
    a.get('flowRetry').click();assert.equal(a.get('flowQuiz').hidden,false);
    a.get('flowChange').click();assert.equal(a.get('flowSettings').hidden,false);
});
test('UI: stale controls do not submit after leaving page; errors exclude invalid items',async()=>{
    const data=structuredClone(sample);data.questions[1].answer=['bad'];
    const a=await app(data);assert.match(a.get('flowErrors').textContent,/正解ID/);
    a.get('flowStart').click();const old=a.buttons()[0];vm.runInContext('showPage()',a.context);old.click();assert.equal(a.get('flowNext').hidden,true);
});
test('UI: Sheets access errors disable study without serving static questions',async()=>{
    const a=await app();
    a.context.HISTORY_FLOW_CONFIG={mode:'sheets',spreadsheetId:'mock-flow-public',sheetName:'history_flow_public',apiKey:'mock'};
    a.context.fetch=async url=>url.includes('regions')?{ok:true,json:async()=>regions}:{ok:false,status:403};
    await a.context.openHistoryFlow();
    assert.equal(a.get('flowStart').disabled,true);assert.match(a.get('flowStatus').textContent,/アクセスが許可されていません/);
});

test('UI: registered order follows filtered data order and applies count before retry', async()=>{
    const a=await app();
    a.get('flow_order').value='registered';a.get('flow_count').value='1';
    a.get('flowStart').click();
    assert.equal(a.get('flowQuestion').textContent,sample.questions[0].question);
    a.buttons()[0].click();a.get('flowNext').click();
    assert.match(a.get('flowStatus').textContent,/出題数 1問/);
    a.get('flowRetry').click();
    assert.equal(a.get('flowQuestion').textContent,sample.questions[0].question);
});
