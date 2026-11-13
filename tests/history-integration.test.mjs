import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const master=JSON.parse(source('history-regions.json'));
const headers=['id','source_id','question','choice1','choice2','choice3','choice4','answer','explanation','period_codes','century_codes','area_codes','time_ranges'];
const row=(id='001')=>[id,'s','問題','A','B','C','D','2','解説','medieval','ce_11','geo.normandy','1066..1066'];
function app() {
    const elements=new Map();
    const make=()=>({style:{},dataset:{},children:[],classList:{toggle(){},add(){}},textContent:'',hidden:false,
        set innerHTML(v){this.children=[];},appendChild(c){this.children.push(c);},replaceChildren(){this.children=[];},addEventListener(){},querySelectorAll(){return[];}});
    const document={addEventListener(){},createElement:make,createTextNode:text=>({textContent:text}),getElementById(id){if(!elements.has(id))elements.set(id,make());return elements.get(id);},querySelectorAll(selector){return selector==='main > section'?['homePage','sheetPage','settingsPage','historyPage','progressPage'].map(id=>this.getElementById(id)):[];}};
    const context=vm.createContext({document,console,alert(){}});context.window=context;context.scrollTo=()=>{};
    for(const name of ['history-classification.js','history_questions.js','script.js'])vm.runInContext(source(name),context);
    context.HistoryClassification.setRegions(master);
    const rows=context.HistoryQuestionCore.parseHistoryQuestionValues([headers,row(),row('002'),row('003')]);
    const publicLoader=context.loadHistoryQuestions;
    context.loadHistoryQuestions=async()=>rows;
    vm.runInContext(`currentUser={uid:'A',isAnonymous:false};progressLoad={uid:'A',request:1,status:'ready'};progress={history_questions:{history_001:{total:10,wrong:5,correct:5},history_002:{total:5,wrong:1,correct:4}}};`,context);
    return {context,elements,rows,publicLoader,run:s=>vm.runInContext(s,context)};
}
test('public parser accepts only exact legacy/current headers, keeps string IDs and defaults legacy rows',()=>{
    const {context}=app(),parse=context.HistoryQuestionCore.parseHistoryQuestionValues;
    assert.equal(parse([headers,row()])[0].id,'001');
    assert.equal(parse([headers.slice(0,9),row().slice(0,9)])[0].area_codes,'unclassified');
    assert.equal(parse([[...headers,'status'],[...row(),'published']]).length,0);
    assert.equal(parse([headers.slice(0,12),row().slice(0,12)]).length,0);
    const malformed=row();malformed[11]='geo.unknown';
    assert.equal(parse([headers,malformed]).length,0);
    const padded=row();padded[10]='';padded.pop();
    assert.equal(parse([headers,padded]).length,1);
});
test('virtual genre is unique, independent of word sheets, and links through settings',async()=>{
    const {context,elements,run}=app();
    run(`SHEETS=[{title:'English'},{title:'古文'},{title:'history_questions'}];renderSheetList()`);
    assert.equal(elements.get('sheetList').children.length,4);
    assert.equal(elements.get('sheetList').children[2].textContent,'世界史一問一答');
    assert.equal(elements.get('sheetList').children[3].textContent,'世界史の流れ');
    assert.equal(elements.get('sheetList').children[3].className,'sheet-button');
    run(`SHEETS=[];renderSheetList()`);
    assert.equal(elements.get('sheetList').children.length,2);
    await context.openHistorySettings();
    assert.equal(elements.get('settingsPage').style.display,'');
    assert.equal(elements.get('vocabularyRange').hidden,true);
    assert.equal(elements.get('historyThirty').hidden,false);
    assert.equal(elements.get('beginStudyButton').disabled,false);
});
test('history modes use legacy counters and classification axes without changing records',async()=>{
    const {context,run}=app();await context.openHistorySettings();
    const before=run('JSON.stringify(progress)');
    for(const [mode,expected]of [['normal',3],['weak',1],['incorrect',2],['unlearned',1]])assert.equal(run(`studySettings.mode='${mode}';historyCandidates().length`),expected);
    assert.equal(run(`studySettings.mode='normal';historyFilters.areas.add('geo.france');historyCandidates().length`),3);
    assert.equal(run(`historyFilters.centuries.add('ce_12');historyCandidates().length`),0);
    assert.equal(run('JSON.stringify(progress)'),before);
    run(`historyFilters.centuries.clear();progressLoad.status='error';studySettings.mode='weak'`);
    assert.equal(run('historyCandidates().length'),0);
});
test('anonymous history remains readable without writes; history progress joins string IDs',async()=>{
    const {context,run,elements}=app();
    run('currentUser=null;progress={};');await context.openHistorySettings();
    assert.equal(elements.get('settingsPage').style.display,'');
    assert.equal(run('historyCandidates().length'),3);
    assert.equal(await context.recordHistoryAnswer({id:'001'},true),false);
    assert.match(context.historySavingNotice(),/保存しません/);
    run(`currentUser={uid:'A',isAnonymous:false};progressLoad={uid:'A',request:1,status:'ready'};progress={history_questions:{history_001:{total:2,correct:1,wrong:1}}}`);
    context.showPage('progressPage');await context.renderProgress('history_questions');
    assert.equal(elements.get('progressSheetName').textContent,'世界史一問一答');
    assert.equal(context.currentProgressWords[0].word.historyId,'001');
    assert.equal(context.currentProgressWords[0].total,2);
    assert.equal(context.currentProgressWords[0].word.back,'B');
});
test('late history genre selection cannot overwrite another page or account',async()=>{
    const {context,run,rows}=app();let release;
    context.loadHistoryQuestions=()=>new Promise(r=>{release=r;});
    const pending=context.openHistorySettings();
    context.showPage('homePage');release(rows);await pending;
    assert.equal(run('historyQuestions.length'),0);
    const other=context.openHistorySettings();
    run(`currentUser={uid:'B',isAnonymous:false};resetProgressLoad(currentUser)`);release(rows);await other;
    assert.equal(run('historyQuestions.length'),0);
});

