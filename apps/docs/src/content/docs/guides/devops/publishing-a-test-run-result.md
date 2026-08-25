---
title: Publishing a Test Run Result
---

## Overview

A produced run reaches the gallery through two explicit steps, review and
publish, split so anyone may judge a run someone else produced (see
[Results: Lifecycle](/components/core/results/#lifecycle)):

- A produced run's [run record](/components/core/run-records/) is stored on the
  backend when the run finishes, and its build is playable off the
  [artifact service](/components/artifacts/overview/). The run stays private and
  is reviewable straight away.
- Review is anyone submitting an assessment for a produced run; see
  [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/).
  A run may gather several reviews, one per account.
- Publish releases the run's source and build publicly and flips it public. A
  [validator-rated](/testing/end-to-end/evaluation/#rating-channels) run is
  publishable as soon as it completes; a legacy run is refused unless it has at
  least one review.

This guide covers driving these from the [CLI](/components/cli/overview/), the
path for scripting and batch sweeps. The
[Tauri desktop app](/components/tauri/overview/) and the
[web console](/components/web/overview/) run the same operations interactively
from a run's review and publish actions. The final product is released as it is,
bugs and all, rather than reduced to a score.

Every command here operates by backend run id: the run executed in-cluster and
its record is already stored on the backend.

## Prerequisites

- An account, logged in. Review and publish both require an
  [account](/components/backend/overview/#authentication): the backend records who
  acted and attributes each review to them. Register or log in once, which stores
  a bearer token at `~/.config/tcab/credentials.json`:

  ```sh
  tcab register --username ada --display-name "Ada"   # first time
  tcab login --username ada                            # thereafter
  ```

  See [Register and Log In](/quickstarts/setup/register-and-login/).
- `TCAB_BACKEND_URL`, pointing at the backend holding the run.
- For a legacy run, a review submitted before you publish, since publishing
  refuses a legacy run with no review. On the solo path below, a `<run-id>.md`
  writeup in the working directory supplies it: a valid rating per domain and a
  non-empty body. A validator-rated run needs none, and a writeup beside it
  supplies the aesthetic rating. Write the review first; see
  [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/).

The public release is the per-run GitHub repository and the Cloudflare Pages
build. It runs server-side in the backend's `tcab-publisher` Job at publish time,
so the release credentials live on the cluster rather than on your machine.

## The solo path: `tcab publish`

When the same person ran the model, played it, and vouches for it, `tcab publish`
collapses self-review and publish into one batch-capable command.

`--dry-run` prints each run's rating and what would be published, submitting no
review and flipping no run public:

```sh
tcab publish <run-id> --dry-run
```

Every run's writeup is gated up front, so a single legacy run missing one stops
the whole batch before anything is published, and a validator-rated run with no
writeup is reported as publishing without a self-review. `publish` takes
multiple run ids for exactly this case:

```sh
tcab publish <run-a> <run-b> --dry-run
tcab publish <run-a> <run-b>   # for real
```

Publishing a reviewed run releases three things, all done by the backend's
`tcab-publisher` Job (see [Results](/components/core/results/#lifecycle) and
[Generated Code](/components/core/results/#generated-code)):

- Source: the run's collected implementation is released to its own public
  repository, keeping results independent and mapping onto per-run hosting. The
  implementation must include a README and whatever documentation a user needs to
  clone and run it locally; every test case requires that.
- Playable build: the built implementation is deployed to Cloudflare Pages under
  a per-run branch alias and served at its own `pages.dev` root, which keeps it
  playable exactly as the test case's
  [build interface](/testing/end-to-end/overview/#design-requirements) and the
  [load check](/components/core/validation/#load-check) require.
- Gallery: the run is flipped public and the backend regenerates the public
  snapshot the [site](/components/site/overview/) is built from.

## The split path: review then publish

When a different person should review a run, split the steps. A produced run is
already stored and its build playable, so a reviewer can assess it straight away:

```sh
# someone with their own account reviews the run's playable build:
tcab review <run-id> --writeup writeup.md
# ... once the run has at least one review (any time, for a validator-rated run),
# an operator publishes it:
tcab publish <run-id>
```

`review` submits a review attributed to its own account; a run gathers one review
per account. `publish` flips the run public and is refused for a legacy run when
no review exists.
Both require a logged-in account. The backend performs the publish half alone, so
two operators publishing at once cannot race on the store or the snapshot.

## Preview before you publish

The gallery dev server plays produced-but-unpublished runs held on disk, review
and all:

```sh
npm run dev -w @test-cabinet/site
```

See
[Reviewing Test Run Results](/guides/development/reviewing-test-run-results/#play-the-build)
for what the local preview reads.
