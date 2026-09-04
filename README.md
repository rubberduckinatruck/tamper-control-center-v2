# Tampermonkey Control Center v2

A self-updating GitHub Pages catalog for organizing, installing, and preserving Tampermonkey userscripts. The website is generated from metadata inside the actual `.user.js` files, so script listings never need to be maintained by hand.

## How it works

1. Put a current userscript in `scripts/<category>/`.
2. Add the required Control Center metadata and canonical update URLs.
3. Run `npm run check` locally or push to `main`.
4. Validation scans current, archived, and draft scripts.
5. `scripts.json` is regenerated and the GitHub Pages site reads it automatically.

## Required metadata

```javascript
// @cc-id            permanent-script-family-id
// @cc-category      category-slug
// @cc-status        live
```

Recommended metadata:

```javascript
// @cc-display-name  Clean Human-Readable Name
// @cc-role          teaching
// @cc-tags          gradebook, grading, workflow
// @cc-note          Optional short operational warning.
```

Existing `@name` and `@namespace` values can remain unchanged to avoid creating duplicate Tampermonkey installations.

## Statuses

| Status | Location | Published behavior |
| --- | --- | --- |
| `live` | `scripts/` | Main dashboard and Script Library |
| `beta` | `scripts/` | Script Library with a Beta badge |
| `draft` | `drafts/` | Validated but not published |
| `archived` | `archive/` | Archive only |
| `deprecated` | `archive/` | Archive only with a warning badge |

## Commands

```bash
npm test          # Run generator tests
npm run catalog   # Validate and regenerate scripts.json
npm run validate  # Validate without replacing the repository catalog
npm run check     # Test, validate, and regenerate
```

The project has no third-party package dependencies. Node.js 20 or newer is sufficient.

## Migration note

The legacy userscripts are preserved unchanged. Until their headers receive the required `@cc-*` metadata and canonical raw GitHub URLs, validation intentionally fails with a complete file-by-file report. The included bootstrap `scripts.json` keeps the rebuilt website usable during this migration.

See [scripts/README.md](scripts/README.md) for the exact add/update workflow and [archive/README.md](archive/README.md) for version preservation.
