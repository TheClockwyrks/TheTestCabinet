---
title: Publishing a Test Run Result
---

A produced run reaches the gallery through two explicit steps — **review** and
**publish** — split so that the person who *ran* a model need not be the only one
who *judges* it (see [Results: Lifecycle](/components/core/results/#lifecycle)):

- A produced run's [run record](/components/core/run-records/) is stored on the
  backend **automatically** when the run finishes (the driver reports it), and its
  build is playable off the [artifact service](/components/artifacts/overview/). The
  run stays **private** — not in the gallery — but is reviewable straight away.
- **Review** is anyone (typically *not* the operator) submitting an assessment for
  a produced run; see [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/).
  A run may gather several reviews, one per account.
- **Publish** releases the reviewed run's source and build publicly and flips it
  **public**. It is refused unless the run has at least one review.

This guide covers driving these from the [CLI](/components/cli/overview/), the path
for scripting and batch sweeps. You can also do each interactively from the
[Tauri desktop app](/components/tauri/overview/) or the
[web console](/components/web/overview/): open a run and use its review and
publish actions, which run exactly the same operations. The final product is
released as it is — bugs and all — rather than reduced to a score (see
[Results](/components/core/results/)).

All of these operate by **backend run id** — the run executed in-cluster and its
record is already stored on the backend, so there is no local run folder to act on.

## Prerequisites

- **An account, logged in.** Review and publish both require an
  [account](/components/backend/overview/#accounts): the backend records who acted
  and attributes each review to them. Register or log in once, which stores a
  bearer token at `~/.config/tcab/credentials.json`:

  ```sh
  tcab register --username ada --display-name "Ada"   # first time
  tcab login --username ada                            # thereafter
  ```

  See [Register and Log In](/quickstarts/setup/register-and-login/).
- **A review, before you publish.** Publishing refuses a run with no review. For
  the solo path below, a `<run-id>.md` writeup in the working directory (a valid
  rating per domain and a non-empty body) supplies it; write the review first — see
  [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/).

You do **not** need `gh`, a Cloudflare token, or any other release credential: the
public release — the per-run GitHub repository and the Cloudflare Pages build —
runs server-side in the backend's `tcab-publisher` Job at publish time.

## The solo path: `tcab publish`

When the same person ran the model, played it, and vouches for it, `tcab publish`
collapses both steps — self-review and publish — into one batch-capable command. It
is the fast path for sweeps you review yourself.

`--dry-run` prints exactly what would happen — each run's rating and what would be
published — without submitting any review or flipping any run public:

```sh
tcab publish <run-id> --dry-run
```

Because the review is known locally (a `<run-id>.md` writeup per run), a single run
missing it stops the **whole** batch before anything is published, so a sweep is
never left half published. `publish` takes multiple run ids for exactly this batch
case:

```sh
tcab publish <run-a> <run-b> --dry-run
tcab publish <run-a> <run-b>   # for real
```

Publishing a reviewed run releases three things (see
[Results](/components/core/results/#lifecycle) and
[Generated Code](/components/core/results/#generated-code)), all done by the
backend's `tcab-publisher` Job:

- **Source** — the run's collected implementation is released to its **own**
  public repository, keeping results independent and mapping onto per-run hosting.
  The implementation must include a README and whatever documentation a user needs
  to clone and run it locally; requiring that is part of every test case.
- **Playable build** — the built implementation is deployed to Cloudflare Pages
  under a per-run branch alias and served at its own `pages.dev` root, which is what
  keeps it playable exactly as the test case's
  [build interface](/testing/end-to-end/overview/#design-requirements) and the
  [load check](/components/core/validation/#load-check) already require.
- **Gallery** — the run is flipped public and the backend regenerates the public
  snapshot the [site](/components/site/overview/) is built from.

## The split path: others review, then publish

When a *different* person should review a run — the usual case for a benchmark you
want others to vouch for — split the steps. A produced run is already stored and its
build playable, so a reviewer can assess it straight away:

```sh
# someone with their own account reviews the run's playable build:
tcab review <run-id> --writeup writeup.md
# ... once the run has at least one review, an operator publishes it:
tcab publish <run-id>
```

`review` submits a review attributed to *its own* account — a run gathers one
review per account. The `publish` flips the run public (running the release) and is
refused if no review exists. Both require a logged-in account; the backend performs
the synchronized publish half alone, so two operators publishing at once cannot race
on the store or the snapshot.

## Preview before you publish

You do not have to publish to see a run in the gallery. The dev server plays
produced-but-unpublished runs locally, review and all, so you can confirm
everything looks right first:

```sh
npm run dev -w @test-cabinet/site
```

See [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/#play-the-build)
for how the local preview works.
