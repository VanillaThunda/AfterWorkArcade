"use strict";

/**
 * Schocken – Server-Teil.
 *
 * Würfelspiel mit 3 Würfeln pro Spieler und 13 Deckeln (Strafpunkten).
 * Regeln nach schockfreunde.de, "Jennie" heißt hier "General",
 * Rangfolge klassisch: Schock Aus > Schock 6…2 > General > Straße > Zahlen.
 *
 * Ablauf einer Runde:
 *  - Reihum würfelt jeder bis zu 3-mal. Der Erste legt durch seine Wurfanzahl
 *    die Vorgabe fest, alle Folgenden dürfen sie nicht überschreiten.
 *  - Nach dem Wurf bleibt der Becher zu – auch der Werfer kennt seine Würfel
 *    nicht. Wer aufdeckt ("look"), zeigt die Würfel ALLEN. Blind beenden ist
 *    erlaubt. Der Erste gibt Wurfzahl und Spielweise (verdeckt/offen) vor.
 *  - Nur aufgedeckte Einsen dürfen herausgelegt werden (offen, gesperrt).
 *  - Zwei/drei aufgedeckte Sechsen dürfen zu einer/zwei Einsen gedreht
 *    werden (nicht im letzten erlaubten Wurf); die übrige Sechs muss neu.
 *  - Der beste Wurf bestimmt die Deckelzahl, der schlechteste bekommt sie:
 *    erst aus dem Topf, danach vom Spieler mit dem besten Wurf.
 *  - Wer alle 13 Deckel hat, verliert die Hälfte (Schock Aus: sofort).
 *
 * Phasen:  setup → playing → finished → (Neue Partie) setup
 *
 * Nutzt die optionalen Hooks tick() (Zugtimer, Bots, Pause nach Auswertung)
 * und viewFor() (fremde Würfel im Becher bleiben auf dem Server).
 */

const crypto = require("crypto");
const { pickBotNames } = require("../../server/bot-names");

// ===========================================================================
// Einstellungen
// ===========================================================================

const TOTAL_CHIPS = 13;
const MAX_PARTICIPANTS = 8;
const MAX_BOTS = 5;
const DEFAULT_BOTS = 2;
const MAX_THROWS = 3;
const TURN_MS = 30_000;       // Zugtimer für Menschen
const BOT_STEP_MS = 900;      // Pause zwischen zwei Bot-Aktionen
const REVEAL_MS = 30_000;     // Anzeige der Auswertung, danach nächste Runde
const ACK_SHARE = 0.75;       // so viele Spieler müssen "Weiter" klicken, um früher weiterzumachen
const LOG_SIZE = 8;
const BOT_BLIND_CHANCE = 0.05; // Bot als Erster spielt blind (1 Wurf, Becher zu)
const MODES = Object.freeze(["half", "full"]);

const STAGE_LABELS = Object.freeze({
    half1: "1. Hälfte",
    half2: "2. Hälfte",
    finale: "Finale"
});

// ===========================================================================
// Zufall (austauschbar für Tests)
// ===========================================================================

let randomDie = () => crypto.randomInt(1, 7);

function setRandom(fn) {
    randomDie = fn ?? (() => crypto.randomInt(1, 7));
}

// ===========================================================================
// Wertung
// ===========================================================================

/**
 * Bewertet drei Würfel.
 * @param {number[]} dice  drei Augenzahlen (1–6)
 * @param {boolean} hand   true, wenn der letzte Wurf alle 3 Würfel umfasste
 *                         (General und Straße zählen nur "aus der Hand")
 * @returns {{kind: string, rank: number, chips: number, label: string}}
 */
