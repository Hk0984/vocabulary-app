/* Read-only adapter for the dedicated public flow sheet. Never merges sources. */
(function(root) {
    'use strict';
    const HEADERS = ['id','type','question', ...[1,2,3,4].flatMap(i=>['id','text','time_ranges'].map(k=>`item${i}_${k}`)),
        'answer','explanation','period_codes','century_codes','area_codes','time_ranges'];
    class SourceError extends Error {}
    function toQuestion(row) {
        const q = Object.fromEntries(['id','type','question','explanation','period_codes','century_codes','area_codes','time_ranges'].map(k=>[k,row[k]]));
        q.answer = row.type==='ordering'?row.answer.split(';'):row.answer;
        const items=[];
        for(const i of [1,2,3,4]) {
            const item=Object.fromEntries(['id','text','time_ranges'].map(k=>[k,row[`item${i}_${k}`]]));
            if(i<4 || row.type==='contemporary' || Object.values(item).some(Boolean))items.push(item);
        }
        q[row.type==='ordering'?'events':'choices']=items;
        return q;
    }
    function parseValues(values, master) {
        if(!Array.isArray(values) || !Array.isArray(values[0]) || values.length>10001 || values[0].length!==HEADERS.length || !HEADERS.every((k,i)=>values[0][i]===k))throw new SourceError('公開シートは専用21列の見出し・列順が必要です。管理用CSVは読み込めません。');
        const questions=[];
        for(const cells of values.slice(1)) {
            if(!Array.isArray(cells) || cells.some(v=>typeof v!=='string') || cells.slice(HEADERS.length).some(Boolean))throw new SourceError('公開シートのセル形式・列数が不正です。');
            if(!cells.some(Boolean))continue;
            const row=Object.fromEntries(HEADERS.map((k,i)=>[k,cells[i]??'']));
            if(HEADERS.some(k=>!k.endsWith('time_ranges') && /^[=+@-]/.test(row[k].trimStart())))throw new SourceError('公開シートに式として解釈され得る入力があります。');
            questions.push(toQuestion(row));
        }
        const loaded=root.HistoryFlow.load({schema_version:'1.0',questions},master);
        if(loaded.errors.length)throw new SourceError('公開問題に不正データまたは重複IDがあります。出題を停止しました。管理者に検証を依頼してください。');
        return loaded;
    }
    function validateConfig(config) {
        if(!config || !['static','sheets'].includes(config.mode))throw new SourceError('世界史の流れのデータソース設定が必要です。');
        const keys=config.mode==='static'?['mode']:['mode','spreadsheetId','sheetName','apiKey'];
        if(Object.keys(config).length!==keys.length || keys.some(k=>!Object.hasOwn(config,k)))throw new SourceError('データソース設定の項目が不正です。公開用設定だけを指定してください。');
        if(config.mode==='sheets') {
            const legacyIds=[root.HISTORY_QUESTIONS_CONFIG?.spreadsheetId, typeof SHEET_ID==='undefined'?undefined:SHEET_ID];
            if(typeof config.spreadsheetId!=='string' || !/^[A-Za-z0-9_-]+$/.test(config.spreadsheetId) || legacyIds.includes(config.spreadsheetId) || config.sheetName!=='history_flow_public' || typeof config.apiKey!=='string' || !config.apiKey.trim())throw new SourceError('専用の世界史の流れ公開シートとブラウザ用API設定が必要です。既存シートは流用できません。');
        }
        return config;
    }
    async function load(master, config=root.HISTORY_FLOW_CONFIG, fetcher=(...args)=>root.fetch(...args)) {
        validateConfig(config);
        const url=config.mode==='static'?'history-flow-data.json':
            'https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(config.spreadsheetId)+'/values/'+encodeURIComponent("'"+config.sheetName+"'")+'?valueRenderOption=FORMULA&key='+encodeURIComponent(config.apiKey);
        let response, data;
        try {response=await fetcher(url,{cache:'no-store'});}catch{throw new SourceError('世界史の流れを取得できません。ネットワーク接続を確認してください。');}
        if(!response.ok)throw new SourceError(response.status===403?'公開シートへのアクセスが許可されていません。公開共有・API制限を確認してください。':response.status===404?'公開シートが見つかりません。データソース設定を確認してください。':'問題データを取得できません。接続・設定を確認してください。');
        try {data=await response.json();}catch{throw new SourceError('問題データのJSON形式が不正です。');}
        if(config.mode==='sheets')return parseValues(data?.values,master);
        try{return root.HistoryFlow.load(data,master);}catch{throw new SourceError('静的な世界史の流れデータの形式が不正です。');}
    }
    root.HistoryFlowSource={HEADERS,SourceError,toQuestion,parseValues,validateConfig,load};
})(typeof window!=='undefined'?window:globalThis);
