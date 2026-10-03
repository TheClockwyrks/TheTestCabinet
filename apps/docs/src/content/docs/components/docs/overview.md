---
title: Overview
---

The documentation for The Test Cabinet is served at
[docs.testcabinet.ai](https://docs.testcabinet.ai) and is built with [Astro
Starlight](https://starlight.astro.build/) from `apps/docs`. It is written for
project developers and covers running The Test Cabinet locally.

The docs are their own Cloudflare Pages project under the `docs.testcabinet.ai`
custom domain, separate from the public site. The build is a pure static Astro
build with no external inputs. The Azure pipeline's `docs` stage builds it and
pushes the bundle with `wrangler` (`scripts/ci/deploy-docs.sh`), on every
`master` and `staging` run that passed the gates. The workspace template renders
the site's `package.json`, as `@the-test-cabinet/docs`, which pins Astro and
Starlight; the pages are the project's. The `docs-typecheck` and `docs-build`
gates check it on every commit that touches it.
