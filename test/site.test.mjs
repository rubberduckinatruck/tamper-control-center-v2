import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("all published pages and browser modules exist", async () => {
  const files = ["index.html", "scripts.html", "archive.html", "install.html", "assets/nav.html", "assets/style.css", "assets/archive.css", "assets/catalog.js", "assets/dashboard.js", "assets/script-library.js", "catalog.config.json", "scripts.json"];
  await Promise.all(files.map(file => access(path.join(ROOT, file))));
});

test("pages use generated catalog modules instead of hard-coded script lists", async () => {
  const index = await readFile(path.join(ROOT, "index.html"), "utf8");
  const library = await readFile(path.join(ROOT, "scripts.html"), "utf8");
  const archive = await readFile(path.join(ROOT, "archive.html"), "utf8");
  assert.match(index, /assets\/dashboard\.js/);
  assert.match(library, /assets\/script-library\.js/);
  assert.match(archive, /data-library-mode="archive"/);
  assert.doesNotMatch(index + library, /Activate<\/button>/);
});

test("bootstrap catalog is valid during legacy metadata migration", async () => {
  const catalog = JSON.parse(await readFile(path.join(ROOT, "scripts.json"), "utf8"));
  assert.equal(catalog.schemaVersion, 2);
  assert.ok(Array.isArray(catalog.scripts));
  assert.equal(typeof catalog.migrationNotice, "string");
});
