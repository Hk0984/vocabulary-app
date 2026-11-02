import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB_FILES = Object.freeze([
    'index.html', 'style.css', 'script.js', 'history-config.js', 'history_questions.js',
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

export async function buildWeb({ sourceDir = projectRoot, outputDir = path.join(projectRoot, 'dist/web') } = {}) {
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
    if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('Usage: node scripts/build-web.mjs [--out dist/name]');
    const outputDir = path.resolve(projectRoot, args[1] || 'dist/web');
    const relative = path.relative(path.join(projectRoot, 'dist'), outputDir);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Output must be a subdirectory of dist/');
    const result = await buildWeb({ outputDir });
    console.log(`Prepared ${result.files.length} web files; build ${result.buildId}. No deployment performed.`);
}
