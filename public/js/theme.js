/**
 * Hell/Dunkel-Schalter.
 *
 * Das Design steht im Attribut data-theme am <html>-Element ("light"/"dark").
 * Den Startwert setzt bereits ein kleines Inline-Script in index.html (gespeicherte
 * Wahl, sonst Systemeinstellung), damit beim Laden nichts hell aufblitzt.
 *
 * Spiele passen ihre Farben per CSS an (:root[data-theme="dark"] …). Wer per
 * Canvas zeichnet, kann auf das Event "awa-themechange" am document hören.
 */

const STORAGE_KEY = "awa-theme";

/** Aktuelles Design: "dark" oder "light". */
export function getTheme() {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme, button) {
    document.documentElement.dataset.theme = theme;
    const dark = theme === "dark";
    if (button) {
        const label = dark ? "Helles Design" : "Dunkles Design";
        button.textContent = dark ? "☀️" : "🌙";
        button.title = label;
        button.setAttribute("aria-label", label);
        button.setAttribute("aria-pressed", String(dark));
    }
    document.dispatchEvent(new CustomEvent("awa-themechange", { detail: { theme } }));
}

/** Verbindet den Button #theme-toggle mit dem Design. */
export function initThemeToggle() {
    const button = document.getElementById("theme-toggle");
    applyTheme(getTheme(), button);
    if (!button) return;

    button.addEventListener("click", () => {
        const next = getTheme() === "dark" ? "light" : "dark";
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // localStorage nicht verfügbar – gilt dann nur bis zum Neuladen
        }
        applyTheme(next, button);
    });
}