function classify(dice, hand) {
    const sorted = [...dice].sort((a, b) => b - a); // absteigend
    const [high, mid, low] = sorted;
    const ones = dice.filter(value => value === 1).length;

    if (ones === 3) {
        return { kind: "schock-aus", rank: 1000, chips: TOTAL_CHIPS, label: "Schock Aus" };
    }
    if (ones === 2) {
        return { kind: "schock", rank: 900 + high, chips: high, label: `Schock ${high}` };
    }
    if (hand && high === low) {
        return { kind: "general", rank: 800 + high, chips: 3, label: `General (${high}er)` };
    }
    if (hand && high - mid === 1 && mid - low === 1) {
        return { kind: "strasse", rank: 700 + high, chips: 2, label: `Straße ${low}-${mid}-${high}` };
    }
    return {
        kind: "zahlen",
        rank: high * 100 + mid * 10 + low,
        chips: 1,
        label: `${high}-${mid}-${low}`
    };
}

/**
 * Sortierfunktion: besserer Wurf zuerst.
 * Gleicher Rang → weniger Würfe besser → früher an der Reihe besser.
 */
function compareEntries(a, b) {
    return (b.rank - a.rank) || (a.throws - b.throws) || (a.order - b.order);
}

// ===========================================================================
// Hilfsfunktionen
// ===========================================================================

function addLog(state, text) {
    state.log.push(text);
    if (state.log.length > LOG_SIZE) state.log.splice(0, state.log.length - LOG_SIZE);
}

function getParticipant(state, id) {
    return state.participants.find(p => p.id === id) ?? null;
}

function nameOf(state, id) {
    return getParticipant(state, id)?.name ?? "?";
}

function emptyTurn() {
    return {
        throws: 0,
        dice: [0, 0, 0],
        aside: [false, false, false],
        hand: false,
        turned: false,   // in diesem Wurf schon Sechsen gedreht
        mustRoll: false, // nach dem Drehen muss neu gewürfelt werden
        open: false,     // Becher aufgedeckt? (dann sehen alle die Würfel)
        done: false,
        result: null
    };
}

/** Teilnehmer, die in der aktuellen Hälfte (bzw. im Finale) mitspielen. */
function activeParticipants(state) {
    return state.match.active
        .map(id => getParticipant(state, id))
        .filter(p => p && !p.left);
}

/** Maximal erlaubte Würfe für den Spieler am Zug. */
function throwLimit(round) {
    if (round.laden) return 1;
    return round.maxThrows ?? MAX_THROWS;
}

function currentId(state) {
    const round = state.round;
    return round && round.stage === "turns" ? round.order[round.turnIndex] ?? null : null;
}

function currentTurn(state) {
    const id = currentId(state);
    return id ? state.round.turns[id] : null;
}

function rollOpenDice(turn) {
    let rolled = 0;
    for (let i = 0; i < 3; i++) {
        if (!turn.aside[i]) {
            turn.dice[i] = randomDie();
            rolled++;
        }
    }
    turn.throws++;
    turn.hand = rolled === 3;
    turn.turned = false;
    turn.mustRoll = false;
    turn.open = false; // Becher ist nach jedem Wurf wieder zu
    turn.result = classify(turn.dice, turn.hand);
}

/** Dürfen in diesem Wurf Sechsen gedreht werden? (nur aufgedeckt) */
function canTurnSixes(round, turn) {
    if (!turn || turn.throws === 0 || !turn.open || turn.turned || turn.mustRoll) return false;
    if (turn.throws >= throwLimit(round)) return false; // nicht im letzten Wurf
    const sixes = turn.dice.filter((value, i) => !turn.aside[i] && value === 6).length;
    return sixes >= 2;
}

// ===========================================================================
// Runden- und Partie-Ablauf
// ===========================================================================

/**
 * Startet eine neue Runde. Reihenfolge: beginnend beim Starter, reihum.
 * Ist der Topf leer, spielen nur noch Spieler mit Deckeln.
 */
function startRound(state, starterId, now, laden = false) {
    const active = activeParticipants(state);
    const players = state.match.pot > 0 ? active : active.filter(p => p.chips > 0);
    const ids = players.map(p => p.id);

    let startIndex = ids.indexOf(starterId);
    if (startIndex === -1) startIndex = 0;
    const order = [...ids.slice(startIndex), ...ids.slice(0, startIndex)];

    state.round = {
        number: (state.round?.number ?? 0) + 1,
        stage: "turns",
        laden,
        order,
        turnIndex: 0,
        maxThrows: null,
        firstOpen: null, // hat der Erste aufgedeckt beendet? (nur Anzeige)
        turns: Object.fromEntries(order.map(id => [id, emptyTurn()])),
        turnEndsAt: null,
        botNextAt: null
    };
    state.reveal = null;
    beginTurn(state, now);
}

