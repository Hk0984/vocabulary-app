// Local, read-only validation. Explicit inputs only, no credentials or Sheets writes.
import {readFile} from 'node:fs/promises';
import '../attribute-tags.js';
import '../history-classification.js';
import '../history-flow.js';
export function csv(text) {
    const rows=[];let row=[],cell='',quoted=false;
    for(let i=0;i<text.length;i++) {
        const c=text[i];
        if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(quoted){quoted=false;if(i+1<text.length&& ![',','\r','\n'].includes(text[i+1]))throw Error('引用符の後が不正です');}else {if(cell)throw Error('引用符の位置が不正です');quoted=true;}}
        else if(!quoted&&c===','){row.push(cell);cell='';}
        else if(!quoted&&(c==='\r'||c==='\n')){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}
        else cell+=c;
    }
    if(quoted)throw Error('引用符が閉じていません');
    if(cell||row.length){row.push(cell);rows.push(row);}
    const headers=rows.shift();if(!headers||new Set(headers).size!==headers.length)throw Error('CSV見出しが不正です');
    return rows.filter(r=>r.some(Boolean)).map(r=>{if(r.length!==headers.length)throw Error('CSV列数が不正です');return Object.fromEntries(headers.map((h,i)=>[h,r[i]]));});
}
export function reconcile(base, labels) {
    const headers=['genre','id','front','back','front_tags','back_tags'];
    for(const r of [...base,...labels])if(Object.keys(r).length!==headers.length||headers.some(h=>!Object.hasOwn(r,h)))throw Error('CSV見出しはgenre,id,front,back,front_tags,back_tagsです');
    const key=r=>JSON.stringify([r.genre,r.id]);const map=new Map();
    const validateTags=r=>{
        for(const side of ['front_tags','back_tags']) {
            try { AttributeTags.parse(r[side]); }
            catch (_) { throw Error(`${side}: 大分類/小分類の2階層ラベルを重複なく指定してください（自動修正は行いません）`); }
        }
    };
    for(const r of base){if(!r.genre||!r.id||map.has(key(r)))throw Error('既存データのジャンル・IDが不正または重複です');validateTags(r);map.set(key(r),r);}
    const seen=new Set();
    for(const r of labels){
        if(!r.genre||!r.id||seen.has(key(r)))throw Error('ラベルCSVのジャンル・IDが不正または重複です');seen.add(key(r));
        validateTags(r);
        const old=map.get(key(r));if(!old||r.front!==old.front||r.back!==old.back)throw Error('ID・本文が既存データと一致しません');
        for(const side of ['front_tags','back_tags']) {
            if(old[side]&&old[side]!==r[side])throw Error('既存ラベルの上書き・消去を拒否しました');
        }
    }
    return labels.length;
}
if(process.argv[1] && new URL(import.meta.url).pathname.endsWith('/'+process.argv[1].replaceAll('\\','/').split('/').at(-1))) {
    const [mode,input,baseline]=process.argv.slice(2);
    const safe=async p=>{
        if(!p||/\.env|service.account|private.key|credential|token|adminsdk/i.test(p)||!(/\.(csv|json)$/i.test(p)))throw Error('非機密のCSV・JSONだけを指定してください');
        return (await readFile(p,'utf8')).replace(/^\uFEFF/,'');
    };
    try {
        if(mode==='labels')console.log(`検証成功: ${reconcile(csv(await safe(baseline)),csv(await safe(input)))}件（書き込みなし）`);
        else if(mode==='flow') {
            const master=HistoryClassification.validateMaster(JSON.parse(await readFile(new URL('../history-regions.json',import.meta.url),'utf8')));
            const result=HistoryFlow.load(JSON.parse(await safe(input)),master);
            console.log(JSON.stringify({valid:result.questions.length,errors:result.errors},null,2));if(result.errors.length)process.exitCode=1;
        } else throw Error('使用法: node scripts/validate-study-data.mjs labels 追加.csv 既存.csv | flow 問題.json');
    } catch(e){console.error(e instanceof SyntaxError?'JSON構文が不正です':e.message);process.exitCode=1;}
}
