---
title: Results
---

A run's value is in its output: the implementation a model produced, together
with the metrics describing how it got there. The Test Cabinet publishes both so
that anyone can inspect, clone, and play the result. The final product is
released as it is, including any bugs and flaws: a run's score and reviews
*frame* the playable build rather than standing in for it, so a number never
replaces seeing the implementation run.

A finished run reaches the public gallery through three distinct steps —
**push**, **review**, and **publish** — each owned by a different actor and
separated on purpose, so that the person who *ran* a model is not the only person
who can *judge* it (see [Lifecycle](#lifecycle)).

## Generated Code

Each published run whose model **writes code** — every type except
asset-generation — must be released as its **own** public git repository.

- Releasing each run as a standalone repository keeps results independent and maps
  cleanly onto per run hosting and embedding. See [Site](/components/site/overview/#hosting).
- The generated implementation must include a README and any other documentation
  that a user needs to clone the repository and run it locally. Requiring this
  documentation is part of every code-writing test case.
- **Asset-generation runs are the exception**: their authoritative output is the
  recorded sequence of drawing operations (uploaded to the backend as the run's
  assets), not a source tree, so **no per-run repository is created** and the run
  carries no source link. The local run folder is still a git repo (seeded like
  any other), but pushing one never creates a repository on GitHub.

## Run Record

Each finished run's [run record](/components/core/run-records/) must be uploaded
to the [backend](/components/backend/overview/), with its links pointing at the
run's source repository and playable build. The backend is the system of record
for runs; the [public site](/components/site/overview/) is built from a dataset
the backend exports rather than from records committed to a repository. This
replaces The Test Cabinet's original "git-as-a-db" design, in which each run
record was committed directly into the site's dataset.

## Lifecycle

A run reaches the gallery through three explicit steps. Splitting them is what
lets a run be reviewed by *someone other than the operator who produced it*, and
it is what keeps the public gallery to runs a human has actually assessed.

### Push

Pushing a run is the **release** step: an operator takes a finished run and

- Releases its generated code to its own public repository (skipped for an
  asset-generation run, which has no code to release).
- Deploys its playable build so it can be embedded — and, crucially, *played and
  reviewed*.
- Records its [run record](/components/core/run-records/), with its links
  pointing at that repository and build, on the [backend](/components/backend/overview/).

A pushed run is **private**: it is stored on the backend and its build is
playable, but it is **not** in the public gallery. Push carries **no review** —
its whole purpose is to make a finished run reviewable, by anyone, before it goes
public.

Mechanically the release work is the operator's, split along where the work can
safely happen. The operator's component (the [CLI](/components/cli/overview/) or
[Tauri app](/components/tauri/overview/)) creates the run's own public repository
and pushes the generated code, and it deploys the produced static build so the
gallery can embed it. The build deploy is fully automated — the component already
holds the built output, so it uploads that directory directly to Cloudflare Pages
(`wrangler pages deploy <dir> --branch=<run-id>`), which serves it at its own
`pages.dev` subdomain root and needs no manual step. Serving at a root rather
than a subpath is what keeps a build playable exactly as the test case's
[build interface](/testing/end-to-end/overview/#design-requirements) and the
[load check](/components/core/validation/#load-check) already require. Releasing
per-run artifacts has no shared state — each run is its own repository and its own
build — so each operator does it directly and holds the credentials it needs to.
It then submits the run record and the resulting links to the backend.

Pushing is idempotent and usable in batch, so a sweep producing many runs can be
released without manual handling of each one.

#### Secret redaction

A run executes with a real provider API key in its container, so a model that
dumps its environment can have written that key into a source file it produced.
The backend that a run streams to is private and trusted and keeps the captured
data as-is; the exposure is only where a run's data crosses into the open
internet. Release therefore redacts secrets at each public-egress point, *as the
operator releases the run*:

- **The public source repository.** Before the generated code is committed and
  pushed, every staged file is scanned and any leaked key is rewritten in place.
- **The Cloudflare Pages build.** Before the static output is deployed, the built
  tree is scanned the same way, in case a key was carried through the build into
  an emitted asset.

Because release runs on the operator's host, the scan matches the exact key
values from the operator's environment (the keys a run here would have used) as
well as any provider-shaped `sk-…` token, and replaces each with `[REDACTED]`.
The third public surface — the run's record and event stream in the public
snapshot — is scrubbed by the backend as it builds that snapshot; see
[the snapshot's per-run record](/components/backend/snapshot/#runsrun-idjson--per-run-record).

### Review

Reviewing a pushed run is the **assessment** step. Anyone with an
[account](/components/backend/overview/#accounts) — typically a *different* person
than the operator who pushed it — plays the now-embeddable build and submits a
[review](#reviews): a writeup, a rating per scoring domain, and the checklist
verdicts. Every review is attributed to the authenticated account that wrote it.

A run may carry **multiple reviews — one per account**. A reviewer cannot submit
two reviews for the same run; submitting again replaces their own. This is how a
run accumulates more than one independent human judgement before it goes public.

### Publish

Publishing is the **gate** that flips a pushed run **public**. It is a small,
explicit step — it adds nothing to the run beyond making it visible. What it
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

### `tcab publish`: the solo path

Push, review, and publish are separate so that *different people* can perform
them. When the same person does all three — they ran the model, they played it,
and they vouch for it — the CLI's **`tcab publish`** is a convenience that does
all three in one step: it pushes the run, self-reviews it (with the writeup and
ratings the operator wrote), and publishes it. It is push + self-review + publish
collapsed, idempotent and batch-capable. A batch is checked for its reviews up
front — the review is known locally — so a single run missing one stops the whole
batch before anything is released, and a sweep is never left half published.

Submitting to the backend requires the caller to be **authenticated**: push,
review, and publish each require a bearer token, attributed to an account (see
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

A case declares one or more **scoring domains** (for example a game's
single-player and versus modes); the reviewer assigns one of four tiers —
**flawless**, **great**, **scuffed**, or **broken**, in descending order of
fidelity to the spec — to each. Within one review the **overall rating** is the
*worst* across its domains, so a flawless mode cannot mask a broken one. What each
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
