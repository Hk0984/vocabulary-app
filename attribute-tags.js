/* Optional labels; invalid nonempty labels fail closed for choice generation. */
(function(root) {
    'use strict';
    function parse(value) {
        if (value === undefined || value === null || value === '') return [];
        if (typeof value !== 'string' || value.length > 2048) throw new Error('ラベルは2048文字以内の文字列です');
        const tags = value.split(';');
        if (tags.length > 32 || tags.some(t => !/^[a-z][a-z0-9_]*\/[a-z][a-z0-9_]*$/.test(t)) || new Set(tags).size !== tags.length) throw new Error('ラベルは大分類/小分類のちょうど2階層で指定し、重複を避けてください');
        return tags;
    }
    function rank(target, candidate) {
        const a = parse(target), b = parse(candidate);
        if (!a.length) return 0;
        const shared = a.filter(t => b.some(u => {
            if (t === u) return true;
            const [category] = t.split('/');
            if (u.split('/')[0] !== category || category === 'language') return false;
            if (category === 'geography') {
                return [t,u].every(tag => ['geography/city','geography/capital'].includes(tag));
            }
            return true;
        }));
        if (!shared.length) return -1;
        // Numeric answer formats cannot match through an auxiliary nonnumeric tag.
        const numeric = a.filter(t => t.split('/')[0] === 'number');
        const candidateNumeric = b.some(t => t.split('/')[0] === 'number');
        if ((numeric.length || candidateNumeric) && !numeric.some(t => b.includes(t))) return -1;
        return shared.reduce((n,t) => n + (b.includes(t) ? 12 : 1), 0);
    }
    function normalize(value) {
        return String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
    }

    function dictionary(data) {
        if (!data || data.schema_version !== '1.0' ||
            !['schema_version,synonyms,tags', 'reviewed_numeric,schema_version,synonyms,tags'].includes(Object.keys(data).sort().join(',')) ||
            !data.tags || typeof data.tags !== 'object' || Array.isArray(data.tags) ||
            !Array.isArray(data.synonyms)) throw Error('選択肢辞書の形式が不正です');
        const normalizeGroup = (entries, minimum) => {
            if (!Array.isArray(entries) || entries.length < minimum || entries.length > 50 ||
                entries.some(value => typeof value !== 'string' || value.length > 200 ||
                    !value.trim() || /[\p{Cc}／\/]/u.test(value))) throw Error('辞書の候補が不正です');
            const keys = entries.map(normalize);
            if (new Set(keys).size !== keys.length) throw Error('辞書の候補が重複しています');
            return keys;
        };

        const aliases = new Map();
        for (const group of data.synonyms) {
            const keys = normalizeGroup(group, 2);
            for (const key of keys) {
                if (aliases.has(key)) throw Error('同義語グループが重複しています');
                aliases.set(key, keys[0]);
            }
        }
        const tags = new Map();
        for (const [tag, entries] of Object.entries(data.tags)) {
            if (parse(tag).length !== 1) throw Error('辞書のタグが不正です');
            const keys = normalizeGroup(entries, 1).map(key => aliases.get(key) ?? key);
            if (new Set(keys).size !== keys.length) throw Error('タグ内の同義語が重複しています');
            tags.set(tag, entries.map(text => text.trim()));
        }
        const reviewedNumeric = new Map();
        if (Object.hasOwn(data, 'reviewed_numeric') && !Array.isArray(data.reviewed_numeric)) {
            throw Error('レビュー済み数値候補の形式が不正です');
        }
        for (const entry of data.reviewed_numeric ?? []) {
            if (!entry || Object.keys(entry).sort().join(',') !== 'answer,choices,prompt,tag' ||
                typeof entry.tag !== 'string' || !entry.tag.startsWith('number/') || parse(entry.tag).length !== 1 ||
                typeof entry.prompt !== 'string' || !entry.prompt.trim() || entry.prompt.length > 500 ||
                typeof entry.answer !== 'string' || entry.answer.length > 120 ||
                !Array.isArray(entry.choices) || !entry.choices.length || entry.choices.length > 3) {
                throw Error('レビュー済み数値候補の形式が不正です');
            }
            const target = numericFormat(entry.answer);
            const seen = new Set([target?.value]);
            for (const answer of entry.choices) {
                const number = typeof answer === 'string' && answer.length <= 120 ? numericFormat(answer) : null;
                if (!target || !number || numericMismatch(target, number) || seen.has(number.value)) {
                    throw Error('レビュー済み数値候補の型・単位・重複が不正です');
                }
                seen.add(number.value);
            }
            const key = numericReviewKey(entry.tag, entry.prompt, entry.answer);
            if (reviewedNumeric.has(key)) throw Error('レビュー済み数値問題が重複しています');
            reviewedNumeric.set(key, entry.choices.map(text => text.trim()));
        }
        return {tags, aliases, reviewedNumeric};
    }

    function numericReviewKey(tag, prompt, answer) {
        return JSON.stringify([tag, normalize(prompt), normalize(answer)]);
    }

    function numericMismatch(target, candidate) {
        if (!candidate) return 'candidate_numeric_unparsed';
        if (candidate.unit !== target.unit) return 'numeric_unit';
        if (candidate.shape !== target.shape) return 'numeric_shape';
        if (candidate.value === target.value) return 'numeric_equivalent';
        if (target.digits !== null && Math.abs(target.digits - candidate.digits) > 1) return 'numeric_magnitude';
        if (target.bounds && candidate.bounds &&
            Math.max(target.bounds[0], candidate.bounds[0]) <= Math.min(target.bounds[1], candidate.bounds[1])) {
            return 'numeric_overlap';
        }
        return null;
    }

    function numericFormat(value) {
        const source = String(value ?? '').normalize('NFKC').trim().replaceAll('−', '-')
            .replace(/(?:ヶ|カ|箇)月/g, 'か月');
        // Keep ordinal and inequality markers in the shape of every choice.
        const text = source.replace(/^(\d+)分の(\d+)(.*)$/u, '$2/$1$3');
        const scalar = /[+-]?(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]+)?/;
        const match = text.match(new RegExp(
            `^(約|第|満)?\\s*(${scalar.source})(?:\\s*([~〜/–-])\\s*(${scalar.source}))?\\s*([^0-9.,\\s]+)?$`, 'u'
        ));
        if (!match) return null;
        const [, prefix = '', first, separator = '', second = '', unit = ''] = match;
        const numbers = [first, second].filter(Boolean);
        const parts = numbers.map(number => {
            const [integer, fraction = ''] = number.replace(/^[+-]/, '').split('.');
            const whole = integer.replaceAll(',', '').replace(/^0+(?=\d)/, '');
            const decimals = fraction.replace(/0+$/, '');
            const negative = number.startsWith('-') && (whole !== '0' || decimals);
            return { sign: negative ? '-' : '', whole, decimals, precision: fraction.length };
        });
        const numberValues = parts.map(part => part.sign + part.whole + '.' + part.decimals);
        let comparableValue = numberValues.join(separator === '/' ? '/' : '~');
        if (separator === '/') {
            if (parts.some(part => part.precision || part.whole.length > 20) || parts[1].whole === '0') return null;
            const numerator = BigInt(parts[0].sign + parts[0].whole);
            const denominator = BigInt(parts[1].sign + parts[1].whole);
            let x = numerator < 0n ? -numerator : numerator;
            let y = denominator < 0n ? -denominator : denominator;
            while (y) [x, y] = [y, x % y];
            comparableValue = (denominator < 0n ? -numerator / x : numerator / x) + '/' +
                (denominator < 0n ? -denominator / x : denominator / x);
        }
        const kind = separator === '/' ? 'fraction' : numbers.length === 2 ? 'range' : 'scalar';
        const bounds = kind === 'range' ? numberValues.map(Number) : null;
        if (bounds && (!bounds.every(Number.isFinite) || bounds[0] > bounds[1])) return null;
        return {
            unit,
            kind,
            shape: [prefix, kind, ...parts.map(part => part.precision)].join(':'),
            value: comparableValue,
            digits: kind === 'fraction' ? null : Math.max(...parts.map(part => part.whole.length)),
            bounds,
        };
    }

    root.AttributeTags = { parse, rank, dictionary, numericFormat, numericMismatch, numericReviewKey };
})(typeof window !== 'undefined' ? window : globalThis);
