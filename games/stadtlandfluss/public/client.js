/**
 * Stadt-Land-Fluss – Client-Teil.
 *
 * Setup (Host wählt Kategorien, Runden, Zeit) → Countdown mit rollendem
 * Buchstaben → Schreiben (ein Feld je Kategorie, „Stopp!“ bei vollen Feldern)
 * → Nachfrist → Auswertung (alle Antworten offen, 👎 zum Anzweifeln, „Fertig“)
 * → nächste Runde … → Ergebnis.
 *
 * Die Eingabefelder werden pro Runde einmal aufgebaut und danach nur
 * aktualisiert, damit Fokus und Tipp-Stand nie verloren gehen. Antworten gehen
 * entprellt (ANSWER_DEBOUNCE_MS) und beim Verlassen eines Feldes an den Server –
 * so überstehen sie auch einen Reload.
 *
 * Aktionen:  settings {categories, rounds, roundSeconds}, start,
 *            answer {category, text}, stop, doubt {playerId, category},
 *            ready, end-review, new-match
 */

export const stylesheets = ["style.css"];

const ANSWER_DEBOUNCE_MS = 400;
const SPIN_MS = 70;
const SPIN_LETTERS = "ABDEFGHIJKLMNOPRSTUVWZ";
const REASONS = { empty: "leer", letter: "falscher Buchstabe" };

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

/** Anfangsbuchstabe wie auf dem Server (Ä/Ö/Ü → A/O/U, Akzente weg). */
function initialOf(text) {
    const first = String(text ?? "").trim().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-zäöüß]/i);
    if (!first) return "";
    const ch = first[0].toUpperCase();
    return ch === "ß" ? "S" : ch;
}

/** Laufender Zeitbalken (CSS-Animation, startet mit der Restzeit). */
function createTimer(remainingMs, totalMs) {
    const bar = createElement("div", "slf-timer");
    const fill = createElement("div", "slf-timer-fill");
    fill.style.animationDuration = `${totalMs}ms`;
    fill.style.animationDelay = `${-(totalMs - remainingMs)}ms`;
    bar.append(fill);
    return bar;
}

