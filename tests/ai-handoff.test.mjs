import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('handoff prints reviewed text and Git state without local file paths or contents', async t => {
    const root = await mkdtemp(path.join(tmpdir(), 'vocab-handoff-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    const handoff = 'docs/ai-handoff/HANDOFF.md';
    const script = 'scripts/print-ai-handoff.mjs';
    const print = () => execFileSync(process.execPath, [path.join(root, script)], { encoding: 'utf8' });

    await mkdir(path.join(root, 'docs/ai-handoff'), { recursive: true });
    await mkdir(path.join(root, 'scripts'));
    await copyFile(new URL('../' + script, import.meta.url), path.join(root, script));
    await writeFile(path.join(root, handoff), '# 共有用の要約\n');

    git('init', '-q', '-b', 'handoff-test');
    git('add', handoff, script);
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false',
        'commit', '-qm', 'SYNTHETIC_PRIVATE_SUBJECT');
    const head = git('rev-parse', 'HEAD');
    const clean = print();
    assert.match(clean, /^# 共有用の要約/m);
    assert.ok(clean.includes('HEAD: ' + head));
    assert.match(clean, /ブランチ: handoff-test/);
    assert.match(clean, /作業ツリー: 未コミット変更なし/);

    await writeFile(path.join(root, 'SYNTHETIC_PRIVATE_FILENAME'), 'SYNTHETIC_PRIVATE_CONTENT');
    assert.match(print(), /作業ツリー: 未コミット変更あり/);
    assert.doesNotMatch(print(), /SYNTHETIC_PRIVATE/);
    git('checkout', '-q', '--detach', head);
    assert.match(print(), /ブランチ: detached HEAD/);
});

test('all handoff documents exist and freeze IDs appear once with frozen status', async () => {
    const docs = new URL('../docs/ai-handoff/', import.meta.url);
    for (const name of ['README', 'STATUS', 'BACKLOG', 'DECISIONS', 'ARCHITECTURE', 'HANDOFF']) {
        const body = await readFile(new URL(name + '.md', docs), 'utf8');
        assert.match(body, /^# /);
        for (const match of body.matchAll(/\]\(([^)]+)\)/g)) {
            const [target] = match[1].split('#');
            if (target && !target.includes('://')) {
                await readFile(new URL(target, docs));
            }
        }
    }
    const backlog = await readFile(new URL('BACKLOG.md', docs), 'utf8');
    const frozen = [...backlog.matchAll(/^\| ([A-Z](?:-\d+)?) \| 対象外 \| 凍結 \|/gm)].map(match => match[1]);
    assert.deepEqual(frozen, ['B-1', 'D-2', 'E', 'F', 'G', 'J-1']);
});
