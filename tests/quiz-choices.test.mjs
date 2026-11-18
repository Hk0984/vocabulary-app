import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../script.js", import.meta.url), "utf8");
const context = vm.createContext({
    document: {
        addEventListener() {}
    }
});
vm.runInContext(source, context);

function choicesFor(current, words, format = "frontToBack") {
    return Array.from(
        vm.runInContext(
            `buildAnswerChoices(${JSON.stringify(current)}, ${JSON.stringify(words)}, ${JSON.stringify(format)})`,
            context
        )
    );
}

test("通常のデータから正解を保った4つの異なる選択肢を作る", () => {
    const words = [
        { front: "apple", back: "リンゴ" },
        { front: "book", back: "本" },
        { front: "water", back: "水" },
        { front: "bird", back: "鳥" },
        { front: "house", back: "家" }
    ];

    const choices = choicesFor(words[0], words);
    assert.equal(choices.length, 4);
    assert.ok(choices.includes("リンゴ"));
    assert.equal(new Set(choices).size, 4);
});

test("Unicode・大小文字・空白を正規化した重複訳を除外する", () => {
    const words = [
        { front: "apple", back: "リンゴ" },
        { front: "pomme", back: " ﾘﾝｺﾞ " },
        { front: "book", back: "本" },
        { front: "water", back: "水" },
        { front: "bird", back: "鳥" }
    ];

    const choices = choicesFor(words[0], words);
    assert.equal(choices.length, 4);
    assert.equal(choices.filter(value => value.normalize("NFKC").trim() === "リンゴ").length, 1);
});

test("正解とほぼ同じ綴りの誤答候補を除外する", () => {
    const words = [
        { front: "apple", back: "リンゴ" },
        { front: "apples", back: "別の意味" },
        { front: "book", back: "本" },
        { front: "water", back: "水" },
        { front: "bird", back: "鳥" }
    ];

    const choices = choicesFor(words[0], words);
    assert.ok(!choices.includes("別の意味"));
    assert.equal(choices.length, 4);
});

test("正解と綴りが似ていて意味の異なる候補を優先する", () => {
    const words = [
        { front: "apple", back: "りんご" },
        { front: "apply", back: "適用する" },
        { front: "banana", back: "バナナ" },
        { front: "book", back: "本" },
        { front: "water", back: "水" },
        { front: "bird", back: "鳥" }
    ];

    const choices = choicesFor(words[0], words);
    assert.equal(choices.length, 4);
    assert.ok(choices.includes("適用する"));
});

test("裏表を逆にする出題でも正解と誤答の側を取り違えない", () => {
    const words = [
        { front: "apple", back: "りんご" },
        { front: "book", back: "本" },
        { front: "water", back: "水" },
        { front: "bird", back: "鳥" }
    ];

    const choices = choicesFor(words[0], words, "backToFront");
    assert.equal(choices.length, 4);
    assert.ok(choices.includes("apple"));
    assert.ok(!choices.includes("りんご"));
});

test("有効候補が不足する場合は重複を補わず、利用可能な選択肢だけ返す", () => {
    const words = [
        { front: "apple", back: "りんご" },
        { front: "pomme", back: " りんご " },
        { front: "apples", back: "りんご" }
    ];

    const choices = choicesFor(words[0], words);
    assert.deepEqual(choices, ["りんご"]);
});

const attributeSource = await readFile(new URL("../attribute-tags.js", import.meta.url), "utf8");
vm.runInContext(attributeSource, context);
const dictionary = context.AttributeTags.dictionary(
    JSON.parse(await readFile(new URL("../choice-dictionary.json", import.meta.url), "utf8"))
);