function beginTurn(state, now) {
    const id = currentId(state);
    if (!id) return;
    const participant = getParticipant(state, id);
    state.round.turnEndsAt = participant.bot ? null : now + TURN_MS;
    state.round.botNextAt = participant.bot ? now + BOT_STEP_MS : null;
}

/** Hat der Erste aufgedeckt, müssen alle anderen am Ende ihres Zugs aufdecken. */
function mustRevealOnFinish(round) {
    return round.firstOpen === true && round.turnIndex > 0;
}

function finishTurn(state, id, now) {
    const round = state.round;
    const turn = round.turns[id];
    if (!turn.open && mustRevealOnFinish(round)) {
        turn.open = true;
        addLog(state, `${nameOf(state, id)} muss aufdecken: ${turn.result.label}.`);
    }
    turn.done = true;

    // Der Erste legt die Vorgabe fest (Wurfzahl und Spielweise).
    if (round.turnIndex === 0) {
        if (!round.laden) round.maxThrows = turn.throws;
        round.firstOpen = turn.open;
    }

    advanceTurn(state, now);
}

/** Nächster Spieler, der noch nicht fertig ist – oder Auswertung. */
function advanceTurn(state, now) {
    const round = state.round;
    while (round.turnIndex < round.order.length && round.turns[round.order[round.turnIndex]].done) {
        round.turnIndex++;
    }
    if (round.turnIndex >= round.order.length) {
        evaluateRound(state, now);
    } else {
        beginTurn(state, now);
    }
}

function evaluateRound(state, now) {
    const round = state.round;
    const entries = round.order
        .map((id, order) => ({ id, order, ...round.turns[id] }))
        .filter(entry => entry.result)
        .map(entry => ({
            id: entry.id,
            name: nameOf(state, entry.id),
            dice: entry.dice,
            throws: entry.throws,
            order: entry.order,
            rank: entry.result.rank,
            kind: entry.result.kind,
            label: entry.result.label,
            chips: entry.result.chips
        }))
        .sort(compareEntries);

    round.stage = "reveal";
    round.turnEndsAt = null;
    round.botNextAt = null;

    if (entries.length < 2) {
        // Kann nur passieren, wenn Spieler während der Runde gehen.
        state.reveal = { entries, bestId: null, loserId: null, amount: 0, text: "Runde ohne Wertung.", halfLoserId: null, acks: [] };
        state.nextRoundAt = now + REVEAL_MS;
        state.nextStarterId = entries[0]?.id ?? null;
        return;
    }

    const best = entries[0];
    const loser = entries[entries.length - 1];
    const loserP = getParticipant(state, loser.id);
    const bestP = getParticipant(state, best.id);
    let amount;
    let text;

    if (best.kind === "schock-aus") {
        // Alle Deckel (Topf + Spieler) an den Verlierer.
        for (const p of activeParticipants(state)) p.chips = 0;
        state.match.pot = 0;
        loserP.chips = TOTAL_CHIPS;
        amount = TOTAL_CHIPS;
        text = `Schock Aus von ${best.name}! ${loser.name} bekommt alle Deckel.`;
    } else if (state.match.pot > 0) {
        amount = Math.min(best.chips, state.match.pot);
        state.match.pot -= amount;
        loserP.chips += amount;
        text = `${loser.name} bekommt ${amount} Deckel aus dem Topf (${best.label} von ${best.name}).`;
    } else {
        amount = Math.min(best.chips, bestP.chips);
        bestP.chips -= amount;
        loserP.chips += amount;
        text = `${best.name} gibt ${amount} Deckel an ${loser.name} (${best.label}).`;
    }
    addLog(state, text);

    const halfLost = state.match.pot === 0 && loserP.chips >= TOTAL_CHIPS;
    state.reveal = {
        entries,
        bestId: best.id,
        loserId: loser.id,
        amount,
        text,
        halfLoserId: halfLost ? loser.id : null,
        acks: [] // wer schon "Weiter" geklickt hat
    };
    state.nextRoundAt = now + REVEAL_MS;
    state.nextStarterId = loser.id; // Verlierer beginnt die nächste Runde
}

