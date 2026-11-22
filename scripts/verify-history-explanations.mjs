import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readHistoryQuizCsv, loadHistoryQuizCsv } from './history-quiz-details.mjs';

const csvPath = new URL('../config/history-quiz-reviewed.csv', import.meta.url);
const reviewedPath = new URL('../data/history-explanations-curated.json', import.meta.url);
const regionsPath = new URL('../history-regions.json', import.meta.url);
const review = JSON.parse(await readFile(reviewedPath, 'utf8'));
const regions = JSON.parse(await readFile(regionsPath, 'utf8'));
const { values, details } = await loadHistoryQuizCsv(
    await readHistoryQuizCsv(fileURLToPath(csvPath)), regions
);

assert.equal(values.length - 1, 1536, 'The production 22-column data must retain all 1,536 rows');
assert.equal(Object.keys(review.entries).length, 109, 'Exactly 109 reviewed explanations are required');
assert.equal(Object.keys(details).length, 1536);
for (const [id, expected] of Object.entries(review.entries)) {
    assert.ok(Object.hasOwn(details, id), 'Reviewed id missing in production: ' + id);
    assert.equal(details[id].reviewedExplanation, expected.merged, 'Curated text mismatch: ' + id);
    assert.ok(details[id].reviewedExplanation.trim());
}
const additional = Object.values(details).filter(row => row.reviewedExplanation).length;
assert.equal(additional, 109);
console.log('Verified 1,536 production question rows and 109 reviewed, nonduplicated explanations.');
