/**
 * VORLAGE für ein neues Spiel/Tool – Client-Teil.
 *
 * Das Lobby-System ruft mount() auf, sobald das Spiel gestartet wird,
 * update(state) bei jeder Zustandsänderung und destroy() beim Beenden.
 *
 * Wichtig: Texte von Spielern immer per textContent einfügen (nicht innerHTML),
 * damit niemand HTML/JavaScript einschleusen kann.
 */

// Optional: CSS-Dateien aus diesem public-Ordner, die automatisch geladen werden.
export const stylesheets = [];

/**
 * @param {HTMLElement} container  Bereich, in den das Spiel zeichnen darf
 * @param {object} ctx
 * @param {{id: string, name: string}} ctx.me  eigener User
 * @param {(action: object) => Promise<boolean>} ctx.sendAction  Aktion an den Server senden
 */
export function mount(container, ctx) {
    const root = document.createElement("div");
    const counter = document.createElement("p");
    const info = document.createElement("p");
    const button = document.createElement("button");

    button.textContent = "Klick!";
    button.addEventListener("click", () => ctx.sendAction({ type: "click" }));

    root.append(counter, info, button);
    container.append(root);

    return {
        /** Neuer Zustand vom Server. */
        update(state) {
            counter.textContent = `Zähler: ${state.count}`;
            info.textContent = state.lastClickedBy
                ? `Zuletzt geklickt von ${state.lastClickedBy}`
                : `Mitspieler: ${state.playerNames.join(", ")}`;
        },

        /** Spiel wird beendet – Aufräumen (Timer stoppen, Listener entfernen …). */
        destroy() {
            root.remove();
        }
    };
}
