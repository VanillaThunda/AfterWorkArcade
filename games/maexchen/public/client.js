/**
 * Mäxchen – Client-Teil.
 *
 * Reines DOM/CSS wie bei Schocken: Die Oberfläche wird bei update() neu
 * aufgebaut. Den Wurf unter dem Becher liefert der Server nur an den Werfer
 * (viewFor) – alle anderen bekommen round.dice = null.
 *
 * Aktionen:  settings {bots, lives}, start, roll, announce {value},
 *            believe, doubt, accept, new-match
 * Alle Texte per textContent – nie innerHTML (Schutz vor XSS).
 */

export const stylesheets = ["style.css"];

/** Augen-Positionen im 3×3-Raster (1 = oben links … 9 = unten rechts). */
const PIPS = {
    1: [5],
    2: [3, 7],
    3: [3, 5, 7],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9]
};

const MAEXCHEN = 21;
const SHAKE_MS = 700; // Dauer der Becher-Animation (siehe style.css)

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function createDie(value, small = false) {
    const die = createElement("div", small ? "mx-die mx-die-small" : "mx-die");
    die.setAttribute("aria-label", `Würfel ${value}`);
    for (const position of PIPS[value]) {
        const pip = createElement("i");
        pip.style.gridRow = String(Math.ceil(position / 3));
        pip.style.gridColumn = String(((position - 1) % 3) + 1);
        die.append(pip);
    }
    return die;
}

function createDice(dice, small = false) {
    const wrap = createElement("span", "mx-dice");
    wrap.append(...dice.map(value => createDie(value, small)));
    return wrap;
}

/** Laufender Zeitbalken (CSS-Animation, startet mit der Restzeit). */
function createTimer(remainingMs, totalMs) {
    const bar = createElement("div", "mx-timer");
    const fill = createElement("div", "mx-timer-fill");
    fill.style.animationDuration = `${totalMs}ms`;
    fill.style.animationDelay = `${-(totalMs - remainingMs)}ms`;
    bar.append(fill);
    return bar;
}

function labelOf(value) {
    if (value === MAEXCHEN) return "Mäxchen";
    if (value % 11 === 0) return `${value / 11}er-Pasch`;
    return String(value);
}

function valueOf(dice) {
    const high = Math.max(...dice);
    const low = Math.min(...dice);
    if (high === 2 && low === 1) return MAEXCHEN;
    if (high === low) return high * 11;
    return high * 10 + low;
}

/** Kurzfassung der Regeln unter dem Spielfeld (einmalig aufgebaut). */
function createRules() {
    const details = createElement("details", "mx-rules");
    details.open = true;
    details.append(createElement("summary", null, "Regeln kurz & knapp"));
    const grid = createElement("div", "mx-rules-grid");

    const flow = createElement("div");
    flow.append(createElement("h5", null, "Ablauf"));
    const list = createElement("ul");
    for (const text of [
        "Würfle verdeckt – nur du siehst deinen Wurf.",
        "Sag einen Wert an, der höher ist als die vorige Ansage. Lügen ist erlaubt!",
        "Der Nächste glaubt (übernimmt den Becher und würfelt selbst) oder zweifelt an (Becher wird aufgedeckt).",
        "Aufgedeckt: Ist der Wurf mindestens so hoch wie angesagt, verliert der Zweifler ein Leben – sonst der Lügner.",
        "Mäxchen angesagt: aufdecken (echt → Zweifler −2 ❤, gelogen → Ansager −1 ❤) oder hinnehmen (−1 ❤).",
        "Wer ein Leben verliert, beginnt die nächste Runde. Mit 0 Leben ist man raus – der Letzte gewinnt.",
        "30 s Zeit pro Schritt."
    ]) list.append(createElement("li", null, text));
    flow.append(list);

    const ranking = createElement("div");
    ranking.append(createElement("h5", null, "Rangfolge (höchster zuerst)"));
    const table = createElement("table", "mx-rules-table");
    for (const [name, example] of [
        ["Mäxchen", "2 + 1"],
        ["Pasch", "6-6 … 1-1"],
        ["Zahlen", "65, 64 … 32, 31"]
    ]) {
        const row = createElement("tr");
        row.append(createElement("td", null, name), createElement("td", null, example));
        table.append(row);
    }
    ranking.append(table);
    ranking.append(createElement("p", "mx-rules-note", "Die höhere Augenzahl ist die Zehnerstelle: 3 und 5 → 53."));

    grid.append(flow, ranking);
    details.append(grid);
    return details;
}

