---
title: HTTP API
---

The backend exposes a single HTTP API that every other component talks to.
Runners resolve test case definitions through it, operators review and publish
runs to it, and reporters read published runs back from it. This page is the
authoritative contract for that definition-and-run surface.

The run queue (`/jobs/…`) and the publish queue (`/publish-jobs/…`) are part of
the same API and are specified with the components that drive them: see
[Dispatcher](/components/dispatcher/overview/) and
[Driver](/components/driver/overview/).

## Conventions

- The API is JSON over HTTP. Request and response bodies are camelCase, matching
  the [run record](/components/core/run-records/) contract.
- A collection of objects is returned wrapped, under a named key (for example
  `{ "testCases": [...] }`), so the response can grow new fields without
  breaking clients. The three reads that return a plain list of values are bare
  JSON arrays: the validation-file keys, a run's events, and a jam's prior
  READMEs.
- Timestamps are RFC 3339 strings.
- Harness slugs are those defined in [Harnesses](/components/core/harnesses/).
- Ratings are the five tiers defined in
  [Reviews](/components/core/results/#reviews): `flawless`, `great`, `passable`,
  `scuffed`, `broken`.
- The reads on this page are open. The mutating run endpoints require an
  `Authorization: Bearer <token>` header identifying the acting account, which
  the backend verifies against the [auth service](/components/auth/overview/). A
  missing or invalid token is a `401`; an auth service that cannot be reached to
  answer is a `502`. See
  [Authentication](/components/backend/overview/#authentication).
- Errors use one envelope across every endpoint, paired with an HTTP status
  (`400`, `401`, `404`, `409`, `422`, `500`, `502`):

  ```jsonc
  { "error": { "code": "string", "message": "string" } }
  ```

  Schema:
  [`backend-api/error.schema.json`](https://docs.testcabinet.ai/schema/backend-api/error.schema.json).

Container images are resolved by each runner from its own registry
configuration, so they are absent from this API. See
[Execution](/components/core/execution/#containerization).

## Health and client configuration

### `GET /healthz`

Liveness and readiness probe. Returns the service status and the API contract
version.

### `GET /config`

The per-deployment URLs a console needs to reach the data plane: `artifactsUrl`,
`arenaUrl`, `grafanaUrl`, and `snapshotUrl` (the public read base of the
snapshot bucket). Each is `null` when the deployment configures no such service,
and the console degrades that feature. An open read.

## `POST /ingest`

Scan the repository checkout the backend ingests from. New or changed [test case
versions](/testing/end-to-end/overview/) are copied into the backend's store,
with each reference mockup rendered to a screenshot (see [Reference
rendering](#reference-rendering)). An already-ingested, unchanged version is a
no-op unless re-ingestion is forced. A whole-catalog scan also prunes any
`(slug, version)` the checkout no longer declares, keeping the ones a stored run
still references.

The request body is optional JSON:

```jsonc
{
  "testCases": ["carom", "coil@v1.1.0"], // restrict the scan (default: all)
  "force": true,             // re-ingest even versions already in the store
  "catalogVersion": "a1b2c3" // tag a whole-catalog ingest with its content version
}
```

Each `testCases` entry is either a bare case id, its slug or folder name,
expanding to every version the case declares (`"carom"`), or a version-qualified
`id@version` targeting exactly that version (`"coil@v1.1.0"`). The
version-qualified form re-ingests a single edited version without re-rendering
the case's others.

`force` overwrites a version already stored and re-renders its references. It is
for development iteration on a version no run has been published against. A
version that published runs reference is immutable and is revised by adding a
new version.

`catalogVersion` is an opaque token identifying the catalog content of a
whole-catalog ingest, such as the calling build's commit. The backend records it
in the store and, while the token is unchanged, reuses the already-ingested
versions instead of re-rendering them, because the store already holds exactly
that catalog. A changed or first-seen token forces a full re-ingest and advances
the recorded marker, so content that changed under an unchanged version string
is still picked up. The marker lives in the store, so a fresh store re-ingests
unconditionally. A partial scan ignores `catalogVersion` and leaves the marker
untouched.

A full re-render can take a minute or more, so the response shape is content
negotiated. By default the call answers once with the full JSON report. A client
that sends `Accept: application/x-ndjson` receives a streamed progress feed of
[NDJSON](https://github.com/ndjson/ndjson-spec) objects, one per line, flushed
as each version finishes. Both paths run the identical scan. The lines are
discriminated by an `event` tag:

```jsonc
{ "event": "start", "total": 31 }                  // once, before the first version
{ "event": "version", "index": 1, "total": 31,     // one per completed version
  "slug": "carom", "version": "v1.0.0",
  "ingested": true, "renderedReferences": 3 }
{ "event": "done", "total": 31, "ingested": 25, "skipped": 6 } // closing summary
{ "event": "error", "message": "…" }               // closing line if the scan aborts
```

The stream has already sent a `200` by the time it knows the outcome, so a late
failure arrives as a closing `error` line rather than an HTTP error status.
`scripts/reingest.sh` consumes this feed.

A scan that actually (re)ingested a version queues a [public
snapshot](/components/backend/snapshot/) refresh, so a repopulated or edited
catalog re-exports corrected case metadata.

## Test case resolution

These endpoints are how a runner resolves the definition it needs to seed and
validate a run, sourced from the backend's store rather than a local checkout.

### `GET /test-cases`

The catalog: every ingested case and its available versions, under `testCases`.
Experimental versions are included only when the backend is configured to offer
them.

```jsonc
{
  "testCases": [
    { "slug": "carom", "versions": ["v1.0.0", "v1.1.0"] }
  ]
}
```

Schema:
[`backend-api/test-case-catalog.schema.json`](https://docs.testcabinet.ai/schema/backend-api/test-case-catalog.schema.json).

### `GET /test-cases/{slug}/versions`

The available versions for one case, echoing the requested `slug`. `404` if the
slug is unknown.

```jsonc
{ "slug": "carom", "versions": ["v1.0.0", "v1.1.0"] }
```

Schema:
[`backend-api/test-case-versions.schema.json`](https://docs.testcabinet.ai/schema/backend-api/test-case-versions.schema.json).

### `GET /test-cases/{slug}/versions/{version}`

Resolve an exact, immutable test case version: the full manifest a runner needs.
This is the authored version with three transformations applied so a runner with
no checkout can consume it:

- Host paths become store-relative `source` keys. Spec and asset bodies stay out
  of the response; the runner fetches each by key from the [artifact
  route](#get-test-casesslugversionsversionartifactspath).
- References resolve to a `mediaUrl` the backend serves the stored media from.
  The runner receives no mockup HTML.
- The prompt template is served inline, because the runner renders it locally,
  and each variant additionally carries the prompt already rendered for it.

A representative response:

```jsonc
{
  "slug": "carom",
  "version": "v1.0.0",
  "name": "Carom",
  "difficulty": "easy",
  "testType": "end-to-end",
  "tags": ["arcade", "2d"],
  "summary": "A two-paddle rally game.",
  "description": "## Carom\n…",
  "changelog": "…",
  "maxRuntimeSeconds": 1800,
  "build": { "install": "npm ci", "build": "npm run build" },
  "promptTemplate": "…handlebars source…",
  "commonSpecs": [
    { "source": "specs/overview.hbs", "dest": "specs/overview.md", "template": true }
  ],
  "assets": [
    { "source": "assets/ball.png", "dest": "assets/ball.png" }
  ],
  "variants": [
    {
      "slug": "base",
      "name": "Base",
      "description": null,
      "prompt": "…rendered for this variant…",
      "specs": [],
      "references": [
        {
          "view": "title",
          "kind": "rendered",
          "mediaUrl": "/test-cases/carom/versions/v1.0.0/references/base/title.png"
        }
      ],
      // Variant-specific reviewer checklist items, for the consoles' guided
      // review. Empty when the variant declares none.
      "reviewItems": []
    }
  ],
  "commonReferences": [
    {
      "view": "gameplay",
      "kind": "rendered",
      "mediaUrl": "/test-cases/carom/versions/v1.0.0/references/_common/gameplay.png"
    }
  ],
  "checks": [
    {
      "view": "title",
      "name": "Title",
      "referenceView": "title",
      "actions": [{ "type": "wait", "ms": 500 }]
    }
  ],
  // Reviewer checklist items common to every variant.
  "commonReviewItems": [
    { "id": "controls", "title": "Controls", "text": "Both paddles respond to input." }
  ],
  // Known-issue errata recorded for this version. Empty when it has none.
  "errata": []
}
```

The response also carries the type-specific manifest blocks the case declares,
such as an asset case's `tool`, `output`, and per-kind spec, and a simulation,
match, or replay block. `404` if the version has not been ingested. Schema:
[`backend-api/resolved-test-case-version.schema.json`](https://docs.testcabinet.ai/schema/backend-api/resolved-test-case-version.schema.json).

### `GET /test-cases/{slug}/versions/{version}/artifacts/{path...}`

Fetch a single seeded artifact, a spec source or an asset file, by its
store-relative `source` key. Returns the raw bytes with an appropriate
`Content-Type`. A `.hbs` spec source is returned verbatim; the runner renders
it. The path is validated to resolve inside the version's store directory. `404`
if the key is unknown for the version.

### `GET /test-cases/{slug}/versions/{version}/specs/{variant}`

The variant's full seeded spec set with each body already rendered for that
variant, in seed order. This is the spec analogue of the inline prompt on the
resolved version, and it is what a console shows on its Inputs tab.

### `GET /test-cases/{slug}/versions/{version}/references/{scope}/{file}`

Fetch a reference's stored media, where `{file}` is `<view>.<ext>`. `scope` is
`_common` for a common reference or a variant slug for a variant-specific one.
The content type follows the extension. The `mediaUrl` fields in the resolved
version point here.

### `GET /test-cases/{slug}/versions/{version}/validation-files`

List the store-relative keys of every file under the version's reporter-side
automated-validation directory (`validation/`), as a sorted JSON string array,
walked recursively. It covers the debug drivers plus the shared modules they
import, such as `validation/_helpers.mjs`. A backend-driven run fetches the
whole set through the artifacts route so a script's sibling imports resolve when
the [validator](/components/core/validation/) runs it. These files are
reporter-side and are never seeded into the model's run container. The array is
empty for a version that declares no scripted items.

### `GET /test-cases/{slug}/versions/{version}/validation-baseline/{variant}/{file}`

Fetch a variant's committed baseline validation media
(`<item>__<output>.<ext>`), synthesized from the reference implementation. This
is the case-scoped invariant counterpart to a run's own validation media.

### `GET /game-jams/{slug}/prior-readmes?model=`

The gameplay READMEs of earlier runs of a [game
jam](/testing/game-jam/overview/) built by the required `model`, oldest first,
across every harness: a model repeats its own ideas whichever harness drove it.
The driver reads this before seeding a repeated jam run so the run can be briefed
on earlier entries. Earlier runs count whether or not they were published; only
those that captured a README appear.

## Reviewing, publishing, and reading runs

A run reaches the gallery through two mutating steps: attach one or more
reviews, then publish it (the [lifecycle](/components/core/results/#lifecycle)).
Each requires a bearer token. Reads require none.

A produced run's [run record](/components/core/run-records/) is stored privately
when the run finishes. The [driver](/components/driver/overview/) reports it
when it posts the job's terminal status, and the produced build and media land
on the [artifact service](/components/artifacts/overview/), playable for review.
The public release of the source repo and the Cloudflare build happens at
publish time.

`POST /jobs/{id}/status`, the driver-authenticated status endpoint that carries
that record, also accepts a `canceled` status, and it is the only status
accepted on a job already in the terminal `canceled` state. Every other late
report from a winding-down driver is discarded. A `canceled` status must carry a
run record (`422` without one), and that record is normally a complete partial
record: the driver [winds the run down
cooperatively](/components/driver/overview/#cancellation) and posts what the
ordinary post-session path produced, including metrics, the collected tree and
the session summary. The backend persists it with the events its relay
accumulated and attaches the record id to the already-canceled job. The job
keeps its `canceled` state and its cancellation detail, no completion
notification fires, and no retry is enqueued.

### `POST /runs/{id}/reviews`

Submit a [review](/components/core/results/#reviews) for a produced run: the
per-domain `ratings`, the markdown `writeup`, the checklist verdicts, and an
`editNote`. The review is attributed to the account the bearer token resolves
to; the reviewer identity is taken from the token rather than the body. A run
carries many reviews, one per account, and re-submitting from the same account
updates that account's own review.

A re-submission that changes the review is an edit. It requires a non-empty
`editNote`, keeps the original `reviewedAt`, stamps `editedAt`, and records the
prior-to-new diff as a public revision. A re-submission that changes nothing is
a no-op.

`404` if the run is unknown. `422` when the review rates no domain and records
no checklist verdict, when the writeup is empty, or when an edit arrives without
a note. Schema:
[`backend-api/review.schema.json`](https://docs.testcabinet.ai/schema/backend-api/review.schema.json).

### `POST /runs/{id}/publish`

Release a run and make it public. The endpoint gates the run (`422` when it
fails), then enqueues a per-publish `tcab-publisher` Job and answers
`202 Accepted` with the publish-job id and the live URL to observe the release
on. The run flips public when that Job reports a terminal success.

The gate refuses a run that can never be published, an infrastructure failure or
a canceled run, and it refuses a completed run carrying no review. A publishable
failure needs no review, since it has no review checklist.

```jsonc
{ "publishJobId": "clx…", "liveUrl": "/publish-jobs/clx…/live" }
```

### `DELETE /runs/{id}`

Permanently delete a run: its record, its reviews, its links, and its stored
media. A published run is refused (`422`), because a public run is in the
snapshot and the gallery. `404` if unknown. The response reports the run id and
`deleted: true`.

The run's playable build and recorded logs live in the separate [artifact
service](/components/artifacts/overview/), which the backend asks to prune the
run's tree as well. That prune is best-effort and never fails the delete; it
runs only when the artifact service URL and the service token are both
configured.

The consoles expose this as a Delete run control on the run detail page, shown
only for an unpublished run.

### `GET /runs`

List stored runs, newest first. A `state` query parameter selects which runs:

- `state=published`, the default — published runs only, ordered by publish time,
  for reporters and the public-facing views.
- `state=review` — the reviewer worklist: completed runs, pending and published,
  ordered by finish time. The failure tiers are excluded, as they carry no
  review checklist.
- `state=failures` — the publishable-failure worklist: catastrophic, timed-out,
  hung, and harness-error runs, pending and published. Infrastructure failures
  are excluded, as they are never publishable.
- `state=unreviewed` — the strict subset of the review worklist that no account
  has reviewed yet. The automatically graded test types are excluded, since no
  reviewer can clear them from the list.
- `state=unpublished` — every unpublished run whatever its terminal state,
  including infrastructure failures and operator-canceled runs, ordered by
  finish time. This is the console's produced worklist, disjoint from the
  default published listing.
- `state=any` — every recorded run, with no lifecycle predicate at all.
  Available on the summary-plus-offset path below.

A `canceled` run, one an operator killed mid-flight, reaches `state=unpublished`
and `state=any`. It can never be published, carries no review checklist, and is
not a publishable failure, so the other selectors omit it.

#### Two projections

`fields` selects how much of each run the listing returns:

- Default, `fields` omitted — the full stored run per row.
- `fields=summary` — a lightweight `RunSummary` card per row: the run's id and
  timestamps, its [subject](/components/core/run-records/#subject) including the
  [test type](/testing/overview/), [metrics](/components/core/metrics/), the
  `validationLoaded` signal, state, the aggregate `rating`, `score` and
  `reviewCount`, the denormalized case name, a performance run's fuel result,
  the ranking slice of a run's code analysis, and links. That is enough to
  render a run-list row, a card, a leaderboard entry, or a metrics aggregate
  without fetching each full record; the [detail endpoint](#get-runsid) loads
  the full record and the run's reviews one run at a time. This is the same
  summary shape the [public
  snapshot](/components/backend/snapshot/#runsjson--the-run-index) ships as its
  run index, whose schema is
  [`snapshot/runs.schema.json`](https://docs.testcabinet.ai/schema/snapshot/runs.schema.json).

#### Two pagination modes

- Cursor. `before`, the opaque cursor a previous page returned as `nextBefore`
  (the ordering timestamp of its last row), plus `limit` walks the whole set
  newest-first, page by page. The response carries the runs and the cursor for
  the next page, `null` when there are no more. It is unaffected by the filter
  and sort parameters below.
- Numbered offset. `offset` plus `limit` returns a single page of a filtered,
  sorted listing as `{ runs, total }`, where `total` is the count under the same
  filters, which is enough to drive a jump-to-page pager without walking the
  set. Available with `fields=summary`.

The offset mode additionally accepts:

- Filters `testCase`, `model`, and `harness`, each narrowing to runs matching
  that lifted subject value.
- Search `q`, a free-text match across the lifted subject columns: test case
  slug, model id, harness slug, variant, and a [gg](/gg/overview/) run's
  [configuration](/gg/configurations/) name. It matches the recorded ids rather
  than a model's resolved display name.
- Sort `sort`, one of `date` (the default), `runtime`, `tokens`, `cost`,
  `rating`, `testType`, `testCase`, `harness`, `model`, or `variant`, with `dir`
  (`asc` or `desc`), tie-broken by run id. `model` orders by the run's model or
  configuration identity: a gg run sorts by the configuration it was launched
  from, and everything else by its model id.

`limit` defaults to 50 and is clamped to 200.

### `GET /runs/{id}`

One stored run, as `{ record, reviews, published, links }`: its record with
links populated, the array of reviews it carries with each reviewer's identity,
whether it is published, and its links. `404` if unknown.

```jsonc
{
  "record": { "…": "full RunRecord, links populated" },
  "published": false,
  "reviews": [
    {
      "reviewerId": "acct_7yq…",
      "reviewer": "Ada",
      "username": "ada",
      "ratings": [{ "domain": "single-player", "rating": "great" }],
      "writeup": "Plays well, but…",
      "checklist": [],
      "reviewedAt": "2026-06-21T18:00:00Z"
    }
  ],
  "links": { "sourceRepo": "https://github.com/…", "playableBuild": "https://…" }
}
```

### `GET /runs/{id}/events`

The run's recorded normalized [event stream](/components/core/events/) as a JSON
array, empty when the run recorded none. Raw harness output is never published,
so it is not served here. This backs the run-detail Events tab. `404` for an
unknown run.

### `POST /snapshot/refresh`

Force an immediate [public snapshot](/components/backend/snapshot/)
regeneration, upload, and deploy-hook fire, outside the normal coalescing
window. The response reports whether the snapshot was refreshed, the run count
it covers, and whether the deploy hook fired.

## Reference rendering

A test case's reference mockups are rendered to screenshots once, by the
backend, at ingest. Rendering there makes the validation baseline byte-identical
across every runner: a runner downloads the rendered image, seeds it as the
visual target, and uses it as the [validation](/components/core/validation/)
baseline. Runners still need a headless browser locally for the load check and
per-check capture; only the reference baseline render lives on the backend.
