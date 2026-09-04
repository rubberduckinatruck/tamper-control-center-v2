import { definition, escapeHtml, loadControlCenter, loadNav, ordered, setStatus, siteLabel, sourceUrl } from "./catalog.js";

await loadNav();
const mode = document.body.dataset.libraryMode || "current";
const notice = document.querySelector("#page-notice");
const grid = document.querySelector("#script-grid");
const empty = document.querySelector("#empty-state");
const search = document.querySelector("#search");
const category = document.querySelector("#category-filter");
const role = document.querySelector("#role-filter");
const status = document.querySelector("#status-filter");

function option(select, value, label) {
  const item = document.createElement("option"); item.value = value; item.textContent = label; select.append(item);
}

function cardFor(script, catalog, config) {
  const card = document.createElement("article");
  card.className = "script-card";
  const categoryInfo = definition("categories", script.category, config);
  const roleInfo = script.role ? definition("roles", script.role, config) : null;
  const sites = [...new Set([...script.matches, ...script.includes].map(siteLabel))];
  const tags = script.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  const actions = ["live", "beta"].includes(script.status)
    ? `<a class="button button--primary" href="${script.installUrl}">Install / Update</a>`
    : "";
  card.innerHTML = `
    <div class="script-card__heading"><div><span class="eyebrow">${escapeHtml(categoryInfo.icon)} ${escapeHtml(categoryInfo.label)}${roleInfo ? ` · ${escapeHtml(roleInfo.label)}` : ""}</span><h2>${escapeHtml(script.name)}</h2></div><span class="badge badge--${escapeHtml(script.status)}">${escapeHtml(definition("statuses", script.status, config).label)}</span></div>
    <p>${escapeHtml(script.description)}</p>
    ${script.note ? `<p class="script-note"><strong>Note:</strong> ${escapeHtml(script.note)}</p>` : ""}
    <dl class="metadata"><div><dt>Version</dt><dd>${escapeHtml(script.version)}</dd></div><div><dt>Runs on</dt><dd>${sites.length ? sites.map(escapeHtml).join(", ") : "No match listed"}</dd></div></dl>
    ${tags ? `<div class="tags" aria-label="Tags">${tags}</div>` : ""}
    <div class="script-card__actions">${actions}<a class="button" href="${sourceUrl(script, catalog)}">View source</a></div>`;
  return card;
}

try {
  const { catalog, config } = await loadControlCenter();
  const allowed = mode === "archive" ? ["archived", "deprecated"] : ["live", "beta"];
  const base = catalog.scripts.filter(script => allowed.includes(script.status));
  for (const value of ordered(base.map(item => item.category), "categories", config)) option(category, value, definition("categories", value, config).label);
  for (const value of ordered(base.map(item => item.role), "roles", config)) option(role, value, definition("roles", value, config).label);
  for (const value of ordered(base.map(item => item.status), "statuses", config)) option(status, value, definition("statuses", value, config).label);

  const params = new URLSearchParams(location.search);
  search.value = params.get("q") || ""; category.value = params.get("category") || "";

  function render() {
    const query = search.value.trim().toLowerCase();
    const shown = base.filter(script => {
      const haystack = [script.name, script.installedName, script.description, script.category, script.role, ...script.tags, ...script.matches].filter(Boolean).join(" ").toLowerCase();
      return (!query || haystack.includes(query)) && (!category.value || script.category === category.value) && (!role.value || script.role === role.value) && (!status.value || script.status === status.value);
    });
    if (mode === "archive") {
      const families = new Map();
      for (const script of shown) {
        if (!families.has(script.id)) families.set(script.id, []);
        families.get(script.id).push(script);
      }
      const groups = [...families.values()].map(scripts => {
        scripts.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
        const section = document.createElement("section");
        section.className = "archive-group";
        const heading = document.createElement("h2");
        heading.textContent = `${scripts[0].name} — ${scripts.length} preserved version${scripts.length === 1 ? "" : "s"}`;
        const cards = document.createElement("div");
        cards.className = "script-grid";
        cards.replaceChildren(...scripts.map(script => cardFor(script, catalog, config)));
        section.append(heading, cards);
        return section;
      });
      grid.className = "archive-groups";
      grid.replaceChildren(...groups);
    } else {
      grid.className = "script-grid";
      grid.replaceChildren(...shown.map(script => cardFor(script, catalog, config)));
    }
    empty.hidden = shown.length !== 0;
    document.querySelector("#result-count").textContent = `${shown.length} script${shown.length === 1 ? "" : "s"}`;
  }
  [search, category, role, status].forEach(control => control.addEventListener(control === search ? "input" : "change", render));
  document.querySelector("#clear-filters").addEventListener("click", () => { search.value = ""; category.value = ""; role.value = ""; status.value = ""; render(); });
  render();
  if (!base.length) setStatus(notice, mode === "archive" ? "No archived scripts are cataloged yet." : (catalog.migrationNotice || "No current scripts are cataloged yet."), "migration");
} catch (error) { setStatus(notice, `The catalog could not be loaded: ${error.message}`, "error"); }
