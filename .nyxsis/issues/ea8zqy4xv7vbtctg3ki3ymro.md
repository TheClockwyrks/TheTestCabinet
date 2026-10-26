---
format: nyxsis-issue
version: 3
id: ea8zqy4xv7vbtctg3ki3ymro
zone: SITE
number: 2
title: Ship the tcab.ai share-link Worker and the preview-tag Worker
type: generic
priority: 3
state: done
depends_on:
  - tx7vcyi2kctg8wr9v5qfr9jf
created: 2026-10-13T21:14:18.240469223Z
done: 2026-10-26T07:21:34.188015413Z
outcome: |
  Both Workers are in the `testcabinet.ai` repository as npm workspace members,
  each with a `wrangler.toml` declaring a `production` and a `staging`
  environment. `apps/preview-tags` is on `testcabinet.ai/runs/*`. It writes a
  published run's title and description from its card, and its image from the run
  document the card names, into the Pages shell with a 200. An unknown id gets the
  shell with an uncached 404. `/runs/comparisons` and `/runs/` get the shell
  untagged, and a bucket that cannot be read gets the shell with an uncached 200.
  `apps/share-links` is the Worker custom domain `tcab.ai`. It redirects
  `/r/<code>` and `/p/<code>` through `codes/<code>` with a 302 and answers an
  unknown code with an uncached 404. `scripts/ci/deploy-workers.sh`, a new
  `workers` job of the deploy stage, deploys both: `master` to production and
  `staging` to staging (`staging.testcabinet.ai/runs/*`, `staging.tcab.ai`).

  For the Caching section, `microservice-artifacts` now stores a `Cache-Control`
  on every R2 write: `index.json` gets `public, max-age=60` and every other key
  `public, max-age=31536000, immutable`. The Worker responses carry the headers in
  the Serving page's new table. The serving, public-gallery, releasing, snapshot
  and artifacts pages now state the image source, the bucket names
  (`tcab-snapshot` and `tcab-snapshot-staging`, since an R2 bucket name cannot
  contain dots), the custom domains, the token's permissions and the bucket's
  one-time cache rule.

  Verified here: the Workers' suites, type-check and `web-lint`, the wrangler
  4.40.3 dry-run deploys of both environments, `deploy-workers.test.sh`, the
  artifacts Rust gates and the docs gates. Not verified here: the site's
  `typescript` gate, because the linked install needs a feed token this machine
  lacks. Nothing was deployed, so the live checks in the issue's Verify section
  remain for the first `staging` and `master` deploys, after the buckets, the
  `tcab.ai` zone, the cache rule and the token are set up as the Releasing page
  states.
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
