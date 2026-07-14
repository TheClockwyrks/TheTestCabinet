---
title: Publish a Run
---

Get a finished run onto the gallery through three steps — **push**, **review**,
**publish** ([lifecycle](/components/core/results/#lifecycle)). The CLI's
`tcab publish` collapses all three when you review your own run. You can drive each
from a [console](/components/tauri/overview/) or the CLI. The full workflow and
prerequisites are in
[Publishing a Test Run Result](/guides/devops/publishing-a-test-run-result/).

## Prerequisites

- You are [signed in](/quickstarts/setup/register-and-login/) — push, review, and
  publish each require an account.
- The run has at least one [review](/quickstarts/development/review-a-run/). Publishing refuses
  a run without one.
- The GitHub CLI (`gh`) is installed and authenticated on the host, with a token
  carrying `repo` and `workflow` scopes (`gh auth login` or `GH_TOKEN`).
- Release credentials are configured; see
  [CLI Authentication](/components/cli/overview/#authentication).

## From a console

In the [Tauri desktop app](/components/tauri/overview/) or the
[web console](/components/web/overview/), sign in, then open the run and use its
push, review, and publish actions. Pushing releases the source and build and stores
the run privately so it can be reviewed; publishing flips a reviewed run public —
all without leaving the app.

## Solo path from the CLI: `tcab publish`

When you ran, reviewed, and are publishing the run yourself, one command does push
+ self-review + publish:

```sh
tcab publish runs/<id>/run-record.json --dry-run   # show what would change
tcab publish runs/<id>/run-record.json             # release for real
```

It is idempotent and batch-capable — pass several record paths to do a sweep at
once. A single run missing its review stops the **whole** batch before anything is
released, so `--dry-run` is the fastest way to confirm a batch is fully reviewed
first. Use `--force` to re-run the work for an already-published run.

## Three-step path: when someone else reviews

```sh
tcab push runs/<id>/run-record.json                       # release + store privately
tcab review runs/<id>/run-record.json --writeup w.md      # a reviewer's own account
tcab publish runs/<id>/run-record.json                    # flip public once reviewed
```

A pushed run is private but its build is playable, so a *different* person can
review it before it is published. A run can carry several reviews, one per account.

## What it releases

- **Source** — each run's implementation as its own public repository.
- **Playable build** — the built implementation deployed to Cloudflare Pages and
  served at its own per-run `pages.dev` subdomain root.
- **Gallery** — the run record and its reviews submitted to the
  [backend](/components/backend/overview/), which refreshes the public snapshot
  once the run is published.

See [Results](/components/core/results/#lifecycle) for the conceptual model behind
the three steps.
