// Read a public History Sheets export and report IDs and classification for source review.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '../history-classification.js';

const [snapshot] = process.argv.slice(2);
if (!snapshot || process.argv.length !== 3 || !/\.json$/i.test(snapshot) ||
    /\.env|credential|secret|service.account|token/i.test(snapshot)) {
    throw Error('Usage: node scripts/audit-history-sources.mjs PUBLIC_SNAPSHOT.json');
}
const classification = globalThis.HistoryClassification;
const input = JSON.parse(readFileSync(resolve(snapshot), 'utf8'));
const values = input.history ?? input.values ?? input;
const schema = [...classification.BASE_HEADERS, ...classification.EXTRA_HEADERS];
if (!Array.isArray(values) || JSON.stringify(values[0]) !== JSON.stringify(schema) ||
    values.slice(1).some(row => !Array.isArray(row) || row.length > schema.length ||
        row.some(cell => typeof cell !== 'string'))) {
    throw Error('Expected the dedicated 13-column public History Sheets format.');
}

const master = classification.validateMaster(JSON.parse(readFileSync(new URL('../history-regions.json', import.meta.url), 'utf8')));
const normalize = text => text.normalize('NFKC').trim().replace(/\s+/gu, ' ');
const report = {
    count: values.length - 1,
    duplicateIds: [],
    duplicatePrompts: [],
    invalidClassifications: [],
    classificationWarnings: {},
    invalidAnswerForms: [],
    unclassified: [],
    regions: { egypt: [], westAsia: [] },
};
const ids = new Set();
const prompts = new Map();

for (const cells of values.slice(1)) {
    const row = Object.fromEntries(schema.map((name, index) => [name, cells[index] ?? '']));
    if (ids.has(row.id)) report.duplicateIds.push(row.id);
    ids.add(row.id);
    const key = normalize(row.question);
    if (!prompts.has(key)) prompts.set(key, []);
    const options = [row.choice1, row.choice2, row.choice3, row.choice4].map(normalize);
    const answer = options[Number(row.answer) - 1];
    if (!/^[1-4]$/.test(row.answer) || options.some(text => !text) || new Set(options).size !== 4) {
        report.invalidAnswerForms.push(row.id);
    }
    prompts.get(key).push({
        id: row.id, sourceId: row.source_id, options, answer, explanation: normalize(row.explanation),
        periods: row.period_codes, centuries: row.century_codes, areas: row.area_codes, dates: row.time_ranges,
    });
    try {
        for (const warning of classification.validate(row, master).warnings) {
            (report.classificationWarnings[warning] ??= []).push(row.id);
        }
    } catch {
        report.invalidClassifications.push(row.id);
        continue;
    }
    if (row.period_codes === 'unclassified' || row.area_codes === 'unclassified') report.unclassified.push(row.id);
    const entry = {
        id: row.id, sourceId: row.source_id, areas: row.area_codes, periods: row.period_codes,
        centuries: row.century_codes, dates: row.time_ranges, sourceReview: '未照合',
    };
    if (classification.matches(row, { areas: ['geo.egypt'] }, master)) report.regions.egypt.push(entry);
    if (classification.matches(row, { areas: ['geo.west_asia'] }, master)) report.regions.westAsia.push(entry);
}

for (const duplicates of prompts.values()) {
    if (duplicates.length < 2) continue;
    const first = duplicates[0];
    report.duplicatePrompts.push({
        ids: duplicates.map(row => row.id),
        sourceIds: duplicates.map(row => row.sourceId),
        sameAnswer: duplicates.every(row => row.answer === first.answer),
        sameOptionSet: duplicates.every(row => row.options.every(option => first.options.includes(option))),
        sameExplanation: duplicates.every(row => row.explanation === first.explanation),
        sameClassification: duplicates.every(row => ['periods', 'centuries', 'areas', 'dates'].every(key => row[key] === first[key])),
    });
}

console.log(JSON.stringify(report, null, 2));