test("通常・高難易度とも未表示の別訳と同義語を誤答から除外する", () => {
    const current = { front: "increase", back: "増加する／上昇する" };
    const words = [
        current,
        { front: "rise", back: "上昇する／登る" },
        { front: "grow", back: "増える" },
        { front: "run", back: "走る" }
    ];
    const args = [current, words, "frontToBack"];
    assert.deepEqual(Array.from(context.buildAnswerChoices(...args, undefined, undefined, dictionary)),
        ["増加する／上昇する", "走る"]);
    assert.deepEqual(Array.from(context.buildAnswerChoices(...args, "増加する",
        new Map([[words[1], "登る"]]), dictionary)), ["増加する", "走る"]);
    assert.deepEqual(Array.from(context.buildAnswerChoices(current, words, "backToFront",
        undefined, undefined, dictionary)), ["increase", "run"]);
});

test("実カード、同タグ辞書、互換分類の順で補い辞書を学習カードに混ぜない", () => {
    const tags = "geography/city";
    const current = { id: 9, front: "capital", back: "東京", back_tags: tags };
    const words = [
        current,
        { id: 10, front: "river city", back: "大阪", back_tags: tags },
        { id: 11, front: "other", back: "ベルリン", back_tags: "geography/capital" },
        { id: 12, front: "country", back: "日本", back_tags: "geography/country" }
    ];
    const data = context.AttributeTags.dictionary({
        schema_version: "1.0", tags: { [tags]: ["パリ", "東京", "大阪"] }, synonyms: []
    });
    const before = structuredClone(words);
    assert.deepEqual(Array.from(context.buildAnswerChoices(current, words, "frontToBack",
        undefined, undefined, data)), ["東京", "大阪", "パリ", "ベルリン"]);
    assert.deepEqual(words, before);
});

test("数値の誤答は同単位・同形式の別値に限る", () => {
    const back_tags = "number/mass_kg";
    const current = { front: "target", back: "１０．０ kg", back_tags };
    const words = [current,
        { front: "equal", back: "10.0kg", back_tags },
        { front: "unit", back: "20.0g", back_tags },
        { front: "precision", back: "30kg", back_tags },
        { front: "valid", back: "40.0kg", back_tags }
    ];
    assert.deepEqual(Array.from(context.buildAnswerChoices(current, words, "frontToBack")), ["１０．０ kg", "40.0kg"]);
});

test("辞書は共有された同義語とラベル形式を検査する", () => {
    assert.ok([...dictionary.tags.values()].every(values => values.length >= 30 && values.length <= 50));
    assert.throws(() => context.AttributeTags.dictionary({
        schema_version: "1.0", tags: { "language/verb": ["増加する", "増える"] },
        synonyms: [["増加する", "増える"]]
    }), /同義語/);
});

test("同じ分数は除外し、全角スラッシュの分数を高難易度でも一つの値として採点する", () => {
    const target = { front: "target", back: "２／４", back_tags: "number/fraction" };
    const words = [target,
        { front: "equal", back: "1/2", back_tags: "number/fraction" },
        { front: "different", back: "1/3", back_tags: "number/fraction" }
    ];
    assert.equal(context.pickDisplayMeaning(target.back),target.back);
    assert.equal(context.isCorrectMeaning(target.back,target.back),true);
    assert.deepEqual(Array.from(context.buildAnswerChoices(target, words, "frontToBack")), ["２／４", "1/3"]);
});

test("レビュー済み数値の候補はタグ・問題文・正答が一致したカードに限り追加する", () => {
    const back_tags = "number/percent";
    const card = { id: 2, front: "資料の比率は何%か。", back: "20%", back_tags };
    const scoped = context.AttributeTags.dictionary({
        schema_version: "1.0", tags: { [back_tags]: ["60%"] }, synonyms: [],
        reviewed_numeric: [{ tag: back_tags, prompt: card.front, answer: card.back, choices: ["15%", "45%", "35%"] }],
    });
    const diagnostics = { rejected: {}, selected: [] };
    const options = context.buildAnswerChoices(card, [card], "frontToBack", undefined, undefined, scoped, diagnostics);
    assert.deepEqual(new Set(options), new Set(["20%", "15%", "45%", "35%"]));
    assert.deepEqual(diagnostics.selected, ["dictionary", "dictionary", "dictionary"]);
    for (const changed of [
        { ...card, front: "別資料の比率は何%か。" },
        { ...card, back: "21%" },
        { ...card, back_tags: "number/other_percent" },
    ]) {
        assert.deepEqual(Array.from(context.buildAnswerChoices(changed, [changed], "frontToBack", undefined, undefined, scoped)),
            [changed.back]);
    }
});