/** Nach der Auswertungs-Pause: nächste Runde, nächste Hälfte oder Ende. */
function continueAfterReveal(state, now) {
    const halfLoserId = state.reveal?.halfLoserId ?? null;
    state.nextRoundAt = null;

    if (halfLoserId) {
        endHalf(state, halfLoserId, now);
        return;
    }
    if (activeParticipants(state).length < 2) {
        finishMatch(state, null, "Zu wenige Spieler – Partie beendet.");
        return;
    }
    // Sicherheitsnetz: hat jemand alle Deckel, obwohl keiner verloren hat (z. B. nach Verlassen)?
    const holder = activeParticipants(state).find(p => p.chips >= TOTAL_CHIPS);
    if (holder) {
        endHalf(state, holder.id, now);
        return;
    }
    startRound(state, state.nextStarterId, now);
}

/** Menschliche Teilnehmer, die noch da sind (zählen für "Weiter"). */
function humanParticipants(state) {
    return state.participants.filter(p => !p.bot && !p.left);
}

/** Wie viele "Weiter"-Klicks nötig sind (mind. 75 %, aufgerundet, mind. 1). */
function ackThreshold(humanCount) {
    return Math.max(1, Math.ceil(humanCount * ACK_SHARE));
}

/** Prüft die "Weiter"-Klicks und startet ggf. sofort die nächste Runde. */
function checkAcks(state, now) {
    if (state.phase !== "playing" || state.round?.stage !== "reveal" || !state.reveal) return;
    const humans = humanParticipants(state).map(p => p.id);
    const acks = state.reveal.acks.filter(id => humans.includes(id));
    state.reveal.acks = acks;
    if (acks.length >= ackThreshold(humans.length)) continueAfterReveal(state, now);
}

function resetChips(state, ids) {
    for (const p of state.participants) p.chips = 0;
    state.match.pot = TOTAL_CHIPS;
    state.match.active = ids;
}

function endHalf(state, loserId, now) {
    const match = state.match;
    const loserName = nameOf(state, loserId);
    const stageLabel = STAGE_LABELS[match.stage];

    if (match.stage === "finale" || state.settings.mode === "half") {
        finishMatch(state, loserId, `${loserName} verliert ${match.stage === "finale" ? "das Finale" : "die Partie"}!`);
        return;
    }

    if (match.stage === "half1") {
        match.halfLosers = [loserId];
        getParticipant(state, loserId).marker = true;
        addLog(state, `${loserName} verliert die ${stageLabel} und bekommt den Markierungsdeckel.`);
        match.stage = "half2";
        resetChips(state, state.participants.filter(p => !p.left).map(p => p.id));
        startRound(state, loserId, now);
        return;
    }

    // 2. Hälfte
    const firstLoser = match.halfLosers[0];
    match.halfLosers.push(loserId);
    const firstLoserP = getParticipant(state, firstLoser);
    if (firstLoser === loserId || !firstLoserP || firstLoserP.left) {
        finishMatch(state, loserId, firstLoser === loserId
            ? `${loserName} verliert beide Hälften und damit die Partie!`
            : `${loserName} verliert die Partie!`);
        return;
    }

    addLog(state, `${loserName} verliert die 2. Hälfte – Finale gegen ${firstLoserP.name}!`);
    match.stage = "finale";
    resetChips(state, [firstLoser, loserId]);
    startRound(state, firstLoser, now);
}

