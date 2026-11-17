/**
 * Kleine, wiederverwendbare UI-Helfer:
 *  - showToast:            kurzer Hinweis unten rechts
 *  - askPassword:          Passwort-Dialog (Promise-basiert)
 *  - setConnectionStatus:  Punkt in der Kopfzeile (grün/gelb/rot)
 *  - formatTime:           Uhrzeit für Chat-Nachrichten
 */

const TOAST_DURATION_MS = 4000;

/**
 * Zeigt einen kurzen Hinweis an.
 * @param {string} message
 * @param {"info"|"error"} [type]
 */
export function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.append(toast);

    setTimeout(() => toast.remove(), TOAST_DURATION_MS);
}

/**
 * Öffnet den Passwort-Dialog.
 * @returns {Promise<string|null>} eingegebenes Passwort oder null bei Abbruch
 */
export function askPassword() {
    const dialog = document.getElementById("password-dialog");
    const input = document.getElementById("password-dialog-input");

    input.value = "";
    dialog.returnValue = "";

    return new Promise(resolve => {
        dialog.addEventListener("close", () => {
            resolve(dialog.returnValue === "ok" ? input.value : null);
        }, { once: true });

        dialog.showModal();
        input.focus();
    });
}

const CONNECTION_LABELS = {
    open: "Verbunden",
    reconnecting: "Verbindung wird wiederhergestellt …",
    closed: "Getrennt"
};

/** Aktualisiert die Verbindungsanzeige in der Kopfzeile. */
export function setConnectionStatus(status) {
    const indicator = document.getElementById("connection-status");
    indicator.dataset.status = status;
    indicator.title = CONNECTION_LABELS[status] ?? status;
}

/** Formatiert einen Zeitstempel als "HH:MM". */
export function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
