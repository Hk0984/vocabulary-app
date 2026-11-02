import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function validatePagesSource(pages) {
    if (pages?.build_type !== 'workflow') {
        throw new Error('Pages publishing source must be GitHub Actions. Resolve the branch publishing route before releasing.');
    }
}

export async function checkPagesSource({ repository, token, fetchImpl = fetch }) {
    if (repository !== 'Hk0984/vocabulary-app' || !token) throw new Error('Expected repository and read-only GitHub token are required');
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/pages`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
    });
    if (!response.ok) throw new Error(`Pages source could not be verified (HTTP ${response.status}); release stopped`);
    validatePagesSource(await response.json());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        await checkPagesSource({repository:process.env.GITHUB_REPOSITORY, token:process.env.GITHUB_TOKEN});
        console.log('Pages source verified as GitHub Actions. No settings were changed.');
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
