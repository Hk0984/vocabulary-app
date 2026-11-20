import { lstat, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { csv } from './validate-study-data.mjs';
import '../history_questions.js';

const numbers = [1, 2, 3, 4];
const choices = numbers.map(number => 'choice' + number);
const explanations = numbers.map(number => 'explanation' + number);
const places = numbers.map(number => 'place' + number);
const baseHeaders = [...HistoryClassification.BASE_HEADERS, ...HistoryClassification.EXTRA_HEADERS];
export const HISTORY_QUIZ_CSV_HEADERS = [...baseHeaders, ...explanations, 'map_kind', ...places];

export async function readHistoryQuizCsv(filename) {
    const stat = await lstat(filename);
    if (!/\.csv$/i.test(filename) || !stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > 1_000_000) {
        throw new Error('作問用のCSVファイル（1 MB以内）を指定してください。');
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(await readFile(filename));
}

function readPosition(value, kind, countries) {
    if (kind === 'country' && countries.has(value)) return value;
    if (kind === 'point' && /^-?\d+(?:\.\d+)?\|-?\d+(?:\.\d+)?$/.test(value)) {
        const [lat, lon] = value.split('|').map(Number);
        if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return [lon === 180 ? -180 : lon, lat];
    }
    throw new Error(kind === 'point' ? 'placeは有効な緯度|経度で指定してください。' : '地図収録済みの3文字国コードを指定してください。');
}

export function compileHistoryQuizCsv(text, regionData, atlas) {
    const rows = csv(text.replace(/^\uFEFF/, ''), HISTORY_QUIZ_CSV_HEADERS);
    if (!rows.length) throw new Error('作問用CSVに問題がありません。');
    HistoryClassification.setRegions(regionData);
    const values = [baseHeaders, ...rows.map(row => baseHeaders.map(header => row[header]))];
    const baseQuestions = HistoryQuestionCore.parseHistoryQuestionValues(values);
    if (baseQuestions.length !== rows.length) throw new Error('既存13列に不正な行、分類、または重複IDがあります。');

    const countries = new Set(atlas.map(([code]) => code).filter(code => /^[A-Z]{3}$/.test(code)));
    const details = Object.create(null);
    let hasMap = false;
    rows.forEach((row, index) => {
        try {
            if (!/^[A-Za-z0-9_-]{1,128}$/.test(row.id)) throw new Error('問題IDの形式が不正です。');
            if (explanations.some(key => !row[key].trim() || row[key].length > 1000)) {
                throw new Error('各選択肢の解説は1〜1000文字で指定してください。');
            }
            const kind = row.map_kind;
            if (!['', 'country', 'point'].includes(kind)) throw new Error('map_kind は空欄、country、pointのいずれかです。');
            if (!kind && places.some(key => row[key] !== '')) throw new Error('地図なしのplace列は空にしてください。');
            const locations = kind ? places.map(key => readPosition(row[key], kind, countries)) : [];
            if (new Set(locations.map(location => JSON.stringify(location))).size !== locations.length) {
                throw new Error('同じ位置を複数の選択肢に指定できません。');
            }
            details[row.id] = {
                question: row.question, choices: choices.map(key => row[key]), answer: row.answer,
                explanations: explanations.map(key => row[key]), kind, locations,
            };
            hasMap ||= Boolean(kind);
        } catch (error) {
            throw new Error(`データ行${index + 1}（${row.id}）: ${error.message}`);
        }
    });
    return { values, details, atlas: hasMap ? atlas : [] };
}

export async function loadHistoryQuizCsv(text, regionData) {
    const atlas = JSON.parse(await readFile(new URL('../data/history-quiz-atlas.json', import.meta.url), 'utf8'));
    return compileHistoryQuizCsv(text, regionData, atlas);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const [input, output, extra] = process.argv.slice(2);
        if (!input || extra || (output && !/\.csv$/i.test(output))) {
            throw new Error('使用法: node scripts/history-quiz-details.mjs 作問用.csv [取込用13列.csv]');
        }
        const regions = JSON.parse(await readFile(new URL('../history-regions.json', import.meta.url), 'utf8'));
        const { values } = await loadHistoryQuizCsv(await readHistoryQuizCsv(input), regions);
        if (output) {
            const escapeCell = cell => /[,\r\n"]/.test(cell) ? '"' + cell.replaceAll('"', '""') + '"' : cell;
            const content = values.map(row => row.map(escapeCell).join(',')).join('\r\n') + '\r\n';
            await writeFile(output, content, { flag: 'wx' });
        }
        console.log(`作問用CSVの検証成功（${values.length - 1}問）${output ? '。取込用13列CSVを作成しました。' : '。'}`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
