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
        const shared = a.filter(t => b.some(u => u.split('/')[0] === t.split('/')[0]));
        if (!shared.length) return -1;
        // Numeric answer formats cannot match through an auxiliary nonnumeric tag.
        const numeric = a.filter(t => t.split('/')[0] === 'number');
        const candidateNumeric = b.some(t => t.split('/')[0] === 'number');
        if ((numeric.length || candidateNumeric) && !numeric.some(t => b.includes(t))) return -1;
        return shared.reduce((n,t) => n + (b.includes(t) ? 12 : 1), 0);
    }
    root.AttributeTags = {parse,rank};
})(typeof window !== 'undefined' ? window : globalThis);
