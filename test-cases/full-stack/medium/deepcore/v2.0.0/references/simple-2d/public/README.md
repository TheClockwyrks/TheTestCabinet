# `public/`

Vite copies everything under this directory into `dist/` verbatim, keeping its
paths, and serves it from the site root in development. That is what puts the
produced assets at `assets/<…>` in the built site, which is exactly where the
engine's asset loader resolves them (`src/assets.ts`, `engine/assets.md`).

`public/assets` is a link to the repository's own `assets/` directory, so the
produced files are committed once, at the canonical paths `specs/assets.md`
fixes, and the built site carries them at those same paths. Nothing else belongs
here: everything the game imports goes through the bundler.
