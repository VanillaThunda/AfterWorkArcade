/**
 * Fünf-Würfel-Poker – Client-Teil.
 *
 * Oben der eigene Würfeltisch (5 Würfel zum Halten, „Würfeln“, Zeitbalken),
 * darunter der gemeinsame Punktzettel: eine Spalte je Teilnehmer, die eigene
 * vorne. Eigene freie Felder zeigen nach einem Wurf die möglichen Punkte als
 * Knöpfe; eine 0 muss mit einem zweiten Klick bestätigt werden.
 *
 * Tastatur: 1–5 hält/löst einen Würfel, Leertaste oder R würfelt.
 *
 * Der Punktzettel wird einmal aufgebaut und danach nur in den Zellen
 * aktualisiert – so gehen Klicks nicht verloren, während Bots würfeln.
 *
 * Aktionen:  settings {bots, botLevel}, start, roll {held}, hold {held},
 *            score {category}, new-match
 *
 * Würfel-Darstellung und Wurf-Animation sind aus Schocken übernommen
 * (games/schocken/public) – Spiele können sich gegenseitig nicht importieren.
 */

export const stylesheets = ["style.css"];

const PIPS = {
    1: [5],
    2: [3, 7],
    3: [3, 5, 7],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9]
};
const ROLL_ANIMATION_MS = 900;
const STAGGER_MS = 70;
const CONFIRM_MS = 3000;

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function button(className, text, onClick) {
    const b = createElement("button", className, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
}

/** Augen eines Würfels setzen; value 0 = noch nicht gewürfelt. */
function paintDie(die, value) {
    die.replaceChildren();
    die.classList.toggle("wp-blank", !value);
    die.setAttribute("aria-label", value ? `Würfel ${value}` : "noch nicht gewürfelt");
    if (!value) return;
    for (const position of PIPS[value]) {
        const pip = createElement("i");
        pip.style.gridRow = String(Math.ceil(position / 3));
        pip.style.gridColumn = String(((position - 1) % 3) + 1);
        die.append(pip);
    }
}

function createDie(value, className = "wp-die") {
    const die = createElement("div", className);
    paintDie(die, value);
    return die;
}

/** Laufender Zeitbalken (CSS-Animation, startet mit der Restzeit). */
function createTimer(remainingMs, totalMs) {
    const bar = createElement("div", "wp-timer");
    const fill = createElement("div", "wp-timer-fill");
    fill.style.animationDuration = `${totalMs}ms`;
    fill.style.animationDelay = `${-(totalMs - remainingMs)}ms`;
    bar.append(fill);
    return bar;
}

const isTyping = () => {
    const el = document.activeElement;
    return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable || el.closest?.("dialog[open]")));
};

