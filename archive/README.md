# Archived userscripts

Preserve superseded versions under their category and permanent script identity:

```text
archive/
└── synergy/
    └── synergy-quick-grade-mapper/
        └── quick-grade-mapper-2-4.user.js
```

Archived copies retain the family `@cc-id` and old `@version`, but use `@cc-status archived` or `deprecated`. The generator publishes them only to the Archive view. They do not need update/download URLs and are not offered as normal installations.

To archive an update:

1. Copy the old current file into its archive family directory.
2. Add the old version to the archived filename using hyphens.
3. Change the copy to `@cc-status archived`.
4. Update the current file in place and increase its `@version`.
5. Run `npm run check`.
