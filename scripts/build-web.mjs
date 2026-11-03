import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const WEB_FILES = Object.freeze([
    'index.html', 'style.css', 'script.js', 'history-config.js', 'history_questions.js',
    'history-classification.js', 'history-regions.json',
    'pwa.js', 'sw.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'
]);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sha256 = data => createHash('sha256').update(data).digest('hex');
const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
    /"type"\s*:\s*"service_account"/,
    /"private_key"\s*:\s*"[^"\r\n]+/,
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
    /\b(?:mfa\.[A-Za-z0-9_-]{50,}|[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,})\b/,
    /\bAKIA[0-9A-Z]{16}\b/
];

export async function buildWeb({ sourceDir = projectRoot, outputDir = path.join(projectRoot, 'dist/web'), publicConfig = null } = {}) {
    const files = new Map();
    // Explicit filenames only: never traverse bot/, credentials, logs or dependencies.
    for (const name of WEB_FILES) {
        const source = path.join(sourceDir, name);
        const stat = await lstat(source);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new Error(`Unsafe source asset: ${name}`);
        const content = await readFile(source);
        if (secretPatterns.some(pattern => pattern.test(content.toString('utf8')))) {
            throw new Error(`Possible credential in asset: ${name}; contents withheld`);
        }
        files.set(name, content);
    }
    if (publicConfig !== null) {
        const allowed=['spreadsheetId','sheetName','expectedIdPrefix','requireCurrentSchema'];
        if (!publicConfig || JSON.stringify(Object.keys(publicConfig).sort())!==JSON.stringify(allowed.sort()) ||
            typeof publicConfig.spreadsheetId!=='string' || !/^[A-Za-z0-9_-]+$/.test(publicConfig.spreadsheetId) ||
            typeof publicConfig.sheetName!=='string' || !publicConfig.sheetName.trim() || publicConfig.requireCurrentSchema!==true ||
            typeof publicConfig.expectedIdPrefix!=='string' || !/^hv1_[a-z][a-z0-9_]{1,40}_$/.test(publicConfig.expectedIdPrefix)) throw new Error('Invalid public-only new-environment configuration');
        const context={window:{}};
        try { vm.runInNewContext(files.get('history-config.js').toString('utf8'),context,{timeout:1000}); }
        catch { throw new Error('Existing browser configuration could not be read; contents withheld'); }
        const existing=context.window.HISTORY_QUESTIONS_CONFIG;
        if (!existing || typeof existing.apiKey!=='string' || !existing.apiKey || existing.spreadsheetId===publicConfig.spreadsheetId) throw new Error('A separate new public sheet and existing browser API configuration are required');
        const generated={apiKey:existing.apiKey,...publicConfig};
        const generatedText='window.HISTORY_QUESTIONS_CONFIG = Object.freeze('+JSON.stringify(generated)+');\n';
        if(secretPatterns.some(pattern=>pattern.test(generatedText)))throw new Error('Possible credential in public-only configuration; contents withheld');
        files.set('history-config.js',Buffer.from(generatedText));
    }
    const sourceDigest = sha256(Buffer.concat([...files].map(([name, content]) =>
        Buffer.from(`${name}\0${sha256(content)}\n`))));
    const buildId = sourceDigest.slice(0, 20);
    const worker = files.get('sw.js').toString('utf8');
    const marker = 'const BUILD_ID = "source-v3";';
    if (worker.split(marker).length !== 2) throw new Error('Service worker build marker is missing or ambiguous');
    const hashMarker = 'const ASSET_HASHES = null;';
    if (worker.split(hashMarker).length !== 2) throw new Error('Service worker asset hash marker is missing or ambiguous');
    const assetHashes = Object.fromEntries([...files].filter(([name]) => name !== 'sw.js')
        .map(([name, content]) => ['./' + name, sha256(content)]));
    assetHashes['./'] = assetHashes['./index.html'];
    files.set('sw.js', Buffer.from(worker.replace(marker, `const BUILD_ID = "${buildId}";`)
        .replace(hashMarker, `const ASSET_HASHES = ${JSON.stringify(assetHashes)};`)));

    try {
        const stat = await lstat(outputDir);
        if (!stat.isDirectory() || stat.isSymbolicLink() || (await readdir(outputDir)).length) {
            throw new Error('Output must be a new or empty directory; existing files will not be removed');
        }
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    await mkdir(outputDir, { recursive: true });
    for (const [name, content] of files) {
        const target = path.join(outputDir, name);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content, { flag: 'wx' });
    }
    const inventory = [...files].map(([name, content]) => ({ name, bytes: content.length, sha256: sha256(content) }));
    await writeFile(path.join(outputDir, 'release.json'), JSON.stringify({ buildId, files: inventory }, null, 2) + '\n', { flag: 'wx' });
    return { buildId, files: [...files.keys(), 'release.json'] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    let target='dist/web',configPath=null;
    for(let i=0;i<args.length;i+=2){if(!args[i+1])throw new Error('Missing argument');if(args[i]==='--out')target=args[i+1];else if(args[i]==='--history-public-config')configPath=args[i+1];else throw new Error('Unknown build option');}
    const outputDir = path.resolve(projectRoot, target);
    const relative = path.relative(path.join(projectRoot, 'dist'), outputDir);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Output must be a subdirectory of dist/');
    let publicConfig=null;
    if(configPath){
        const name=path.basename(configPath).toLowerCase(),stat=await lstat(configPath);
        if(!name.endsWith('.json')||/\.env|service.account|credentials|firebase-adminsdk/.test(name)||!stat.isFile()||stat.isSymbolicLink()||stat.nlink>1||stat.size>10000)throw new Error('Use a small non-secret public-only JSON configuration');
        try { publicConfig=JSON.parse(await readFile(configPath,'utf8')); }
        catch { throw new Error('Public-only configuration JSON is invalid; contents withheld'); }
    }
    const result = await buildWeb({ outputDir, publicConfig });
    console.log(`Prepared ${result.files.length} web files; build ${result.buildId}. No deployment performed.`);
}
