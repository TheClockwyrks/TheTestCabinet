---
title: Publish a Run
---

## Overview

Publishing releases a run to public hosting and the gallery. A produced run's
record and artifacts are already stored privately on the backend by the driver.
A [validator-rated](/testing/end-to-end/evaluation/#rating-channels) run is
publishable the moment it completes, and a legacy run is reviewed first, then
published ([lifecycle](/components/core/results/#lifecycle)). The full workflow
is
[Publishing a Test Run Result](/guides/devops/publishing-a-test-run-result/).

## Prerequisites

- You are [signed in](/quickstarts/setup/register-and-login/): reviewing and
  publishing each require an account.
- `TCAB_BACKEND_URL` points at the backend holding the run.
- A legacy run carries at least one
  [review](/quickstarts/development/review-a-run/). Publishing a legacy run with
  no review is refused; a validator-rated run needs none.

The repository-host and Cloudflare credentials the release itself needs live with
the backend's publisher Job, not on your machine.

## From a console

In the [desktop app](/components/tauri/overview/) or the
[web console](/components/web/overview/), sign in and open the run. The web
console offers Submit review and Publish run as separate actions, with Publish
gated on a legacy run carrying a review. The desktop app offers a single Publish
run that saves your review and publishes in one step.

## From the CLI

`tcab publish` is the solo path: it self-reviews each run from a local writeup
and then publishes it. Author `<run-id>.md` in the working directory for each run
(the format is in [Review a Run](/quickstarts/development/review-a-run/)); a
validator-rated run with no writeup publishes without a self-review, which the
command reports. Then:

```sh
tcab publish <run-id> --dry-run       # show what would be reviewed and published
tcab publish <run-id>                 # review and release
tcab publish <run-id> <run-id> …      # a whole sweep in one invocation
```

Every run's writeup is validated before anything is submitted, so a batch with a
legacy run missing its review stops before releasing any of it. `--dry-run` is
the fastest way to confirm a batch is fully reviewed.

When someone else reviews the run, they submit it with
`tcab review <run-id> --writeup <file>` or from a console, and the run is
published from a console afterwards.

## What publishing releases

- Source: the run's implementation, as its own public repository.
- Playable build: the built implementation, deployed to Cloudflare Pages at its
  own per-run subdomain.
- Gallery: the run record and its reviews, which the backend folds into the
  public snapshot.

The release runs as a `tcab-publisher` Job; `tcab publish` streams its progress
until the release reports its outcome.