export function mount(container, ctx) {
    const frame = createElement("div", "wp-root");
    const root = createElement("div", "wp");
    const top = createElement("div", "wp-top");          // Setup, eigener Tisch oder Ergebnis
    const sheetWrap = createElement("div", "wp-sheet-wrap");
    const log = createElement("ul", "wp-log");
    root.append(top, sheetWrap, log);
    frame.append(root);
    container.append(frame);

    let state = null;
    let topKey = "";
    let sheetKey = "";
    let held = [false, false, false, false, false];
    let pendingHold = 0;
    let busy = false;
    let confirm = null;                 // { category, until }
    const rollSeen = new Map();         // Spieler-id → { rollNo, at }
    let initial = true;

    // Elemente des eigenen Tisches (bleiben bestehen, solange die Partie läuft)
    let tableEls = null;
    // Zellen des Punktzettels: `${category}|${playerId}` → td
    let cells = new Map();
    let headDice = new Map();
    let headInfo = new Map();
    let potentialButtons = new Map();

    const isHost = () => ctx.getLobby()?.hostId === ctx.me.id;
    const me = () => state?.players.find(p => p.id === ctx.me.id && !p.left) ?? null;
    const canAct = () => state?.phase === "playing" && me() && !me().done;

    async function send(action) {
        if (busy) return;
        busy = true;
        try {
            await ctx.sendAction(action);
        } finally {
            busy = false;
        }
    }

    // --- Eingaben --------------------------------------------------------------
    function toggleHold(i) {
        const self = me();
        if (!canAct() || self.turn.rolls === 0 || self.turn.rolls >= state.catalog.maxRolls) return;
        held = held.map((h, k) => (k === i ? !h : h));
        pendingHold += 1;
        renderTable();
        Promise.resolve(ctx.sendAction({ type: "hold", held })).finally(() => { pendingHold -= 1; });
    }

    function roll() {
        const self = me();
        if (!canAct() || self.turn.rolls >= state.catalog.maxRolls) return;
        if (self.turn.rolls > 0 && held.every(Boolean)) return;
        send({ type: "roll", held });
    }

    function scoreField(category) {
        const self = me();
        if (!canAct() || self.turn.rolls === 0) return;
        const value = state.potentials?.[category];
        if (value === 0 && (!confirm || confirm.category !== category || performance.now() > confirm.until)) {
            confirm = { category, until: performance.now() + CONFIRM_MS };
            updateSheet();
            setTimeout(() => { if (confirm?.category === category) { confirm = null; updateSheet(); } }, CONFIRM_MS + 50);
            return;
        }
        confirm = null;
        send({ type: "score", category });
    }

    function onKey(event) {
        if (!canAct() || isTyping() || event.ctrlKey || event.metaKey || event.altKey) return;
        const index = Number(event.key) - 1;
        if (Number.isInteger(index) && index >= 0 && index < 5) {
            event.preventDefault();
            toggleHold(index);
        } else if (event.key === " " || event.key.toLowerCase() === "r") {
            event.preventDefault();
            roll();
        }
    }
    document.addEventListener("keydown", onKey);

    // --- Animation -----------------------------------------------------------------
    /** Millisekunden seit dem letzten Wurf dieses Spielers, solange die Animation läuft. */
    function rollElapsed(player) {
        const now = performance.now();
        const seen = rollSeen.get(player.id);
        if (!seen || seen.rollNo !== player.rollNo) {
            rollSeen.set(player.id, { rollNo: player.rollNo, at: initial || player.rollNo === 0 ? -Infinity : now });
        }
        const elapsed = now - rollSeen.get(player.id).at;
        return elapsed < ROLL_ANIMATION_MS ? elapsed : null;
    }

    function animate(dieEls, player) {
        const elapsed = rollElapsed(player);
        let k = 0;
        dieEls.forEach((die, i) => {
            die.classList.remove("wp-rolling");
            if (elapsed === null || !player.turn.dice[i] || (player.turn.held[i] && player.turn.rolls > 1)) return;
            void die.offsetWidth; // Animation neu starten
            die.classList.add("wp-rolling");
            die.style.animationDelay = `${k * STAGGER_MS - elapsed}ms`;
            k++;
        });
    }

    // --- Oberer Bereich --------------------------------------------------------
    function renderTop() {
        const host = isHost();
        const key = JSON.stringify([state.phase, state.matchNumber, host, state.phase === "setup" ? [state.settings, state.members.length] : null, state.result, Boolean(me())]);
        if (key !== topKey) {
            topKey = key;
            tableEls = null;
            top.replaceChildren();
            if (state.phase === "setup") renderSetup(host);
            else if (state.phase === "finished") renderResult(host);
            else if (me()) buildTable();
            else top.append(createElement("p", "wp-muted wp-spectator", "Du schaust zu – bei der nächsten Partie bist du dabei."));
        }
        if (tableEls) renderTable();
    }

    function buildTable() {
        const felt = createElement("div", "wp-felt");
        const status = createElement("div", "wp-status");
        const dice = createElement("div", "wp-dice");
        const dieEls = [0, 1, 2, 3, 4].map(i => {
            const die = createDie(0, "wp-die wp-clickable");
            die.tabIndex = 0;
            die.setAttribute("role", "button");
            die.dataset.index = String(i);
            die.addEventListener("click", () => toggleHold(i));
            dice.append(die);
            return die;
        });
        const controls = createElement("div", "wp-controls");
        const rollBtn = button("wp-roll", "Würfeln", roll);
        const timerSlot = createElement("div", "wp-timer-slot");
        controls.append(rollBtn, timerSlot);
        const hint = createElement("p", "wp-hint", "");
        felt.append(status, dice, controls, hint);
        top.append(felt);
        tableEls = { status, dieEls, rollBtn, timerSlot, hint, timerKey: "" };
    }

    function renderTable() {
        const self = me();
        if (!self || !tableEls) return;
        const { status, dieEls, rollBtn, timerSlot, hint } = tableEls;
        const filled = state.catalog.categories.filter(c => self.sheet[c.id] !== null).length;
        const max = state.catalog.maxRolls;
        if (pendingHold === 0) held = [...self.turn.held];
        if (self.done) {
            const waiting = state.players.filter(p => !p.left && !p.done).length;
            status.textContent = `Fertig: ${self.totals.total} Punkte – warte auf die anderen (${waiting} ${waiting === 1 ? "spielt" : "spielen"} noch).`;
        } else {
            status.textContent = `Feld ${filled + 1}/13 · Wurf ${self.turn.rolls}/${max} · ${self.totals.total} Punkte`;
        }
        dieEls.forEach((die, i) => {
            const value = self.turn.dice[i];
            if (Number(die.dataset.value ?? -1) !== value) {
                paintDie(die, value);
                die.dataset.value = String(value);
            }
            die.classList.toggle("wp-held", Boolean(held[i]) && self.turn.rolls > 0);
            die.setAttribute("aria-pressed", String(Boolean(held[i])));
        });
        animate(dieEls, self);
        const rollsLeft = max - self.turn.rolls;
        rollBtn.textContent = self.turn.rolls === 0 ? "Würfeln" : rollsLeft > 0 ? `Würfeln (noch ${rollsLeft})` : "Feld eintragen ↓";
        rollBtn.disabled = self.done || rollsLeft === 0 || (self.turn.rolls > 0 && held.every(Boolean));
        hint.textContent = self.done ? "" : self.turn.rolls === 0 ? "Leertaste oder R würfelt." :
            rollsLeft > 0 ? "Würfel antippen (oder 1–5) zum Halten – oder unten ein Feld eintragen." : "Keine Würfe mehr – trag unten ein Feld ein.";
        const timerKey = `${state.matchNumber}|${filled}|${self.done}`;
        if (timerKey !== tableEls.timerKey) {
            tableEls.timerKey = timerKey;
            timerSlot.replaceChildren();
            if (!self.done && self.turnRemainingMs !== null) timerSlot.append(createTimer(self.turnRemainingMs, state.catalog.turnMs));
        }
    }

    function renderSetup(host) {
        const box = createElement("div", "wp-card");
        box.append(createElement("h3", null, "Fünf-Würfel-Poker"));
        box.append(createElement("p", null, "Fünf Würfel, bis zu drei Würfe pro Zug: Würfel antippen hält sie fest, dann ein Feld auf dem Zettel eintragen. Nach 13 Zügen ist der Zettel voll – die meisten Punkte gewinnen."));
        box.append(createElement("p", "wp-muted", `Alle würfeln gleichzeitig. Oben gibt es +${state.catalog.upperBonus} Bonus ab ${state.catalog.upperBonusAt} Punkten, jeder weitere Fünferpasch bringt +${state.catalog.extraFiver}. Pro Feld hast du ${state.catalog.turnMs / 1000} s.`));
        const maxBots = Math.max(0, Math.min(state.settings.maxBots, state.catalog.maxParticipants - state.members.length));
        if (host) {
            const row = createElement("div", "wp-setup");
            row.append(
                createChoice("Bots", "wp-bots", Array.from({ length: maxBots + 1 }, (_, n) => [String(n), String(n)]), String(Math.min(state.settings.bots, maxBots)), value => send({ type: "settings", bots: Number(value) })),
                createChoice("Bot-Stärke", "wp-bot-level", Object.entries(state.catalog.levels), state.settings.botLevel, value => send({ type: "settings", botLevel: value }))
            );
            box.append(row, button("wp-start", "Spiel starten", () => send({ type: "start" })));
        } else {
            const count = Math.min(state.settings.bots, maxBots);
            box.append(createElement("p", "wp-muted", `Bots: ${count}${count ? ` (${state.catalog.levels[state.settings.botLevel].toLowerCase()})` : ""} – der Host startet.`));
        }
        top.append(box);
    }

    function renderResult(host) {
        const result = state.result;
        const box = createElement("div", "wp-card wp-result");
        const winner = state.players.find(p => p.id === result.winnerId);
        box.append(createElement("h3", null, result.outcome === "aborted" ? "Spiel beendet" : `🎲 ${winner?.name ?? "?"} gewinnt!`));
        const table = createElement("table", "wp-placements");
        const head = createElement("tr");
        for (const title of ["", "Name", "Oben", "Bonus", "Unten", "Extra", "Gesamt"]) head.append(createElement("th", null, title));
        table.append(head);
        result.placements.forEach((id, index) => {
            const p = state.players.find(x => x.id === id);
            const row = createElement("tr", p.id === ctx.me.id ? "is-me" : "");
            const nameCell = createElement("td");
            const swatch = createElement("span", "wp-swatch");
            swatch.style.background = p.color;
            nameCell.append(swatch, document.createTextNode(` ${p.name}`));
            row.append(createElement("td", null, `${index + 1}.`), nameCell);
            for (const value of [p.totals.upper, p.totals.bonus, p.totals.lower, p.totals.extra]) row.append(createElement("td", "wp-num", String(value)));
            row.append(createElement("td", "wp-num wp-total", String(p.totals.total)));
            table.append(row);
        });
        box.append(table);
        if (host) box.append(button("wp-new-match", "Neue Partie", () => send({ type: "new-match" })));
        else box.append(createElement("p", "wp-muted", "Der Host kann eine neue Partie starten."));
        top.append(box);
    }

    function createChoice(labelText, className, options, current, onChange) {
        const label = createElement("label", null, `${labelText} `);
        const select = createElement("select", className);
        for (const [value, text] of options) {
            const option = createElement("option", null, text);
            option.value = value;
            option.selected = value === current;
            select.append(option);
        }
        select.addEventListener("change", () => onChange(select.value));
        label.append(select);
        return label;
    }

    // --- Punktzettel ------------------------------------------------------------
    function columns() {
        const list = state.players.filter(p => !p.left);
        const mine = list.find(p => p.id === ctx.me.id);
        return mine ? [mine, ...list.filter(p => p !== mine)] : list;
    }

    function buildSheet() {
        cells = new Map();
        headDice = new Map();
        headInfo = new Map();
        potentialButtons = new Map();
        const cols = columns();
        const table = createElement("table", "wp-sheet");
        const head = createElement("tr");
        head.append(createElement("th", "wp-label", ""));
        for (const p of cols) {
            const th = createElement("th", `wp-col${p.id === ctx.me.id ? " is-me" : ""}`);
            th.dataset.player = p.id;
            th.style.setProperty("--wp-color", p.color);
            const name = createElement("div", "wp-col-name", p.id === ctx.me.id ? `${p.name} (du)` : p.name);
            const dice = createElement("div", "wp-mini-dice");
            const dieEls = [0, 1, 2, 3, 4].map(() => {
                const die = createDie(0, "wp-die wp-mini");
                dice.append(die);
                return die;
            });
            const info = createElement("div", "wp-col-info");
            th.append(name, dice, info);
            head.append(th);
            headDice.set(p.id, dieEls);
            headInfo.set(p.id, info);
        }
        table.append(head);
        const addRow = (label, key, className = "") => {
            const tr = createElement("tr", className);
            tr.append(createElement("th", "wp-label", label));
            for (const p of cols) {
                const td = createElement("td", `wp-cell${p.id === ctx.me.id ? " is-me" : ""}`);
                tr.append(td);
                cells.set(`${key}|${p.id}`, td);
            }
            table.append(tr);
        };
        const upper = state.catalog.categories.filter(c => c.upper);
        const lower = state.catalog.categories.filter(c => !c.upper);
        for (const c of upper) addRow(c.label, c.id);
        addRow("Summe oben", "sumUpper", "wp-sum");
        addRow(`Bonus (ab ${state.catalog.upperBonusAt})`, "bonus", "wp-sum");
        for (const c of lower) addRow(c.label, c.id);
        addRow("Extra-Fünferpasch", "extra", "wp-sum");
        addRow("Gesamt", "total", "wp-sum wp-total-row");
        sheetWrap.replaceChildren(table);

        const mine = me();
        if (mine) {
            for (const c of state.catalog.categories) {
                const b = button("wp-potential", "", () => scoreField(c.id));
                b.dataset.category = c.id;
                potentialButtons.set(c.id, b);
            }
        }
    }

    function updateSheet() {
        if (!state || state.phase === "setup") return;
        const self = me();
        for (const p of columns()) {
            const set = (key, text) => {
                const td = cells.get(`${key}|${p.id}`);
                if (td && td.textContent !== text) td.textContent = text;
            };
            for (const c of state.catalog.categories) {
                const td = cells.get(`${c.id}|${p.id}`);
                if (!td) continue;
                const value = p.sheet[c.id];
                const potential = p.id === ctx.me.id && value === null && state.phase === "playing" && self && !self.done && self.turn.rolls > 0
                    ? state.potentials?.[c.id] : undefined;
                if (potential !== undefined) {
                    const b = potentialButtons.get(c.id);
                    const confirming = confirm?.category === c.id;
                    b.textContent = confirming ? "0 eintragen?" : String(potential);
                    b.classList.toggle("is-zero", potential === 0);
                    b.classList.toggle("is-confirm", confirming);
                    if (b.parentElement !== td) td.replaceChildren(b);
                } else {
                    const text = value === null ? "" : String(value);
                    if (td.firstChild?.tagName === "BUTTON" || td.textContent !== text) td.textContent = text;
                }
                td.classList.toggle("is-zero-filled", value === 0);
            }
            set("sumUpper", String(p.totals.upper));
            set("bonus", p.totals.bonus ? `+${p.totals.bonus}` : `${Math.max(0, state.catalog.upperBonusAt - p.totals.upper)} fehlen`);
            set("extra", p.totals.extra ? `+${p.totals.extra}` : "");
            set("total", String(p.totals.total));
            const filled = state.catalog.categories.filter(c => p.sheet[c.id] !== null).length;
            const info = headInfo.get(p.id);
            const text = p.done ? "✓ fertig" : `Feld ${filled + 1}/13 · Wurf ${p.turn.rolls}`;
            if (info && info.textContent !== text) info.textContent = text;
            const dieEls = headDice.get(p.id);
            if (dieEls) {
                dieEls.forEach((die, i) => {
                    const value = p.turn.dice[i];
                    if (Number(die.dataset.value ?? -1) !== value) {
                        paintDie(die, value);
                        die.dataset.value = String(value);
                    }
                    die.classList.toggle("wp-held", Boolean(p.turn.held[i]) && p.turn.rolls > 0);
                });
                if (p.id !== ctx.me.id) animate(dieEls, p);
            }
        }
    }

    function renderSheet() {
        if (state.phase === "setup") {
            sheetKey = "";
            sheetWrap.replaceChildren();
            return;
        }
        const key = JSON.stringify([state.matchNumber, columns().map(p => p.id), Boolean(me())]);
        if (key !== sheetKey) {
            sheetKey = key;
            buildSheet();
        }
        updateSheet();
    }

    function renderLog() {
        log.replaceChildren(...[...state.log].reverse().map(text => createElement("li", null, text)));
        log.hidden = state.log.length === 0;
    }

    /** Mögliche Punkte für die eigenen Würfel (Regeln wie scoring.js). */
    function computePotentials() {
        const self = me();
        if (!self || self.turn.rolls === 0) return null;
        const dice = self.turn.dice;
        const c = [0, 0, 0, 0, 0, 0, 0];
        for (const d of dice) c[d] += 1;
        const sum = dice.reduce((a, b) => a + b, 0);
        const max = Math.max(...c);
        const run = length => {
            let n = 0;
            for (let v = 1; v <= 6; v++) {
                n = c[v] ? n + 1 : 0;
                if (n >= length) return true;
            }
            return false;
        };
        const all = {
            ones: c[1], twos: c[2] * 2, threes: c[3] * 3, fours: c[4] * 4, fives: c[5] * 5, sixes: c[6] * 6,
            three: max >= 3 ? sum : 0, four: max >= 4 ? sum : 0, fullHouse: c.includes(3) && c.includes(2) ? 25 : 0,
            smallStraight: run(4) ? 30 : 0, largeStraight: run(5) ? 40 : 0, fiver: max === 5 ? 50 : 0, chance: sum
        };
        return Object.fromEntries(Object.entries(all).filter(([id]) => self.sheet[id] === null));
    }

    return {
        update(newState) {
            state = newState;
            if (!state) return;
            root.dataset.phase = state.phase;
            state.potentials = computePotentials();
            renderTop();
            renderSheet();
            renderLog();
            initial = false;
        },
        destroy() {
            document.removeEventListener("keydown", onKey);
            frame.remove();
        }
    };
}
