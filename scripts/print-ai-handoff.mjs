import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);

function git(...args) {
    return execFileSync('git', ['--no-optional-locks', ...args], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

try {
    const handoff = readFileSync(new URL('docs/ai-handoff/HANDOFF.md', root), 'utf8');
    const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
    const head = git('rev-parse', '--verify', 'HEAD');
    const hasChanges = git('-c', 'core.fsmonitor=false', 'status', '--porcelain=v1', '--untracked-files=normal') !== '';

    console.log(handoff.trimEnd());
    console.log('\n## 出力時のローカルGit情報\n');
    console.log('    ブランチ: ' + (branch === 'HEAD' ? 'detached HEAD' : branch));
    console.log('    HEAD: ' + head);
    console.log('    作業ツリー: ' + (hasChanges ? '未コミット変更あり' : '未コミット変更なし'));
} catch {
    console.error('引き継ぎ資料またはローカルGitの情報を読み取れませんでした。');
    process.exitCode = 1;
}
