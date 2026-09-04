#!/usr/bin/env node
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATUSES = new Set(["live", "beta", "draft", "archived", "deprecated"]);
const REQUIRED = ["name", "version", "description", "cc-id", "cc-category", "cc-status"];
const REPEATABLE = new Set(["match", "include", "exclude", "grant", "require", "connect"]);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function argumentsFrom(argv) {
  const result = { scriptsDir: path.join(ROOT, "scripts"), archiveDir: path.join(ROOT, "archive"), draftsDir: path.join(ROOT, "drafts"), output: path.join(ROOT, "scripts.json"), config: path.join(ROOT, "catalog.config.json"), checkDrafts: true };
  const keys = { "--scripts-dir": "scriptsDir", "--archive-dir": "archiveDir", "--drafts-dir": "draftsDir", "--output": "output", "--config": "config" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--no-drafts") result.checkDrafts = false;
    else if (argv[i] === "--help") { console.log("Usage: node tools/generate-catalog.mjs [--scripts-dir PATH] [--archive-dir PATH] [--drafts-dir PATH] [--output PATH] [--config PATH] [--no-drafts]"); process.exit(0); }
    else if (keys[argv[i]] && argv[i + 1]) result[keys[argv[i]]] = path.resolve(argv[++i]);
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  return result;
}

async function filesBelow(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(full));
    else if (entry.isFile() && entry.name.endsWith(".user.js")) files.push(full);
  }
  return files;
}

function metadataFrom(source, file) {
  const block = source.match(/\/\/\s*==UserScript==\s*[\r\n]+([\s\S]*?)[\r\n]+\/\/\s*==\/UserScript==/);
  if (!block) throw new Error(`${file}: missing or malformed userscript metadata block`);
  const data = {};
  for (const line of block[1].split(/\r?\n/)) {
    const item = line.match(/^\s*\/\/\s*@([^\s]+)(?:\s+(.*?))?\s*$/);
    if (!item) continue;
    const key = item[1].toLowerCase();
    const value = (item[2] ?? "").trim();
    if (REPEATABLE.has(key)) (data[key] ??= []).push(value); else data[key] = value;
  }
  return data;
}

const uniqueTags = (value = "") => [...new Set(value.split(",").map(v => v.trim().toLowerCase()).filter(Boolean))].sort();
const posix = value => value.split(path.sep).join("/");

function inspect({ metadata, source, file, rootDir, area, config }) {
  const errors = [], warnings = [];
  const relativeInArea = posix(path.relative(rootDir, file));
  const repositoryPath = posix(path.relative(ROOT, file));
  const folderCategory = relativeInArea.includes("/") ? relativeInArea.split("/")[0] : null;
  const report = (list, message) => list.push(`${repositoryPath}: ${message}`);
  for (const field of REQUIRED) if (!metadata[field]) report(errors, `missing required @${field}`);
  for (const field of ["cc-id", "cc-category", "cc-role"]) if (metadata[field] && !SLUG.test(metadata[field])) report(errors, `@${field} must be a lowercase slug`);
  if (metadata["cc-status"] && !STATUSES.has(metadata["cc-status"])) report(errors, `unknown @cc-status "${metadata["cc-status"]}"`);
  if (folderCategory && metadata["cc-category"] && folderCategory !== metadata["cc-category"]) report(warnings, `folder "${folderCategory}" differs from @cc-category "${metadata["cc-category"]}"; using metadata category`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.user\.js$/.test(path.basename(file))) report(errors, "filename must use lowercase kebab-case and end in .user.js");
  if (area === "scripts" && /(?:^|-)v?\d+(?:[.-]\d+)+(?:-|\.user\.js$)/i.test(path.basename(file))) report(errors, "current filename must not contain a version number");
  if (area === "scripts" && metadata["cc-status"] && !["live", "beta"].includes(metadata["cc-status"])) report(errors, "files in scripts/ must be live or beta");
  if (area === "archive" && metadata["cc-status"] && !["archived", "deprecated"].includes(metadata["cc-status"])) report(errors, "files in archive/ must be archived or deprecated");
  if (area === "drafts" && metadata["cc-status"] && metadata["cc-status"] !== "draft") report(errors, "files in drafts/ must have @cc-status draft");
  if (!metadata["cc-display-name"]) report(warnings, "missing recommended @cc-display-name; using @name");
  if (!metadata["cc-role"]) report(warnings, "missing recommended @cc-role");
  if (!metadata["cc-tags"]) report(warnings, "missing recommended @cc-tags");
  if ((metadata.match ?? []).includes("*://*/*")) report(warnings, "broad @match *://*/* should be reviewed");
  for (const dependency of metadata.require ?? []) report(warnings, `remote dependency: ${dependency}`);
  try { new vm.Script(source, { filename: repositoryPath }); } catch (error) { report(errors, `JavaScript syntax error: ${error.message.split("\n")[0]}`); }
  const expectedUrl = config.repository.rawBaseUrl.replace(/\/$/, "") + "/" + repositoryPath;
  if (["live", "beta"].includes(metadata["cc-status"])) {
    if (!metadata.updateurl) report(errors, `@updateURL is required for ${metadata["cc-status"]} scripts`); else if (metadata.updateurl !== expectedUrl) report(errors, `@updateURL must be ${expectedUrl}`);
    if (!metadata.downloadurl) report(errors, `@downloadURL is required for ${metadata["cc-status"]} scripts`); else if (metadata.downloadurl !== expectedUrl) report(errors, `@downloadURL must be ${expectedUrl}`);
  }
  const optional = key => metadata[key] || null;
  return { errors, warnings, record: { id: metadata["cc-id"], name: metadata["cc-display-name"] || metadata.name, installedName: metadata.name, version: metadata.version, description: metadata.description, author: optional("author"), namespace: optional("namespace"), category: metadata["cc-category"], role: optional("cc-role"), status: metadata["cc-status"], tags: uniqueTags(metadata["cc-tags"]), note: optional("cc-note"), file: repositoryPath, installUrl: optional("downloadurl") || optional("updateurl"), updateUrl: optional("updateurl"), matches: metadata.match ?? [], includes: metadata.include ?? [], excludes: metadata.exclude ?? [], grants: metadata.grant ?? [], requires: metadata.require ?? [], runAt: optional("run-at"), noframes: Object.hasOwn(metadata, "noframes") } };
}

