import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repo = 'Hk0984/vocabulary-app';
const workflowPath = '.github/workflows/web-release.yml';
const runIdPattern = /^[1-9][0-9]{0,19}$/;

export function reviewedAttempt(run, { repository, runId, currentRunId, commit }) {
    if (repository !== repo || !runIdPattern.test(runId) || !/^[a-f0-9]{40}$/.test(commit) || runId === currentRunId ||
        String(run?.id) !== runId || run.path !== workflowPath || run.event !== 'workflow_dispatch' ||
        run.head_repository?.full_name !== repository || run.head_branch !== 'main' ||
        run.head_sha !== commit || run.status !== 'completed' || run.conclusion !== 'success' ||
        !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) {
        throw new Error('Use a successful manual review run from the same repository, workflow, and main commit.');
    }
    return run.run_attempt;
}

export function requireReviewOnly(jobs) {
    if (!Array.isArray(jobs) ||
        !jobs.some(job => job.name === 'build' && job.conclusion === 'success') ||
        !jobs.some(job => job.name === 'deploy' && job.conclusion === 'skipped')) {
        throw new Error('The selected run must have built an artifact with deployment skipped.');
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const config = {
        repository: process.env.GITHUB_REPOSITORY,
        runId: process.env.REVIEW_RUN_ID,
        currentRunId: process.env.GITHUB_RUN_ID,
        commit: process.env.GITHUB_SHA,
    };
    try {
        if (config.repository !== repo || !runIdPattern.test(config.runId)) {
            throw new Error('A review_run_id from this repository is required.');
        }
        const gh = promisify(execFile);
        const endpoint = 'repos/' + repo + '/actions/runs/' + config.runId;
        const get = async url => {
            try {
                const { stdout } = await gh('gh', ['api', url], { timeout: 30_000 });
                return JSON.parse(stdout);
            } catch {
                throw new Error('The review run metadata could not be verified.');
            }
        };
        const attempt = reviewedAttempt(await get(endpoint), config);
        const { jobs } = await get(endpoint + '/attempts/' + attempt + '/jobs');
        requireReviewOnly(jobs);
        console.log(attempt);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
