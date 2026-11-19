/**
 * Release-Prüfung: Ist eine Version vollständig vorbereitet?
 *
 *  - version in package.json ist größer als der höchste vorhandene Tag v*
 *  - changelog.md hat oben einen Eintrag "## [x.y.z] – JJJJ-MM-TT" für genau diese Version
 *  - dokumentation.md nennt im Kopf "**Version:** x.y.z"
 *
 * Wird vom pre-merge-commit-Hook und von scripts/release.mjs genutzt.
 * Direkt aufrufbar:  node scripts/git/release-check.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { git, fail } from "./git-utils.mjs";

/** Zerlegt "1.2.3" bzw. "v1.2.3" in Zahlen, sonst null. */
export function parseVersion(text) {
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(text).trim());
    return match ? match.slice(1).map(Number) : null;
}

/** Vergleicht zwei Versionen: < 0, 0 oder > 0. */
export function compareVersions(a, b) {
    const va = parseVersion(a);
    const vb = parseVersion(b);
    if (!va || !vb) throw new Error(`Ungültige Version: ${!va ? a : b}`);
    for (let i = 0; i < 3; i++) {
        if (va[i] !== vb[i]) return va[i] - vb[i];
    }
    return 0;
}

/** Höchster Tag der Form vX.Y.Z aus einer Liste (oder null). */
export function latestTag(tags) {
    const valid = tags.filter(tag => parseVersion(tag) && tag.startsWith("v"));
    return valid.sort(compareVersions).at(-1) ?? null;
}

/** Abschnitt einer Version aus dem Changelog (ohne Überschrift) oder null. */
export function changelogSection(changelog, version) {
    const lines = changelog.split(/\r?\n/);
    const start = lines.findIndex(line => line.startsWith(`## [${version}]`));
    if (start === -1) return null;
    let end = lines.findIndex((line, i) => i > start && /^## \[/.test(line));
    if (end === -1) end = lines.length;
    return lines.slice(start + 1, end).filter(line => line.trim() !== "---").join("\n").trim();
}

/**
 * Prüft die Release-Daten und liefert eine Liste von Fehlern (leer = alles ok).
 * @param {{version: string, tags: string[], changelog: string, documentation: string}} data
 */
export function checkRelease({ version, tags, changelog, documentation }) {
    const errors = [];
    if (!parseVersion(version)) {
        return [`package.json: ungültige Version "${version}"`];
    }

    const last = latestTag(tags);
    if (tags.includes(`v${version}`)) {
        errors.push(`Tag v${version} existiert bereits – Version in package.json erhöhen.`);
    } else if (last && compareVersions(version, last) <= 0) {
        errors.push(`Version ${version} ist nicht größer als der letzte Tag ${last}.`);
    }

    const firstEntry = /^## \[([^\]]+)\]\s*–\s*(.*)$/m.exec(changelog);
    if (!firstEntry || firstEntry[1] !== version) {
        errors.push(`changelog.md: oberster Eintrag muss "## [${version}] – JJJJ-MM-TT" sein` +
            (firstEntry ? ` (gefunden: [${firstEntry[1]}]).` : "."));
    } else if (!/^\d{4}-\d{2}-\d{2}/.test(firstEntry[2].trim())) {
        errors.push(`changelog.md: Eintrag [${version}] hat kein Datum (JJJJ-MM-TT).`);
    }

    const docVersion = /\*\*Version:\*\*\s*(\d+\.\d+\.\d+)/.exec(documentation);
    if (!docVersion || docVersion[1] !== version) {
        errors.push(`dokumentation.md: Kopfzeile "**Version:** ${version}" fehlt` +
            (docVersion ? ` (gefunden: ${docVersion[1]}).` : "."));
    }
    return errors;
}

/** Liest die Daten aus einem Arbeitsordner (Worktree) und prüft sie. */
export function checkWorktree(root) {
    const read = file => fs.readFileSync(path.join(root, file), "utf8");
    const version = JSON.parse(read("package.json")).version;
    const tags = git(["tag", "--list", "v*"], { cwd: root }).split("\n").filter(Boolean);
    const changelog = read("changelog.md");
    return {
        version,
        changelog,
        errors: checkRelease({ version, tags, changelog, documentation: read("dokumentation.md") })
    };
}

// Direkter Aufruf
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    const root = git(["rev-parse", "--show-toplevel"]);
    const { version, errors } = checkWorktree(root);
    if (errors.length > 0) fail(`Release ${version} ist nicht vollständig vorbereitet:`, errors);
    console.log(`✔ Release-Prüfung für ${version} bestanden.`);
}
