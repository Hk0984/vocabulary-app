// Compare local versions against one read-only snapshot of the public card pools.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = new URL('../', import.meta.url);
const files = ['attribute-tags.js', 'script.js', 'choice-dictionary.json'];
const [snapshotPath, baselineRef, detailsFlag] = process.argv.slice(2);
if (!snapshotPath || !/^[0-9a-f]{7,40}$/.test(baselineRef ?? '') ||
    (detailsFlag !== undefined && detailsFlag !== '--details') || process.argv.length > 5 ||
    !/\.json$/i.test(snapshotPath) || /\.env|credential|secret|service.account|token/i.test(snapshotPath)) {
    throw Error('Usage: node scripts/audit-choices.mjs PUBLIC_SNAPSHOT.json BASELINE_COMMIT [--details]');
}

function engine(sources) {
    const [tags, quiz, dictionary] = sources;
    return new Function('dictionary', `
        const document = { addEventListener() {} };
        const window = {};
        const Math = Object.create(globalThis.Math);
        Math.random = () => 0.5;
        ${tags}
        const AttributeTags = window.AttributeTags;
        ${quiz}
        return { buildAnswerChoices, meaningKeys, sharesMeaning, tags: AttributeTags,
            dictionary: AttributeTags.dictionary(dictionary) };
    `)(JSON.parse(dictionary));
}

function counters() {
    return { questions: 0, skipped: 0, reduced: 0, four: 0, attributeFlags: 0, tagMismatches: 0, numericFormatFlags: 0, ambiguityFlags: 0, duplicateOptions: 0, synonymousOptions: 0, numericConflicts: 0 };
}

function add(counter, outcome) {
    counter.questions++;
    counter[outcome.size < 2 ? 'skipped' : outcome.size < 4 ? 'reduced' : 'four']++;
    counter.attributeFlags += outcome.attributeFlags;
    counter.tagMismatches += outcome.tagMismatches;
    counter.numericFormatFlags += outcome.numericFormatFlags;
    counter.ambiguityFlags += outcome.ambiguityFlags;
    counter.duplicateOptions += outcome.duplicateOptions;
    counter.synonymousOptions += outcome.synonymousOptions;
    counter.numericConflicts += outcome.numericConflicts;
}

const raw = readFileSync(resolve(snapshotPath));
const { genres } = JSON.parse(raw.toString('utf8'));
if (!Array.isArray(genres) || !genres.length || genres.some(genre =>
    typeof genre?.title !== 'string' || !Array.isArray(genre.words) || !genre.words.length ||
    genre.words.some(word => typeof word?.front !== 'string' || typeof word?.back !== 'string'))) {
    throw Error('Public snapshot must contain genres with title and parsed words.');
}
const before = engine(files.map(file => execFileSync('git', ['show', baselineRef + ':' + file], { cwd: root, encoding: 'utf8' })));
const after = engine(files.map(file => readFileSync(new URL(file, root), 'utf8')));
const report = {
    snapshotSha256: createHash('sha256').update(raw).digest('hex'),
    baselineRef, directions: {}, priorSample: {},
};
const details = [];
const risks = (version, word, words, direction, options) => {
    const front = direction === 'frontToBack';
    const side = front ? 'back' : 'front';
    const promptSide = front ? 'front' : 'back';
    const rawTags = word[side + '_tags'];
    const tags = after.tags.parse(rawTags);
    const numeric = tags.some(tag => tag.startsWith('number/'));
    const seen = after.meaningKeys(word[side], front, after.dictionary.aliases);
    const seenRaw = after.meaningKeys(word[side], front);
    const usedNumbers = numeric ? [after.tags.numericFormat(word[side])].filter(Boolean) : [];
    let tagMismatches = 0, numericFormatFlags = 0, duplicateOptions = 0, synonymousOptions = 0, numericConflicts = 0;
    for (const option of options.slice(1)) {
        const knownInDictionary = tags.some(tag => {
            if (numeric) {
                const key = after.tags.numericReviewKey(tag, word[promptSide], word[side]);
                return version.dictionary.reviewedNumeric?.get(key)?.includes(option);
            }
            return version.dictionary.tags.get(tag)?.includes(option);
        });
        if (tags.length && !knownInDictionary && !words.some(candidate => candidate !== word &&
            candidate[side] === option && after.tags.rank(rawTags, candidate[side + '_tags']) >= 0)) {
            tagMismatches++;
        }
        const keys = after.meaningKeys(option, front, after.dictionary.aliases);
        const numericOption = numeric ? after.tags.numericFormat(option) : null;
        if (numeric && (!numericOption || (usedNumbers[0] &&
            ['numeric_unit','numeric_shape','numeric_magnitude'].includes(after.tags.numericMismatch(usedNumbers[0],numericOption))))) {
            numericFormatFlags++;
        }
        const conflictsWithNumber = numericOption && usedNumbers.some(number =>
            ['numeric_overlap','numeric_equivalent'].includes(after.tags.numericMismatch(number,numericOption)));
        const rawKeys = after.meaningKeys(option, front);
        if (conflictsWithNumber) numericConflicts++;
        else if (after.sharesMeaning(rawKeys, seenRaw)) duplicateOptions++;
        else if (after.sharesMeaning(keys, seen)) synonymousOptions++;
        if (numericOption) usedNumbers.push(numericOption);
        for (const key of keys) seen.add(key);
        for (const key of rawKeys) seenRaw.add(key);
    }
    return { size: options.length, attributeFlags: tagMismatches + numericFormatFlags, tagMismatches,
        numericFormatFlags, duplicateOptions, synonymousOptions, numericConflicts,
        ambiguityFlags: duplicateOptions + synonymousOptions + numericConflicts };
};

