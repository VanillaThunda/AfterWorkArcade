"use strict";

/**
 * User-Verwaltung.
 *
 * Ein "User" ist eine angemeldete Browser-Sitzung mit frei gewähltem
 * Usernamen. Es gibt keine Accounts und keine Passwörter – die Anmeldung gilt,
 * solange der Server läuft und der Browser verbunden ist.
 *
 * Jeder User erhält ein geheimes Token. Der Browser schickt es bei jeder
 * Anfrage mit; so weiß der Server, wer eine Aktion ausführt.
 */

const crypto = require("crypto");
const config = require("./config");
const { HttpError } = require("./http-utils");

/**
 * @typedef {object} User
 * @property {string} id            Öffentliche ID (für andere Clients sichtbar)
 * @property {string} name          Username
 * @property {string} token         Geheimes Sitzungs-Token (nur der eigene Browser kennt es)
 * @property {string|null} lobbyId  ID der aktuellen Lobby oder null
 * @property {NodeJS.Timeout|null} removalTimer  Timer für das automatische Abmelden
 */

/** @type {Map<string, User>} userId → User */
const usersById = new Map();

/** @type {Map<string, string>} token → userId (schneller Zugriff beim Authentifizieren) */
const userIdsByToken = new Map();

/** Erlaubt Buchstaben (inkl. Umlaute), Ziffern, Leerzeichen sowie _ . - */
const USERNAME_PATTERN = /^[\p{L}\p{N} _.-]+$/u;

/** Entfernt Leerzeichen am Rand und fasst mehrfache Leerzeichen zusammen. */
function normalizeName(rawName) {
    return String(rawName ?? "").trim().replace(/\s+/g, " ");
}

/** Prüft, ob ein Username bereits vergeben ist (Groß-/Kleinschreibung egal). */
function isNameTaken(name) {
    const wanted = name.toLocaleLowerCase("de");
    for (const user of usersById.values()) {
        if (user.name.toLocaleLowerCase("de") === wanted) return true;
    }
    return false;
}

/**
 * Legt einen neuen User an.
 * @throws {HttpError} bei ungültigem oder bereits vergebenem Namen
 * @returns {User}
 */
function createUser(rawName) {
    const name = normalizeName(rawName);
    const { USERNAME_MIN_LENGTH: min, USERNAME_MAX_LENGTH: max } = config;

    if (name.length < min || name.length > max) {
        throw new HttpError(400, `Der Username muss zwischen ${min} und ${max} Zeichen lang sein.`);
    }
    if (!USERNAME_PATTERN.test(name)) {
        throw new HttpError(400, "Erlaubt sind Buchstaben, Ziffern, Leerzeichen sowie _ . -");
    }
    if (isNameTaken(name)) {
        throw new HttpError(409, "Dieser Username ist bereits vergeben.");
    }

    const user = {
        id: crypto.randomUUID(),
        name,
        token: crypto.randomBytes(24).toString("hex"),
        lobbyId: null,
        removalTimer: null
    };

    usersById.set(user.id, user);
    userIdsByToken.set(user.token, user.id);
    return user;
}

/** @returns {User|null} */
function getById(userId) {
    return usersById.get(userId) ?? null;
}

/** @returns {User|null} */
function getByToken(token) {
    if (!token) return null;
    const userId = userIdsByToken.get(token);
    return userId ? getById(userId) : null;
}

/** Entfernt einen User endgültig. */
function removeUser(userId) {
    const user = usersById.get(userId);
    if (!user) return;

    clearTimeout(user.removalTimer);
    usersById.delete(userId);
    userIdsByToken.delete(user.token);
}

/**
 * Plant das automatische Abmelden eines Users nach `delayMs`.
 * Wird z. B. aufgerufen, wenn die Echtzeit-Verbindung abbricht.
 *
 * @param {string} userId
 * @param {number} delayMs
 * @param {(user: User) => void} onExpire  Räumt den User auf (Lobby verlassen, entfernen …)
 */
function scheduleRemoval(userId, delayMs, onExpire) {
    const user = usersById.get(userId);
    if (!user) return;

    clearTimeout(user.removalTimer);
    user.removalTimer = setTimeout(() => {
        user.removalTimer = null;
        onExpire(user);
    }, delayMs);
}

/** Bricht ein geplantes Abmelden ab (der User hat sich wieder verbunden). */
function cancelRemoval(userId) {
    const user = usersById.get(userId);
    if (!user) return;

    clearTimeout(user.removalTimer);
    user.removalTimer = null;
}

/** Öffentliche Darstellung eines Users – ohne Token! */
function toPublicUser(user) {
    return { id: user.id, name: user.name };
}

/** Alle angemeldeten User, alphabetisch sortiert. */
function listUsers() {
    return [...usersById.values()]
        .map(toPublicUser)
        .sort((a, b) => a.name.localeCompare(b.name, "de"));
}

module.exports = {
    createUser,
    getById,
    getByToken,
    removeUser,
    scheduleRemoval,
    cancelRemoval,
    toPublicUser,
    listUsers
};