function crossValidate(records) {
  const versions = new Map(), current = new Map(), conflicts = new Map();
  const flag = (record, message) => {
    if (!conflicts.has(record.file)) conflicts.set(record.file, []);
    conflicts.get(record.file).push(message);
  };
  for (const record of records) {
    const identity = `${record.id}@${record.version}`;
    if (versions.has(identity)) {
      const first = versions.get(identity);
      flag(first, `duplicate identity ${identity}; also in ${record.file}`);
      flag(record, `duplicate identity ${identity}; also in ${first.file}`);
    } else versions.set(identity, record);
    if (["live", "beta"].includes(record.status)) {
      if (current.has(record.id)) {
        const first = current.get(record.id);
        flag(first, `more than one current file uses @cc-id ${record.id}; also in ${record.file}`);
        flag(record, `more than one current file uses @cc-id ${record.id}; also in ${first.file}`);
      } else current.set(record.id, record);
    }
  }
  return {
    records: records.filter(record => !conflicts.has(record.file)),
    skipped: [...conflicts].map(([file, reasons]) => ({ file, reasons: [...new Set(reasons)] })),
  };
}

function summaries(records) {
  const count = key => Object.fromEntries([...new Set(records.map(r => r[key]).filter(Boolean))].sort().map(value => [value, records.filter(r => r[key] === value).length]));
  return { total: records.length, current: records.filter(r => ["live", "beta"].includes(r.status)).length, archived: records.filter(r => ["archived", "deprecated"].includes(r.status)).length, byCategory: count("category"), byRole: count("role"), byStatus: count("status") };
}

async function run(options) {
  const config = JSON.parse(await readFile(options.config, "utf8"));
  const areas = [{ name: "scripts", dir: options.scriptsDir, publish: true }, { name: "archive", dir: options.archiveDir, publish: true }];
  if (options.checkDrafts) areas.push({ name: "drafts", dir: options.draftsDir, publish: false });
  const records = [], skipped = [], warnings = [];
  let scanned = 0, draftsValidated = 0;
  for (const area of areas) for (const file of await filesBelow(area.dir)) {
    scanned += 1;
    const repositoryPath = posix(path.relative(ROOT, file));
    try {
      const source = await readFile(file, "utf8");
      const result = inspect({ metadata: metadataFrom(source, repositoryPath), source, file, rootDir: area.dir, area: area.name, config });
      warnings.push(...result.warnings);
      if (result.errors.length) skipped.push({ file: repositoryPath, reasons: result.errors.map(message => message.replace(`${repositoryPath}: `, "")) });
      else if (area.publish) records.push(result.record);
      else draftsValidated += 1;
    } catch (error) {
      skipped.push({ file: repositoryPath, reasons: [error.message.replace(`${repositoryPath}: `, "")] });
    }
  }
  const checked = crossValidate(records);
  skipped.push(...checked.skipped);
  warnings.forEach(message => console.warn(`Warning: ${message}`));
  skipped.forEach(item => console.warn(`::warning file=${item.file}::Skipped ${item.file}: ${item.reasons.join("; ")}`));
  checked.records.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  const issueCount = warnings.length + skipped.reduce((total, item) => total + item.reasons.length, 0);
  const catalog = {
    schemaVersion: 2,
    repository: config.repository,
    build: { scanned, published: checked.records.length, skipped: skipped.length, warnings: issueCount, draftsValidated },
    summary: summaries(checked.records),
    scripts: checked.records,
  };
  if (skipped.length) catalog.migrationNotice = `${skipped.length} userscript${skipped.length === 1 ? " is" : "s are"} awaiting valid metadata and were skipped.`;
  await writeFile(options.output, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  console.log(`Catalog generated successfully. Scanned: ${scanned}; published: ${checked.records.length}; skipped: ${skipped.length}; warnings: ${issueCount}.`);
}

try { await run(argumentsFrom(process.argv.slice(2))); } catch (error) { console.error(error.message); process.exitCode = 1; }
