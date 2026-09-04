import { definition, escapeHtml, loadControlCenter, loadNav, ordered, setStatus } from "./catalog.js";

await loadNav();
const notice = document.querySelector("#page-notice");

try {
  const { catalog, config } = await loadControlCenter();
  const current = catalog.scripts.filter(script => ["live", "beta"].includes(script.status));
  document.querySelector("#live-count").textContent = current.filter(script => script.status === "live").length;
  document.querySelector("#beta-count").textContent = current.filter(script => script.status === "beta").length;
  document.querySelector("#category-count").textContent = new Set(current.map(script => script.category)).size;
  document.querySelector("#archive-count").textContent = catalog.scripts.filter(script => ["archived", "deprecated"].includes(script.status)).length;

  const grid = document.querySelector("#category-grid");
  for (const category of ordered(current.map(script => script.category), "categories", config)) {
    const info = definition("categories", category, config);
    const scripts = current.filter(script => script.category === category);
    const card = document.createElement("a");
    card.className = "category-card";
    card.href = `scripts.html?category=${encodeURIComponent(category)}`;
    card.innerHTML = `<span class="category-card__icon" aria-hidden="true">${escapeHtml(info.icon)}</span><span><strong>${escapeHtml(info.label)}</strong><small>${scripts.length} script${scripts.length === 1 ? "" : "s"}</small><span>${escapeHtml(info.description)}</span></span>`;
    grid.append(card);
  }

  const latest = [...current].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 6);
  const list = document.querySelector("#current-list");
  for (const script of latest) {
    const item = document.createElement("li");
    item.innerHTML = `<a href="scripts.html?q=${encodeURIComponent(script.name)}">${escapeHtml(script.name)}</a><span>v${escapeHtml(script.version)}</span>`;
    list.append(item);
  }

  if (!current.length) setStatus(notice, catalog.migrationNotice || "No current scripts are cataloged yet. Add Control Center metadata and regenerate the catalog.", "migration");
} catch (error) {
  setStatus(notice, `The catalog could not be loaded: ${error.message}`, "error");
}
