/**
 * Skizzen-Raten – Client-Teil.
 *
 * Links die Zeichenfläche (Canvas 800 × 500 logische Einheiten, bleibt auch im
 * Dark-Mode weiß) mit Kopfzeile (Zeichner, Hinweis/Begriff, Zeit) und – für den
 * Zeichner – Werkzeugleiste. Rechts Punktestand, Rate-Liste und Ratefeld.
 * Wort-Wahl, Auflösung, Setup und Ergebnis erscheinen als Karten.
 *
 * Zeichnen: Pointer-Events (Maus, Stift, Touch). Punkte erscheinen sofort
 * lokal und gehen gesammelt alle SEND_MS als „stroke“ an den Server – über eine
 * Warteschlange, damit die Reihenfolge stimmt. Sobald der Server-Stand einen
 * Strich vollständig enthält, fällt die lokale Vorschau weg.
 *
 * Aktionen:  settings {...}, start, choose {index}, stroke {id, color, size, points},
 *            undo, clear, guess {text}, skip, new-match
 */

export const stylesheets = ["style.css"];

const SEND_MS = 120;
const MIN_STEP = 2;           // Mindestabstand zwischen zwei Punkten (logische Einheiten)
const CONFIRM_MS = 3000;
const ENDINGS = { all: "Alle haben es erraten!", time: "Die Zeit ist um.", skipped: "Übersprungen.", left: "Der Zeichner ist gegangen." };

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

/** Laufender Zeitbalken (CSS-Animation, startet mit der Restzeit). */
function createTimer(remainingMs, totalMs) {
    const bar = createElement("div", "sr-timer");
    const fill = createElement("div", "sr-timer-fill");
    fill.style.animationDuration = `${totalMs}ms`;
    fill.style.animationDelay = `${-(totalMs - remainingMs)}ms`;
    bar.append(fill);
    return bar;
}

const isTyping = () => {
    const el = document.activeElement;
    return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable));
};

/** Einen Strich auf das Canvas malen. */
function paintStroke(g, stroke, colors) {
    const p = stroke.p;
    if (p.length < 2) return;
    g.strokeStyle = colors[stroke.c] ?? "#000";
    g.fillStyle = g.strokeStyle;
    g.lineWidth = stroke.s;
    if (p.length === 2) {
        g.beginPath();
        g.arc(p[0], p[1], stroke.s / 2, 0, Math.PI * 2);
        g.fill();
        return;
    }
    g.beginPath();
    g.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
    g.stroke();
}

