---
format: nyxsis-issue
version: 3
id: ea8zqy4xv7vbtctg3ki3ymro
zone: SITE
number: 2
title: Ship the tcab.ai share-link Worker and the preview-tag Worker
type: generic
state: open
depends_on:
  - tx7vcyi2kctg8wr9v5qfr9jf
created: 2026-10-13T21:14:18.240469223Z
---

No Worker exists in front of the gallery, every run page is answered with the
same document, and nothing resolves a short code. The documentation describes
two Workers: one on `tcab.ai` bound to the bucket, redirecting `/r/<code>`
and `/p/<code>` to the run's verdict and play pages, and one in front of the
gallery's run routes writing the run's preview tags and answering an unknown
id with a 404: `apps/docs/src/content/docs/components/site/serving.md`,
sections "Preview tags and status" and "Share links", and
`apps/docs/src/content/docs/deployment/public-gallery.md`, sections "The
Workers", "DNS and TLS", "Deploying" and "Staging".

## What is missing

Both Workers in the `testcabinet.ai` repository, deployed by its pipeline as
the public-gallery page states, the `tcab.ai` zone and the staging hostnames
routed as its "DNS and TLS" and "Staging" sections state, and the caching the
serving page's "Caching" section states.

## Verify

`https://tcab.ai/r/<code>` for a published run redirects to its verdict page
and `/p/<code>` to its play page, an unknown code answers 404, a published
run's page carries its title and image as preview tags, an unknown run id
answers 404, and `make gate` passes in the site's checkout.