function finishMatch(state, loserId, text) {
    state.phase = "finished";
    state.result = { loserId, loserName: loserId ? nameOf(state, loserId) : null, text };
    if (state.round) {
        state.round.turnEndsAt = null;
        state.round.botNextAt = null;
    }
    state.nextRoundAt = null;
    addLog(state, text);
}

function startMatch(state, now) {
    const humans = state.members.slice(0, MAX_PARTICIPANTS);
    const botCount = Math.min(state.settings.bots, MAX_PARTICIPANTS - humans.length);
    if (humans.length + botCount < 2) {
        throw new Error("Schocken braucht mindestens 2 Teilnehmer – füge Bots hinzu.");
    }

    const botNames = pickBotNames(botCount, humans.map(h => h.name));
    state.participants = [
        ...humans.map(m => ({ id: m.id, name: m.name, bot: false, chips: 0, marker: false, left: false })),
        ...Array.from({ length: botCount }, (_, i) => ({
            id: `bot-${i + 1}`, name: botNames[i], bot: true, chips: 0, marker: false, left: false
        }))
    ];
    state.phase = "playing";
    state.match = { stage: "half1", pot: TOTAL_CHIPS, halfLosers: [], active: state.participants.map(p => p.id) };
    state.result = null;
    state.reveal = null;
    state.round = null;
    state.log = [];
    state.matchNumber++;

    // Laden: Startspieler zufällig, jeder würfelt genau einmal.
    const starter = state.participants[Math.floor(Math.random() * state.participants.length)].id;
    addLog(state, `Partie ${state.matchNumber}: Es wird geladen – jeder würfelt einmal.`);
    startRound(state, starter, now, true);
}

// ===========================================================================
// Spielerzüge (gemeinsam für Menschen, Bots und Timer)
// ===========================================================================

function doRoll(state, id, asideIndices, now) {
    const round = state.round;
    const turn = round.turns[id];
    const limit = throwLimit(round);

    if (turn.throws >= limit) {
        throw new Error(round.laden ? "Beim Laden wird nur einmal gewürfelt." : `Mehr als ${limit} ${limit === 1 ? "Wurf ist" : "Würfe sind"} in dieser Runde nicht erlaubt.`);
    }

    const indices = [...new Set(asideIndices ?? [])];
    if (indices.length > 0 && turn.throws === 0) {
        throw new Error("Vor dem ersten Wurf kann nichts herausgelegt werden.");
    }
    if (indices.length > 0 && !turn.open) {
        throw new Error("Zum Herauslegen musst du erst aufdecken.");
    }
    for (const index of indices) {
        if (!Number.isInteger(index) || index < 0 || index > 2) throw new Error("Ungültiger Würfel.");
        if (turn.aside[index]) throw new Error("Dieser Würfel liegt schon draußen.");
        if (turn.dice[index] !== 1) throw new Error("Nur Einsen dürfen herausgelegt werden.");
    }
    const remaining = turn.aside.filter((aside, i) => !aside && !indices.includes(i)).length;
    if (remaining === 0) throw new Error("Mindestens ein Würfel muss im Becher bleiben.");

    for (const index of indices) turn.aside[index] = true;
    rollOpenDice(turn);
    if (getParticipant(state, id) && !getParticipant(state, id).bot) {
        round.turnEndsAt = now + TURN_MS; // jede Aktion gibt wieder volle Zeit
    }
}

function doTurnSixes(state, id) {
    const round = state.round;
    const turn = round.turns[id];
    if (!canTurnSixes(round, turn)) {
        throw new Error(turn && turn.throws > 0 && !turn.open
            ? "Zum Sechsen drehen musst du erst aufdecken."
            : "Sechsen drehen geht nur bei mindestens zwei Sechsen und nicht im letzten Wurf.");
    }
    const sixIndices = [0, 1, 2].filter(i => !turn.aside[i] && turn.dice[i] === 6);
    const toTurn = sixIndices.length >= 3 ? 2 : 1; // 2 Sechsen → 1 Eins, 3 Sechsen → 2 Einsen
    for (let k = 0; k < toTurn; k++) {
        turn.dice[sixIndices[k]] = 1;
        turn.aside[sixIndices[k]] = true;
    }
    turn.turned = true;
    turn.mustRoll = true;
    turn.hand = false;
    turn.result = classify(turn.dice, false);
    addLog(state, `${nameOf(state, id)} dreht ${toTurn === 1 ? "zwei Sechsen zu einer Eins" : "drei Sechsen zu zwei Einsen"}.`);
}

