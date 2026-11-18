/* Independent data and session engine. No persistence or existing question access. */
(function(root) {
    'use strict';
    const fail = message => { throw new Error(message); };
    const text = x => typeof x === 'string' && x.trim().length > 0 && x.length <= 10000;
    const id = x => typeof x === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(x);
    const normalizeAnswer = value => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
    function validateBlanks(q) {
        if (!Array.isArray(q.blanks) || q.blanks.length < 2 || q.blanks.length > 4) fail('空欄は2〜4個です');
        const placeholders = [...q.question.matchAll(/\{([^{}]*)\}/g)].map(match => match[1]);
        if (placeholders.length !== q.blanks.length || new Set(placeholders).size !== placeholders.length ||
            /[{}]/.test(q.question.replace(/\{[^{}]*\}/g, ''))) fail('空欄の参照が不正です');
        for (const [index, blank] of q.blanks.entries()) {
            if (!blank || !id(blank.id) || blank.id !== placeholders[index] ||
                !['choice','input'].includes(blank.mode)) fail('空欄のID・出題形式が不正です');
            const choice = blank.mode === 'choice';
            const field = choice ? 'choices' : 'accepted';
            if (Object.keys(blank).length !== 3 || !Array.isArray(blank[field]) ||
                blank[field].length < (choice ? 2 : 1) || blank[field].length > 4) fail('空欄の項目が不正です');
            const values = choice ? blank.choices.map(entry => {
                if (!entry || !id(entry.id) || !text(entry.text) ||
                    typeof entry.correct !== 'boolean' || Object.keys(entry).length !== 3) fail('空欄の選択肢が不正です');
                return entry.text;
            }) : blank.accepted;
            if (values.some(value => !text(value) || value.length > 500) ||
                new Set(values.map(normalizeAnswer)).size !== values.length) fail('空欄の選択肢・正答が不正です');
            if (choice && (new Set(blank.choices.map(entry => entry.id)).size !== values.length ||
                blank.choices.filter(entry => entry.correct).length !== 1)) fail('空欄の正答は1個です');
        }
    }

    function validate(q, master, schema = '1.1') {
        if (!q || !id(q.id) || !text(q.question) || !text(q.explanation) || (!['contemporary','ordering'].includes(q.type) && !(q.type === 'cloze' && schema === '1.1'))) fail('ID・形式・問題文・解説が不正です');
        const allowed = ['id','type','question','choices','events','answer','blanks','explanation','period_codes','century_codes','area_codes','time_ranges','source'];
        if (Object.keys(q).some(k=>!allowed.includes(k)) || (q.source !== undefined && !text(q.source))) fail('未知の項目・出典が不正です');
        root.HistoryClassification.validate(q, master);
        if (q.type === 'cloze') {
            if (['choices','events','answer'].some(key => Object.hasOwn(q,key))) fail('形式に対応しない項目です');
            validateBlanks(q);
            return q;
        }
        if (Object.hasOwn(q,'blanks')) fail('形式に対応しない項目です');
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
        if (!data || !['1.0','1.1'].includes(data.schema_version) || !Array.isArray(data.questions) || Object.keys(data).some(k=>!['schema_version','questions'].includes(k))) fail('データのルート形式が不正です');
        const counts = new Map(), errors = [], questions = [];
        for (const q of data.questions) if(q && typeof q.id === 'string') counts.set(q.id,(counts.get(q.id)||0)+1);
        data.questions.forEach((q,index)=>{
            try { validate(q,master,data.schema_version); if(counts.get(q.id)>1) fail('問題IDが重複しています'); questions.push(q); }
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
        let index=0, correct=0, answered=false, lastGrade=null;
        return {
            get current(){return questions[index];},
            get answered(){return answered;},
            get lastGrade(){return lastGrade;},
            get summary(){return {total:index+(answered?1:0),correct,incorrect:index+(answered?1:0)-correct,accuracy:index+(answered?1:0)?Math.round(correct/(index+(answered?1:0))*100):0};},
            options(){const q=questions[index];return q && q.type !== 'cloze' ? shuffle(q.choices||q.events,random):[];},
            submit(answer){
                const q=questions[index]; if(!q || answered)return null;
                if(q.type==='ordering' && (!Array.isArray(answer)||answer.length!==q.events.length||new Set(answer).size!==answer.length||answer.some(v=>!q.events.some(e=>e.id===v))))return null;
                if(q.type==='contemporary' && !q.choices.some(v=>v.id===answer))return null;
                if (q.type === 'cloze') {
                    if (!Array.isArray(answer) || answer.length !== q.blanks.length ||
                        answer.some((value,index) => typeof value !== 'string' ||
                            (q.blanks[index].mode === 'choice'
                                ? !q.blanks[index].choices.some(entry => entry.id === value)
                                : !normalizeAnswer(value) || value.length > 500))) return null;
                    const results = q.blanks.map((blank,index) => blank.mode === 'choice'
                        ? blank.choices.some(entry => entry.correct && entry.id === answer[index])
                        : blank.accepted.some(value => normalizeAnswer(value) === normalizeAnswer(answer[index])));
                    const points = results.filter(Boolean).length;
                    lastGrade = { points, total: results.length, results };
                    answered = true;
                    if (points === results.length) correct++;
                    return points === results.length;
                }
                const ok=JSON.stringify(q.answer)===JSON.stringify(answer);answered=true;if(ok)correct++;return ok;
            },
            next(){if(!answered)return false; index++;answered=false;lastGrade=null;return true;}
        };
    }
    root.HistoryFlow = {validate,load,shuffle,filter,session};
})(typeof window !== 'undefined' ? window : globalThis);