export function mount(container, ctx) {
    // --- Grundgerüst ---------------------------------------------------------
    const frame = createElement("div", "mx-root"); // Bezugsrahmen für Container-Queries
    const root = createElement("div", "mx");
    const table = createElement("div", "mx-table");
    const head = createElement("div", "mx-head");
    const center = createElement("div", "mx-center");
    const seats = createElement("div", "mx-seats");
    const overlay = createElement("div", "mx-overlay");
    table.append(head, center, seats, overlay);

    const panel = createElement("div", "mx-panel");
    const log = createElement("ul", "mx-log");
    root.append(table, panel, log, createRules());
    frame.append(root);
    container.append(frame);

    let state = null;
    let busy = false;
    let overlayKey = "";
    let initialRender = true; // nach einem Reload nichts nachträglich animieren

    /** Startzeiten der Becher-Animation (überlebt den häufigen Neuaufbau). */
    const shakeStarts = new Map();
    function shakeElapsed(key) {
        const now = performance.now();
        if (!shakeStarts.has(key)) {
            shakeStarts.set(key, initialRender ? -Infinity : now);
            if (shakeStarts.size > 100) shakeStarts.delete(shakeStarts.keys().next().value);
        }
        const elapsed = now - shakeStarts.get(key);
        return elapsed < SHAKE_MS ? elapsed : null;
    }

    const isHost = () => ctx.getLobby()?.hostId === ctx.me.id;
    const nameOf = id => state.participants.find(p => p.id === id)?.name ?? "?";
    const currentId = () => state.round ? state.round.order[state.round.index] : null;
    const me = () => state.participants.find(p => p.id === ctx.me.id) ?? null;

    async function send(action) {
        if (busy) return;
        busy = true;
        render();
        await ctx.sendAction(action); // Fehler zeigt das Lobby-System als Hinweis an
        busy = false;
        render();
    }

    function button(text, action, className) {
        const element = createElement("button", className, text);
        element.type = "button";
        element.disabled = busy;
        element.addEventListener("click", () => send(action));
        return element;
    }

    // --- Darstellung ---------------------------------------------------------

    function renderHead() {
        const status = createElement("div", "mx-status");
        if (state.phase === "playing" && state.round) {
            const parts = [`Runde ${state.round.number}`];
            if (state.round.stage !== "reveal") parts.push(`am Zug: ${nameOf(currentId())}`);
            status.textContent = parts.join(" · ");
        } else {
            status.textContent = "Mäxchen";
        }
        head.replaceChildren(status);
    }

    function createCup(round) {
        const cup = createElement("div", "mx-cup");
        cup.setAttribute("aria-hidden", "true");
        if (round.throws > 0) {
            const elapsed = shakeElapsed(`${state.matchNumber}|${round.number}|${round.throws}`);
            if (elapsed !== null) {
                cup.classList.add("mx-shake");
                cup.style.animationDelay = `${-elapsed}ms`;
            }
        }
        return cup;
    }

    function renderCenter() {
        const round = state.round;
        if (state.phase !== "playing" || !round) {
            center.replaceChildren();
            return;
        }

        if (round.stage === "reveal" && state.reveal) {
            const reveal = state.reveal;
            const box = createElement("div", "mx-reveal-box");
            const title = reveal.truthful === null ? "Hingenommen" : reveal.truthful ? "Stimmt!" : "Gelogen!";
            box.append(createElement("h4", reveal.truthful === false ? "mx-lie" : "mx-truth", title));
            if (reveal.dice) {
                const line = createElement("div", "mx-reveal-dice");
                line.append(createDice(reveal.dice), createElement("strong", null, labelOf(valueOf(reveal.dice))));
                box.append(line);
            }
            box.append(createElement("p", null, reveal.text));
            box.append(createElement("p", "mx-outcome", reveal.outcome));
            if (state.revealRemainingMs !== null) box.append(createTimer(state.revealRemainingMs, state.revealMs));
            center.replaceChildren(box);
            return;
        }

        const announcement = createElement("div", "mx-announcement");
        if (round.announcement) {
            announcement.append(
                createElement("span", "mx-announcer", `${nameOf(round.announcement.by)} sagt:`),
                createElement("strong", round.announcement.value === MAEXCHEN ? "mx-big mx-maexchen" : "mx-big",
                    round.announcement.value === MAEXCHEN ? "Mäxchen!" : labelOf(round.announcement.value))
            );
        } else {
            announcement.append(createElement("span", "mx-announcer", "Neue Runde – noch keine Ansage"));
        }
        center.replaceChildren(createCup(round), announcement);
    }

    function stepText(participant) {
        if (participant.out) return participant.left ? "hat verlassen" : "ausgeschieden";
        const round = state.round;
        if (!round || state.phase !== "playing" || round.stage === "reveal") return "";
        if (participant.id !== currentId()) return round.holderId === participant.id && round.stage !== "roll" ? "hält den Becher" : "";
        return { roll: "würfelt …", announce: "sagt an …", decide: "entscheidet …" }[round.stage] ?? "";
    }

    function renderSeats() {
        if (state.phase === "setup") {
            seats.replaceChildren();
            return;
        }
        const maxLives = state.settings.lives;
        const items = state.participants.map(participant => {
            const seat = createElement("div", "mx-seat");
            if (participant.id === ctx.me.id) seat.classList.add("mx-seat-me");
            if (participant.out) seat.classList.add("mx-seat-out");
            if (state.phase === "playing" && state.round?.stage !== "reveal" && participant.id === currentId()) {
                seat.classList.add("mx-seat-active");
            }
            if (state.round?.stage === "reveal" && state.reveal?.loserId === participant.id) seat.classList.add("mx-seat-loser");

            const top = createElement("div", "mx-seat-top");
            const name = createElement("span", "mx-seat-name",
                `${participant.bot ? "🤖 " : ""}${participant.name}${participant.id === ctx.me.id ? " (du)" : ""}`);
            top.append(name);

            const lives = createElement("span", "mx-lives");
            lives.setAttribute("aria-label", `${participant.lives} Leben`);
            lives.textContent = "❤".repeat(participant.lives) + "♡".repeat(Math.max(0, maxLives - participant.lives));

            seat.append(top, lives, createElement("span", "mx-seat-info", stepText(participant)));
            return seat;
        });
        seats.replaceChildren(...items);
    }

    function renderOverlay() {
        const host = isHost();
        const key = JSON.stringify([state.phase, state.settings, state.result, host, busy, state.members.length]);
        if (key === overlayKey) return;
        overlayKey = key;

        if (state.phase === "playing") {
            overlay.hidden = true;
            overlay.replaceChildren();
            return;
        }
        overlay.hidden = false;
        const box = createElement("div", "mx-overlay-box");

        if (state.phase === "setup") {
            box.append(createElement("h3", null, "Mäxchen"));
            box.append(createElement("p", null, "Würfle verdeckt, sag höher an – und bluffe, wenn es sein muss."));
            const humans = state.members.length;
            if (host) {
                const setup = createElement("div", "mx-setup");
                setup.append(
                    createSelect("Bots", "mx-bots", 0, state.settings.maxBots, state.settings.bots, value => send({ type: "settings", bots: value })),
                    createSelect("Leben", "mx-lives-select", state.settings.minLives, state.settings.maxLives, state.settings.lives, value => send({ type: "settings", lives: value }))
                );
                const start = button("Spiel starten", { type: "start" }, "mx-start");
                if (humans + state.settings.bots < 2) {
                    start.disabled = true;
                    start.title = "Mindestens 2 Teilnehmer – füge Bots hinzu.";
                }
                box.append(setup, start);
            } else {
                box.append(createElement("p", "mx-muted",
                    `Bots: ${state.settings.bots} · Leben: ${state.settings.lives} – der Host startet die Partie.`));
            }
            box.append(createElement("p", "mx-muted", `${humans} ${humans === 1 ? "Mensch" : "Menschen"} in der Lobby`));
        } else if (state.phase === "finished" && state.result) {
            const winner = state.result.winnerId ? nameOf(state.result.winnerId) : "Niemand";
            box.append(createElement("h3", null, `🏆 ${winner} gewinnt!`));
            const list = createElement("ol", "mx-placements");
            for (const id of state.result.placements) list.append(createElement("li", null, nameOf(id)));
            box.append(list);
            if (host) box.append(button("Neue Partie", { type: "new-match" }, "mx-new-match"));
            else box.append(createElement("p", "mx-muted", "Der Host kann eine neue Partie starten."));
        }
        overlay.replaceChildren(box);
    }

    function createSelect(labelText, className, min, max, current, onChange) {
        const label = createElement("label", null, labelText);
        const select = createElement("select", className);
        for (let value = min; value <= max; value++) {
            const option = createElement("option", null, String(value));
            option.value = String(value);
            option.selected = value === current;
            select.append(option);
        }
        select.disabled = busy;
        select.addEventListener("change", () => onChange(Number(select.value)));
        label.append(select);
        return label;
    }

    function renderPanel() {
        const round = state.round;
        const self = me();
        if (state.phase !== "playing" || !round) {
            panel.hidden = true;
            return;
        }
        panel.hidden = false;
        const info = createElement("div", "mx-panel-info");
        const children = [];

        if (!self) {
            info.append(createElement("strong", null, "Du schaust zu."));
            panel.replaceChildren(info);
            return;
        }
        if (self.out) {
            info.append(createElement("strong", null, "Du bist ausgeschieden."), createElement("span", null, "Schau zu, wer gewinnt."));
            panel.replaceChildren(info);
            return;
        }

        const myTurn = currentId() === ctx.me.id && round.stage !== "reveal";
        const minRank = round.announcement ? state.values.indexOf(round.announcement.value) + 1 : 0;

        if (round.stage === "reveal") {
            info.append(createElement("strong", null, "Aufgedeckt"), createElement("span", null, "Gleich geht es mit der nächsten Runde weiter."));
            children.push(info);
        } else if (!myTurn) {
            info.append(createElement("strong", null, `${nameOf(currentId())} ist am Zug.`));
            if (round.dice && round.holderId === ctx.me.id) {
                const own = createElement("div", "mx-panel-dice");
                own.append(createDice(round.dice));
                info.append(createElement("span", null, `Dein Wurf unter dem Becher: ${labelOf(valueOf(round.dice))}`));
                children.push(own);
            }
            children.push(info);
        } else if (round.stage === "roll") {
            info.append(
                createElement("strong", null, "Du bist dran – würfle!"),
                createElement("span", null, round.announcement
                    ? `Du musst danach mehr als ${labelOf(round.announcement.value)} ansagen.`
                    : "Du beginnst die Runde und darfst danach jeden Wert ansagen.")
            );
            const buttons = createElement("div", "mx-panel-buttons");
            buttons.append(button("🎲 Würfeln", { type: "roll" }, "mx-roll"));
            children.push(info, buttons);
        } else if (round.stage === "announce" && round.dice) {
            const actual = valueOf(round.dice);
            const own = createElement("div", "mx-panel-dice");
            own.append(createDice(round.dice));
            info.append(
                createElement("strong", null, `Dein Wurf: ${labelOf(actual)}`),
                createElement("span", null, state.values.indexOf(actual) >= minRank
                    ? "Sag die Wahrheit – oder bluffe höher."
                    : `Zu niedrig – du musst mehr als ${labelOf(round.announcement.value)} ansagen. Zeit zu bluffen!`)
            );
            const values = createElement("div", "mx-values");
            for (const value of state.values.slice(minRank)) {
                const option = button(labelOf(value), { type: "announce", value }, "mx-value");
                if (value === actual) {
                    option.classList.add("mx-value-truth");
                    option.title = "Wahrheit";
                }
                values.append(option);
            }
            children.push(own, info, values);
        } else if (round.stage === "decide") {
            const announced = round.announcement.value;
            info.append(
                createElement("strong", null, `${nameOf(round.announcement.by)} sagt ${labelOf(announced)} an.`),
                createElement("span", null, announced === MAEXCHEN ? "Aufdecken oder hinnehmen?" : "Glaubst du das?")
            );
            const buttons = createElement("div", "mx-panel-buttons");
            if (announced === MAEXCHEN) {
                buttons.append(
                    button("🔍 Aufdecken", { type: "doubt" }, "mx-doubt"),
                    button("Hinnehmen (−1 ❤)", { type: "accept" }, "mx-accept button-secondary")
                );
            } else {
                buttons.append(
                    button("👍 Glauben & würfeln", { type: "believe" }, "mx-believe"),
                    button("🔍 Anzweifeln", { type: "doubt" }, "mx-doubt button-secondary")
                );
            }
            children.push(info, buttons);
        }

        if (myTurn && round.turnRemainingMs !== null && round.turnRemainingMs !== undefined) {
            children.push(createTimer(round.turnRemainingMs, state.turnMs));
        }
        panel.replaceChildren(...children);
    }

    function renderLog() {
        log.hidden = state.log.length === 0;
        log.replaceChildren(...[...state.log].reverse().map(text => createElement("li", null, text)));
    }

    function render() {
        if (!state) return;
        root.dataset.phase = state.phase;
        root.dataset.stage = state.round?.stage ?? "";
        renderHead();
        renderCenter();
        renderSeats();
        renderOverlay();
        renderPanel();
        renderLog();
        initialRender = false;
    }

    return {
        update(newState) {
            state = newState;
            if (!state) {
                head.replaceChildren(createElement("div", "mx-status", "Spielstand nicht verfügbar."));
                return;
            }
            render();
        },
        destroy() {
            frame.remove();
        }
    };
}
