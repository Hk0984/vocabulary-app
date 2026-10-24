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
