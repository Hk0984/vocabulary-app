import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Read-only public HTTP requests only. Never fetch credentials or backend data.
const base = 'https://hk0984.github.io/vocabulary-app/';
const api = 'https://api.github.com/repos/Hk0984/vocabulary-app';
const output = path.resolve('dist', `live-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
    /"type"\s*:\s*"service_account"/,
    /"private_key"\s*:/,
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16})\b/,
    /\b(?:mfa\.[A-Za-z0-9_-]{50,}|[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,})\b/
];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function get(url, optional = false) {
    const response = await fetch(url, { redirect: 'error', headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'vocabulary-app-readonly-backup' }, signal: AbortSignal.timeout(30000) });
    if (optional && response.status === 404) return null;
    if (!response.ok) throw new Error(`Read-only request failed: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}
const main = JSON.parse(await get(`${api}/commits/main`)).sha;
const workflows = JSON.parse(await get(`${api}/actions/workflows`));
const tree = JSON.parse(await get(`${api}/git/trees/${main}?recursive=1`));
if (tree.truncated) throw new Error('Incomplete main tree');
const workflowFiles = tree.tree.filter(item => item.type === 'blob' && /^\.github\/workflows\/[^/]+\.ya?ml$/.test(item.path));
await mkdir(path.join(output, 'web'), { recursive: true });
const metadata = { capturedAt: new Date().toISOString(), base, mainSha: main,
    pages: { source: 'Deploy from a branch', evidence: 'Owner confirmation in this session', branch: null, directory: null, note: 'Branch and directory not independently verified; do not assume main/root.' },
    workflows: workflows.workflows.map(({ id, name, path, state }) => ({ id, name, path, state })), mainWorkflowFiles: [], files: [], externalDependencies: [], absentOptional: [] };
const pagesResponse = await fetch(`${api}/pages`, { headers: { 'User-Agent': 'vocabulary-app-readonly-backup' }, signal: AbortSignal.timeout(30000) });
metadata.pages.apiStatus = pagesResponse.status;
if (pagesResponse.ok) {
    const settings = await pagesResponse.json();
    metadata.pages.apiBuildType = settings.build_type;
    metadata.pages.branch = settings.source?.branch ?? null;
    metadata.pages.directory = settings.source?.path ?? null;
}
for (const item of workflowFiles) {
    const body = JSON.parse(await get(`${api}/git/blobs/${item.sha}`));
    const bytes = Buffer.from(body.content.replace(/\s/g, ''), 'base64');
    if (patterns.some(pattern => pattern.test(bytes.toString('utf8')))) throw new Error('Credential pattern in workflow; contents withheld');
    await mkdir(path.join(output, 'workflows'), { recursive: true });
    await writeFile(path.join(output, 'workflows', path.basename(item.path)), bytes, { flag: 'wx' });
    metadata.mainWorkflowFiles.push({ name: item.path, sha256: digest(bytes) });
}
const pending = new Map([['index.html', false], ['sw.js', true], ['manifest.json', true]]);
const content = new Map();
function add(reference, parent) {
    const url = new URL(reference, new URL(parent, base));
    if (!['http:', 'https:'].includes(url.protocol)) return;
    if (url.origin !== new URL(base).origin || !url.pathname.startsWith(new URL(base).pathname)) {
        metadata.externalDependencies.push(url.origin + url.pathname); return;
    }
    const name = decodeURIComponent(url.pathname.slice(new URL(base).pathname.length));
    if (!/^[A-Za-z0-9_./-]+\.(?:html|css|js|json|png|jpg|jpeg|svg|ico|webp|woff2?)$/.test(name) || name.split('/').some(part => part === '..') || /(?:^|\/)(?:bot|tests|docs|node_modules)\//.test(name)) throw new Error('Unexpected web dependency; inspect reference without printing values');
    if (!pending.has(name)) pending.set(name, false);
}
for (const [name, optional] of pending) {
    if (pending.size > 100) throw new Error('Too many web dependencies');
    const bytes = await get(new URL(name, base), optional);
    if (!bytes) { metadata.absentOptional.push(name); continue; }
    const text = bytes.toString('utf8');
    if (patterns.some(pattern => pattern.test(text))) throw new Error(`Possible credential in ${name}; no asset saved`);
    if (!name.endsWith('.html') && /^\s*<!doctype html/i.test(text)) throw new Error('Unexpected HTML response for asset');
    content.set(name, bytes);
    if (name.endsWith('.html')) for (const match of text.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/gi)) add(match[1], name);
    if (name.endsWith('.css')) for (const match of text.matchAll(/url\(\s*["']?([^\s)'";]+)["']?\s*\)/gi)) add(match[1], name);
    if (name === 'manifest.json') for (const icon of JSON.parse(text).icons || []) add(icon.src, name);
    if (name.endsWith('.js')) for (const match of text.matchAll(/(?:from\s*|import\s*\(|fetch\s*\(|register\s*\()\s*["'](\.\.?\/[^"']+)["']/g)) add(match[1], name);
}
// Re-fetch every file, protecting the snapshot against a deployment during capture.
for (const [name, bytes] of content) {
    if (digest(await get(new URL(name, base))) !== digest(bytes)) throw new Error('Live assets changed during capture; snapshot not complete');
    const target = path.join(output, 'web', name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx' });
    metadata.files.push({ name, bytes: bytes.length, sha256: digest(bytes) });
}
if (JSON.parse(await get(`${api}/commits/main`)).sha !== main) throw new Error('Main changed during capture');
metadata.externalDependencies = [...new Set(metadata.externalDependencies)];
metadata.validation = { doubleReadIdentical: true, representativeSecretMatches: 0, mainUnchanged: true, productionDataRequested: false, note: 'Static files only; public browser API keys are not secrets. Pattern checks cannot prove absence of all possible credentials. Live deployment SHA not inferred from main SHA.' };
await writeFile(path.join(output, 'snapshot.json'), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, mainSha: main, files: metadata.files.map(file => file.name), workflows: metadata.workflows, mainWorkflowFiles: metadata.mainWorkflowFiles.map(file => file.name), pages: metadata.pages, validation: metadata.validation }, null, 2));