/** Unter den Becher schauen: Die Würfel sind ab jetzt für ALLE sichtbar. */
function doLook(state, id) {
    const turn = state.round.turns[id];
    if (turn.throws === 0) throw new Error("Erst würfeln.");
    if (turn.open) throw new Error("Dein Becher ist schon aufgedeckt.");
    turn.open = true;
    addLog(state, `${nameOf(state, id)} deckt auf: ${turn.result.label}.`);
}

function doFinish(state, id, now) {
    const turn = state.round.turns[id];
    if (turn.throws === 0) throw new Error("Erst würfeln.");
    if (turn.mustRoll) throw new Error("Nach dem Drehen muss noch einmal gewürfelt werden.");
    finishTurn(state, id, now);
}

/** Zugtimer abgelaufen: Zug sinnvoll automatisch beenden. */
function autoFinish(state, id, now) {
    const round = state.round;
    const turn = round.turns[id];
    if (turn.throws === 0 || (turn.mustRoll && turn.throws < throwLimit(round))) {
        rollOpenDice(turn);
    }
    turn.mustRoll = false;
    addLog(state, `${nameOf(state, id)}: Zeit abgelaufen.`);
    finishTurn(state, id, now);
}

// ===========================================================================
// Bots
// ===========================================================================

/**
 * Ein Bot-Schritt. Bots nutzen nur Informationen, die auch Menschen sehen:
 * ihre aufgedeckten Würfel sowie aufgedeckte Würfe der Mitspieler.
 */
function botStep(state, id, now) {
    const round = state.round;
    const turn = round.turns[id];
    const limit = throwLimit(round);
    const isFirst = round.turnIndex === 0;

    if (turn.throws === 0 || turn.mustRoll) {
        doRoll(state, id, [], now);
        return;
    }
    if (!turn.open) {
        // Ab und zu spielt ein Bot als Erster blind: ein Wurf, Becher zu.
        if (isFirst && turn.throws === 1 && Math.random() < BOT_BLIND_CHANCE) {
            addLog(state, `${nameOf(state, id)} spielt blind!`);
            finishTurn(state, id, now);
        } else {
            doLook(state, id);
        }
        return;
    }
    if (canTurnSixes(round, turn)) {
        doTurnSixes(state, id);
        return;
    }

    const result = turn.result;
    if (turn.throws >= limit || shouldBotStop(state, id, result, isFirst)) {
        finishTurn(state, id, now);
        return;
    }

    // Einsen herauslegen (für einen Schock), sonst alle neu würfeln.
    const ones = [0, 1, 2].filter(i => !turn.aside[i] && turn.dice[i] === 1);
    const openCount = turn.aside.filter(a => !a).length;
    const aside = ones.length < openCount ? ones : ones.slice(0, openCount - 1);
    doRoll(state, id, aside, now);
}

function shouldBotStop(state, id, result, isFirst) {
    if (result.kind !== "zahlen") return true;
    if (isFirst) return false;
    // Ist ein aufgedeckter Wurf eines Mitspielers schlechter? Dann reicht es.
    const round = state.round;
    return round.order.some(otherId => {
        if (otherId === id) return false;
        const other = round.turns[otherId];
        return other.done && other.open && other.result && other.result.rank < result.rank;
    });
}

// ===========================================================================
// Aktionen
// ===========================================================================

function requireHost(player, context) {
    if (!context || player.id !== context.hostId) {
        throw new Error("Das darf nur der Host der Lobby.");
    }
}

function requireMyTurn(state, player) {
    if (state.phase !== "playing") throw new Error("Es läuft gerade keine Partie.");
    if (!state.round || state.round.stage !== "turns") throw new Error("Die Runde wird gerade ausgewertet.");
    if (currentId(state) !== player.id) throw new Error("Du bist nicht an der Reihe.");
}

