---
format: nyxsis-issue
version: 3
id: z2c61iiajegk8huhkfbjyc28
zone: SITE
number: 1
title: Serve the gallery from the index objects the bucket holds
type: generic
priority: 3
state: done
depends_on:
  - tx7vcyi2kctg8wr9v5qfr9jf
created: 2026-10-13T21:14:12.316276725Z
done: 2026-10-26T07:14:27.30655389Z
outcome: |
  The gallery shell in `testcabinet.ai` no longer bakes the snapshot into its
  build. In the browser it reads `index.json` from the bucket at
  `TCAB_SNAPSHOT_URL`, then follows the pointer to the run index, the model
  catalog, the comparisons, the groups and the gg corpus, and mounts its routes
  once they are in. After that it builds the case catalog from the case files the
  run index names. A run's document is fetched when a page of that run opens.
  Listing pages are answered from the run index with `runSummaryPage`. A bucket
  with no pointer renders the empty states. A dataset that cannot be read is
  reported on a single page with a reload button. The build emits only the shell,
  and the deploy stage stays the Direct Upload that `releasing.md` describes. The
  serving page now says when the case files are read, and the public gallery page
  states the CORS policy each bucket needs.

  How it was verified: typecheck, the reader's vitest suite (53 tests), lint,
  prettier and the deploy script's table test all pass. The production build of
  the shell was driven in Chromium against the live production bucket through a
  local CORS proxy. Home, the runs listing, a run deep link and its Inputs,
  Events, Code and Verdict tabs, an unknown run id, gg Discover, the case catalog
  and a case page all rendered. So did an empty bucket and a failing one. The
  site's `make gate` passes except for two gates that cannot run in this
  container. `typescript` needs the package feed, and its build, typecheck and
  tests were run by hand. `cspell` matches no file in a worktree under `.git/`, so
  the changed Markdown was spell-checked in a scratch copy.

  Left to do:
  - The staging bucket `snapshot.staging.testcabinet.ai` has no CORS policy for
    `https://staging.testcabinet.ai`: a preflight is answered 403. Until one is
    set in Cloudflare, the staging gallery cannot read its dataset. The production
    bucket already allows `GET` from `https://testcabinet.ai`.
  - The issue's own check, that a publish on staging appears in the staging
    gallery without a build, is still to be run after that policy is set and this
    lands on `staging`.
  - A local build inside the superrepo, with `@clockwyrks/ui` linked to the
    ui-common checkout, bundles two copies of react-router, and every route fails
    with "useLocation() may be used only in the context of a <Router>". A build
    from the feed holds one copy. Adding react, react-dom and react-router to
    `resolve.dedupe` in `vite.config.ts` fixed it for the verification, but that
    change was not committed.
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

- The shell in the `testcabinet.ai` repository built without the snapshot,
  reading the objects the serving page lists at runtime and rendering the
  empty states for a bucket with no pointer.
- Listing pages answered from the run index with the paging, filtering and
  sorting the console's backend query has, as the serving page states.
- The site's build and deploy as
  `apps/docs/src/content/docs/development/releasing.md`, section "Gallery
  (Cloudflare Pages and Workers, one-time)", states: a Direct Upload pushed
  by the `testcabinet.ai` pipeline, with no snapshot baked in.

## Verify

Publishing a run on staging makes it appear in the staging gallery without
a site build, a deep link to it resolves, and `make gate` passes in the
site's checkout.
