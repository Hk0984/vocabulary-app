(function(root) {
    'use strict';
    let questions=[], master, active, request=0;
    const el=id=>document.getElementById(id);
    const say=message=>{el('flowStatus').textContent=message;};
    function button(label,action,container=el('flowChoices')) {
        const b=document.createElement('button');b.textContent=label;b.type='button';b.addEventListener('click',action);container.appendChild(b);return b;
    }
    function settings() {
        return Object.fromEntries(['type','periods','centuries','areas','count'].map(key=>{
            const node=el('flow_'+key);
            return [key,['periods','centuries','areas'].includes(key)?Array.from(node.selectedOptions,o=>o.value).filter(Boolean):node.value];
        }));
    }
    function candidates(){return root.HistoryFlow.filter(questions,settings(),master);}
    function update(){const n=candidates().length; say(questions.length?`条件に合う問題：${n}問`:'まだ問題が登録されていません');el('flowStart').disabled=!n;}
    root.openHistoryFlow=async function() {
        const token=++request;active=null;questions=[];
        showPage('flowPage');const page=pageGeneration;
        el('flowSettings').hidden=false;el('flowQuiz').hidden=true;el('flowActions').hidden=true;
        say('問題データを読み込んでいます…');el('flowStart').disabled=true;
        el('flowErrors').textContent='';
        try {
            const regionResponse=await fetch('history-regions.json');
            if(!regionResponse.ok)throw Error();
            const regions=await regionResponse.json();
            if(token!==request||page!==pageGeneration)return;
            master=root.HistoryClassification.validateMaster(regions);
            const loaded=await root.HistoryFlowSource.load(master);
            if(token!==request||page!==pageGeneration)return;
            questions=loaded.questions;
            el('flowErrors').textContent=loaded.errors.map(e=>`行${e.index} (${e.id ?? 'IDなし'}): ${e.reason}`).join('\n');
            for(const axis of ['periods','centuries','areas']) {
                const select=el('flow_'+axis);select.replaceChildren();
                const codes=[...new Set(questions.flatMap(q=>q[{periods:'period_codes',centuries:'century_codes',areas:'area_codes'}[axis]].split(';').filter(Boolean)))];
                // Include region ancestors so a broad region filter includes descendants.
                if(axis==='areas')for(const node of master.values())if(node.active&&!codes.includes(node.code))codes.push(node.code);
                for(const code of codes) {const option=document.createElement('option');option.value=code;option.textContent=root.HistoryClassification.PERIOD_LABELS[code]||master.get(code)?.label||code;select.appendChild(option);}
            }
            update();
        } catch (error) {if(token===request&&page===pageGeneration)say(error instanceof root.HistoryFlowSource.SourceError?error.message:'問題データを読み込めません。形式・接続を確認して選び直してください。');}
    };
    function start() {
        const pool=candidates();if(!pool.length)return;
        const count=settings().count;
        active=root.HistoryFlow.session(root.HistoryFlow.shuffle(pool).slice(0,count==='all'?pool.length:Number(count)));
        el('flowSettings').hidden=true;el('flowQuiz').hidden=false;el('flowActions').hidden=true;render();
    }
    function render() {
        const session=active, page=pageGeneration, q=session.current;
        const live=()=>active===session&&pageGeneration===page;
        const container=el('flowChoices');container.replaceChildren();el('flowNext').hidden=true;el('flowExplanation').textContent='';
        if(!q){
            const s=session.summary;el('flowQuiz').hidden=true;el('flowActions').hidden=false;
            say(`出題数 ${s.total}問／正解 ${s.correct}問／不正解 ${s.incorrect}問／正答率 ${s.accuracy}%`);return;
        }
        say(`${session.summary.total+1}問目`);el('flowQuestion').textContent=q.question;
        const options=session.options(), selected=[];
        const result=answer=>{
            if(!live())return;
            const correct=session.submit(answer);if(correct===null)return;
            container.querySelectorAll('button').forEach(b=>{b.disabled=true;});
            const items=q.choices||q.events, answerIds=Array.isArray(q.answer)?q.answer:[q.answer];
            el('flowExplanation').textContent=(correct?'正解です。':'不正解です。')+' 正解：'+answerIds.map(id=>items.find(v=>v.id===id).text).join(' → ')+'\n'+q.explanation;
            el('flowNext').hidden=false;
        };
        if(q.type==='contemporary')for(const item of options)button(item.text,()=>result(item.id));
        else {
            const order=document.createElement('p');order.setAttribute('aria-live','polite');container.appendChild(order);
            const buttons=[];
            const refresh=()=>{order.textContent='選択順：'+selected.map((id,i)=>`${i+1}. ${q.events.find(v=>v.id===id).text}`).join(' → ');buttons.forEach(([b,id])=>{b.disabled=selected.includes(id);});submit.disabled=selected.length!==options.length;};
            for(const item of options)buttons.push([button(item.text,()=>{if(!live()||session.answered)return;selected.push(item.id);refresh();}),item.id]);
            button('ひとつ取り消す',()=>{if(!live()||session.answered)return;selected.pop();refresh();});
            button('やり直す',()=>{if(!live()||session.answered)return;selected.length=0;refresh();});
            const submit=button('回答確定',()=>result([...selected]));refresh();
        }
        el('flowNext').onclick=()=>{if(live()&&session.next())render();};
    }
    document.addEventListener('DOMContentLoaded',()=>{
        el('flowStart').addEventListener('click',start);
        el('flowRetry').addEventListener('click',start);
        el('flowChange').addEventListener('click',()=>{active=null;el('flowActions').hidden=true;el('flowQuiz').hidden=true;el('flowSettings').hidden=false;update();});
        el('flowSettings').addEventListener('change',()=>{if(master)update();});
    });
})(window);
