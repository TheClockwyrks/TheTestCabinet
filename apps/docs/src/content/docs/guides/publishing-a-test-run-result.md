---
title: Publishing a Test Run Result
---

A run is local until it reaches the gallery, and it gets there through three
explicit steps — **push**, **review**, **publish** — split so that the person who
*ran* a model need not be the only one who *judges* it (see
[Results: Lifecycle](/components/core/results/#lifecycle)):

- **Push** releases a finished run's source and build and stores its
  [run record](/components/core/run-records/) on the backend **without** a review.
  The run stays **private** — not in the gallery — but its build is playable, so it
  can be reviewed.
- **Review** is anyone (typically *not* the operator) submitting an assessment for
  a pushed run; see [Reviewing Test Run Results](/guides/reviewing-test-run-results/).
  A run may gather several reviews, one per account.
- **Publish** flips a pushed, reviewed run **public**. It is refused unless the run
  has at least one review.

This guide covers driving these from the [CLI](/components/cli/overview/), the path
for scripting and batch sweeps. You can also do each interactively from the
[Tauri desktop app](/components/tauri/overview/) or the
[web console](/components/web/overview/): open a run and use its push, review, and
publish actions, which run exactly the same operations. The final product is
released as it is — bugs and all — rather than reduced to a score (see
[Results](/components/core/results/)).

## Prerequisites

- **An account, logged in.** Push, review, and publish all require an
  [account](/components/backend/overview/#accounts): the backend records who acted
  and attributes each review to them. Register or log in once, which stores a
  bearer token at `~/.config/tcab/credentials.json`:

  ```sh
  tcab register --username ada --display-name "Ada"   # first time
  tcab login --username ada                            # thereafter
  ```

  See [Register and Log In](/quickstarts/register-and-login/).
- **The GitHub CLI.** Pushing shells out to `gh` to create and push the per-run
  repositories, so `gh` must be installed and authenticated on the host, with a
  token carrying `repo` and `workflow` scopes (`gh auth login` or `GH_TOKEN`). In
  the devcontainer, install it with `.devcontainer/tools/gh.sh`; it is not in the
  base image, so re-run it after a rebuild.
- **Release credentials.** Releasing per-run artifacts is the operator's half of a
  push, so the operator holds the credentials it needs — a repository-host
  credential and the build-deploy token. See
  [CLI Authentication](/components/cli/overview/#authentication) for the full list
  and why each lives where it does.
- **A review, before you publish.** Publishing refuses a run with no review. For
  the solo path below, your local `writeup.md` (a valid rating per domain and a
  non-empty body) supplies it; write the review first — see
  [Reviewing Test Run Results](/guides/reviewing-test-run-results/).

## The solo path: `tcab publish`

When the same person ran the model, played it, and vouches for it, `tcab publish`
collapses all three steps — push, self-review, publish — into one idempotent,
batch-capable command. It is the fast path for sweeps you review yourself.

`--dry-run` prints exactly what would happen — repository names, build subdomains,
the dataset that would change, and each run's rating — without creating, pushing,
or committing anything:

```sh
tcab publish runs/<id>/run-record.json --dry-run
```

Because the review is known locally, a single run missing it stops the **whole**
batch before anything is released, so a sweep is never left half published.
`publish` takes multiple record paths for exactly this batch case:

```sh
tcab publish runs/<a>/run-record.json runs/<b>/run-record.json --dry-run
tcab publish runs/<a>/run-record.json runs/<b>/run-record.json   # for real
```

The operation is idempotent: re-running it on an already-published run is safe.
`--force` re-runs the work anyway when you need to refresh a release. It releases
three things (see [Results](/components/core/results/#lifecycle) and
[Generated Code](/components/core/results/#generated-code)):

- **Source** — each run's collected implementation is pushed to its **own**
  public repository, keeping results independent and mapping onto per-run hosting.
  The implementation must include a README and whatever documentation a user needs
  to clone and run it locally; requiring that is part of every test case.
- **Playable build** — the built implementation is deployed to Cloudflare Pages
  under a per-run branch alias and served at its own `<run-id>.<project>.pages.dev`
  root, which is what keeps it playable exactly as the test case's
  [build interface](/testing/end-to-end/overview/#design-requirements) and the
  [load check](/components/core/validation/#load-check) already require.
- **Gallery** — the run record (with its links), your self-review, and the publish
  gate are submitted to the [backend](/components/backend/overview/), which records
  them and regenerates the public snapshot the [site](/components/site/overview/)
  is built from. This requires a logged-in account.

## The three-step path: push, then have others review, then publish

When a *different* person should review a run — the usual case for a benchmark you
want others to vouch for — split the steps:

```sh
tcab push runs/<id>/run-record.json          # release + store privately (no review)
# ... someone with their own account reviews the now-playable build:
tcab review runs/<id>/run-record.json --writeup writeup.md
# ... once the run has at least one review, an operator publishes it:
tcab publish runs/<id>/run-record.json
```

`push` releases the source and build and stores the record on the backend
**without** a review; the run is private but its build is playable, so reviewers
can assess it. `review` submits a review attributed to *its own* account — a run
gathers one review per account. The final `publish` flips the run public and is
refused if no review exists. Each of the three requires a logged-in account; the
backend performs the synchronized publish half alone, so two operators publishing
at once cannot race on the store or the snapshot.

## Preview before you publish

You do not have to publish to see a run in the gallery. The dev server plays
produced-but-unpublished runs locally, review and all, so you can confirm
everything looks right first:

```sh
npm run dev -w @test-cabinet/site
```

See [Reviewing Test Run Results](/guides/reviewing-test-run-results/#play-the-build)
for how the local preview works.