test('history counts cap the unique population and switching back restores word-only controls',async()=>{
    const {context,run,elements,rows}=app();await context.openHistorySettings();
    const population=Array.from({length:55},(_,i)=>({...rows[0],id:String(i)}));
    for(const [count,expected]of [[10,10],[20,20],[30,30],[50,50],['unlimited',55],[100,55]]){
        const session=context.HistoryQuestionCore.createSession([...population,population[0]],count);
        assert.equal(session.length,expected);assert.equal(new Set(session.map(q=>q.id)).size,expected);
        assert.ok(session.every(q=>q.choices.filter(c=>c.correct).length===1));
    }
    run(`selectedSheet='古文';studySettings.count='30';configureGenreSettings()`);
    assert.equal(elements.get('historyThirty').hidden,true);
    assert.equal(elements.get('vocabularyRange').hidden,false);
    assert.equal(Number(run('studySettings.count')),10);
});

test('a late history progress response after leaving the page never repopulates the view',async()=>{
    const {context,rows}=app();let release;
    context.loadHistoryQuestions=()=>new Promise(r=>{release=r;});
    context.showPage('progressPage');const pending=context.renderProgress('history_questions');
    context.showPage('homePage');release(rows);await pending;
    assert.equal(context.currentProgressWords.length,0);
});

test('dedicated public loader distinguishes empty data from private or intermediate schemas',async()=>{
    const {context,publicLoader}=app();
    context.HISTORY_QUESTIONS_CONFIG={spreadsheetId:'mock-public',sheetName:'questions',apiKey:'mock'};
    context.fetch=async()=>({ok:true,json:async()=>({})});
    assert.equal((await publicLoader()).length,0);
    context.fetch=async()=>({ok:true,json:async()=>({values:[headers,row()]})});
    assert.equal((await publicLoader())[0].id,'001');
    context.fetch=async()=>({ok:true,json:async()=>({values:[[...headers,'status'],[...row(),'draft']]})});
    await assert.rejects(publicLoader(),/形式/);
});

test('newer history selection wins when an older selection returns later',async()=>{
    const {context,rows,run}=app(),releases=[];
    context.loadHistoryQuestions=()=>new Promise(resolve=>releases.push(resolve));
    const first=context.openHistorySettings(),second=context.openHistorySettings();
    releases[1]([rows[1]]);await second;releases[0]([rows[0]]);await first;
    assert.equal(run('historyQuestions[0].id'),'002');
});

test('word settings survive a history session and history settings remain separate',async()=>{
    const {context,run}=app();
    run(`studySettings={mode:'weak',count:'20',meaningDisplay:'hard',format:'backToFront',rangeMode:'id'};`);
    await context.openHistorySettings();
    assert.equal(run('studySettings.mode'),'normal');
    run(`studySettings.count='30';selectedSheet='古文';configureGenreSettings()`);
    assert.equal(run('studySettings.count'),'20');
    assert.equal(run('studySettings.mode'),'weak');
    assert.equal(run('studySettings.meaningDisplay'),'hard');
    assert.equal(run('studySettings.format'),'backToFront');
    assert.equal(run('studySettings.rangeMode'),'id');
    await context.openHistorySettings();
    assert.equal(run('studySettings.count'),'30');
});

test('classical Japanese continues through the unchanged vocabulary parser and settings flow',async()=>{
    const {context,run,elements}=app();await context.openHistorySettings();
    context.fetchSheetData=async()=>[['id','表面','裏面'],['001','あはれ','しみじみとした趣']];
    await context.selectSheet('古文');
    assert.equal(run('studyWords[0].front'),'あはれ');
    assert.equal(run('studyWords[0].back'),'しみじみとした趣');
    assert.equal(run('studyWords[0].id'),1);
    assert.equal(elements.get('historyFilters').hidden,true);
    assert.equal(elements.get('vocabularyMeaning').hidden,false);
    assert.equal(elements.get('settingsPage').style.display,'');
});

test('new environment rejects legacy schemas and mixed namespaces instead of reading old history IDs',()=>{
    const {context}=app();const config={requireCurrentSchema:true,expectedIdPrefix:'hv1_rebuild1_'};
    assert.throws(()=>context.HistoryQuestionCore.parseDataset([headers.slice(0,9),row().slice(0,9)],config));
    assert.throws(()=>context.HistoryQuestionCore.parseDataset([headers,row('001')],config));
    assert.throws(()=>context.HistoryQuestionCore.parseDataset([headers,row('hv1_rebuild1_001'),row('001')],config));
    assert.equal(context.HistoryQuestionCore.parseDataset([headers,row('hv1_rebuild1_001')],config)[0].id,'hv1_rebuild1_001');
    assert.equal(context.HistoryQuestionCore.parseDataset([headers.slice(0,9),row().slice(0,9)],{}).length,1);
});

test('new public environment requires initialization while legacy empty reads remain compatible',async()=>{
    const {context,publicLoader}=app();
    context.HISTORY_QUESTIONS_CONFIG={spreadsheetId:'mock-new',sheetName:'new',apiKey:'mock',requireCurrentSchema:true,expectedIdPrefix:'hv1_rebuild1_'};
    context.fetch=async()=>({ok:true,json:async()=>({})});
    await assert.rejects(publicLoader(),/ヘッダ/);
    context.fetch=async()=>({ok:true,json:async()=>({values:[headers]})});
    assert.equal((await publicLoader()).length,0);
});
