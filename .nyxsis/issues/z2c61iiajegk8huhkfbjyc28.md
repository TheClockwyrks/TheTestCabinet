---
format: nyxsis-issue
version: 2
id: z2c61iiajegk8huhkfbjyc28
zone: SITE
number: 1
title: Serve the gallery from the index objects the bucket holds
type: generic
state: open
depends_on:
  - tx7vcyi2kctg8wr9v5qfr9jf
created: 2026-10-13T21:14:12.316276725Z
---

The gallery is built with the whole published snapshot baked into it, so a
publish rebuilds and redeploys the site. The documentation has the static
shell read `index.json` from the bucket's public hostname on load and follow
it to the run index, the model catalog, the comparison index, the group set
and the gg corpus, with listing pages answered in the browser from the run
index: `apps/docs/src/content/docs/components/site/serving.md`, sections "The
static shell", "Reading the dataset", "The public read surface" and
"Caching", and `apps/docs/src/content/docs/components/backend/snapshot.md`.

## What is missing

- The shell in `apps/site` built without the snapshot, reading the objects
  the serving page lists at runtime and rendering the empty states for a
  bucket with no pointer.
- Listing pages answered from the run index with the paging, filtering and
  sorting the console's backend query has, as the serving page states.
- The site's build and deploy as
  `apps/docs/src/content/docs/development/releasing.md`, section "Gallery
  (Cloudflare Pages and Workers, one-time)", states, with no deploy hook.

## Verify

Publishing a run on staging makes it appear in the staging gallery without
a site build, a deep link to it resolves, and `make gate` passes in the
site's checkout.
