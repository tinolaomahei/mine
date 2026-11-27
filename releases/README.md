# Releases

Each major version of mine is named after a native tree. Minor versions and patches keep their major's tree, so all of 0.x is Mānuka.

Every release gets a graphic. The tree's name is on it, with the trunk drawn as rings: one pink ring for each major version so far, and a fine growth line inside the current ring for each minor release. The flower or seed of that version's tree sits in the middle.

| Major | Tree | |
| --- | --- | --- |
| 0 | Mānuka | The first tree back on bare ground. It shelters the ones that come up after it. |

## Making one

1. Add or check the tree for the major version in `trees.json`.
2. Write the notes in `<version>.md`.
3. Draw the graphic from `desktop/`:

   ```
   npx electron scripts/release-art.cjs 0.1.0
   ```

   It writes `<version>.png` here, 2560×1280, which is also the size GitHub uses for social previews.
