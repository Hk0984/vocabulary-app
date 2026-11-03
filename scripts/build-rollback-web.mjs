// Local preparation only. Uses the builder and assets from one pinned, pre-v2 commit.
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

export const ROLLBACK_COMMIT='8b70b2a2a5fc141aeba7f063f40176f1374aef5a';
export const OLD_ASSETS=Object.freeze(['index.html','style.css','script.js','history-config.js',
    'history_questions.js','pwa.js','sw.js','manifest.json','icons/icon-192.png','icons/icon-512.png']);
const root=fileURLToPath(new URL('../',import.meta.url));
const sha256=b=>createHash('sha256').update(b).digest('hex');
const PUBLIC_HEADERS=['id','source_id','question','choice1','choice2','choice3','choice4','answer','explanation'];
const blob=name=>execFileSync('git',['show',ROLLBACK_COMMIT+':'+name],{cwd:root,stdio:['ignore','pipe','pipe']});

export async function buildRollback({publicSheet,tab='history_questions',outputDir,fetchImpl=fetch}){
    if(typeof publicSheet!=='string'||!/^[A-Za-z0-9_-]+$/.test(publicSheet)||tab!=='history_questions')throw Error('Explicit old public sheet and expected tab required');
    const out=path.resolve(outputDir),relative=path.relative(path.join(root,'dist'),out);
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Use a fresh directory below dist/');
    const context={window:{}};
    vm.runInNewContext(blob('history-config.js').toString('utf8'),context,{timeout:1000});
    const old=context.window.HISTORY_QUESTIONS_CONFIG;
    if(!old?.apiKey)throw Error('Pinned browser configuration missing');
    // Header row ONLY: reject private 12/16-column and new 13-column targets before building.
    const url='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(publicSheet)+'/values/'+
        encodeURIComponent("'"+tab+"'!1:1")+'?key='+encodeURIComponent(old.apiKey);
    const response=await fetchImpl(url,{headers:{Referer:'https://hk0984.github.io/'},signal:AbortSignal.timeout(25000)});
    if(response.status!==200)throw Error('Old public header request failed');
    const data=await response.json();
    if(JSON.stringify(data.values)!==JSON.stringify([PUBLIC_HEADERS]))throw Error('Not an exact nine-column public sheet; stop');
    await mkdir(out,{recursive:false});
    const source=path.join(out,'source'),web=path.join(out,'web'),builder=path.join(out,'builder');
    await mkdir(source);await mkdir(builder);
    const originalHashes={};
    for(const name of OLD_ASSETS){const content=blob(name);originalHashes[name]=sha256(content);
        const file=path.join(source,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,content,{flag:'wx'});}
    // Only the history public ID/tab change. Word/Firebase settings stay at the pinned version.
    const generated='window.HISTORY_QUESTIONS_CONFIG = Object.freeze('+JSON.stringify({...old,spreadsheetId:publicSheet,sheetName:tab})+');\n';
    await writeFile(path.join(source,'history-config.js'),generated);
    const builderFile=path.join(builder,'build-web.mjs'),builderBytes=blob('scripts/build-web.mjs');
    await writeFile(builderFile,builderBytes,{flag:'wx'});
    const previous=await import(pathToFileURL(builderFile).href);
    if(JSON.stringify(previous.WEB_FILES)!==JSON.stringify(OLD_ASSETS))throw Error('Pinned builder asset contract mismatch');
    const result=await previous.buildWeb({sourceDir:source,outputDir:web});
    if(JSON.stringify([...result.files].sort())!==JSON.stringify([...OLD_ASSETS,'release.json'].sort()))throw Error('Rollback inventory mismatch');
    const actual=(await readdir(web,{recursive:true})).filter(p=>p.endsWith('.js')||p.endsWith('.html')||p.endsWith('.css')||p.endsWith('.json')||p.endsWith('.png'));
    if(actual.length!==11)throw Error('Unexpected rollback files');
    const release=JSON.parse(await readFile(path.join(web,'release.json'),'utf8'));
    for(const item of release.files)if(sha256(await readFile(path.join(web,item.name)))!==item.sha256)throw Error('Rollback hash mismatch');
    const verified={window:{}};vm.runInNewContext(await readFile(path.join(web,'history-config.js'),'utf8'),verified,{timeout:1000});
    if(verified.window.HISTORY_QUESTIONS_CONFIG.spreadsheetId!==publicSheet)throw Error('Wrong rollback target');
    const evidence={commit:ROLLBACK_COMMIT,builderSha256:sha256(builderBytes),originalHashes,
        historyPublicHeaderColumns:9,historyPublicSheet:publicSheet,historyTab:tab,historyOnlyConfigOverride:true,
        wordAndFirebaseSourceUnchanged:sha256(await readFile(path.join(web,'script.js')))===originalHashes['script.js'],
        files:result.files,buildId:result.buildId,sheetsWrites:0,deployed:false};
    await writeFile(path.join(out,'verification.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
    return evidence;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
    try{
        const args=process.argv.slice(2),options={};
        for(let i=0;i<args.length;i+=2){if(!args[i+1])throw Error('Missing argument');
            if(args[i]==='--public-sheet')options.publicSheet=args[i+1];else if(args[i]==='--out')options.outputDir=args[i+1];else throw Error('Unknown option');}
        const result=await buildRollback(options);
        console.log(JSON.stringify({prepared:true,commit:result.commit,files:result.files.length,buildId:result.buildId,publicHeaderColumns:9,sheetsWrites:0,deployed:false}));
    }catch{
        console.error('Rollback preparation failed. Check public header, pinned Git history and fresh dist output; sensitive details withheld.');process.exitCode=1;
    }
}
