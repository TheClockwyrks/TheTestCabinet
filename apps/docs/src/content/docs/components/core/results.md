---
title: Results
---

A run's value is in its output: the implementation a model produced, together
with the metrics describing how it got there. The Test Cabinet publishes both so
that anyone can inspect, clone, and play the result. The final product is
released as it is, including any bugs and flaws: a run's score and reviews
*frame* the playable build rather than standing in for it, so a number never
replaces seeing the implementation run.

A finished run reaches the public gallery through two distinct steps —
**review** and **publish** — separated on purpose, so that the person who *ran* a
model is not the only person who can *judge* it. A run's record is stored on the
backend automatically when it finishes (the [driver](/components/driver/overview/)
reports it), so it is reviewable as soon as it is produced; the public **release**
of its code and build happens only at publish (see [Lifecycle](#lifecycle)).

## Generated Code

Each published run whose model **writes code** — every type except
asset-generation — must be released as its **own** public git repository.

- Releasing each run as a standalone repository keeps results independent and maps
  cleanly onto per run hosting and embedding. See [Site](/components/site/overview/#hosting).
- The generated implementation must include a README and any other documentation
  that a user needs to clone the repository and run it locally. Requiring this
  documentation is part of every code-writing test case.
- **Asset-generation runs are the exception**: their authoritative output is the
  recorded sequence of operations (uploaded to the backend as the run's assets),
  not a source tree, so **no per-run repository is created** and the run carries no
  source link. The run folder is still a git repo (seeded like any other), but
  publishing one never creates a repository on GitHub. This covers all four
  [asset kinds](/testing/asset-generation/overview/#asset-kinds) — a sprite or
  sprite-sheet run uploads its regenerated images, and a
  [voxel](/testing/asset-generation/overview/#voxel-models-and-rigs) run instead
  uploads its emitted per-part `.glb` (plus `voxels.json` for the cube tools) and (for an
  animated model) `rig.json`, so
  the review UI can render an interactive 3D model: a `voxel-model` auto-rotates and
  a `voxel-animation` gives one orbit-drag viewer per animation with a control per
  caller joint. See [Evaluation](/testing/asset-generation/evaluation/#voxel-validation).

## Run Record

Each finished run's [run record](/components/core/run-records/) must be uploaded
to the [backend](/components/backend/overview/), with its links pointing at the
run's source repository and playable build. The backend is the system of record
for runs; the [public site](/components/site/overview/) is built from a dataset
the backend exports rather than from records committed to a repository. This
replaces The Test Cabinet's original "git-as-a-db" design, in which each run
record was committed directly into the site's dataset.

## Lifecycle

A run reaches the gallery through two explicit steps — **review** and
**publish** — after the automatic storage every produced run gets when it
finishes. Splitting review from publish is what lets a run be reviewed by
*someone other than the operator who produced it*, and it is what keeps the public
gallery to runs a human has actually assessed.

### Stored when produced

A run needs no operator action to become reviewable. When the
[driver](/components/driver/overview/) finishes a run it reports the produced
[run record](/components/core/run-records/) to the
[backend](/components/backend/overview/), which stores it **privately**, and it
uploads the produced tree — the playable build, proof and asset media — to the
[artifact service](/components/artifacts/overview/). The run is now stored but
**not** in the public gallery, and its build is playable *for review* straight off
the artifact service. No code has been released publicly yet — that happens only at
publish.

### Review

Reviewing a produced run is the **assessment** step. Anyone with an
[account](/components/backend/overview/#accounts) — typically a *different* person
than the operator who produced it — plays the run's build (served by the
[artifact service](/components/artifacts/overview/)) and submits a
[review](#reviews): a writeup, a rating per scoring domain, and the checklist
verdicts. Every review is attributed to the authenticated account that wrote it.

A run may carry **multiple reviews — one per account**. A reviewer cannot submit
two reviews for the same run; submitting again replaces their own. This is how a
run accumulates more than one independent human judgement before it goes public.

### Publish

Publishing is the step that **releases** a reviewed run and flips it **public**.
It is the only point at which a run's outputs cross onto the open internet. What it
requires depends on the run's [terminal state](/components/core/run-records/#status):

- A **`completed`** run is published through review: the backend **refuses to
  publish one that has no review** (`422`).
- A **`catastrophic`** or **`timed_out`** run is a publishable model *failure*
  (real signal at the benchmark's edge — a model that produced unbuildable output
  or never converged). It has no review checklist to complete, so publishing it
  needs **no review**; it is published from a separate "publish failures"
  affordance rather than the review flow.
- An **`infrastructure`** failure is the Test Cabinet's own fault and is **never
  publishable** (`422`), no matter what reviews it carries.

Publishing is **asynchronous**: the backend gates the run and enqueues a
per-publish `tcab-publisher` Job, which does the release work and reports back. The
release Job:

- Releases the run's generated code to its own public repository (skipped for an
  asset-generation run, which has no code to release).
- Deploys the produced static build to Cloudflare Pages
  (`wrangler pages deploy <dir> --branch=<run-id>`), which serves it at its own
  `pages.dev` subdomain root — needing no manual step and keeping the build
  playable exactly as the test case's
  [build interface](/testing/end-to-end/overview/#design-requirements) and the
  [load check](/components/core/validation/#load-check) require.

The backend records the resulting links on the run and, once the Job reports a
terminal success, flips the run public and regenerates the snapshot. Releasing
per-run artifacts has no shared state — each run is its own repository and its own
build — so each release is independent and the Job holds the credentials it needs.
The release is idempotent: a re-publish reuses an existing repository rather than
recreating it, but still re-commits and re-pushes the implementation — a clean
no-op when the repository is already current, and the recovery path when an
earlier publish created the repository but its first push never landed. The push
is retried through GitHub's brief permission-propagation lag on a freshly created
organization repository (a short settle before the first push, then bounded
retries with backoff), so a transient post-create `403` self-heals instead of
failing the publish.

The public snapshot, and therefore the gallery, contains **only published runs**.
A published failure shows its generated source but has no playable build (it
produced none); its catastrophic/timeout outcome is reported as a per-model
statistic, separate from the score that ranks the runs that were at least
workable.

The backend performs publish (and the snapshot regeneration it triggers) as the
**synchronized** half of the lifecycle: because the backend is the single entity
doing this, two operators publishing at once cannot race on the store or the
snapshot. See
[Publishing and Synchronization](/components/backend/overview/#publishing-and-synchronization).

#### Secret redaction

A run executes with a real provider API key in its container, so a model that
dumps its environment can have written that key into a source file it produced.
The backend a run streams to is private and trusted and keeps the captured data
as-is; the exposure is only where a run's data crosses into the open internet — at
**release**. Publishing therefore redacts secrets at each public-egress point, as
the release Job produces it:

- **The public source repository.** Before the generated code is committed and
  pushed, every staged file is scanned and any leaked key is rewritten in place.
- **The Cloudflare Pages build.** Before the static output is deployed, the built
  tree is scanned the same way, in case a key was carried through the build into
  an emitted asset.

The scrubber matches any provider-shaped `sk-…` token (and, where the release Job
holds them, the exact key values from its environment), replacing each with
`[REDACTED]`. The third public surface — the run's record and event stream in the
public snapshot — is scrubbed by the backend as it builds that snapshot; see
[the snapshot's per-run record](/components/backend/snapshot/#runsrun-idjson--per-run-record).

### `tcab publish`: the solo path

Review and publish are separate so that *different people* can perform them. When
the same person does both — they ran the model, they played it, and they vouch for
it — the CLI's **`tcab publish`** is a convenience that does both in one step: it
self-reviews the run (with the writeup and ratings the operator wrote) and
publishes it. It is batch-capable: a batch is checked for its reviews up front —
the review is known locally — so a single run missing one stops the whole batch
before anything is published.

Submitting to the backend requires the caller to be **authenticated**: review and
publish each require a bearer token, attributed to an account (see
[Accounts and bearer tokens](/components/backend/overview/#accounts)). Reads stay
open.

## Reviews

A run carries one or more hand-written **reviews**. A single review is a short
[writeup](/components/site/overview/#implementation-writeups) the site shows
before the playable build, together with a **rating per scoring domain**, a
**checklist** of verdicts on the items the test case asked the reviewer to check,
and the **reviewer's identity** — the account that authored it. The verdicts and
the items' point weights produce that review's numeric **score**.

A review is curatorial — authored separately by a person after playing the
finished build, rather than emitted by a run — and it is **not** part of the
[run record](/components/core/run-records/) contract. The per-domain ratings and
the checklist verdicts travel with the writeup (in its frontmatter), not in the
record. Publishing makes a run's reviews available to the site alongside the run
record.

The **checklist** records a binary verdict — **pass** or **fail**, with an
optional note — for each reviewer checklist item the test case version declares
(see the version manifest's
[`review_item`s](/testing/end-to-end/manifests/)). Every declared item must carry
a verdict before a review can be submitted, so a reviewer cannot silently skip a
requirement the case author called out. Each item is worth a **weight** in
points: a `pass` earns the item's weight and a `fail` earns none, and a review's
**score** is the earned weight over the total declared weight.

A case declares one or more **common scoring domains** (for example a game's
single-player and versus modes), and the run's variant may add its own; the
reviewer assigns one of four tiers — **flawless**, **great**, **scuffed**, or
**broken**, in descending order of fidelity to the spec — to each domain in the
run variant's **effective** set (common plus that variant's own). Within one
review the **overall rating** is the *worst* across those domains, so a flawless
mode cannot mask a broken one. What each
tier means is reviewer judgment rather than anything a run emits, so the criteria
for choosing one live with the review workflow; see
[Reviewing Test Run Results](/guides/reviewing-test-run-results/#write-the-review).

### Aggregating across reviews

A published run may carry several reviews, so the numbers shown for the run are
aggregated across them:

- The run's **score** is the **average** of its reviews' scores — each review's
  earned weight over total declared weight, averaged across every review.
- The run's **overall rating** is the **worst (lowest)** rating across all of its
  reviews: still the worst across domains *within* each review, then the worst of
  those across reviews. One reviewer marking a domain `broken` pulls the run's
  overall rating to `broken`, however generous the others were.

The aggregate rating and score are shown together on the run, each review's
per-domain ratings break it down (attributed to its reviewer), and each test
case's [leaderboard](/components/site/overview/#leaderboard) ranks models by the
aggregate score.
