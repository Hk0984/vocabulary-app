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
