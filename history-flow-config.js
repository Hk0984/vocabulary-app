// Public-only source selector. No admin sheet identifiers or credentials belong here.
// Reuse the existing restricted browser key; never add Bot/admin credentials here.
window.HISTORY_FLOW_CONFIG = Object.freeze({
    mode: 'sheets',
    spreadsheetId: '1CUqOaYi0PcPrWOmrPvf_C5NYAjZ1krB24FYdG_lImak',
    sheetName: 'history_flow_public',
    apiKey: window.HISTORY_QUESTIONS_CONFIG?.apiKey || ''
});