export function mount(container, ctx) {
    const frame = createElement("div", "sr-root");
    const root = createElement("div", "sr");
    const stage = createElement("div", "sr-stage");
    const side = createElement("aside", "sr-side");
    const log = createElement("ul", "sr-log");
    root.append(stage, side, log);
    frame.append(root);
    container.append(frame);

    // --- Bühne (bleibt die ganze Partie bestehen) ---------------------------------
    const head = createElement("div", "sr-head");
    const headWho = createElement("div", "sr-who");
    const headWord = createElement("div", "sr-word");
    const headInfo = createElement("div", "sr-turn-info");
    const timerSlot = createElement("div", "sr-timer-slot");
    head.append(headWho, headWord, headInfo, timerSlot);
    const board = createElement("div", "sr-board");
    const canvas = createElement("canvas", "sr-canvas");
    canvas.width = 800;
    canvas.height = 500;
    const overlay = createElement("div", "sr-overlay");
    board.append(canvas, overlay);
    const tools = createElement("div", "sr-tools");
    const card = createElement("div", "sr-card-slot");
    stage.append(card, head, board, tools);
    const g = canvas.getContext("2d");
    g.lineCap = "round";
    g.lineJoin = "round";

    // --- Seitenleiste -------------------------------------------------------------
    const scores = createElement("div", "sr-scores");
    const guessBox = createElement("div", "sr-guesses");
    const guessList = createElement("ul", "sr-guess-list");
    const guessForm = createElement("form", "sr-guess-form");
    const guessInput = createElement("input", "sr-guess-input");
    guessInput.maxLength = 40;
    guessInput.autocomplete = "off";
    guessInput.spellcheck = false;
    guessInput.placeholder = "Dein Tipp …";
    const guessButton = Object.assign(createElement("button", "sr-guess-button", "Raten"), { type: "submit" });
    guessForm.append(guessInput, guessButton);
    guessBox.append(createElement("h4", null, "Tipps"), guessList, guessForm);
    side.append(scores, guessBox);

    let state = null;
    let cardKey = "";
    let overlayKey = "";
    let toolsKey = "";
    let timerKey = "";
    let tool = { color: 0, size: 10 };
    let clearConfirm = 0;

    // Zeichnen: lokale Striche { id, c, s, p, sent } bis der Server sie hat
    let local = [];
    let drawing = null;
    let nextId = 1;
    let turnSeen = 0;
    let queue = Promise.resolve();
    let flushTimer = null;

    const isHost = () => ctx.getLobby()?.hostId === ctx.me.id;
    const turn = () => state?.turn ?? null;
    const playerById = id => state.players.find(p => p.id === id);
    const amDrawer = () => turn()?.drawerId === ctx.me.id;
    const canDraw = () => state?.phase === "drawing" && amDrawer();
    const amPlayer = () => state?.players.some(p => p.id === ctx.me.id && !p.left);
    const solved = () => turn()?.guessed.some(x => x.id === ctx.me.id);

    // --- Senden der Striche ---------------------------------------------------------
    function enqueue(action) {
        queue = queue.then(() => ctx.sendAction(action)).catch(() => {});
        return queue;
    }

    function flush() {
        flushTimer = null;
        for (const stroke of local) {
            while (stroke.sent < stroke.p.length) {
                const chunk = stroke.p.slice(stroke.sent, stroke.sent + 600);
                stroke.sent += chunk.length;
                enqueue({ type: "stroke", id: stroke.id, color: stroke.c, size: stroke.s, points: chunk });
            }
        }
    }

    function scheduleFlush() {
        if (!flushTimer) flushTimer = setTimeout(flush, SEND_MS);
    }

    function toCanvas(event) {
        const rect = canvas.getBoundingClientRect();
        return [
            Math.round(Math.min(800, Math.max(0, (event.clientX - rect.left) / rect.width * 800))),
            Math.round(Math.min(500, Math.max(0, (event.clientY - rect.top) / rect.height * 500)))
        ];
    }

    canvas.addEventListener("pointerdown", event => {
        if (!canDraw() || event.button > 0) return;
        event.preventDefault();
        canvas.setPointerCapture?.(event.pointerId);
        const [x, y] = toCanvas(event);
        drawing = { id: nextId++, c: tool.color, s: tool.size, p: [x, y], sent: 0 };
        local.push(drawing);
        render();
        scheduleFlush();
    });
    canvas.addEventListener("pointermove", event => {
        if (!drawing) return;
        const [x, y] = toCanvas(event);
        const p = drawing.p;
        if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) < MIN_STEP) return;
        p.push(x, y);
        render();
        scheduleFlush();
    });
    const endStroke = () => {
        if (!drawing) return;
        drawing = null;
        flush();
    };
    canvas.addEventListener("pointerup", endStroke);
    canvas.addEventListener("pointercancel", endStroke);
    canvas.addEventListener("lostpointercapture", endStroke);

    function undo() {
        if (!canDraw()) return;
        flush();
        local = [];
        enqueue({ type: "undo" });
    }

    function clearAll() {
        if (!canDraw()) return;
        if (performance.now() > clearConfirm) {
            clearConfirm = performance.now() + CONFIRM_MS;
            toolsKey = "";
            renderTools();
            setTimeout(() => { toolsKey = ""; if (state) renderTools(); }, CONFIRM_MS + 50);
            return;
        }
        clearConfirm = 0;
        flush();
        local = [];
        enqueue({ type: "clear" });
        toolsKey = "";
        renderTools();
    }

    function onKey(event) {
        if (!canDraw() || isTyping()) return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
            event.preventDefault();
            undo();
        }
    }
    document.addEventListener("keydown", onKey);

    guessForm.addEventListener("submit", event => {
        event.preventDefault();
        const text = guessInput.value.trim();
        if (!text) return;
        guessInput.value = "";
        ctx.sendAction({ type: "guess", text });
    });

    // --- Canvas ----------------------------------------------------------------------
    function render() {
        const t = turn();
        g.fillStyle = "#ffffff";
        g.fillRect(0, 0, 800, 500);
        if (!t) return;
        const colors = state.catalog.colors;
        const server = new Map(t.strokes.map(s => [s.id, s]));
        for (const s of t.strokes) paintStroke(g, s, colors);
        // lokale Vorschau, solange der Server den Strich noch nicht vollständig hat
        local = local.filter(s => s === drawing || (server.get(s.id)?.p.length ?? -1) < s.p.length);
        for (const s of local) paintStroke(g, s, colors);
        canvas.dataset.strokes = String(t.strokes.length);
    }

    // --- Karten: Setup und Ergebnis -----------------------------------------------------
    function renderCard() {
        const key = JSON.stringify([state.phase === "setup" ? [state.settings, state.members.length, isHost()] : null,
            state.phase === "finished" ? [state.matchNumber, state.result, isHost()] : null]);
        if (key === cardKey) return;
        cardKey = key;
        card.replaceChildren();
        root.dataset.card = state.phase === "setup" || state.phase === "finished" ? "yes" : "no";
        if (state.phase === "setup") card.append(renderSetup());
        else if (state.phase === "finished") card.append(renderResult());
    }

    function renderSetup() {
        const box = createElement("div", "sr-card sr-setup");
        const s = state.settings;
        box.append(createElement("h3", null, "Skizzen-Raten"));
        box.append(createElement("p", null, "Reihum zeichnet einer einen Begriff, die anderen tippen ihre Tipps ins Ratefeld. Je schneller jemand richtig liegt, desto mehr Punkte – der Zeichner punktet mit jedem, der es errät."));
        box.append(createElement("p", "sr-muted", "Falsche Tipps sehen alle, richtige bleiben geheim. Mit der Zeit werden einzelne Buchstaben aufgedeckt."));
        if (isHost()) {
            const row = createElement("div", "sr-options");
            row.append(
                createChoice("Durchgänge", "sr-rounds", state.catalog.roundOptions.map(n => [String(n), `${n}× zeichnen`]), String(s.rounds), v => ctx.sendAction({ type: "settings", rounds: Number(v) })),
                createChoice("Zeit", "sr-seconds", state.catalog.secondsOptions.map(n => [String(n), `${n} s`]), String(s.drawSeconds), v => ctx.sendAction({ type: "settings", drawSeconds: Number(v) })),
                createChoice("Begriffe", "sr-difficulty", Object.entries(state.catalog.difficulties), s.difficulty, v => ctx.sendAction({ type: "settings", difficulty: v }))
            );
            box.append(row);
            const area = createElement("textarea", "sr-custom");
            area.rows = 3;
            area.placeholder = "Eigene Begriffe, durch Komma getrennt (optional)";
            area.value = s.customWords.join(", ");
            area.addEventListener("change", () => ctx.sendAction({ type: "settings", customWords: area.value }));
            const only = createElement("label", "sr-only");
            const check = createElement("input");
            check.type = "checkbox";
            check.checked = s.onlyCustom;
            check.disabled = s.customCount < state.catalog.limits.minCustomOnly;
            check.addEventListener("change", () => ctx.sendAction({ type: "settings", onlyCustom: check.checked }));
            only.append(check, document.createTextNode(` nur eigene Begriffe (ab ${state.catalog.limits.minCustomOnly}, aktuell ${s.customCount})`));
            box.append(area, only);
            const start = button("sr-start", "Spiel starten", () => ctx.sendAction({ type: "start" }));
            start.disabled = state.members.length < state.catalog.limits.minPlayers;
            box.append(start);
            if (start.disabled) box.append(createElement("p", "sr-muted", `Es braucht mindestens ${state.catalog.limits.minPlayers} Spieler.`));
        } else {
            box.append(createElement("p", "sr-summary", `${s.rounds}× zeichnen, ${s.drawSeconds} s pro Bild, Begriffe: ${state.catalog.difficulties[s.difficulty].toLowerCase()}${s.customCount ? ` + ${s.customCount} eigene${s.onlyCustom ? " (nur eigene)" : ""}` : ""}.`));
            box.append(createElement("p", "sr-muted", "Der Host startet."));
        }
        return box;
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

    function renderResult() {
        const result = state.result;
        const box = createElement("div", "sr-card sr-result");
        const winner = result && playerById(result.winnerId);
        box.append(createElement("h3", null, result?.outcome === "aborted" ? "Spiel beendet" : `🏆 ${winner?.name ?? "?"} gewinnt!`));
        const table = createElement("table", "sr-placements");
        const headRow = createElement("tr");
        for (const title of ["", "Name", "Punkte"]) headRow.append(createElement("th", null, title));
        table.append(headRow);
        (result?.placements ?? []).forEach((id, index) => {
            const p = playerById(id);
            const row = createElement("tr", p.id === ctx.me.id ? "is-me" : "");
            const nameCell = createElement("td");
            const swatch = createElement("span", "sr-swatch");
            swatch.style.background = p.color;
            nameCell.append(swatch, document.createTextNode(` ${p.name}`));
            row.append(createElement("td", null, `${index + 1}.`), nameCell, createElement("td", "sr-num", String(p.score)));
            table.append(row);
        });
        box.append(table);
        if (isHost()) box.append(button("sr-new-match", "Neue Partie", () => ctx.sendAction({ type: "new-match" })));
        else box.append(createElement("p", "sr-muted", "Der Host kann eine neue Partie starten."));
        return box;
    }

    // --- Kopfzeile, Overlay, Werkzeuge ---------------------------------------------------
    function renderHead() {
        const t = turn();
        if (!t) return;
        const drawer = playerById(t.drawerId);
        headWho.textContent = amDrawer() ? "Du zeichnest" : `${drawer?.name ?? "?"} zeichnet`;
        headWho.style.setProperty("--sr-color", drawer?.color ?? "#888");
        let word = "";
        if (state.phase === "choosing") word = amDrawer() ? "Wähle einen Begriff" : "…";
        else if (t.word && (amDrawer() || solved())) word = `${solved() ? "✓ " : ""}${t.word}`;
        else if (t.word) word = t.word;
        else if (t.hint) word = `${t.hint.split("").join(" ")}  (${t.letters})`;
        headWord.textContent = word;
        headWord.classList.toggle("is-hint", Boolean(!t.word && t.hint));
        const total = state.settings.rounds * state.players.filter(p => !p.left).length;
        headInfo.textContent = `Bild ${t.number}/${Math.max(total, t.number)}`;
        const key = `${t.number}|${state.phase}`;
        if (key !== timerKey) {
            timerKey = key;
            timerSlot.replaceChildren();
            if (t.remainingMs !== null && state.phase !== "reveal") timerSlot.append(createTimer(t.remainingMs, t.totalMs));
        }
    }

    function renderOverlay() {
        const t = turn();
        const key = JSON.stringify([state.phase, t?.number, t?.choices, state.phase === "reveal" ? [t.word, t.guessed, t.drawerPoints] : null]);
        if (key === overlayKey) return;
        overlayKey = key;
        overlay.replaceChildren();
        overlay.hidden = !(state.phase === "choosing" || state.phase === "reveal");
        if (state.phase === "choosing") {
            const drawer = playerById(t.drawerId);
            if (amDrawer()) {
                overlay.append(createElement("h3", null, "Was möchtest du zeichnen?"));
                const row = createElement("div", "sr-choices");
                t.choices.forEach((word, index) => {
                    const b = button("sr-choice", word, () => ctx.sendAction({ type: "choose", index }));
                    b.dataset.index = String(index);
                    row.append(b);
                });
                overlay.append(row);
            } else {
                overlay.append(createElement("h3", null, `${drawer?.name ?? "?"} wählt einen Begriff …`));
            }
        } else if (state.phase === "reveal") {
            overlay.append(createElement("p", "sr-muted", ENDINGS[t.ending] ?? ""));
            overlay.append(createElement("h3", null, t.word ? `Der Begriff war: ${t.word}` : "Kein Begriff gewählt"));
            const list = createElement("ul", "sr-reveal-list");
            for (const x of t.guessed) list.append(createElement("li", null, `${playerById(x.id)?.name ?? "?"} +${x.points}`));
            if (t.word) list.append(createElement("li", "sr-drawer-points", `✏️ ${playerById(t.drawerId)?.name ?? "?"} +${t.drawerPoints}`));
            overlay.append(list);
        }
    }

    function renderTools() {
        const active = canDraw();
        const key = JSON.stringify([active, tool, clearConfirm > performance.now()]);
        if (key === toolsKey) return;
        toolsKey = key;
        tools.replaceChildren();
        tools.hidden = !active;
        board.classList.toggle("is-drawing", active);
        if (!active) return;
        const colors = state.catalog.colors;
        const palette = createElement("div", "sr-palette");
        colors.forEach((color, index) => {
            const eraser = index === state.catalog.eraser;
            const b = button(`sr-color${tool.color === index ? " is-on" : ""}${eraser ? " is-eraser" : ""}`, eraser ? "⌫" : "", () => { tool = { ...tool, color: index }; renderTools(); });
            b.style.setProperty("--sr-swatch", color);
            b.title = eraser ? "Radierer" : "Farbe";
            b.dataset.color = String(index);
            palette.append(b);
        });
        const sizes = createElement("div", "sr-sizes");
        for (const size of state.catalog.sizes) {
            const b = button(`sr-size${tool.size === size ? " is-on" : ""}`, "", () => { tool = { ...tool, size }; renderTools(); });
            const dot = createElement("i");
            dot.style.width = dot.style.height = `${Math.max(4, size * 0.8)}px`;
            b.append(dot);
            b.title = `Stift ${size}`;
            sizes.append(b);
        }
        const actions = createElement("div", "sr-actions");
        actions.append(
            button("sr-undo", "↶ Rückgängig", undo),
            button(`sr-clear${clearConfirm > performance.now() ? " is-confirm" : ""}`, clearConfirm > performance.now() ? "Wirklich leeren?" : "🗑 Leeren", clearAll)
        );
        if (isHost()) actions.append(button("sr-skip", "Überspringen", () => ctx.sendAction({ type: "skip" })));
        tools.append(palette, sizes, actions);
    }

    // --- Seitenleiste ------------------------------------------------------------------
    function renderSide() {
        const t = turn();
        const rows = state.players.filter(p => !p.left).sort((a, b) => b.score - a.score);
        const list = createElement("ol", "sr-score-list");
        for (const p of rows) {
            const li = createElement("li", p.id === ctx.me.id ? "is-me" : "");
            li.dataset.player = p.id;
            const name = createElement("span", "sr-score-name", p.name);
            name.style.setProperty("--sr-color", p.color);
            const marks = createElement("span", "sr-marks");
            if (t?.drawerId === p.id && state.phase !== "finished") marks.append(createElement("span", "sr-mark", "✏️"));
            const hit = t?.guessed.find(x => x.id === p.id);
            if (hit) marks.append(createElement("span", "sr-mark is-hit", `✓ +${hit.points}`));
            li.append(name, marks, createElement("span", "sr-score", String(p.score)));
            list.append(li);
        }
        scores.replaceChildren(createElement("h4", null, "Punkte"), list);

        const items = (t?.guesses ?? []).map(x => {
            const li = createElement("li", x.id === ctx.me.id ? "is-me" : "");
            li.append(createElement("b", null, `${playerById(x.id)?.name ?? "?"}: `), document.createTextNode(x.text));
            if (x.id === ctx.me.id && t.near && x.text === t.near) {
                li.classList.add("is-near");
                li.append(createElement("span", "sr-near", " Fast!"));
            }
            return li;
        });
        guessList.replaceChildren(...items);
        guessList.scrollTop = guessList.scrollHeight;
        const canGuess = state.phase === "drawing" && amPlayer() && !amDrawer() && !solved();
        guessInput.disabled = !canGuess;
        guessButton.disabled = !canGuess;
        guessInput.placeholder = amDrawer() ? "Du zeichnest gerade" : solved() ? "Erraten! Warte auf die anderen" : state.phase === "drawing" ? "Dein Tipp …" : "Gleich geht's weiter";
        guessBox.hidden = state.phase === "setup" || state.phase === "finished";
        scores.hidden = state.phase === "setup";
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
            const t = turn();
            if (t && t.number !== turnSeen) {
                turnSeen = t.number;
                local = [];
                drawing = null;
                nextId = 1;
            }
            if (t) nextId = Math.max(nextId, ...t.strokes.map(s => s.id + 1));
            renderCard();
            renderHead();
            renderOverlay();
            renderTools();
            render();
            renderSide();
            renderLog();
        },
        destroy() {
            document.removeEventListener("keydown", onKey);
            clearTimeout(flushTimer);
            frame.remove();
        }
    };
}
