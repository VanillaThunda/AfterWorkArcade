"use strict";

/**
 * Lobby-Verwaltung.
 *
 * Eine Lobby ist ein Raum, in dem sich mehrere User treffen, chatten und
 * gemeinsam ein Spiel/Tool nutzen. Regeln:
 *  - Jeder User ist in höchstens einer Lobby.
 *  - Der Ersteller ist Host. Verlässt der Host die Lobby, wird das am
 *    längsten anwesende Mitglied neuer Host.
 *  - Eine leere Lobby wird automatisch gelöscht.
 *  - "public"  = in der Lobby-Übersicht sichtbar
 *    "private" = unsichtbar, Beitritt nur über den Lobby-Code / Einladungslink
 *  - Ein Passwort ist für beide Varianten optional.
 */

const crypto = require("crypto");
const config = require("./config");
const { HttpError } = require("./http-utils");
const users = require("./users");
const gameRegistry = require("./game-registry");

const VISIBILITY = Object.freeze({
    PUBLIC: "public",
    PRIVATE: "private"
});

/** Zeichen für Lobby-Codes – ohne leicht verwechselbare Zeichen wie 0/O und 1/I. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * @typedef {object} Lobby
 * @property {string} id
 * @property {string} code                 Kurzer Beitritts-Code, z. B. "K7MX2P"
 * @property {string} name
 * @property {"public"|"private"} visibility
 * @property {{salt: Buffer, hash: Buffer}|null} password  Passwort-Hash oder null
 * @property {string} hostId
 * @property {string[]} memberIds          In Beitrittsreihenfolge
 * @property {{id: string, state: any}|null} game  Aktives Spiel und dessen Zustand
 * @property {number} createdAt
 */

/** @type {Map<string, Lobby>} */
const lobbies = new Map();

// ---------------------------------------------------------------------------
// Passwörter
// ---------------------------------------------------------------------------

/**
 * Passwörter werden nie im Klartext gespeichert, sondern mit scrypt
 * und zufälligem Salt gehasht.
 */
function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 32);
    return { salt, hash };
}

/** Prüft ein Passwort. Lobbys ohne Passwort akzeptieren immer. */
function verifyPassword(lobby, password) {
    if (!lobby.password) return true;
    if (typeof password !== "string") return false;

    const hash = crypto.scryptSync(password, lobby.password.salt, 32);
    // timingSafeEqual verhindert, dass man über die Antwortzeit Rückschlüsse ziehen kann.
    return crypto.timingSafeEqual(hash, lobby.password.hash);
}

// ---------------------------------------------------------------------------
// Erstellen und Finden
// ---------------------------------------------------------------------------

/** Erzeugt einen Lobby-Code, der aktuell noch nicht verwendet wird. */
function generateUniqueCode() {
    let code;
    do {
        code = Array.from(
            { length: config.LOBBY_CODE_LENGTH },
            () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]
        ).join("");
    } while (findByCode(code));
    return code;
}

/**
 * Erstellt eine neue Lobby. Der Host wird hier NICHT als Mitglied
 * eingetragen – das übernimmt die API über addMember().
 *
 * @param {{name?: string, visibility?: string, password?: string}} options
 * @param {import("./users").User} host
 * @throws {HttpError} bei ungültigen Angaben
 * @returns {Lobby}
 */
function createLobby(options, host) {
    const name = String(options.name ?? "").trim().replace(/\s+/g, " ") || `Lobby von ${host.name}`;
    const visibility = options.visibility;
    const password = typeof options.password === "string" ? options.password : "";

    if (name.length > config.LOBBY_NAME_MAX_LENGTH) {
        throw new HttpError(400, `Der Lobby-Name darf höchstens ${config.LOBBY_NAME_MAX_LENGTH} Zeichen lang sein.`);
    }
    if (!Object.values(VISIBILITY).includes(visibility)) {
        throw new HttpError(400, "Ungültige Sichtbarkeit.");
    }
    if (password.length > config.LOBBY_PASSWORD_MAX_LENGTH) {
        throw new HttpError(400, `Das Passwort darf höchstens ${config.LOBBY_PASSWORD_MAX_LENGTH} Zeichen lang sein.`);
    }

    const lobby = {
        id: crypto.randomUUID(),
        code: generateUniqueCode(),
        name,
        visibility,
        password: password ? hashPassword(password) : null,
        hostId: host.id,
        memberIds: [],
        game: null,
        createdAt: Date.now()
    };

    lobbies.set(lobby.id, lobby);
    return lobby;
}