const actions = {
    settings(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "setup") throw new Error("Einstellungen sind nur vor der Partie möglich.");
        if (action.bots !== undefined) {
            const bots = Number(action.bots);
            if (!Number.isInteger(bots) || bots < 0 || bots > MAX_BOTS) {
                throw new Error(`Es sind 0 bis ${MAX_BOTS} Bots möglich.`);
            }
            state.settings.bots = bots;
        }
        if (action.mode !== undefined) {
            if (!MODES.includes(action.mode)) throw new Error("Unbekannter Spielmodus.");
            state.settings.mode = action.mode;
        }
    },

    start(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "setup") throw new Error("Die Partie läuft bereits.");
        startMatch(state, context.now ?? Date.now());
    },

    roll(state, action, player, context) {
        requireMyTurn(state, player);
        const aside = Array.isArray(action.aside) ? action.aside.map(Number) : [];
        doRoll(state, player.id, aside, context?.now ?? Date.now());
    },

    look(state, action, player) {
        requireMyTurn(state, player);
        doLook(state, player.id);
    },

    "turn-sixes"(state, action, player) {
        requireMyTurn(state, player);
        doTurnSixes(state, player.id);
    },

    finish(state, action, player, context) {
        requireMyTurn(state, player);
        doFinish(state, player.id, context?.now ?? Date.now());
    },

    /** "Weiter" während der Auswertung. Ab 75 % der Spieler geht es sofort weiter. */
    continue(state, action, player, context) {
        if (state.phase !== "playing" || state.round?.stage !== "reveal" || !state.reveal) {
            return false; // Auswertung schon vorbei (z. B. Doppelklick) → still ignorieren
        }
        if (!humanParticipants(state).some(p => p.id === player.id)) {
            throw new Error("Nur Mitspieler können weiterklicken.");
        }
        if (state.reveal.acks.includes(player.id)) return false;
        state.reveal.acks.push(player.id);
        checkAcks(state, context?.now ?? Date.now());
    },

    "new-match"(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "finished") throw new Error("Die Partie läuft noch.");
        state.phase = "setup";
        state.participants = [];
        state.match = null;
        state.round = null;
        state.reveal = null;
        state.result = null;
        state.log = [];
    }
};

// ===========================================================================
// Sicht eines Spielers (viewFor)
// ===========================================================================

/**
 * Entfernt alle Würfel unter einem geschlossenen Becher – auch für den
 * Besitzer selbst (er hat ja nicht nachgesehen). Herausgelegte Einsen und
 * aufgedeckte Würfe sind öffentlich. Bei der Auswertung ist alles sichtbar.
 * userId wird bewusst nicht gebraucht: Alle sehen dasselbe, nur eben nicht
 * mehr, als auf dem Tisch liegt.
 */
function viewFor(state, userId) {
    const round = state.round;
    if (!round) return state;

    const now = Date.now();
    const view = {
        ...state,
        nextRoundAt: undefined,
        revealRemainingMs: state.nextRoundAt ? Math.max(0, state.nextRoundAt - now) : null,
        round: {
            ...round,
            turnRemainingMs: round.turnEndsAt ? Math.max(0, round.turnEndsAt - now) : null,
            turnEndsAt: undefined,
            botNextAt: undefined
        }
    };
    if (round.stage === "reveal") return view; // Auswertung: alles aufgedeckt

    const turns = {};
    for (const [id, turn] of Object.entries(round.turns)) {
        turns[id] = turn.open || turn.throws === 0 ? turn : {
            ...turn,
            dice: turn.dice.map((value, i) => (turn.aside[i] ? value : 0)),
            result: null,
            hand: false
        };
    }
    view.round.turns = turns;
    return view;
}

// ===========================================================================
// Schnittstelle zum Lobby-System
// ===========================================================================

