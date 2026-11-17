/**
 * Ansicht "Anmeldung": Username eingeben und absenden.
 */

/**
 * @param {object} options
 * @param {(name: string) => Promise<void>} options.onLogin  wirft bei Fehlern
 */
export function createLoginView({ onLogin }) {
    const form = document.getElementById("login-form");
    const input = document.getElementById("login-name");
    const errorElement = document.getElementById("login-error");
    const submitButton = form.querySelector("button[type=submit]");

    form.addEventListener("submit", async event => {
        event.preventDefault();
        errorElement.textContent = "";
        submitButton.disabled = true;

        try {
            await onLogin(input.value);
        } catch (err) {
            errorElement.textContent = err.message;
        } finally {
            submitButton.disabled = false;
        }
    });

    return {
        /** Setzt den Cursor ins Eingabefeld. */
        focus() {
            input.focus();
        }
    };
}
