/* Independent data and session engine. No persistence or existing question access. */
(function(root) {
    'use strict';
    const fail = message => { throw new Error(message); };
    const text = x => typeof x === 'string' && x.trim().length > 0 && x.length <= 10000;
    const id = x => typeof x === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(x);
    function validate(q, master) {
        if (!q || !id(q.id) || !text(q.question) || !text(q.explanation) || !['contemporary','ordering'].includes(q.type)) fail('ID・形式・問題文・解説が不正です');
        const allowed = ['id','type','question','choices','events','answer','explanation','period_codes','century_codes','area_codes','time_ranges','source'];
        if (Object.keys(q).some(k=>!allowed.includes(k)) || (q.source !== undefined && !text(q.source))) fail('未知の項目・出典が不正です');
        root.HistoryClassification.validate(q, master);
        const items = q.type === 'contemporary' ? q.choices : q.events;
        if ((q.type === 'contemporary' && q.events !== undefined) || (q.type === 'ordering' && q.choices !== undefined)) fail('形式に対応しない項目です');
        if (!Array.isArray(items) || (q.type === 'contemporary' ? items.length !== 4 : ![3,4].includes(items.length))) fail('選択肢・出来事の数が不正です');
        if (items.some(v=>!v || !id(v.id) || !text(v.text) || Object.keys(v).some(k=>!['id','text','time_ranges'].includes(k)))) fail('選択肢・出来事が不正です');
        for (const v of items) if (v.time_ranges !== undefined) root.HistoryClassification.parseRanges(v.time_ranges);
        const ids = items.map(v=>v.id);
        if (new Set(ids).size !== ids.length || new Set(items.map(v=>v.text.normalize('NFKC').trim())).size !== items.length) fail('選択肢が重複しています');
        if (q.type === 'contemporary' ? !ids.includes(q.answer) : !Array.isArray(q.answer) || q.answer.length !== ids.length || new Set(q.answer).size !== ids.length || q.answer.some(v=>!ids.includes(v))) fail('正解IDが不正です');
        return q;
    }
    function load(data, master) {
        if (!data || data.schema_version !== '1.0' || !Array.isArray(data.questions) || Object.keys(data).some(k=>!['schema_version','questions'].includes(k))) fail('データのルート形式が不正です');
        const counts = new Map(), errors = [], questions = [];
        for (const q of data.questions) if(q && typeof q.id === 'string') counts.set(q.id,(counts.get(q.id)||0)+1);
        data.questions.forEach((q,index)=>{
            try { validate(q,master); if(counts.get(q.id)>1) fail('問題IDが重複しています'); questions.push(q); }
            catch(e) { errors.push({index:index+1,id:q?.id ?? null,reason:e.message}); }
        });
        return {questions,errors};
    }
    function shuffle(items, random = Math.random) {
        const result = [...items];
        for(let i=result.length-1;i>0;i--) { const j=Math.floor(random()*(i+1)); [result[i],result[j]]=[result[j],result[i]]; }
        return result;
    }
    function filter(questions, settings, master) {
        return questions.filter(q=>(!settings.type || settings.type==='mixed' || q.type===settings.type) && root.HistoryClassification.matches(q,settings,master));
    }
    function session(questions, random = Math.random) {
        let index=0, correct=0, answered=false;
        return {
            get current(){return questions[index];},
            get answered(){return answered;},
            get summary(){return {total:index+(answered?1:0),correct,incorrect:index+(answered?1:0)-correct,accuracy:index+(answered?1:0)?Math.round(correct/(index+(answered?1:0))*100):0};},
            options(){const q=questions[index];return q ? shuffle(q.choices||q.events,random):[];},
            submit(answer){
                const q=questions[index]; if(!q || answered)return null;
                if(q.type==='ordering' && (!Array.isArray(answer)||answer.length!==q.events.length||new Set(answer).size!==answer.length||answer.some(v=>!q.events.some(e=>e.id===v))))return null;
                if(q.type==='contemporary' && !q.choices.some(v=>v.id===answer))return null;
                const ok=JSON.stringify(q.answer)===JSON.stringify(answer);answered=true;if(ok)correct++;return ok;
            },
            next(){if(!answered)return false; index++;answered=false;return true;}
        };
    }
    root.HistoryFlow = {validate,load,shuffle,filter,session};
})(typeof window !== 'undefined' ? window : globalThis);
