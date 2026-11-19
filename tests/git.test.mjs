/**
 * Test der Release-Prüfung (scripts/git/release-check.mjs) – reine Funktionen,
 * ohne Git-Aufrufe.
 *
 * Start:  npm run test:git   bzw.  node tests/git.test.mjs
 * Dauer:  unter 1 Sekunde
 */

import assert from "node:assert/strict";
import { createTestRunner } from "./helpers.mjs";
import {
    parseVersion, compareVersions, latestTag, changelogSection, checkRelease
} from "../scripts/git/release-check.mjs";

const { test, section, summary } = createTestRunner();

const CHANGELOG = `# Changelog

---

## [0.6.0] – 2026-12-01

### Hinzugefügt
- Neues Spiel

---

## [0.5.1] – 2026-11-19

### Geändert
- Texte
`;
const DOC = "# Doku\n\n**Version:** 0.6.0 (siehe package.json)\n";
const TAGS = ["v0.0.1", "v0.5.0", "v0.5.1", "v0.10.0-test"];
const ok = { version: "0.6.0", tags: TAGS, changelog: CHANGELOG, documentation: DOC };

section("Versionen");

await test("parseVersion und compareVersions (numerisch, nicht alphabetisch)", async () => {
    assert.deepEqual(parseVersion("v1.2.3"), [1, 2, 3]);
    assert.equal(parseVersion("1.2"), null);
    assert.ok(compareVersions("0.10.0", "0.9.9") > 0);
    assert.ok(compareVersions("v0.5.1", "0.5.2") < 0);
    assert.equal(compareVersions("1.0.0", "v1.0.0"), 0);
});
await test("latestTag ignoriert ungültige Tags", async () => {
    assert.equal(latestTag(TAGS), "v0.5.1");
    assert.equal(latestTag([]), null);
});

section("Release-Prüfung");

await test("Vollständiges Release ist ok", async () => {
    assert.deepEqual(checkRelease(ok), []);
});
await test("Version nicht erhöht bzw. Tag existiert schon", async () => {
    const same = checkRelease({ ...ok, version: "0.5.1",
        changelog: CHANGELOG.replace("[0.6.0]", "[0.5.1x]"), documentation: DOC.replace("0.6.0", "0.5.1") });
    assert.ok(same.some(e => e.includes("existiert bereits")), same.join("; "));
    const lower = checkRelease({ ...ok, version: "0.5.0", tags: ["v0.5.1"] });
    assert.ok(lower.some(e => e.includes("nicht größer")), lower.join("; "));
});
await test("Fehlender oder falscher Changelog-Eintrag wird erkannt", async () => {
    const missing = checkRelease({ ...ok, changelog: CHANGELOG.replace("## [0.6.0] – 2026-12-01", "") });
    assert.ok(missing.some(e => e.startsWith("changelog.md") && e.includes("[0.5.1]")), missing.join("; "));
    const noDate = checkRelease({ ...ok, changelog: CHANGELOG.replace("– 2026-12-01", "– bald") });
    assert.ok(noDate.some(e => e.includes("kein Datum")), noDate.join("; "));
});
await test("Fehlende oder falsche Doku-Version wird erkannt", async () => {
    const wrong = checkRelease({ ...ok, documentation: DOC.replace("0.6.0", "0.5.1") });
    assert.ok(wrong.some(e => e.startsWith("dokumentation.md") && e.includes("0.5.1")), wrong.join("; "));
    const missing = checkRelease({ ...ok, documentation: "# Doku" });
    assert.ok(missing.some(e => e.startsWith("dokumentation.md")), missing.join("; "));
});
await test("changelogSection liefert den Abschnitt für die Tag-Beschreibung", async () => {
    const notes = changelogSection(CHANGELOG, "0.6.0");
    assert.match(notes, /### Hinzugefügt\n- Neues Spiel/);
    assert.ok(!notes.includes("0.5.1"));
    assert.equal(changelogSection(CHANGELOG, "9.9.9"), null);
});

process.exit(summary());
