# Current userscripts

Place each current `live` or `beta` `.user.js` file directly in `scripts/` or in an optional category folder. The `@cc-category` value—not the folder—controls where the script appears in the Control Center.

```text
scripts/
├── quick-grade-mapper.user.js
└── synergy/
    └── another-synergy-tool.user.js
```

Rules:

- Use lowercase kebab-case filenames ending in `.user.js`.
- Do not put version numbers in current filenames.
- Category folders are optional. If one is used, it should match `@cc-category`; a mismatch produces a warning, but the metadata category wins.
- Each current script must have a unique permanent `@cc-id`.
- Keep the filename, `@cc-id`, `@name`, and `@namespace` stable across ordinary updates.
- Increase `@version` whenever installed code changes.
- Both URL fields must equal the canonical raw URL for the file.

The update URLs must follow the file's actual physical path. For a file directly inside `scripts/`:

```javascript
// @updateURL    https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center/main/scripts/quick-grade-mapper.user.js
// @downloadURL  https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center/main/scripts/quick-grade-mapper.user.js
```

For a file physically stored in `scripts/synergy/`:

```javascript
// @updateURL    https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center/main/scripts/synergy/quick-grade-mapper.user.js
// @downloadURL  https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center/main/scripts/synergy/quick-grade-mapper.user.js
```

After adding or updating a script, run `npm run check`.
