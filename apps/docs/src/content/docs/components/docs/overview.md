---
title: Overview
---

The documentation for The Test Cabinet is served at
[docs.testcabinet.ai](https://docs.testcabinet.ai) and is built with [Astro
Starlight](https://starlight.astro.build/) from `apps/docs`. It is the site you
are reading. Beyond being a standard Starlight site there is little to specify.

The documentation is written for project developers, and covers running The Test
Cabinet locally as well. It is a separate deployment from the [public
site](/components/site/overview/): two Cloudflare Pages projects under their own
custom domains, the docs at `docs.testcabinet.ai` and the gallery at the apex
`testcabinet.ai`. The builds differ in their inputs. The docs are a pure static
Astro build with no external inputs, uploaded by a GitHub Actions workflow that
pushes the bundle with `wrangler`, whereas the gallery is built by Cloudflare
from the repository and fetches the backend snapshot at build time.