/** @returns {Lobby|null} */
function getById(lobbyId) {
    return lobbies.get(lobbyId) ?? null;
}

/** Sucht eine Lobby per Code (Groß-/Kleinschreibung egal). @returns {Lobby|null} */
function findByCode(rawCode) {
    const code = String(rawCode ?? "").trim().toUpperCase();
    if (!code) return null;

    for (const lobby of lobbies.values()) {
        if (lobby.code === code) return lobby;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Mitglieder
// ---------------------------------------------------------------------------

/** Wirft einen Fehler, wenn die Lobby voll ist. */
function assertHasSpace(lobby) {
    if (lobby.memberIds.length >= config.LOBBY_MAX_MEMBERS) {
        throw new HttpError(409, "Die Lobby ist voll.");
    }
}

/** Fügt einen User als Mitglied hinzu. */
function addMember(lobby, user) {
    if (lobby.memberIds.includes(user.id)) return;

    assertHasSpace(lobby);
    lobby.memberIds.push(user.id);
    user.lobbyId = lobby.id;
}

/**
 * Entfernt einen User aus der Lobby.
 *
 * @returns {{deleted: boolean, newHostId: string|null}}
 *          deleted   = die Lobby war danach leer und wurde gelöscht
 *          newHostId = ID des neuen Hosts, falls der Host gewechselt hat
 */
function removeMember(lobby, user) {
    lobby.memberIds = lobby.memberIds.filter(id => id !== user.id);
    if (user.lobbyId === lobby.id) user.lobbyId = null;

    if (lobby.memberIds.length === 0) {
        lobbies.delete(lobby.id);
        return { deleted: true, newHostId: null };
    }

    if (lobby.hostId === user.id) {
        lobby.hostId = lobby.memberIds[0]; // am längsten anwesendes Mitglied
        return { deleted: false, newHostId: lobby.hostId };
    }

    return { deleted: false, newHostId: null };
}

// ---------------------------------------------------------------------------
// Darstellungen für den Client
// ---------------------------------------------------------------------------

/** Name des aktiven Spiels oder null. */
function getGameName(lobby) {
    if (!lobby.game) return null;
    const plugin = gameRegistry.getGame(lobby.game.id);
    return plugin ? plugin.meta.name : lobby.game.id;
}

/** Kurzinfo für die Lobby-Übersicht (nur öffentliche Lobbys). */
function toSummary(lobby) {
    const host = users.getById(lobby.hostId);
    return {
        id: lobby.id,
        name: lobby.name,
        hostName: host ? host.name : "?",
        memberCount: lobby.memberIds.length,
        maxMembers: config.LOBBY_MAX_MEMBERS,
        hasPassword: Boolean(lobby.password),
        gameName: getGameName(lobby)
    };
}

/** Vollständige Infos für die Mitglieder einer Lobby. */
function toDetails(lobby) {
    return {
        id: lobby.id,
        code: lobby.code,
        name: lobby.name,
        visibility: lobby.visibility,
        hasPassword: Boolean(lobby.password),
        hostId: lobby.hostId,
        maxMembers: config.LOBBY_MAX_MEMBERS,
        members: lobby.memberIds
            .map(users.getById)
            .filter(Boolean)
            .map(users.toPublicUser),
        game: lobby.game ? { id: lobby.game.id, name: getGameName(lobby) } : null
    };
}

/** Alle öffentlichen Lobbys, älteste zuerst. */
function listPublicSummaries() {
    return [...lobbies.values()]
        .filter(lobby => lobby.visibility === VISIBILITY.PUBLIC)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(toSummary);
}

module.exports = {
    VISIBILITY,
    createLobby,
    getById,
    findByCode,
    verifyPassword,
    assertHasSpace,
    addMember,
    removeMember,
    toDetails,
    listPublicSummaries
};
