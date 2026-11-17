/**
 * Kommunikation mit dem Server.
 *
 *  - api.*            → Aktionen per fetch (POST/GET /api/...)
 *  - openEventStream  → Echtzeit-Updates per EventSource (GET /events)
 *  - Token-Verwaltung → das Sitzungs-Token wird im localStorage gespeichert,
 *                       damit man nach einem Reload angemeldet bleibt.
 */

const TOKEN_STORAGE_KEY = "afterworkArcade.token";

/** Fallback, falls localStorage nicht verfügbar ist (z. B. privater Modus). */
let memoryToken = null;

/** Fehler einer API-Anfrage mit HTTP-Status und optionalem Fehlercode. */
export class ApiError extends Error {
    constructor(message, status, code) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.code = code;
    }
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

export function getToken() {
    try {
        return localStorage.getItem(TOKEN_STORAGE_KEY) ?? memoryToken;
    } catch {
        return memoryToken;
    }
}

export function setToken(token) {
    memoryToken = token;
    try {
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } catch {
        // localStorage nicht verfügbar – memoryToken reicht für diese Seite
    }
}

export function clearToken() {
    memoryToken = null;
    try {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
        // ignorieren
    }
}

// ---------------------------------------------------------------------------
// HTTP-Anfragen
// ---------------------------------------------------------------------------

/**
 * Schickt eine Anfrage an die API und gibt die JSON-Antwort zurück.
 * @throws {ApiError} wenn der Server einen Fehler meldet oder nicht erreichbar ist
 */
async function request(method, path, body) {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response;
    try {
        response = await fetch(path, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    } catch {
        throw new ApiError("Server nicht erreichbar.", 0);
    }

    let data = {};
    try {
        data = await response.json();
    } catch {
        // keine JSON-Antwort – data bleibt leer
    }

    if (!response.ok || data.ok === false) {
        throw new ApiError(data.error || `Fehler ${response.status}`, response.status, data.code);
    }
    return data;
}

/** Alle API-Aufrufe an einer Stelle. */
export const api = {
    info: () => request("GET", "/api/info"),
    listGames: () => request("GET", "/api/games"),
    login: name => request("POST", "/api/login", { name }),
    me: () => request("GET", "/api/me"),
    logout: () => request("POST", "/api/logout", {}),

    createLobby: options => request("POST", "/api/lobby/create", options),
    joinLobby: options => request("POST", "/api/lobby/join", options),
    leaveLobby: () => request("POST", "/api/lobby/leave", {}),

    sendChat: (scope, text) => request("POST", "/api/chat/send", { scope, text }),

    selectGame: gameId => request("POST", "/api/game/select", { gameId }),
    endGame: () => request("POST", "/api/game/end", {}),
    gameAction: action => request("POST", "/api/game/action", { action })
};

// ---------------------------------------------------------------------------
// Echtzeit-Stream
// ---------------------------------------------------------------------------

/** Event-Typen, die der Server schickt (siehe server/sync.js). */
const EVENT_TYPES = ["online-users", "lobbies", "lobby", "chat", "chat-history", "game-state"];

/**
 * Öffnet die Echtzeit-Verbindung zum Server.
 *
 * @param {Record<string, (data: any) => void>} handlers  Handler je Event-Typ
 * @param {(status: "open"|"reconnecting"|"closed") => void} onStatusChange
 * @returns {EventSource}
 */
export function openEventStream(handlers, onStatusChange) {
    const token = encodeURIComponent(getToken() ?? "");
    const source = new EventSource(`/events?token=${token}`);

    for (const type of EVENT_TYPES) {
        source.addEventListener(type, event => {
            const handler = handlers[type];
            if (handler) handler(JSON.parse(event.data));
        });
    }

    source.onopen = () => onStatusChange("open");

    // Bei Netzwerkfehlern verbindet sich der Browser selbst neu ("reconnecting").
    // Antwortet der Server mit einem Fehler (z. B. 401), gibt er auf ("closed").
    source.onerror = () => {
        onStatusChange(source.readyState === EventSource.CLOSED ? "closed" : "reconnecting");
    };

    return source;
}
