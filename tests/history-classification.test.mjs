import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import '../history-classification.js';
const C=globalThis.HistoryClassification;
const masterData=JSON.parse(readFileSync(new URL('../history-regions.json',import.meta.url)));
const master=C.validateMaster(masterData);
const fixture=JSON.parse(readFileSync(new URL('./fixtures/history-classification.json',import.meta.url)));
for(const [year,period,century] of fixture.years) test(`classification boundary ${year}`,()=>{
    const row={period_codes:period,century_codes:century,area_codes:'geo.france',time_ranges:`${year}..${year}`};
    assert.doesNotThrow(()=>C.validate(row,master));
    assert.ok(C.matches(row,{periods:[period],centuries:[century]},master));
});
test('invalid ranges, missing and extra codes, and ambiguous dates fail closed',()=>{
    for(const value of fixture.invalidRanges) assert.throws(()=>C.parseRanges(value));
    for(const patch of [{period_codes:'medieval'},{period_codes:'toString'},{period_codes:'constructor'},{century_codes:'ce_17'},{area_codes:'global;geo.france'},{area_codes:'geo.france;;geo.normandy'},{area_codes:'geo.missing'},{period_codes:'unclassified'}])assert.throws(()=>C.validate({...fixture.intersection,...patch},master));
    assert.throws(()=>C.validate({period_codes:'modern;contemporary',century_codes:'ce_19;ce_20',area_codes:'global',time_ranges:''},master));
    assert.ok(C.validate({...fixture.intersection,time_ranges:'1850..1850;1750..1750'},master).warnings.length);
});
test('region master is a validated 92-node DAG with directional descendants',()=>{
    assert.equal(master.size,92);
    for(const [parent,child,expected]of fixture.descendants)assert.equal(C.descendants(master,[parent]).has(child),expected);
    for(const mutation of [d=>d.regions.push(d.regions[0]),d=>d.regions[0].parents=['geo.missing'],d=>d.regions[0].parents=[d.regions[0].code],d=>{d.regions[0].parents=['geo.france'];}]){const data=structuredClone(masterData);mutation(data);assert.throws(()=>C.validateMaster(data));}
});
test('AND across axes uses the same date; all concrete regions do not include global or unclassified',()=>{
    const row=fixture.intersection;
    assert.equal(C.matches(row,{periods:['modern'],centuries:['ce_18']},master),false);
    assert.equal(C.matches(row,{periods:['early_modern','modern'],centuries:['ce_19'],areas:['geo.france']},master),true);
    assert.equal(C.matches({...row,century_codes:''},{centuries:['ce_19']},master),false);
    assert.equal(C.matches({...row,area_codes:'global'},{areas:[...master.keys()]},master),false);
    const legacy=C.defaults({});
    assert.equal(C.matches(legacy,{},master),true);
    assert.equal(C.matches(legacy,{areas:['geo.france']},master),false);
    assert.equal(C.matches({...row,area_codes:'unclassified'},{periods:['modern']},master),false);
});

test('split BCE/CE ranges have no year zero, century spelling is canonical, inactive codes remain readable',()=>{
    const row={period_codes:'ancient',century_codes:'bce_01;ce_01',area_codes:'geo.france',time_ranges:'-2..-1;1..2'};
    assert.doesNotThrow(()=>C.validate(row,master));
    for(const code of ['ce_00','ce_1','ce_001','ce_1001','bce_0'])assert.throws(()=>C.centuryRange(code));
    const inactive=structuredClone(masterData);inactive.regions.find(n=>n.code==='geo.france').active=false;
    assert.doesNotThrow(()=>C.validate(row,C.validateMaster(inactive)));
});
