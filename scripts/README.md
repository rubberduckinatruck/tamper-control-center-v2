# Current userscripts

Place one current `live` or `beta` `.user.js` file inside a category folder.

```text
scripts/
└── synergy/
    └── quick-grade-mapper.user.js
```

Rules:

- Use lowercase kebab-case filenames ending in `.user.js`.
- Do not put version numbers in current filenames.
- The category folder should match `@cc-category`.
- Each current script must have a unique permanent `@cc-id`.
- Keep the filename, `@cc-id`, `@name`, and `@namespace` stable across ordinary updates.
- Increase `@version` whenever installed code changes.
- Both URL fields must equal the canonical raw URL for the file.

Example URLs:

```javascript
// @updateURL    https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center/main/scripts/synergy/quick-grade-mapper.user.js
// @downloadURL  https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center/main/scripts/synergy/quick-grade-mapper.user.js
```

After adding or updating a script, run `npm run check`.
