---
title: Publish a Run
---

[Publish](/components/core/results/#publishing) a finished, reviewed run:
release its code and build to public hosting and add it to the gallery. The full
workflow, prerequisites, and what each step releases are in
[Publishing a Test Run Result](/guides/publishing-a-test-run-result/).

## Prerequisites

- The run has a [review](/quickstarts/review-a-run/) — `runs/<id>/writeup.md`
  with a valid rating. Publishing refuses a run without one.
- The GitHub CLI (`gh`) is installed and authenticated on the host, with a token
  carrying `repo` and `workflow` scopes (`gh auth login` or `GH_TOKEN`).
- Release credentials are configured; see
  [CLI Authentication](/components/cli/overview/#authentication).

## Dry run, then publish

```sh
tcab publish runs/<id>/run-record.json --dry-run   # show what would change
tcab publish runs/<id>/run-record.json             # release for real
```

`publish` is idempotent and batch-capable — pass several record paths to publish
a sweep at once. A single run missing its review stops the **whole** batch before
anything is released, so `--dry-run` is the fastest way to confirm a batch is
fully reviewed first. Use `--force` to re-run the work for an already-published
run.

## What it releases

- **Source** — each run's implementation as its own public repository.
- **Playable build** — the built implementation deployed to Cloudflare Pages and
  served at its own per-run `pages.dev` subdomain root.
- **Gallery** — the run record and review submitted to the
  [backend](/components/backend/overview/), which refreshes the public snapshot.

See [Results](/components/core/results/#publishing) for the conceptual model
behind the two halves of a publish.
