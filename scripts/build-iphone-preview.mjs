// Creates a local, synthetic artifact. Hosting is a separate operation.
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWeb, WEB_FILES } from './build-web.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const filename = fileURLToPath(import.meta.url);

function previewServices() {
    const vocabID = 'iphone-review-vocab';
    const historyID = 'iphone-review-history';
    const cards = {
        '英単語（検証）': [['ID', '表面', '裏面', 'front_tags', 'back_tags'],
            ['1', 'capital of Japan', '東京', '', 'geography/city']],
        '古文（検証）': [['ID', '表面', '裏面'],
            ['2', 'いと', 'たいへん'], ['3', 'をかし', '趣がある'], ['4', 'なほ', 'やはり'], ['5', 'すなはち', 'すぐに']],
        '数値（検証）': [['ID', '表面', '裏面', 'front_tags', 'back_tags'],
            ['6', '架空の展示Aの重さ', '10 kg', '', 'number/mass'],
            ['7', '架空の模型Bの重さ', '20 kg', '', 'number/mass'],
            ['8', '架空の容器Cの分量', '30 kg', '', 'number/mass'],
            ['9', '架空の待ち時間', '3分', '', 'number/duration']],
    };
    const history = [
        ['id','source_id','question','choice1','choice2','choice3','choice4','answer','explanation'],
        ['h001','synthetic','架空の会議で配布されたものは？','地図','画像','楽譜','資料','4','操作確認用の架空問題です。'],
    ];

    const nativeFetch = window.fetch.bind(window);
    const jsonResponse = data => new Response(JSON.stringify(data), {headers:{'Content-Type':'application/json'}});
    window.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input, location.href);
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
        if (method.toUpperCase() !== 'GET') return new Response(null, { status: 403 });
        if (url.origin === location.origin) return nativeFetch(input, init);
        if (url.origin === 'https://sheets.googleapis.com') {
            const base = '/v4/spreadsheets/' + vocabID;
            if (url.pathname === base) {
                return jsonResponse({ sheets: Object.keys(cards).map((title,sheetId) => ({properties:{title,sheetId}})) });
            }
            if (url.pathname.startsWith(base + '/values/')) {
                const title = decodeURIComponent(url.pathname.split('/').at(-1)).slice(1,-1);
                if (Object.hasOwn(cards,title)) return jsonResponse({ values:cards[title] });
            }
            if (url.pathname.startsWith('/v4/spreadsheets/' + historyID + '/values/')) {
                return jsonResponse({ values:history });
            }
        }
        return new Response(null, { status:403 });
    };

    let changed;
    const auth = {
        setPersistence: async () => {},
        onAuthStateChanged(callback) { changed = callback; callback(null); },
        async signInAnonymously() { await changed({uid:'iphone-review-guest',isAnonymous:true}); },
        async signOut() { await changed(null); },
    };
    const authFactory = () => auth;
    authFactory.Auth = { Persistence:{LOCAL:'synthetic'} };
    window.firebase = { initializeApp: () => ({}), auth:authFactory, firestore: () => Object.freeze({}) };
}

function replaceRequired(text, pattern, replacement) {
    if (!pattern.test(text)) throw Error('Preview bootstrap no longer matches the application source.');
    return text.replace(pattern, () => replacement);
}

export async function buildIphonePreview(outputDir) {
    const staging = await mkdtemp(path.join(tmpdir(), 'vocab-iphone-preview-'));
    try {
        for (const name of WEB_FILES) {
            const source = path.join(project, name);
            const stat = await lstat(source);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw Error('Unsafe preview source.');
            const target = path.join(staging, name);
            await mkdir(path.dirname(target), {recursive:true});
            await copyFile(source, target);
        }
        const read = name => readFile(path.join(staging,name),'utf8');
        const write = (name,content) => writeFile(path.join(staging,name),content);
        const writeJSON = (name,data) => write(name,JSON.stringify(data,null,2)+'\n');

        let script = await read('script.js');
        script = replaceRequired(script, /const FIREBASE_CONFIG\s*=\s*\{[^}]*\};/, 'const FIREBASE_CONFIG = {};');
        script = replaceRequired(script, /const GOOGLE_SHEETS_API_KEY\s*=\s*"[^"]*";/, 'const GOOGLE_SHEETS_API_KEY = "synthetic";');
        script = replaceRequired(script, /const SHEET_ID\s*=\s*"[^"]*";/, 'const SHEET_ID = "iphone-review-vocab";');
        await write('script.js','(' + previewServices.toString() + ')();\n' + script);

        let html = (await read('index.html')).replace(/^\s*<script src="https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+"[^>]*><\/script>/gm,'');
        html = replaceRequired(html, /<head>/, '<head>\n<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; connect-src \'self\'; object-src \'none\'; form-action \'none\'; base-uri \'none\'">');
        html = replaceRequired(html, /<title>[^<]*<\/title>/, '<title>単語学習・iPhone検証用</title>');
        html = replaceRequired(html, /<body>/, '<body>\n<p role="note">iPhone検証用・架空データ・履歴保存なし</p>');
        await write('index.html',html);

        const manifest = JSON.parse(await read('manifest.json'));
        await writeJSON('manifest.json',{...manifest,name:'単語学習・iPhone検証用',short_name:'単語学習 検証'});
        await write('history-config.js','window.HISTORY_QUESTIONS_CONFIG = {spreadsheetId:"iphone-review-history",sheetName:"history_questions",apiKey:"synthetic"};\n');
        await write('history-flow-config.js','window.HISTORY_FLOW_CONFIG = {mode:"static"};\n');
        const samples = await Promise.all(['history-flow.sample.json','history-flow-cloze.sample.json']
            .map(async name => JSON.parse(await readFile(path.join(project,'templates',name),'utf8'))));
        await writeJSON('history-flow-data.json',{schema_version:'1.1',questions:samples.flatMap(sample => sample.questions)});
        const dictionary = JSON.parse(await read('choice-dictionary.json'));
        delete dictionary.reviewed_numeric;
        await writeJSON('choice-dictionary.json',dictionary);
        return await buildWeb({sourceDir:staging,outputDir});
    } finally {
        await rm(staging,{recursive:true,force:true});
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === filename) {
    const [folder = 'iphone-review'] = process.argv.slice(2);
    if (process.argv.length > 3 || !/^iphone-review(?:-[A-Za-z0-9_-]+)?$/.test(folder)) {
        throw Error('Usage: node scripts/build-iphone-preview.mjs [iphone-review-SUFFIX]');
    }
    const result = await buildIphonePreview(path.join(project,'dist',folder));
    console.log(`Local iPhone review artifact: dist/${folder} (build ${result.buildId})`);
}
