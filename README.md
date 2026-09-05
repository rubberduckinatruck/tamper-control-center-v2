# Tampermonkey Control Center v2

A self-updating GitHub Pages catalog for organizing, installing, and preserving Tampermonkey userscripts. The website is generated from metadata inside the actual `.user.js` files, so script listings never need to be maintained by hand.

## How it works

1. Put a current userscript in `scripts/<category>/`.
2. Add the required Control Center metadata and canonical update URLs.
3. Run `npm run check` locally or push to `main`.
4. Validation scans current, archived, and draft scripts.
5. Invalid or incomplete userscripts are reported and skipped.
6. `scripts.json` is regenerated from every valid script and the GitHub Pages site reads it automatically.

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

Legacy userscripts can remain in place unchanged. Until their headers receive the required `@cc-*` metadata and canonical raw GitHub URLs, the generator reports and skips them while continuing to publish every valid script. Script-level metadata, URL, syntax, and identity problems do not fail the workflow; unreadable configuration or an inability to write `scripts.json` still does.

See [scripts/README.md](scripts/README.md) for the exact add/update workflow and [archive/README.md](archive/README.md) for version preservation.


// ==UserScript==
// @name             Existing Tampermonkey Script Name
// @namespace        Existing namespace
// @version          1.0.0
// @description      Clear description of what the script does.
// @author           Big Poppa
//
// REQUIRED CONTROL CENTER METADATA
// @cc-id            permanent-unique-script-id
// @cc-category      category-slug
// @cc-status        live
//
// OPTIONAL CONTROL CENTER METADATA
// @cc-display-name  Clean Human-Readable Name
// @cc-role          role-slug
// @cc-tags          tag one, tag two, tag three
// @cc-note          Optional short operational note or warning.
//
// @match            https://example.com/*
// @grant            none
// @run-at           document-idle
//
// @updateURL        https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/optional-folder/example-script.user.js
// @downloadURL      https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/optional-folder/example-script.user.js
// ==/UserScript==



## List of all probably will use / could use:

// @name             Name shown in Tampermonkey.
// @namespace        Stable identifier used with @name to distinguish the script.
// @version          Script version used to detect updates.
// @description      Short explanation of what the script does.
// @author           Script author; use Big Poppa for your scripts.

// @cc-id            Permanent unique Control Center script ID.
// @cc-category      Category used to organize the script in the Control Center.
// @cc-status        Publishing status: live, beta, draft, archived, or deprecated.
// @cc-display-name  Clean name displayed in the Control Center.
// @cc-role          Broader role such as teaching, development, personal, or system.
// @cc-tags          Comma-separated searchable Control Center tags.
// @cc-note          Optional usage requirement, warning, or other important note.

// @match            Defines the pages where the script runs.
// @include          Alternative URL-matching rule for unusual patterns.
// @exclude          Prevents the script from running on specified pages.
// @grant            Gives the script access to specific Tampermonkey APIs.
// @run-at           Controls when the script runs during page loading.
// @noframes         Prevents the script from running inside frames and iframes.

// @require          Loads an external JavaScript library before the script.
// @resource         Makes an external CSS, image, text, or template file available.
// @connect          Allows GM_xmlhttpRequest to contact specified domains.

// @updateURL        Location Tampermonkey checks for a newer version.
// @downloadURL      Location Tampermonkey uses to download the updated script.

// @homepageURL      Optional project or Control Center homepage.