module.exports = {
    meta: {
        id: "schocken",
        name: "Schocken",
        description: "Das klassische Kneipen-Würfelspiel mit Schock Aus, General und Straße. Bis zu drei Würfe pro Runde – wer am schlechtesten würfelt, kassiert Deckel. Auch mit Bots spielbar.",
        minPlayers: 1,
        maxPlayers: MAX_PARTICIPANTS,
        tickMs: 250
    },

    createState({ players }) {
        return {
            phase: "setup",
            matchNumber: 0,
            members: players.map(({ id, name }) => ({ id, name })),
            participants: [],
            settings: { bots: DEFAULT_BOTS, maxBots: MAX_BOTS, mode: "full" },
            match: null,
            round: null,
            reveal: null,
            result: null,
            nextRoundAt: null,
            nextStarterId: null,
            totalChips: TOTAL_CHIPS,
            turnMs: TURN_MS,
            revealMs: REVEAL_MS,
            log: []
        };
    },

    handleAction(state, action, player, context) {
        const handler = Object.hasOwn(actions, action.type) ? actions[action.type] : null;
        if (!handler) throw new Error("Unbekannte Aktion.");
        const next = structuredClone(state);
        const result = handler(next, action, player, context);
        return result === false ? undefined : next;
    },

    tick(state, { now }) {
        if (state.phase !== "playing" || !state.round) return undefined;
        const round = state.round;

        if (round.stage === "reveal") {
            if (state.nextRoundAt && now >= state.nextRoundAt) {
                const next = structuredClone(state);
                continueAfterReveal(next, now);
                return next;
            }
            return undefined;
        }

        const id = currentId(state);
        if (!id) return undefined;
        const participant = getParticipant(state, id);

        if (participant.bot) {
            if (round.botNextAt && now >= round.botNextAt) {
                const next = structuredClone(state);
                botStep(next, id, now);
                if (next.round.stage === "turns" && currentId(next) === id) {
                    next.round.botNextAt = now + BOT_STEP_MS;
                }
                return next;
            }
            return undefined;
        }

        if (round.turnEndsAt && now >= round.turnEndsAt) {
            const next = structuredClone(state);
            autoFinish(next, id, now);
            return next;
        }
        return undefined;
    },

    viewFor,

    onPlayerJoin(state, player) {
        const next = structuredClone(state);
        const existing = next.participants.find(p => p.id === player.id);
        if (!next.members.some(m => m.id === player.id)) {
            next.members.push({ id: player.id, name: player.name });
        }
        if (existing) existing.name = player.name;
        return next;
    },

    onPlayerLeave(state, player) {
        const next = structuredClone(state);
        next.members = next.members.filter(m => m.id !== player.id);

        const participant = next.participants.find(p => p.id === player.id);
        if (!participant || participant.left || next.phase !== "playing") return next;

        participant.left = true;
        next.match.pot += participant.chips;
        participant.chips = 0;
        addLog(next, `${participant.name} hat das Spiel verlassen – seine Deckel gehen in den Topf.`);

        const humansLeft = activeParticipants(next).some(p => !p.bot);
        if (activeParticipants(next).length < 2 || !humansLeft) {
            finishMatch(next, null, "Zu wenige Spieler – Partie beendet.");
            return next;
        }

        const round = next.round;
        if (round && round.stage === "turns") {
            const index = round.order.indexOf(player.id);
            if (index !== -1) {
                const wasCurrent = index === round.turnIndex;
                round.order.splice(index, 1);
                delete round.turns[player.id];
                if (index < round.turnIndex) round.turnIndex--;
                if (wasCurrent || round.turnIndex >= round.order.length) {
                    advanceTurn(next, Date.now());
                }
            }
        }
        if (next.nextStarterId === player.id) next.nextStarterId = null;
        checkAcks(next, Date.now()); // evtl. reichen die "Weiter"-Klicks der Verbleibenden
        return next;
    },

    // Für Tests
    _internals: { classify, compareEntries, setRandom, ackThreshold, TOTAL_CHIPS, TURN_MS, BOT_STEP_MS, REVEAL_MS, canTurnSixes, throwLimit }
};
