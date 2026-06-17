---
title: Publishing a Test Run Result
---

A run is local until it is **published**. Publishing is the explicit, idempotent,
batch-capable operation that takes a finished, reviewed run and releases it: its
generated code, its playable build, and its [run record](/components/core/run-records/)
on the gallery. The final product is released as it is — bugs and all — rather
than reduced to a score (see [Results](/components/core/results/)).

This guide covers running a publish. For the conceptual model behind it — the two
halves of a publish and where each safely happens — read
[Results: Publishing](/components/core/results/#publishing).

## Prerequisites

- **A reviewed run.** Publishing refuses a run whose `writeup.md` is missing or
  whose frontmatter has no valid rating — every published implementation must be
  framed by a human assessment. Write the review first; see
  [Reviewing Test Run Results](/guides/reviewing-test-run-results/).
- **The GitHub CLI.** `tcab publish` shells out to `gh` to create and push the
  per-run repositories, so `gh` must be installed and authenticated on the host,
  with a token carrying `repo` and `workflow` scopes (`gh auth login` or
  `GH_TOKEN`). In the devcontainer, install it with
  `.devcontainer/tools/gh.sh`; it is not in the base image, so re-run it after a
  rebuild.
- **Release credentials.** Releasing per-run artifacts is the operator's half of
  a publish, so the operator holds the credentials it needs — a repository-host
  credential and the build-deploy token. See
  [CLI Authentication](/components/cli/overview/#authentication) for the full
  list and why each lives where it does.

## Confirm the batch with a dry run

`--dry-run` prints exactly what would be published — repository names, build
subdomains, and the dataset that would change — and each run's rating, without
creating, pushing, or committing anything:

```sh
tcab publish runs/<id>/run-record.json --dry-run
```

This is the fastest way to confirm a batch is fully reviewed before publishing
for real. Because the review is known locally, a single run missing it stops the
**whole** batch before anything is released, so a sweep is never left half
published. `publish` takes multiple record paths for exactly this batch case:

```sh
tcab publish runs/<a>/run-record.json runs/<b>/run-record.json --dry-run
```

## Publish

```sh
tcab publish runs/<id>/run-record.json
```

The operation is idempotent: re-running it on an already-published run is safe.
`--force` re-runs the work anyway when you need to refresh a release. A publish
releases three things (see [Results](/components/core/results/#publishing) and
[Generated Code](/components/core/results/#generated-code)):

- **Source** — each run's collected implementation is pushed to its **own**
  public repository, keeping results independent and mapping onto per-run hosting.
  The implementation must include a README and whatever documentation a user needs
  to clone and run it locally; requiring that is part of every test case.
- **Playable build** — the built implementation is deployed to Cloudflare Pages
  under a per-run branch alias and served at its own `<run-id>.<project>.pages.dev`
  root, which is what keeps it playable exactly as the test case's
  [build interface](/components/core/test-cases/#design-requirements) and the
  [load check](/components/core/validation/#load-check) already require.
- **Gallery** — the run record, with its source and build links filled in, plus
  the run's review, is submitted to the [backend](/components/backend/overview/),
  which records it and regenerates the public snapshot the
  [site](/components/site/overview/) is built from. Submitting requires the
  operator to be authenticated to the backend, which only accepts pushes from
  authorized users.

The backend performs this last, synchronized half alone, so two operators
publishing at once cannot race on the store or the snapshot.

## Preview before you publish

You do not have to publish to see a run in the gallery. The dev server plays
produced-but-unpublished runs locally, review and all, so you can confirm
everything looks right first:

```sh
npm run dev -w @test-cabinet/site
```

See [Reviewing Test Run Results](/guides/reviewing-test-run-results/#play-the-build)
for how the local preview works.
