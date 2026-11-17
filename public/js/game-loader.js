/**
 * GameHost: lädt den Client-Teil eines Spiels und bindet ihn in die Lobby ein.
 *
 * Jedes Spiel liefert unter /games/<id>/client.js ein ES-Modul mit:
 *   export const stylesheets = ["style.css"];      (optional)
 *   export function mount(container, ctx) { … return { update(state), destroy() }; }
 *
 * Der GameHost kümmert sich um
 *  - das Nachladen per dynamic import(),
 *  - das Laden und Entfernen der Spiel-Stylesheets,
 *  - das Zwischenspeichern eines Zustands, der ankommt, bevor das Spiel
 *    fertig geladen ist,
 *  - das Aufräumen (destroy), wenn das Spiel beendet oder gewechselt wird.
 */
export class GameHost {
    /**
     * @param {HTMLElement} container  Bereich, in den das Spiel zeichnet
     * @param {(gameId: string) => object} createContext  liefert das ctx-Objekt für mount()
     */
    constructor(container, createContext) {
        this.container = container;
        this.createContext = createContext;

        this.gameId = null;            // aktuell angezeigtes Spiel
        this.instance = null;          // Rückgabe von mount()
        this.pendingState = undefined; // Zustand, der vor dem Laden ankam
        this.loadCounter = 0;          // erkennt veraltete Ladevorgänge
        this.stylesheetLinks = [];
    }

    /** Zeigt das angegebene Spiel an (lädt es bei Bedarf). */
    async show(gameId) {
        if (this.gameId === gameId) return; // läuft bereits

        this.clear();
        this.gameId = gameId;
        const loadId = ++this.loadCounter;
        this.container.textContent = "Spiel wird geladen …";

        try {
            const module = await import(`/games/${encodeURIComponent(gameId)}/client.js`);

            // Wurde inzwischen ein anderes Spiel gewählt oder beendet? Dann abbrechen.
            if (loadId !== this.loadCounter) return;

            this.addStylesheets(gameId, module.stylesheets ?? []);
            this.container.replaceChildren();
            this.instance = module.mount(this.container, this.createContext(gameId));

            if (this.pendingState !== undefined) {
                this.instance.update(this.pendingState);
                this.pendingState = undefined;
            }
        } catch (err) {
            console.error("Spiel konnte nicht geladen werden:", err);
            if (loadId === this.loadCounter) {
                this.container.textContent = "Das Spiel konnte nicht geladen werden.";
            }
        }
    }

    /** Übergibt einen neuen Zustand vom Server an das Spiel. */
    setState(data) {
        if (!data || data.gameId !== this.gameId) return;

        if (this.instance) {
            this.instance.update(data.state);
        } else {
            this.pendingState = data.state; // Spiel lädt noch
        }
    }

    /** Entfernt das aktuelle Spiel vollständig. */
    clear() {
        this.loadCounter++;

        if (this.instance) {
            try {
                this.instance.destroy?.();
            } catch (err) {
                console.error("Fehler beim Beenden des Spiels:", err);
            }
        }

        for (const link of this.stylesheetLinks) link.remove();
        this.stylesheetLinks = [];
        this.instance = null;
        this.gameId = null;
        this.pendingState = undefined;
        this.container.replaceChildren();
    }

    addStylesheets(gameId, files) {
        for (const file of files) {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = `/games/${encodeURIComponent(gameId)}/${file}`;
            document.head.append(link);
            this.stylesheetLinks.push(link);
        }
    }
}
