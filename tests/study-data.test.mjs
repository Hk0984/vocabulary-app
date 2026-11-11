import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import '../attribute-tags.js';
import '../history-classification.js';
import '../history-flow.js';
import {csv,reconcile} from '../scripts/validate-study-data.mjs';
const master=HistoryClassification.validateMaster(JSON.parse(await readFile(new URL('../history-regions.json',import.meta.url),'utf8')));
const sample=JSON.parse(await readFile(new URL('../templates/history-flow.sample.json',import.meta.url),'utf8'));
const context=vm.createContext({document:{addEventListener(){}},AttributeTags});
vm.runInContext(await readFile(new URL('../script.js',import.meta.url),'utf8'),context);
test('labels: syntax, multiple paths, numeric dimensions and missing candidates',()=>{
    assert.deepEqual(AttributeTags.parse('person/politician;concept/theory'),['person/politician','concept/theory']);
    for(const x of ['x;;y','Number/year','x;x',' x',[], 'number/unit/%'])assert.throws(()=>AttributeTags.parse(x));
    assert.equal(AttributeTags.rank('number/percent','number/mass_kg'),-1);
    assert.equal(AttributeTags.rank('number/percent',''),-1);
    assert.equal(AttributeTags.rank('number/percent','number/calendar_year'),-1);
    assert.equal(AttributeTags.rank('number/mass_kg','number/mass_g'),-1);
    assert.ok(AttributeTags.rank('number/percent','number/percent')>0);
    assert.ok(AttributeTags.rank('person/politician','person/politician')>AttributeTags.rank('person/politician','person/scientist'));
});
for(const [label,valid] of [
    ['language/verb',true], ['number/percent',true], ['concept/academic;language/noun',true],
    ['number',false], ['number/mass/kg',false], ['concept/a/b/c',false], ['',true]
])test(`two-level label ${JSON.stringify(label)}: ${valid?'valid':'invalid'}`,()=>{
    if(valid)assert.deepEqual(AttributeTags.parse(label),label?label.split(';'):[]);
    else assert.throws(()=>AttributeTags.parse(label),/2階層/);
});
test('numeric formats cannot match indirectly through nonnumeric auxiliary labels',()=>{
    for(const [a,b] of [
        ['number/percent;concept/academic','number/calendar_year;concept/academic'],
        ['concept/academic','concept/academic;number/calendar_year']
    ]) {
        assert.equal(AttributeTags.rank(a,b),-1);assert.equal(AttributeTags.rank(b,a),-1);
    }
    assert.equal(AttributeTags.rank('person/politician','geography/country'),-1);
});
const choice=(current,words,format='frontToBack',hard=false)=>Array.from(context.buildAnswerChoices(current,words,format,hard?'hard answer':undefined,hard?new Map(words.map(w=>[w,w.back])):undefined));
test('labeled directions, hard meanings, incompatible and untagged exclusions',()=>{
    const words=[{front:'alpha',back:'15%',back_tags:'number/percent',front_tags:'person/politician'},
        {front:'bravo',back:'40%',back_tags:'number/percent',front_tags:'person/politician'},
        {front:'charlie',back:'80kg',back_tags:'number/mass_kg',front_tags:'geography/country'},
        {front:'delta',back:'70%'}, {front:'echo',back:'Newton',back_tags:'person/scientist'}];
    assert.deepEqual(choice(words[0],words),['15%','40%']);
    assert.deepEqual(choice(words[0],words,'backToFront'),['alpha','bravo']);
    assert.deepEqual(choice(words[0],words,'frontToBack',true),['hard answer','40%']);
    assert.deepEqual(choice(words[0],[words[0],words[2]]),['15%']);
    const unlabeled={front:'foxtrot',back:'無設定'};assert.equal(choice(unlabeled,[unlabeled,...words]).length,4);
});
test('choice engine keeps reduced choices and skips invalid labels without rewriting cards',()=>{
    const current={front:'alpha',back:'15%',back_tags:'number/percent'};
    const same={front:'bravo',back:'40%',back_tags:'number/percent'};
    const third={front:'charlie',back:'65%',back_tags:'number/percent'};
    const year={front:'delta',back:'1999',back_tags:'number/calendar_year'};
    const invalid={front:'echo',back:'80kg',back_tags:'number/mass/kg'};
    const words=[current,same,third,year,invalid];const before=structuredClone(words);
    assert.equal(choice(current,words).length,3);
    assert.ok(!choice(current,words).includes('1999'));
    assert.deepEqual(choice(current,[current,year,invalid]),['15%']);
    assert.deepEqual(choice(invalid,words),['80kg']);
    assert.deepEqual(words,before);
});
test('sheet parsing keeps ID and progress key when optional columns are added',()=>{
    const old=context.parseSheetData([['id','front','back'],['12','apple','果物']])[0];
    const next=context.parseSheetData([['id','front','back','front_tags','back_tags'],['12','apple','果物','language/noun','substance/food']])[0];
    assert.equal(old.id,next.id);assert.equal(context.getWordKey(old),context.getWordKey(next));
    assert.equal(next.back_tags,'substance/food');
});
test('CSV quoting and stable-ID reconciliation reject overwrite, mismatches and duplicates',()=>{
    assert.equal(csv('a,b\r\n"x,y","z""q"\r\n')[0].b,'z"q');
    const row={genre:'g',id:'1',front:'a',back:'b',front_tags:'',back_tags:'concept/academic'};
    assert.equal(reconcile([row],[row]),1);
    for(const r of [{...row,back_tags:''},{...row,id:'2'},{...row,front:'c'}])assert.throws(()=>reconcile([row],[r]));
    assert.throws(()=>reconcile([row],[row,row]));
    assert.throws(()=>reconcile([row],[{...row,back_tag:'concept/academic'}]));
});
test('CSV rejects invalid label depths on either side and preserves all input labels',()=>{
    const row={genre:'g',id:'1',front:'a',back:'b',front_tags:'language/verb',back_tags:'concept/academic;language/noun'};
    for(const side of ['front_tags','back_tags'])for(const bad of ['number','number/mass/kg','concept/a/b/c']) {
        const invalid={...row,[side]:bad},before=structuredClone(invalid);
        assert.throws(()=>reconcile([row],[invalid]),/2階層/);
        assert.throws(()=>reconcile([invalid],[row]),/2階層/);
        assert.deepEqual(invalid,before);
    }
    const before=structuredClone(row);assert.equal(reconcile([row],[row]),1);assert.deepEqual(row,before);
    assert.equal(reconcile([{...row,front_tags:'',back_tags:''}],[{...row,front_tags:'',back_tags:''}]),1);
});
test('flow validation rejects malformed items, classification, duplicates and answer references',()=>{
    assert.equal(HistoryFlow.load(sample,master).questions.length,2);
    for(const mutate of [q=>q.answer='missing',q=>q.choices[1].id='a',q=>q.period_codes='bad',q=>q.extra=true,q=>q.choices.pop(),q=>q.question='']){
        const data=structuredClone(sample);mutate(data.questions[0]);const result=HistoryFlow.load(data,master);assert.equal(result.errors.length,1);assert.equal(result.questions.length,1);
    }
    assert.equal(HistoryFlow.load({schema_version:'1.0',questions:[sample.questions[0],sample.questions[0]]},master).questions.length,0);
    assert.throws(()=>HistoryFlow.load({},master));
});
test('shuffled IDs, one answer only, ordering, incomplete answer, totals and filters',()=>{
    const s=HistoryFlow.session(sample.questions,()=>0);
    assert.notDeepEqual(s.options().map(v=>v.id),sample.questions[0].choices.map(v=>v.id));
    assert.equal(s.next(),false);assert.equal(s.submit('b'),true);assert.equal(s.submit('a'),null);assert.equal(s.next(),true);
    assert.equal(s.submit(['start']),null);assert.equal(s.submit(['end','middle','start']),false);s.next();
    assert.deepEqual(s.summary,{total:2,correct:1,incorrect:1,accuracy:50});
    const s2=HistoryFlow.session([sample.questions[1]]);assert.equal(s2.submit(['start','middle','end']),true);
    assert.equal(HistoryFlow.filter(sample.questions,{type:'ordering',periods:['medieval'],centuries:['ce_12']},master).length,1);
    assert.equal(HistoryFlow.filter(sample.questions,{periods:['modern']},master).length,0);
    assert.equal(HistoryFlow.filter(sample.questions,{areas:['geo.europe']},master).length,0);
    const local={...sample.questions[0],area_codes:'geo.france'};
    assert.equal(HistoryFlow.filter([local],{areas:['geo.europe']},master).length,1);
    assert.equal(HistoryFlow.session([]).summary.total,0);
});
