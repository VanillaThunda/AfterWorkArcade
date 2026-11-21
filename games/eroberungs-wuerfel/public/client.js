/**
 * Eroberungs-Würfel – Client-Teil.
 *
 * Wird vom Lobby-System per dynamic import() geladen, sobald der Host das
 * Spiel auswählt. Schnittstelle (siehe dokumentation.md):
 *
 *   export const stylesheets = [...]        → CSS-Dateien, die mitgeladen werden
 *   export function mount(container, ctx)   → baut die Oberfläche auf
 *       ctx.me          eigener User { id, name }
 *       ctx.sendAction  schickt eine Aktion an den Server (Promise<boolean>)
 *     Rückgabe: { update(state), destroy() }
 */

export const stylesheets = ["style.css"];

const SIDES = [
    { key: "attacker", label: "Angreifer" },
    { key: "defender", label: "Verteidiger" }
];

const WINNER_LABELS = { attacker: "Angreifer gewinnt", defender: "Verteidiger gewinnt" };

/** Erzeugt ein Element mit Klasse und optionalem Text. */
function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

export function mount(container, ctx) {
    // --- Grundgerüst aufbauen ------------------------------------------------
    const root = createElement("div", "rw");
    const roundLabel = createElement("div", "rw-round");
    const sidesWrapper = createElement("div", "rw-sides");
    const resultBox = createElement("div", "rw-result");
    const actions = createElement("div", "rw-actions");
    const newRoundButton = createElement("button", "button-secondary", "Neue Runde");

    /** Referenzen auf die Elemente je Seite. */
    const sideElements = {};

    for (const { key, label } of SIDES) {
        const section = createElement("section", `rw-side rw-${key}`);
        const dice = createElement("div", "rw-dice");
        const rolledBy = createElement("div", "rw-rolled-by");
        const buttons = createElement("div", "rw-buttons");

        section.append(createElement("h3", null, label), dice, rolledBy, buttons);
        sidesWrapper.append(section);
        sideElements[key] = { dice, rolledBy, buttons };
    }

    actions.append(newRoundButton);
    root.append(roundLabel, sidesWrapper, resultBox, actions);
    container.append(root);

    // --- Zustand und Aktionen ------------------------------------------------
    let currentState = null;
    let busy = false; // verhindert Doppelklicks, solange eine Aktion unterwegs ist

    async function send(action) {
        if (busy) return;
        busy = true;
        render();
        await ctx.sendAction(action); // Fehler zeigt das Lobby-System als Hinweis an
        busy = false;
        render();
    }

    newRoundButton.addEventListener("click", () => send({ type: "new-round" }));

    // --- Darstellung ---------------------------------------------------------

    /** Ergebnis des paarweisen Vergleichs für einen Würfel ("win" / "lose" / ""). */
    function getDieOutcome(sideKey, index) {
        const comparison = currentState.result?.comparisons[index];
        if (!comparison) return "";
        return comparison.winner === sideKey ? "win" : "lose";
    }

    function renderSide(sideKey) {
        const side = currentState[sideKey];
        const elements = sideElements[sideKey];
        const roundFinished = Boolean(currentState.result);
        const alreadyRolled = side.dice.length > 0 && !roundFinished;

        // Würfel
        elements.dice.replaceChildren(
            ...side.dice.map((value, index) => {
                const outcome = getDieOutcome(sideKey, index);
                return createElement("div", `rw-die ${outcome ? "rw-die-" + outcome : ""}`, String(value));
            })
        );

        // Wer hat gewürfelt?
        elements.rolledBy.textContent = side.rolledBy
            ? `gewürfelt von ${side.rolledBy}`
            : "noch nicht gewürfelt";

        // Buttons – Anzahl kommt vom Server (maxDice), damit sie immer zu den Regeln passt.
        const buttons = [];
        for (let count = 1; count <= currentState.maxDice[sideKey]; count++) {
            const button = createElement("button", null, `${count} Würfel`);
            button.disabled = busy || alreadyRolled;
            button.addEventListener("click", () => send({ type: "roll", side: sideKey, count }));
            buttons.push(button);
        }
        elements.buttons.replaceChildren(...buttons);
    }

    function renderResult() {
        const { result, attacker, defender } = currentState;

        if (!result) {
            const waitingFor = [];
            if (attacker.dice.length === 0) waitingFor.push("Angreifer");
            if (defender.dice.length === 0) waitingFor.push("Verteidiger");
            resultBox.replaceChildren(
                createElement("p", "rw-waiting", `Warte auf: ${waitingFor.join(" und ")}`)
            );
            return;
        }

        const list = createElement("ul", "rw-comparisons");
        for (const { attacker: a, defender: d, winner } of result.comparisons) {
            list.append(createElement("li", `rw-comparison rw-winner-${winner}`, `${a} : ${d} → ${WINNER_LABELS[winner]}`));
        }

        const summary = createElement("p", "rw-summary");
        summary.append(
            createElement("span", "rw-loss rw-loss-attacker", `Angreifer verliert ${result.attackerLosses}`),
            createElement("span", "rw-loss rw-loss-defender", `Verteidiger verliert ${result.defenderLosses}`)
        );

        resultBox.replaceChildren(list, summary);
    }

    function render() {
        if (!currentState) return;
        roundLabel.textContent = `Runde ${currentState.round}`;
        renderSide("attacker");
        renderSide("defender");
        renderResult();
        newRoundButton.disabled = busy;
    }

    // --- Schnittstelle zum Lobby-System -------------------------------------
    return {
        update(state) {
            currentState = state;
            render();
        },
        destroy() {
            root.remove();
        }
    };
}
