const CATALOG_URL = "scripts.json";
const CONFIG_URL = "catalog.config.json";

export async function loadControlCenter() {
  const [catalogResponse, configResponse] = await Promise.all([fetch(CATALOG_URL), fetch(CONFIG_URL)]);
  if (!catalogResponse.ok) throw new Error(`Catalog request failed (${catalogResponse.status})`);
  if (!configResponse.ok) throw new Error(`Configuration request failed (${configResponse.status})`);
  const [catalog, config] = await Promise.all([catalogResponse.json(), configResponse.json()]);
  if (catalog.schemaVersion !== 2) throw new Error("Unsupported catalog version. Regenerate scripts.json.");
  return { catalog, config };
}

export function titleCase(slug = "") {
  return slug.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

export function definition(group, slug, config) {
  const item = config[group]?.[slug] ?? {};
  return { label: item.label ?? titleCase(slug), icon: item.icon ?? "🧩", description: item.description ?? "", order: item.order ?? 999 };
}

export function ordered(values, group, config) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => {
    const first = definition(group, a, config), second = definition(group, b, config);
    return first.order - second.order || first.label.localeCompare(second.label);
  });
}

export function sourceUrl(script, catalog) {
  return `${catalog.repository.sourceBaseUrl.replace(/\/$/, "")}/${script.file}`;
}

export function siteLabel(pattern) {
  try {
    const host = pattern.replace(/^\*:/, "https:").replace(/\*/g, "example");
    return new URL(host).hostname.replace(/^www\./, "").replace(/^example\./, "*.");
  } catch { return pattern; }
}

export function setStatus(target, message, type = "info") {
  target.className = `notice notice--${type}`;
  target.textContent = message;
  target.hidden = false;
}

export function nav() {
  const current = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll("[data-nav]").forEach(link => {
    if (link.getAttribute("href") === current) link.setAttribute("aria-current", "page");
  });
}

export async function loadNav() {
  const slot = document.querySelector("[data-nav-slot]");
  if (!slot) return;
  try {
    const response = await fetch("assets/nav.html");
    if (!response.ok) throw new Error();
    slot.innerHTML = await response.text();
    nav();
  } catch { slot.innerHTML = '<nav class="site-nav"><a href="index.html">Control Center</a><a href="scripts.html">Script Library</a><a href="archive.html">Archive</a></nav>'; nav(); }
}
