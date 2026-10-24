import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../script.js", import.meta.url), "utf8");
const elements = new Map();
let activeButtons = [];

function element(id = "") {
    return elements.get(id) ?? {
        id,
        style: {},
        classList: { add() {}, remove() {}, toggle() {} },
        children: [],
        appendChild(child) { this.children.push(child); },
        set innerHTML(value) { this.children = []; },
        get innerHTML() { return ""; }
    };
}

const document = {
    addEventListener() {},
    getElementById(id) {
        if (!elements.has(id)) elements.set(id, element(id));
        return elements.get(id);
    },
    createElement() { return element(); },
    querySelectorAll() { return activeButtons; }
};
const context = vm.createContext({ document, Math });
vm.runInContext(source, context);
const pickDisplayMeaning = context.pickDisplayMeaning;

test("meaning split trims whitespace, drops empty entries, and leaves other separators alone", () => {
    assert.equal(vm.runInContext('pickDisplayMeaning("銀行／川のほとり／貯蔵庫", () => 0.5)', context), "川のほとり");
    assert.equal(vm.runInContext('pickDisplayMeaning(" ／ 銀行 ／ ／ 貯蔵庫 ", () => 0.99)', context), "貯蔵庫");
    assert.equal(vm.runInContext('pickDisplayMeaning("語彙;別の意味", () => 0)', context), "語彙;別の意味");
    assert.equal(vm.runInContext('pickDisplayMeaning(" 語彙;別の意味 ", () => 0)', context), " 語彙;別の意味 ");
    assert.equal(vm.runInContext('pickDisplayMeaning(" 語彙〔表記／別表記〕 ", () => 0)', context), " 語彙〔表記／別表記〕 ");
    assert.equal(vm.runInContext('pickDisplayMeaning("語彙〔表記／別表記〕／別義", () => 0)', context), "語彙〔表記／別表記〕");
    assert.equal(vm.runInContext('pickDisplayMeaning("語彙〔表記／別表記〕／別義", () => 0.99)', context), "別義");
    assert.equal(vm.runInContext('isCorrectMeaning("語彙〔表記／別表記〕", "語彙〔表記／別表記〕／別義")', context), true);
});

test("normal mode preserves the complete original meaning", () => {
    vm.runInContext(`
        studySettings.meaningDisplay = "normal";
        studySettings.format = "backToFront";
        studyWords = [{ front: "word", back: " 銀行／川のほとり " }];
        currentIndex = 0;
        currentWord = null;
        showQuestion();
    `, context);

    assert.equal(elements.get("question").textContent, " 銀行／川のほとり ");
});

test("hard mode keeps a card's picked meaning on redraw and picks again for a new card", () => {
    const randomValues = [0, 0.99];
    context.pickDisplayMeaning = value =>
        pickDisplayMeaning(value, () => randomValues.shift() ?? 0);
    vm.runInContext(`
        studySettings.meaningDisplay = "hard";
        studySettings.format = "backToFront";
        studyWords = [
            { front: "bank", back: "銀行／川のほとり" },
            { front: "store", back: "貯蔵庫／店舗" }
        ];
        currentIndex = 0;
        currentWord = null;
        showQuestion();
    `, context);

    assert.equal(elements.get("question").textContent, "銀行");
    vm.runInContext("showQuestion()", context);
    assert.equal(elements.get("question").textContent, "銀行");

    vm.runInContext("currentIndex = 1; showQuestion()", context);
    assert.equal(elements.get("question").textContent, "店舗");
});

test("all original meanings remain valid answers in hard mode", () => {
    assert.equal(vm.runInContext('isCorrectMeaning("川のほとり", "銀行／川のほとり／貯蔵庫")', context), true);
    assert.equal(vm.runInContext('isCorrectMeaning("誤答", "銀行／川のほとり／貯蔵庫")', context), false);
});

test("answerQuestion accepts an undisplayed original meaning", async () => {
    const buttons = ["銀行", "誤答"].map(textContent => ({
        textContent,
        disabled: false,
        classList: { add() {} }
    }));
    activeButtons = buttons;
    context.recordAnswer = async () => {};
    vm.runInContext(`
        studySettings.meaningDisplay = "hard";
        studySettings.format = "frontToBack";
        currentWord = { front: "bank", back: "銀行／川のほとり／貯蔵庫" };
        sessionAnswered = 0;
        sessionCorrect = 0;
        sessionResults = [];
    `, context);

    await vm.runInContext('answerQuestion("川のほとり", null)', context);

    assert.equal(vm.runInContext("sessionCorrect", context), 1);
    assert.equal(elements.get("result").textContent, "正解！ 意味：銀行／川のほとり／貯蔵庫");
});

test("four-choice answers show one cached meaning and preserve reverse-format pairing", () => {
    const words = [
        { front: "bank", back: "銀行／川のほとり" },
        { front: "store", back: "貯蔵庫／店舗" },
        { front: "river", back: "川／河川" },
        { front: "vault", back: "金庫／貯蔵庫" },
        { front: "shore", back: "岸／海岸" }
    ];
    const choices = Array.from(vm.runInContext(`(() => {
        const words = ${JSON.stringify(words)};
        const displayed = new Map([[words[0], "川のほとり"]]);
        return buildAnswerChoices(
            words[0], words, "frontToBack", "川のほとり", displayed
        );
    })()`, context));
    assert.equal(choices.length, 4);
    assert.equal(choices[0], "川のほとり");
    assert.ok(choices.every(choice => !choice.includes("／")));

    const reverseChoices = Array.from(vm.runInContext(
        `buildAnswerChoices(${JSON.stringify(words[0])}, ${JSON.stringify(words)}, "backToFront")`,
        context
    ));
    assert.ok(reverseChoices.includes("bank"));
    assert.ok(!reverseChoices.includes("銀行／川のほとり"));
});