function group() {
    return { before: counters(), after: counters(), dictionaryFilledSkip: 0, dictionaryFilledFour: 0 };
}

for (const direction of ['frontToBack', 'backToFront']) {
    const side = direction === 'frontToBack' ? 'back' : 'front';
    const directionReport = { ...group(), genres: {}, tags: {}, answerKinds: {}, rejectedForRemainingSkips: {} };
    const sampleReport = group();
    report.directions[direction] = directionReport;
    report.priorSample[direction] = sampleReport;
    for (const { title, words } of genres) {
        for (const [index, word] of words.entries()) {
            const diagnostics = { rejected: {}, eligible: {}, selected: [] };
            const original = before.buildAnswerChoices(word, words, direction, undefined, undefined, before.dictionary);
            const updated = after.buildAnswerChoices(word, words, direction, undefined, undefined, after.dictionary, diagnostics);
            const oldResult = risks(before, word, words, direction, original);
            const newResult = risks(after, word, words, direction, updated);
            const tags = after.tags.parse(word[side + '_tags']);
            const kind = tags.some(tag => tag.startsWith('number/')) ? 'numeric' : 'other';
            let dictionaryFilledSkip = false, dictionaryFilledFour = false;
            if (diagnostics.selected.includes('dictionary') && ((original.length < 2 && updated.length >= 2) ||
                (original.length < 4 && updated.length === 4))) {
                const without = after.buildAnswerChoices(word, words, direction, undefined, undefined,
                    { ...after.dictionary, tags: new Map(), reviewedNumeric: new Map() });
                dictionaryFilledSkip = original.length < 2 && without.length < 2 && updated.length >= 2;
                dictionaryFilledFour = original.length < 4 && without.length < 4 && updated.length === 4;
            }
            const buckets = [
                directionReport,
                directionReport.genres[title] ??= group(),
                directionReport.answerKinds[kind] ??= group(),
                ...(tags.length ? tags : ['untagged']).map(tag => directionReport.tags[tag] ??= group()),
            ];
            const priorSample = index % 7 === 0 || after.tags.parse(word.back_tags).some(tag => tag.startsWith('number/'));
            if (priorSample) buckets.push(sampleReport);
            for (const bucket of buckets) {
                add(bucket.before, oldResult);
                add(bucket.after, newResult);
                bucket.dictionaryFilledSkip += Number(dictionaryFilledSkip);
                bucket.dictionaryFilledFour += Number(dictionaryFilledFour);
            }
            if (updated.length < 2) {
                for (const [reason, count] of Object.entries(diagnostics.rejected)) {
                    const total = directionReport.rejectedForRemainingSkips[reason] ??= { questions: 0, candidates: 0 };
                    total.questions++;
                    total.candidates += count;
                }
            }
            if (detailsFlag && (original.length < 2 || updated.length < 2)) {
                details.push({ genre: title, id: word.id, direction, tags, kind, priorSample,
                    before: original.length, after: updated.length, dictionaryFilledSkip, ...diagnostics });
            }
        }
    }
}
if (detailsFlag) report.shortages = details;
console.log(JSON.stringify(report, null, 2));
