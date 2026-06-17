---
title: Results
---

A run's value is in its output: the implementation a model produced, together
with the metrics describing how it got there. The Test Cabinet publishes both so
that anyone can inspect, clone, and play the result. The final product is
released as it is, including any bugs and flaws, rather than being reduced to
graphs or a single percentage.

## Generated Code

Each published run's generated implementation must be released as its **own**
public git repository.

- Releasing each run as a standalone repository keeps results independent and maps
  cleanly onto per run hosting and embedding. See [Site](/components/site/overview/#hosting).
- The generated implementation must include a README and any other documentation
  that a user needs to clone the repository and run it locally. Requiring this
  documentation is part of every test case.

## Run Record

Each published run's [run record](/components/core/run-records/) must be uploaded
to the [backend](/components/backend/overview/), with its links pointing at the
run's source repository and playable build. The backend is the system of record
for published runs; the [public site](/components/site/overview/) is built from
a dataset the backend exports rather than from records committed to a repository.
This replaces The Test Cabinet's original "git-as-a-db" design, in which each
run record was committed directly into the site's dataset.

## Publishing

Publishing a run must be an explicit operation that takes a finished run and:

- Releases its generated code to a public repository.
- Makes its playable build available for embedding.
- Records its [run record](/components/core/run-records/) — with its links
  pointing at that repository and build — on the [backend](/components/backend/overview/).
- Includes the run's [review](#reviews) — its writeup and rating.

Mechanically this has two halves, split along where the work can safely happen.
The operator's component (the [CLI](/components/cli/overview/) or
[Tauri app](/components/tauri/overview/)) performs the **release**: it creates
the run's own public repository and pushes the generated code, and it deploys
the produced static build so the gallery can embed it. The build deploy is fully
automated — the component already holds the built output, so it uploads that
directory directly to Cloudflare Pages (`wrangler pages deploy <dir>
--branch=<run-id>`), which serves it at its own `pages.dev` subdomain root and
needs no manual step. Serving at a root rather than a subpath is what keeps a
build playable exactly as the test case's [build interface](/components/core/test-cases/#design-requirements)
and the [load check](/components/core/validation/#load-check) already require.
Releasing per-run artifacts has no shared state — each run is its own repository
and its own build — so each operator does it directly and holds the credentials
it needs to. It then submits the run record, the review, and the resulting links
to the backend.

The backend performs the **synchronized** half: it ingests the record and review
into its store and regenerates the public snapshot the site is built from.
Because the backend is the single entity doing this, two operators publishing at
once cannot race on the store or the snapshot. See
[Publishing and Synchronization](/components/backend/overview/#publishing-and-synchronization).
Submitting to the backend requires the operator to be authenticated to it; it only
accepts pushes from authorized users (see
[Backend](/components/backend/overview/#authentication)).

Publishing must refuse a run that has no review: a run cannot be released
without a hand-written writeup and a rating. This keeps every published
implementation framed by a human assessment rather than dropped onto the site as
raw output.

The publish operation must be idempotent and must be usable in batch, so that a
sweep producing many runs can be published without manual handling of each one.
When publishing a batch, a single run missing its review must stop the batch
before anything is released — the review is known locally, so the whole batch is
checked before any code is pushed, and a sweep is never left half published.

## Reviews

Every published run carries a hand-written **review**: a short
[writeup](/components/site/overview/#implementation-writeups) the site shows
before the playable build, together with a **rating** that records the
reviewer's overall assessment.

A review is curatorial — authored separately by a person after playing the
finished build, rather than emitted by a run — and it is **not** part of the
[run record](/components/core/run-records/) contract. The rating travels with
the writeup (in its frontmatter), not in the record. Publishing makes the review
available to the site alongside the run record.

The rating is one of four hand-assigned tiers — **flawless**, **great**,
**scuffed**, or **broken**, in descending order of fidelity to the spec. What
each tier means is reviewer judgment rather than anything a run emits, so the
criteria for choosing one live with the review workflow; see
[Reviewing Test Run Results](/guides/reviewing-test-run-results/#write-the-review).

The rating is a subjective, per-run signal. It is shown alongside a run but is
never aggregated or used to rank runs (see [Site](/components/site/overview/)).
