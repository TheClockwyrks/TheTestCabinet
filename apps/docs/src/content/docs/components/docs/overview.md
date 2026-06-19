---
title: Overview
---

The documentation for The Test Cabinet is provided at
[docs.testcabinet.ai](https://docs.testcabinet.ai) and is handled using
[Astro Starlight](https://starlight.astro.build/). It is the site you are
reading now, and it is documented here mostly for completeness: unlike the other
components there is little to specify, as it is a standard Astro Starlight site.

This documentation is primarily intended for project developers but will be
expanded over time to support end users who want to run The Test Cabinet locally.
It is a separate deployment from the [public site](/components/site/overview/) —
the two are distinct sites, not one. Both deploy to **Cloudflare Pages** as
separate projects under their own custom domains — the docs at
`docs.testcabinet.ai`, the [gallery](/components/site/overview/) at the apex
`testcabinet.ai`. They differ only in their build: the docs are a pure static
Astro build with no external inputs, whereas the gallery fetches the backend
snapshot at build time.