export function mount(container, ctx) {
    const frame = createElement("div", "slf-root");
    const root = createElement("div", "slf");
    const main = createElement("div", "slf-main");
    const board = createElement("aside", "slf-board");
    const log = createElement("ul", "slf-log");
    root.append(main, board, log);
    frame.append(root);
    container.append(frame);

    let state = null;
    let mainKey = "";
    let reviewKey = "";
    let writeEls = null;            // Elemente der Schreibphase (bleiben die Runde über bestehen)
    let spinTimer = null;
    const pending = new Map();      // Kategorie-Index → Timeout fürs Senden

    const isHost = () => ctx.getLobby()?.hostId === ctx.me.id;
    const round = () => state?.round ?? null;
    const playerById = id => state.players.find(p => p.id === id);
    const isParticipant = () => Boolean(round()?.participants.includes(ctx.me.id) && !playerById(ctx.me.id)?.left);
    const canWrite = () => (state.phase === "writing" || state.phase === "grace") && isParticipant();

    // --- Senden ------------------------------------------------------------------
    function sendAnswer(index) {
        clearTimeout(pending.get(index));
        pending.delete(index);
        if (!writeEls || !canWrite()) return Promise.resolve();
        const text = writeEls.inputs[index].value;
        if ((round().mine?.[index] ?? "") === text) return Promise.resolve();
        return ctx.sendAction({ type: "answer", category: index, text });
    }

    function scheduleAnswer(index) {
        clearTimeout(pending.get(index));
        pending.set(index, setTimeout(() => sendAnswer(index), ANSWER_DEBOUNCE_MS));
    }

    async function flushAnswers() {
        await Promise.all([...pending.keys()].map(sendAnswer));
    }

    async function stop() {
        await flushAnswers();
        ctx.sendAction({ type: "stop" });
    }

    // --- Hauptbereich ------------------------------------------------------------
    function renderMain() {
        const r = round();
        const writingPhase = ["countdown", "writing", "grace"].includes(state.phase);
        const key = JSON.stringify([
            state.phase === "setup" ? ["setup", state.settings, isHost(), state.members.length] : null,
            writingPhase ? ["write", state.matchNumber, r.number, isParticipant()] : null,
            state.phase === "review" ? ["review", state.matchNumber, r.number] : null,
            state.phase === "finished" ? ["finished", state.matchNumber, isHost()] : null
        ]);
        if (key !== mainKey) {
            mainKey = key;
            reviewKey = "";
            writeEls = null;
            main.replaceChildren();
            if (state.phase === "setup") renderSetup();
            else if (writingPhase) buildWriting();
            else if (state.phase === "review") main.append(createElement("div", "slf-review"));
            else renderResult();
        }
        if (writeEls) updateWriting();
        if (state.phase === "review") renderReview();
    }

    // --- Setup -------------------------------------------------------------------
    function renderSetup() {
        const box = createElement("div", "slf-card slf-setup");
        box.append(createElement("h3", null, "Stadt-Land-Fluss"));
        box.append(createElement("p", null, "Ein Buchstabe wird gezogen – zu jeder Kategorie ein passendes Wort finden. Wer alles ausgefüllt hat, ruft Stopp; dann bleiben allen noch 3 Sekunden."));
        box.append(createElement("p", "slf-muted", `Danach liegen alle Antworten offen: Zweifelhafte Antworten per 👎 anzweifeln – zweifelt mehr als die Hälfte der anderen, zählt sie nicht. Punkte: ${state.catalog.points.alone} als einzige gültige Antwort, ${state.catalog.points.unique} einmalig, ${state.catalog.points.shared} doppelt.`));
        const chosen = state.settings.categories;
        if (isHost()) {
            const { minCategories, maxCategories, categoryLength } = state.catalog.limits;
            const send = categories => ctx.sendAction({ type: "settings", categories });
            box.append(createElement("h4", null, `Kategorien (${chosen.length}, ${minCategories}–${maxCategories})`));
            const chips = createElement("div", "slf-chips");
            const custom = chosen.filter(c => !state.catalog.presets.includes(c));
            for (const name of [...state.catalog.presets, ...custom]) {
                const on = chosen.includes(name);
                const chip = button(`slf-chip${on ? " is-on" : ""}${custom.includes(name) ? " is-custom" : ""}`, on && custom.includes(name) ? `${name} ✕` : name,
                    () => send(on ? chosen.filter(c => c !== name) : [...chosen, name]));
                chip.dataset.category = name;
                chip.setAttribute("aria-pressed", String(on));
                chips.append(chip);
            }
            box.append(chips);
            const form = createElement("form", "slf-add");
            const input = createElement("input", "slf-add-input");
            input.maxLength = categoryLength;
            input.placeholder = "Eigene Kategorie …";
            form.append(input, Object.assign(createElement("button", "slf-add-button", "Hinzufügen"), { type: "submit" }));
            form.addEventListener("submit", event => {
                event.preventDefault();
                const name = input.value.trim();
                if (name) send([...chosen, name]);
            });
            box.append(form);
            const row = createElement("div", "slf-options");
            row.append(
                createChoice("Runden", "slf-rounds", state.catalog.roundOptions.map(n => [String(n), String(n)]), String(state.settings.rounds),
                    value => ctx.sendAction({ type: "settings", rounds: Number(value) })),
                createChoice("Zeit pro Runde", "slf-seconds", state.catalog.secondsOptions.map(n => [String(n), `${n} s`]), String(state.settings.roundSeconds),
                    value => ctx.sendAction({ type: "settings", roundSeconds: Number(value) }))
            );
            box.append(row);
            const start = button("slf-start", "Spiel starten", () => ctx.sendAction({ type: "start" }));
            start.disabled = state.members.length < state.catalog.limits.minPlayers;
            box.append(start);
            if (start.disabled) box.append(createElement("p", "slf-muted", `Es braucht mindestens ${state.catalog.limits.minPlayers} Spieler.`));
        } else {
            box.append(createElement("p", "slf-summary", `Kategorien: ${chosen.join(", ")}`));
            box.append(createElement("p", "slf-muted", `${state.settings.rounds} Runden à ${state.settings.roundSeconds} s – der Host startet.`));
        }
        main.append(box);
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

    // --- Schreiben ---------------------------------------------------------------
    function buildWriting() {
        const card = createElement("div", "slf-card slf-write");
        const head = createElement("div", "slf-head");
        const letter = createElement("div", "slf-letter", "?");
        const info = createElement("div", "slf-info");
        const roundText = createElement("div", "slf-round");
        const status = createElement("div", "slf-status");
        const timerSlot = createElement("div", "slf-timer-slot");
        info.append(roundText, status, timerSlot);
        head.append(letter, info);
        const fields = createElement("div", "slf-fields");
        const inputs = [];
        const checks = [];
        state.settings.categories.forEach((name, index) => {
            const label = createElement("label", "slf-field");
            const title = createElement("span", "slf-field-name", name);
            const input = createElement("input", "slf-input");
            input.dataset.category = String(index);
            input.maxLength = state.catalog.limits.answerLength;
            input.autocomplete = "off";
            input.spellcheck = false;
            input.value = round().mine?.[index] ?? "";
            const check = createElement("span", "slf-check");
            input.addEventListener("input", () => {
                scheduleAnswer(index);
                updateWriting();
            });
            input.addEventListener("blur", () => sendAnswer(index));
            input.addEventListener("keydown", event => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                const nextInput = inputs[index + 1];
                if (nextInput) nextInput.focus();
                else input.blur();
            });
            label.append(title, input, check);
            fields.append(label);
            inputs.push(input);
            checks.push(check);
        });
        const stopBtn = button("slf-stop", "Stopp!", stop);
        const hint = createElement("p", "slf-hint");
        card.append(head, fields, stopBtn, hint);
        main.append(card);
        writeEls = { letter, roundText, status, timerSlot, inputs, checks, stopBtn, hint, timerKey: "" };
    }

    function updateWriting() {
        const r = round();
        const { letter, roundText, status, timerSlot, inputs, checks, stopBtn, hint } = writeEls;
        const participant = isParticipant();
        roundText.textContent = `Runde ${r.number}/${state.settings.rounds}`;
        // Buchstabe: im Countdown rollt er, danach steht er fest
        if (state.phase === "countdown") {
            if (!spinTimer) {
                letter.classList.add("is-spinning");
                spinTimer = setInterval(() => {
                    letter.textContent = SPIN_LETTERS[Math.floor(Math.random() * SPIN_LETTERS.length)];
                }, SPIN_MS);
            }
        } else {
            stopSpin();
            letter.textContent = r.letter;
        }
        const stopper = r.stoppedBy ? playerById(r.stoppedBy) : null;
        if (state.phase === "countdown") status.textContent = "Gleich geht's los …";
        else if (state.phase === "grace") status.textContent = `${stopper?.id === ctx.me.id ? "Du hast" : `${stopper?.name ?? "Jemand"} hat`} Stopp gerufen – schnell noch fertig schreiben!`;
        else status.textContent = participant ? `Alles mit „${r.letter}“!` : "Du spielst ab der nächsten Runde mit.";
        letter.classList.toggle("is-stopped", state.phase === "grace");

        const writable = canWrite();
        inputs.forEach((input, index) => {
            input.disabled = !writable;
            const server = r.mine?.[index] ?? "";
            // Server-Stand nur übernehmen, wenn hier nicht gerade getippt wird (z. B. nach Reload)
            if (document.activeElement !== input && !pending.has(index) && input.value !== server && (input.value === "" || !writable)) input.value = server;
            input.placeholder = r.letter ? `${state.settings.categories[index]} mit ${r.letter} …` : "";
            const text = input.value.trim();
            const ok = Boolean(text) && r.letter && initialOf(text) === r.letter;
            checks[index].textContent = !text ? "" : ok ? "✓" : "✗";
            checks[index].classList.toggle("is-bad", Boolean(text) && !ok);
        });
        const complete = inputs.every(i => i.value.trim() !== "");
        stopBtn.hidden = !participant;
        stopBtn.disabled = state.phase !== "writing" || !complete;
        hint.textContent = !participant ? "" : state.phase !== "writing" ? "" :
            complete ? "Alles ausgefüllt – ruf Stopp, bevor die anderen fertig sind!" : "Enter springt ins nächste Feld. Stopp geht, sobald alle Felder ausgefüllt sind.";

        const total = state.phase === "grace" ? state.catalog.graceMs : state.phase === "countdown" ? state.catalog.countdownMs : state.settings.roundSeconds * 1000;
        const timerKey = `${state.phase}|${r.number}`;
        if (timerKey !== writeEls.timerKey) {
            writeEls.timerKey = timerKey;
            timerSlot.replaceChildren();
            if (r.remainingMs !== null && state.phase !== "countdown") timerSlot.append(createTimer(r.remainingMs, total));
            timerSlot.classList.toggle("is-grace", state.phase === "grace");
        }
    }

    function stopSpin() {
        if (!spinTimer) return;
        clearInterval(spinTimer);
        spinTimer = null;
        writeEls?.letter.classList.remove("is-spinning");
    }

    // --- Auswertung ----------------------------------------------------------------
    function renderReview() {
        const r = round();
        const ev = r.evaluation;
        const box = main.querySelector(".slf-review");
        if (!ev || !box) return;
        const key = JSON.stringify([r.doubts, r.ready, ev.totals, isHost(), r.participants]);
        if (key === reviewKey) return;
        reviewKey = key;
        const participant = isParticipant();
        const head = createElement("div", "slf-review-head");
        head.append(createElement("div", "slf-letter is-small", r.letter), createElement("h3", null, `Auswertung Runde ${r.number}/${state.settings.rounds}`));
        const cards = createElement("div", "slf-cats");
        ev.categories.forEach((category, index) => {
            const card = createElement("div", "slf-cat");
            card.append(createElement("h4", null, state.settings.categories[index]));
            const list = createElement("ul", "slf-answers");
            for (const e of category.entries) {
                const p = playerById(e.id);
                const li = createElement("li", `slf-answer${e.valid ? "" : " is-invalid"}${e.id === ctx.me.id ? " is-me" : ""}`);
                li.dataset.player = e.id;
                li.dataset.category = String(index);
                const name = createElement("span", "slf-answer-name", p?.name ?? "?");
                name.style.setProperty("--slf-color", p?.color ?? "#888");
                const text = createElement("span", "slf-answer-text", e.text.trim() || "—");
                const tags = createElement("span", "slf-tags");
                if (e.auto) tags.append(createElement("span", "slf-tag is-bad", REASONS[e.auto]));
                else if (e.rejected) tags.append(createElement("span", "slf-tag is-bad", "abgelehnt"));
                if (e.duplicate) tags.append(createElement("span", "slf-tag", "doppelt"));
                const points = createElement("span", "slf-points", String(e.points));
                li.append(name, text, tags);
                if (!e.auto && e.id !== ctx.me.id && participant) {
                    const mine = e.doubts.includes(ctx.me.id);
                    const doubt = button(`slf-doubt${mine ? " is-on" : ""}`, `👎${e.doubts.length ? ` ${e.doubts.length}` : ""}`,
                        () => ctx.sendAction({ type: "doubt", playerId: e.id, category: index }));
                    doubt.title = mine ? "Zweifel zurücknehmen" : "Antwort anzweifeln";
                    doubt.setAttribute("aria-pressed", String(mine));
                    li.append(doubt);
                } else {
                    li.append(createElement("span", "slf-doubt-count", e.doubts.length ? `👎 ${e.doubts.length}` : ""));
                }
                li.append(points);
                list.append(li);
            }
            card.append(list);
            cards.append(card);
        });
        const footer = createElement("div", "slf-review-foot");
        const active = r.participants.filter(id => !playerById(id)?.left);
        const readyCount = active.filter(id => r.ready.includes(id)).length;
        if (participant) {
            const isReady = r.ready.includes(ctx.me.id);
            footer.append(button(`slf-ready${isReady ? " is-on" : ""}`, isReady ? "✓ Fertig (zurücknehmen)" : "Fertig", () => ctx.sendAction({ type: "ready" })));
        }
        footer.append(createElement("span", "slf-muted", `${readyCount}/${active.length} fertig`));
        if (isHost()) footer.append(button("slf-end-review", "Auswertung beenden", () => ctx.sendAction({ type: "end-review" })));
        const timer = r.remainingMs !== null ? createTimer(r.remainingMs, state.catalog.reviewMs) : createElement("div");
        box.replaceChildren(head, createElement("p", "slf-muted slf-review-hint", "Zweifelhafte Antworten mit 👎 anzweifeln – zweifelt mehr als die Hälfte der anderen, zählt sie nicht. Wer anzweifelt, setzt alle „Fertig“ zurück."), cards, footer, timer);
    }

    // --- Ergebnis --------------------------------------------------------------------
    function renderResult() {
        const result = state.result;
        const box = createElement("div", "slf-card slf-result");
        const winner = result && playerById(result.winnerId);
        box.append(createElement("h3", null, result?.outcome === "aborted" ? "Spiel beendet" : `🏆 ${winner?.name ?? "?"} gewinnt!`));
        const table = createElement("table", "slf-placements");
        const head = createElement("tr");
        for (const title of ["", "Name", "Punkte", "Beste Runde"]) head.append(createElement("th", null, title));
        table.append(head);
        (result?.placements ?? []).forEach((id, index) => {
            const p = playerById(id);
            const best = [...p.roundScores].sort((a, b) => b.points - a.points)[0];
            const row = createElement("tr", p.id === ctx.me.id ? "is-me" : "");
            const nameCell = createElement("td");
            const swatch = createElement("span", "slf-swatch");
            swatch.style.background = p.color;
            nameCell.append(swatch, document.createTextNode(` ${p.name}`));
            row.append(createElement("td", null, `${index + 1}.`), nameCell, createElement("td", "slf-num slf-total", String(p.score)),
                createElement("td", "slf-num", best ? `${best.points} (${best.letter})` : "–"));
            table.append(row);
        });
        box.append(table);
        if (isHost()) box.append(button("slf-new-match", "Neue Partie", () => ctx.sendAction({ type: "new-match" })));
        else box.append(createElement("p", "slf-muted", "Der Host kann eine neue Partie starten."));
        main.append(box);
    }

    // --- Punktestand -------------------------------------------------------------------
    function renderBoard() {
        if (state.phase === "setup" || state.phase === "finished") {
            board.hidden = true;
            return;
        }
        board.hidden = false;
        const r = round();
        const gained = state.phase === "review" ? r.evaluation?.totals ?? {} : {};
        const rows = state.players.filter(p => !p.left).sort((a, b) => b.score - a.score);
        const list = createElement("ol", "slf-scores");
        for (const p of rows) {
            const li = createElement("li", p.id === ctx.me.id ? "is-me" : "");
            li.dataset.player = p.id;
            const name = createElement("span", "slf-score-name", p.name);
            name.style.setProperty("--slf-color", p.color);
            const right = createElement("span", "slf-score-right");
            if (["writing", "grace", "countdown"].includes(state.phase)) {
                if (r.participants.includes(p.id)) {
                    const filled = r.progress[p.id] ?? 0;
                    const dots = createElement("span", "slf-progress", "●".repeat(filled) + "○".repeat(state.settings.categories.length - filled));
                    dots.title = `${filled}/${state.settings.categories.length} ausgefüllt`;
                    right.append(dots);
                } else {
                    right.append(createElement("span", "slf-muted", "ab nächster Runde"));
                }
            }
            if (gained[p.id] !== undefined) right.append(createElement("span", "slf-gain", `+${gained[p.id]}`));
            if (state.phase === "review" && r.ready.includes(p.id)) right.append(createElement("span", "slf-ready-mark", "✓"));
            right.append(createElement("span", "slf-score", String(p.score)));
            li.append(name, right);
            list.append(li);
        }
        board.replaceChildren(createElement("h4", null, "Punkte"), list);
    }

    function renderLog() {
        log.replaceChildren(...[...state.log].reverse().map(text => createElement("li", null, text)));
        log.hidden = state.log.length === 0;
    }

    return {
        update(newState) {
            state = newState;
            if (!state) return;
            root.dataset.phase = state.phase;
            if (state.phase !== "countdown") stopSpin();
            renderMain();
            renderBoard();
            renderLog();
        },
        destroy() {
            stopSpin();
            for (const t of pending.values()) clearTimeout(t);
            frame.remove();
        }
    };
}
