---
title: Publish a Run
---

[Publish](/components/core/results/#publishing) a finished, reviewed run:
release its code and build to public hosting and add it to the gallery. You can
publish from a [console](/components/tauri/overview/) or from the CLI. The full
workflow, prerequisites, and what each step releases are in
[Publishing a Test Run Result](/guides/publishing-a-test-run-result/).

## Prerequisites

- The run has a [review](/quickstarts/review-a-run/) — a valid rating and a
  verdict on every checklist item. Publishing refuses a run without one.
- The GitHub CLI (`gh`) is installed and authenticated on the host, with a token
  carrying `repo` and `workflow` scopes (`gh auth login` or `GH_TOKEN`).
- Release credentials are configured; see
  [CLI Authentication](/components/cli/overview/#authentication).

## Publish from a console

In the [Tauri desktop app](/components/tauri/overview/) or the
[web console](/components/web/overview/), open the reviewed run and use its
publish action. The console runs the same publish — releasing the source and
build, then submitting the run record and review to the
[backend](/components/backend/overview/) — without leaving the app.

## Publish from the CLI: dry run, then publish

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
