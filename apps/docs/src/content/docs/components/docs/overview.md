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
the two are distinct sites, not one. The docs are a pure static Astro build (no
Rust or catalog step) deployed to **Cloudflare Pages**, which lets them have
their own subdomain; the gallery, by contrast, is served from GitHub Pages, which
allows only one custom domain per repository.
