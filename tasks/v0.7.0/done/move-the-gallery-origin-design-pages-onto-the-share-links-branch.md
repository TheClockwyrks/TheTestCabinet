# Move the gallery origin design pages onto the share-links branch

Make the documentation on `feat/gg` describe the gallery that ships in v0.7.0,
and keep the server-routed gallery design on `feat/share-links` as the starting
point for v0.8.0.

## Current state

Commit `b5f72b9079` on `feat/gg` documents a gallery served by a `tcab-gallery`
origin on an Azure Container App, reading a PostgreSQL public projection the
backend writes at publish time, with short links on `tcab.ai`. It added
`components/site/serving.md`, `components/backend/projection.md`, and
`deployment/public-gallery.md`, and edited `CLAUDE.md`,
`apps/docs/astro.config.mjs`, `comparisons/publishing.md`,
`components/architecture.md`, `components/backend/api.md`,
`components/backend/overview.md`, `components/backend/snapshot.md`,
`components/core/results.md`, `components/site/overview.md`,
`components/web/overview.md`, `deployment/kubernetes/overview.md`,
`deployment/overview.md`, `development/releasing.md`,
`guides/devops/adding-or-updating-a-model.md`, and
`quickstarts/devops/publish-errata.md`. The wording sweep `2443e30f89` and the
prettier sweep `dd0390a044` touched those pages afterwards.

None of that design exists in code. The backend writes no projection, there is
no gallery service, no short codes are minted, and `apps/site` is a Vite build
deployed to Cloudflare Pages that reads the build-time public snapshot. The pages
as they stood before `b5f72b9079` describe that static gallery, including a
Hosting section in `components/site/overview.md` on per-run Pages builds embedded
by iframe.

`feat/share-links` holds 540 commits over master. Every one of them is
patch-equivalent to a commit on `feat/gg` or superseded there: the managed
PostgreSQL shape by `components/postgres`, and the claim re-evaluation under the
row lock by the current `db.rs`.

## Design

On `feat/gg`, revert the documentation content of `b5f72b9079` page by page,
reconciling each page with the wording and formatting sweeps that followed, so
every page describes the static gallery on Pages and the build-time snapshot.
Delete the three added pages and their sidebar entries in `astro.config.mjs`, and
restore the `CLAUDE.md` pointers.

Reset `feat/share-links` to the rewritten `feat/gg` and commit the three design
pages and the related edits there. That branch is the starting point for
[serving the gallery from an origin with share links](serve-the-gallery-from-an-origin-with-share-links.md)
in v0.8.0.

This issue runs after
[the history rewrite](rewrite-the-repository-history-without-baselines-and-wasm-blobs.md),
so the reset lands on the rewritten history.

## Done when

- [ ] `git grep -iE 'tcab-gallery|public projection|short code|/r/<code>'`
      over `apps/docs/src/content/docs` on `feat/gg` matches only changelog
      pages.
- [ ] `components/site/overview.md` on `feat/gg` describes the static gallery,
      its Hosting section, and the build-time snapshot.
- [ ] The docs sidebar has no `serving`, `projection`, or `public-gallery`
      entry.
- [ ] `feat/share-links` is the rewritten `feat/gg` plus one commit holding the
      design pages and their related edits.
- [ ] Gates green.
