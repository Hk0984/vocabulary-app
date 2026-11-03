/* Shared classification contract. No network, credentials, storage, or year zero. */
(function (root) {
    'use strict';
    const BASE_HEADERS = ['id','source_id','question','choice1','choice2','choice3','choice4','answer','explanation'];
    const EXTRA_HEADERS = ['period_codes','century_codes','area_codes','time_ranges'];
    const PERIODS = {
        prehistoric: [-100000,-3501], ancient: [-3500,500], medieval: [501,1500],
        early_modern: [1501,1800], modern: [1801,1918], contemporary: [1919,100000]
    };
    const PERIOD_LABELS = {prehistoric:'先史',ancient:'古代',medieval:'中世',early_modern:'近世',modern:'近代',contemporary:'現代'};
    const SPECIAL = ['unclassified','unspecified'];
    const fail = message => { throw new Error(message); };
    function codes(value, optional = false) {
        if (typeof value !== 'string' || value.length > 24000) fail('分類コードが不正です');
        if (!value && optional) return [];
        const result = value.split(';');
        if (result.length > 2048 || result.some(code => !code || code.trim() !== code) || new Set(result).size !== result.length) fail('分類コードの空要素・重複があります');
        return result;
    }
    function validateMaster(data) {
        const types = ['major_region','subregion','country_area','historical_region','composite_region'];
        if (!data || data.schema_version !== '1.0' || !Array.isArray(data.regions) || !data.regions.length || data.regions.length > 4096) fail('地域マスターの形式が不正です');
        const nodes = new Map();
        for (const node of data.regions) {
            if (!node || !/^geo\.[a-z][a-z0-9_]*$/.test(node.code) || nodes.has(node.code) || typeof node.label !== 'string' || !node.label.trim() || !types.includes(node.type) || typeof node.active !== 'boolean' || !Array.isArray(node.aliases) || node.aliases.some(a=>typeof a!=='string') || !Array.isArray(node.parents) || new Set(node.parents).size !== node.parents.length) fail('地域マスターのノードが不正です');
            nodes.set(node.code, node);
        }
        const pending=new Map(),children=new Map(),depth=new Map(),queue=[];
        for(const node of nodes.values()) {
            pending.set(node.code,node.parents.length);depth.set(node.code,1);
            if(!node.parents.length)queue.push(node.code);
            for(const parent of node.parents) {
                if(!nodes.has(parent))fail('地域マスターの親が存在しません');
                if(!children.has(parent))children.set(parent,[]);
                children.get(parent).push(node.code);
            }
        }
        for(let i=0;i<queue.length;i++)for(const child of children.get(queue[i])||[]) {
            depth.set(child,Math.max(depth.get(child),depth.get(queue[i])+1));
            if(depth.get(child)>64)fail('地域マスターの階層が深すぎます');
            pending.set(child,pending.get(child)-1);
            if(pending.get(child)===0)queue.push(child);
        }
        if(queue.length!==nodes.size)fail('地域マスターが循環しています');
        return nodes;
    }
    function descendants(master, selected) {
        const result = new Set(selected);
        if (selected.some(code=>!master.has(code))) fail('地域コードが存在しません');
        let changed = true;
        while (changed) {
            changed = false;
            for (const node of master.values()) if (!result.has(node.code) && node.parents.some(parent=>result.has(parent))) {
                result.add(node.code); changed = true;
            }
        }
        return result;
    }
    function parseRanges(value) {
        if (typeof value !== 'string' || value.length > 2048) fail('年代範囲が不正です');
        if (!value) return [];
        const chunks = value.split(';');
        if (chunks.length > 64) fail('年代範囲が多すぎます');
        const ranges = chunks.map(chunk => {
            const match = /^(-?[1-9][0-9]*)\.\.(-?[1-9][0-9]*)$/.exec(chunk);
            if (!match) fail('年代は0のないASCII整数で指定してください');
            const a = Number(match[1]), b = Number(match[2]);
            if (Math.abs(a)>100000 || Math.abs(b)>100000 || a>b || (a<0&&b>0)) fail('年代の範囲・順序・紀元前後の分割が不正です');
            return [a,b];
        });
        const sorted = [...ranges].sort((a,b)=>a[0]-b[0]);
        if (sorted.some((range,i)=>i>0&&range[0]<=sorted[i-1][1])) fail('年代範囲が重複しています');
        return ranges;
    }
    function centuryRange(code) {
        const match = /^(ce|bce)_([0-9]{2,})$/.exec(code);
        if (!match) fail('世紀コードが不正です');
        const n = Number(match[2]);
        if (!Number.isInteger(n) || n<1 || n>1000 || String(n).padStart(2,'0')!==match[2]) fail('世紀の範囲・表記が不正です');
        return match[1]==='ce' ? [(n-1)*100+1,n*100] : [-n*100,-(n-1)*100-1];
    }
    const overlaps = (a,b) => Math.max(a[0],b[0])<=Math.min(a[1],b[1]);
    const equalSet = (a,b) => a.length===b.size&&a.every(x=>b.has(x));
    function defaults(row) {
        return {...row,period_codes:'unclassified',century_codes:'',area_codes:'unclassified',time_ranges:''};
    }
    function validate(row, master) {
        const periods = codes(row.period_codes), centuries = codes(row.century_codes,true), areas = codes(row.area_codes), ranges = parseRanges(row.time_ranges);
        const warnings = [];
        if (periods.some(p=>!Object.hasOwn(PERIODS,p)&&!SPECIAL.includes(p)) || (periods.some(p=>SPECIAL.includes(p))&&periods.length!==1)) fail('時代コードが不正です');
        const centuryRanges = centuries.map(centuryRange);
        if (areas.some(a=>!master.has(a)&&!['global',...SPECIAL].includes(a)) || (areas.some(a=>['global',...SPECIAL].includes(a))&&areas.length!==1)) fail('地域コードが不正です');
        if (periods.some(p=>SPECIAL.includes(p))&&(ranges.length||centuries.length)) fail('未分類・時代指定なしに年代や世紀は指定できません');
        if (ranges.length) {
            const expectedPeriods = new Set(Object.keys(PERIODS).filter(p=>ranges.some(r=>overlaps(r,PERIODS[p]))));
            if (!equalSet(periods,expectedPeriods)) fail('年代と時代コードが一致しません');
            if (centuries.length) {
                const expected = new Set();
                for (const [a,b] of ranges) for(let n=Math.ceil(Math.min(Math.abs(a),Math.abs(b))/100);n<=Math.ceil(Math.max(Math.abs(a),Math.abs(b))/100);n++) expected.add((a<0?'bce_':'ce_')+String(n).padStart(2,'0'));
                if (!equalSet(centuries,expected)) fail('年代と世紀コードが一致しません');
            }
            if (ranges.some((r,i)=>i>0&&r[0]<ranges[i-1][0])) warnings.push('年代範囲は昇順を推奨します');
        } else if (centuries.length) {
            if (periods.some(p=>!centuryRanges.some(c=>overlaps(c,PERIODS[p]))) || centuryRanges.some(c=>!periods.some(p=>overlaps(c,PERIODS[p])))) fail('時代と世紀が一致しません');
            if (periods.length>1 && centuries.length>1 && centuryRanges.some(c=>periods.filter(p=>overlaps(c,PERIODS[p])).length>1)) fail('複数時代・世紀の対応を年代範囲で指定してください');
        }
        for(const area of areas) if(master.has(area)&&areas.some(parent=>parent!==area&&master.has(parent)&&descendants(master,[parent]).has(area))) warnings.push('地域の親子が重複指定されています');
        return {periods,centuries,areas,ranges,warnings};
    }
    function matches(row, filters, master) {
        const parsed = validate(row,master);
        const periods = filters.periods||[], centuries = filters.centuries||[], areas = filters.areas||[];
        if (!(periods.length||centuries.length||areas.length)) return true;
        if (parsed.periods.includes('unclassified')||parsed.areas.includes('unclassified')) return false;
        if (periods.length&&!periods.some(p=>parsed.periods.includes(p))) return false;
        if (centuries.length&&!centuries.some(c=>parsed.centuries.includes(c))) return false;
        if (areas.length) {const expanded=descendants(master,areas);if(!parsed.areas.some(a=>expanded.has(a)))return false;}
        if (parsed.ranges.length) {
            const pRanges=periods.length?periods.map(p=>PERIODS[p]).filter(Boolean):[[-100000,100000]];
            const cRanges=centuries.length?centuries.map(centuryRange):[[-100000,100000]];
            if(!parsed.ranges.some(r=>pRanges.some(p=>cRanges.some(c=>Math.max(r[0],p[0],c[0])<=Math.min(r[1],p[1],c[1])))))return false;
        }
        return true;
    }
    const api = {BASE_HEADERS,EXTRA_HEADERS,HEADERS:[...BASE_HEADERS,...EXTRA_HEADERS],PERIODS,PERIOD_LABELS,validateMaster,descendants,parseRanges,centuryRange,defaults,validate,matches,master:null};
    api.setRegions=data=>(api.master=validateMaster(data));
    root.HistoryClassification=api;
})(typeof window!=='undefined'?window:globalThis);
