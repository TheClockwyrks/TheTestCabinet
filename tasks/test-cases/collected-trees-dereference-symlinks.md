# A Collected Run Tree Dereferences Symlinks, So Filesystem Walks Re-Read Differently

A validator that walks the workspace with `readdirSync` reads a different tree
when it runs against a COLLECTED run tree than it did in the run container.

## Current behaviour

Gantry's `assets/produced-files-committed-under-assets` asserts that every
produced `.glb`, `.wav` and `.mid` sits under one root, `assets/`. Its `walk`
skips a symlink, because `Dirent.isDirectory()` is false for one.

All four gantry runs of the 2026-09-10 batch passed it. Re-running the same
point, unchanged, against the tree fetched from
`GET /runs/<id>/archive.tar.gz` fails it on all four, listing twenty-two
strays under `public/assets/`.

The builds are not at fault and neither is the point. Those builds carry a
`public/assets` **symlink** — the run's own README says "The `public/assets`
symlink makes Vite copy the committed assets into the static site" — and
collection materialises it as a real directory. The artifact archive holds zero
link entries (`tar tvzf | awk '$1 ~ /^l/'` is empty) and the artifacts volume
shows a directory, so the flattening happens at collection, before anything a
later reader can see.

## Design

Two separable pieces.

1. **Decide whether collection should preserve symlinks.** A produced tree is
   meant to be what the run built; a link flattened into a duplicate is neither
   the same tree nor obviously wrong (it is self-contained, which a link into
   a sibling is not). Whichever way it goes, say so in
   `components/driver/overview.md` beside the collection contract, because
   nothing states it today.

2. **Make the point read what it means either way.** It is named
   `produced-files-COMMITTED-under-assets` and decides a fact about what the
   repository carries, but it reads the filesystem. Reading the build's own git
   index would answer the committed question directly, and would be indifferent
   to both the symlink and its flattening.

Until then, a validator audit re-running points against downloaded trees should
expect this one point to fail on every gantry run, and should not read it as a
regression.
