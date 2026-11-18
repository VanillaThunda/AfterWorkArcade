/**
 * Spielmodus: Sobald in der Lobby ein Spiel läuft, werden die Lobby-Elemente
 * an die Seitenränder "angedockt" (Layout per CSS, Klasse .game-mode auf .layout):
 *  - links:  Lobby-Kopf, Mitglieder, Einladen
 *  - rechts: Lobby-Chat, Online-Liste, globaler Chat
 *
 * Dieses Modul kümmert sich um
 *  - das Ein-/Ausschalten des Spielmodus,
 *  - das Einklappen der Leisten (Dock-Schalter) und einzelner Bereiche
 *    (Online-Liste, globaler Chat),
 *  - Hinweis-Punkte für ungelesene Chat-Nachrichten in eingeklappten Bereichen.
 *
 * Der Einklapp-Zustand wird pro Browser im localStorage gemerkt.
 */

const STORAGE_KEY = "awa-dock";

/** Standard: Leisten offen, Online-Liste und globaler Chat eingeklappt. */
const DEFAULTS = { left: false, right: false, online: true, global: true };

/** Ab dieser Breite wird angedockt (muss zur Media-Query in style.css passen). */
const desktopQuery = matchMedia("(min-width: 901px)");

const DOCK_LABELS = {
    left: { expanded: "« Lobby", collapsed: "Lobby »" },
    right: { expanded: "Chats »", collapsed: "« Chats" }
};

function loadSettings() {
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
        return { ...DEFAULTS, ...stored };
    } catch {
        return { ...DEFAULTS };
    }
}

function saveSettings(settings) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
        // Nicht kritisch (z. B. privater Modus) – Zustand gilt dann nur bis zum Reload.
    }
}

export function createDock() {
    const layout = document.querySelector(".layout");
    const dockToggles = {
        left: layout.querySelector('.dock-toggle[data-dock="left"]'),
        right: layout.querySelector('.dock-toggle[data-dock="right"]')
    };
    const sections = {
        online: document.getElementById("online-card"),
        global: document.getElementById("global-chat-card")
    };
    const settings = loadSettings();

    const isActive = () => layout.classList.contains("game-mode");
    const badgeOf = element => element.querySelector(".dock-badge");

    function applyDock(side) {
        const collapsed = settings[side];
        layout.classList.toggle(`dock-${side}-collapsed`, collapsed);
        const toggle = dockToggles[side];
        toggle.setAttribute("aria-expanded", String(!collapsed));
        toggle.title = collapsed ? "Leiste ausklappen" : "Leiste einklappen";
        toggle.querySelector(".dock-label").textContent = DOCK_LABELS[side][collapsed ? "collapsed" : "expanded"];
        if (!collapsed) badgeOf(toggle).hidden = true;
    }

    function applySection(name) {
        const collapsed = settings[name];
        const card = sections[name];
        card.classList.toggle("is-collapsed", collapsed);
        card.querySelector(".section-toggle").setAttribute("aria-expanded", String(!collapsed || !isActive()));
        if (!collapsed) badgeOf(card).hidden = true;
    }

    function applyAll() {
        applyDock("left");
        applyDock("right");
        applySection("online");
        applySection("global");
    }

    // --- Event-Listener -----------------------------------------------------
    for (const [side, toggle] of Object.entries(dockToggles)) {
        toggle.addEventListener("click", () => {
            settings[side] = !settings[side];
            saveSettings(settings);
            applyDock(side);
        });
    }

    for (const [name, card] of Object.entries(sections)) {
        card.querySelector(".section-toggle").addEventListener("click", () => {
            if (!isActive()) return; // außerhalb des Spielmodus ist alles ausgeklappt
            settings[name] = !settings[name];
            saveSettings(settings);
            applySection(name);
        });
    }

    applyAll();

    return {
        /** Schaltet den Spielmodus ein (Spiel läuft) oder aus. */
        setGameMode(active) {
            if (active === isActive()) return;
            layout.classList.toggle("game-mode", active);
            if (!active) {
                for (const badge of layout.querySelectorAll(".dock-badge")) badge.hidden = true;
            }
            applyAll();
        },

        /**
         * Neue Chat-Nachricht: Ist der betroffene Bereich im Spielmodus
         * eingeklappt, wird ein Hinweis-Punkt angezeigt.
         * @param {"global"|"lobby"} scope
         */
        notifyUnread(scope) {
            if (!isActive()) return;

            if (desktopQuery.matches && settings.right) {
                badgeOf(dockToggles.right).hidden = false;
            }
            if (scope === "global" && settings.global) {
                badgeOf(sections.global).hidden = false;
            }
        }
    };
}
