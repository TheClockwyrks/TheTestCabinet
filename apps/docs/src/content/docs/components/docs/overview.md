---
title: Overview
---

The documentation for The Test Cabinet is served at
[docs.testcabinet.ai](https://docs.testcabinet.ai) and is built with [Astro
Starlight](https://starlight.astro.build/) from `apps/docs` of the superrepo,
`the-test-cabinet`. It is written for project developers and covers every
repository of the set, including running The Test Cabinet locally.

The docs are their own Cloudflare Pages project under the `docs.testcabinet.ai`
custom domain, separate from the gallery at `testcabinet.ai`. The build is a
pure static Astro build whose only input is the superrepo's checkout. The
superrepo pipeline's `docs` stage builds it and pushes the bundle with
`wrangler` (`scripts/ci/deploy-docs.sh`), on every `master` and `staging` run
that passed the gates. The workspace template renders the site's
`package.json`, as `@the-test-cabinet/docs`, which pins Astro and Starlight;
the pages are the project's. The `docs-typecheck` and `docs-build` gates check
it on every commit that touches it.

The gg section is the `gg` repository's: its pages live there, and the docs
tree's `gg/` entry points into the superrepo's checkout of that submodule, so
the build reads them as it reads every other page. Every other page is the
superrepo's own.