test("数値候補の単位、範囲の重なり、桁差、分数の同値を除外理由にできる", () => {
    const { numericFormat, numericMismatch } = context.AttributeTags;
    const compare = (target, candidate) => numericMismatch(numericFormat(target), numericFormat(candidate));
    assert.equal(compare("20～24歳", "24～26歳"), "numeric_overlap");
    assert.equal(compare("20～24歳", "25～29歳"), null);
    assert.equal(compare("第１～４ヶ月", "第５～７か月"), null);
    assert.equal(compare("2分の1", "2/4"), "numeric_equivalent");
    assert.equal(compare("１.０ kg", "2.0g"), "numeric_unit");
    assert.equal(compare("10kg", "2000kg"), "numeric_magnitude");
    assert.equal(compare("18歳未満", "20歳以上"), "numeric_unit");
    assert.equal(numericFormat("30～20歳"), null);
    assert.equal(numericFormat("0分の1"), null);
});

test("数値辞書のビルド検証は同値・別単位・重なる範囲を拒否する", () => {
    for (const [answer, candidate] of [
        ["2分の1", "2/4"], ["15kg", "13g"], ["20～24歳", "19～22歳"],
    ]) {
        assert.throws(() => context.AttributeTags.dictionary({
            schema_version: "1.0", tags: {}, synonyms: [],
            reviewed_numeric: [{ tag: "number/example", prompt: "資料の数値", answer, choices: [candidate] }],
        }), /型・単位・重複/);
    }
});

test("複合書式を解釈し、週の矛盾や頻度・年齢条件の違いを選択肢から除く", () => {
    const { numericFormat, numericMismatch } = context.AttributeTags;
    const compare = (target, candidate) => numericMismatch(numericFormat(target), numericFormat(candidate));
    assert.deepEqual(Array.from(numericFormat("第６ヶ月（２０～２３週）").bounds), [20,23]);
    assert.equal(numericFormat("第６か月（２４～２７週）"), null);
    assert.equal(numericFormat("第６か月（20～24週）"), null);
    assert.equal(compare("5年に1度", "５年に１回"), "numeric_equivalent");
    assert.equal(compare("5年に1度", "5年に2度"), "numeric_unit");
    assert.equal(compare("5年に1度", "5年"), "numeric_unit");
    assert.equal(compare("生後1～2週間程度", "生後2～3週間程度"), "numeric_overlap");
    assert.equal(compare("生後1～2週間程度", "1～2週間程度"), "numeric_shape");
    assert.equal(numericFormat("5年に0度"), null);
});

test("原資料を要する複合数値は、同型の実カードがあっても自動補充しない", () => {
    const tag = "number/gestational_month";
    const current = {front:"資料に即した時期",back:"第6か月（20～23週）",back_tags:tag};
    const peer = {front:"別の資料項目",back:"第8か月（28～31週）",back_tags:tag};
    const diagnostics = {rejected:{}, selected:[]};
    assert.deepEqual(Array.from(context.buildAnswerChoices(current,[current,peer],"frontToBack",
        undefined,undefined,dictionary,diagnostics)), [current.back]);
    assert.equal(diagnostics.rejected.registered_source_review,1);
});

test("同じ辞書項目に境界が重なる誤答を登録できない", () => {
    assert.throws(() => context.AttributeTags.dictionary({
        schema_version:"1.0", tags:{}, synonyms:[],
        reviewed_numeric:[{tag:"number/example",prompt:"架空の範囲",answer:"10～15日",
            choices:["20～25日","25～30日"]}],
    }), /型・単位・重複/);
});
