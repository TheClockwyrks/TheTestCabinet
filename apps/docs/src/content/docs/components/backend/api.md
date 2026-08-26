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
[Driver](/components/driver/overview/). The bulk cancel controls over that queue
are the exception and are specified [here](#stopping-runs-in-bulk), because they
are an operator surface rather than a dispatch one.

## Conventions

- The API is JSON over HTTP. Request and response bodies are camelCase, matching
  the [run record](/components/core/run-records/) contract.
- A collection of objects is returned wrapped, under a named key (for example
  `{ "testCases": [...] }`), so the response can grow new fields without
  breaking clients. The three reads that return a plain list of values are bare
  JSON arrays: the validation-file keys, a run's events, and a jam's prior
  READMEs. The console-only [reviewer scheduling](#coverage-plans-ladders-and-the-review-buffer)
  collections are bare arrays too, for the reason given there.
- Timestamps are RFC 3339 strings.
- Harness slugs are those defined in [Harnesses](/components/core/harnesses/).
- Ratings are the tiers defined in
  [Reviews](/components/core/results/#ratings): a functional rating is one of
  `flawless`, `great`, `passable`, `scuffed`, `broken`, and an aesthetic rating
  is one of `legendary`, `amazing`, `good`, `okay`, `slop`.
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

Liveness probe and service identity. Always `200` while the process is serving.
Returns the service status, the API contract version, and `storeReady`, whether
the definition store can resolve test case versions yet.

`storeReady` is reported here for display, on the console's Connections page. It
is deliberately not what makes this endpoint `200`: a backend whose store is
still filling is alive and must not be restarted.

### `GET /readyz`

Readiness probe. `200` once the definition store holds versions the running
build can read, `503` otherwise.

Two states hold it at `503`. An empty store has nothing to resolve against. A
store stamped with another record format holds versions this build cannot read
(see [Test case definitions](/components/backend/overview/#test-case-definitions)),
and serving it would answer with whatever subset happened to be re-ingested
since. Both are cleared by an ingest scan.

Keep this separate from the `/healthz` liveness probe in every deployment. A
backend whose definition store lives on an ephemeral volume starts with an empty
store and re-ingests the whole catalog on boot, which takes minutes. A liveness
probe on this signal would kill the pod mid-ingest and never converge, and a
readiness probe on `/healthz` admits traffic to an empty store, so every run
launched in that window fails with a spurious `test-case version … is not
ingested` 404.

The signal latches. Once the store is populated the backend stays ready and a
later re-ingest does not withdraw it: re-ingest swaps each version into place
atomically, so resolution keeps working throughout one, and the backend runs at
a single replica, where going unready would empty its Service and fail every
caller outright rather than 404 a single case.

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

A scan against a store stamped with another record format is promoted to a
forced whole-catalog scan, whatever the request asked for: no version in such a
store can be read, so there is nothing for a partial scan to leave coherent.
This is what repairs a store after a backend upgrade that changed the record
shapes, including from the incremental re-ingest a local stack runs.

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
them. Each entry also carries the display metadata a listing renders, the name,
test type, asset shape, difficulty, tags, and summary, read from the case's
latest visible version.

```jsonc
{
  "testCases": [
    {
      "slug": "carom",
      "versions": ["v1.0.0", "v1.1.0"],
      "name": "Carom",
      "testType": "end-to-end",
      "assetKind": "sprite",
      "difficulty": "easy",
      "tags": ["arcade"],
      "summary": "A duel of angles."
    }
  ]
}
```

This is the **summary** half of the catalog contract, and it is deliberately
self-sufficient: a client renders a whole catalog grid from this one request.
Anything heavier than a card — the description, the variants with their prompts,
seeded specs, references and checklists, plus the changelog and errata — lives on
[`GET /test-cases/{slug}/versions/{version}`](#get-test-casesslugversionsversion)
and is fetched only for the case a visitor opens. Folding that detail into the
listing costs a request per version *and* per variant, for every case in the
catalog, before the grid can paint.

A case whose latest manifest cannot be read is omitted from this listing rather
than failing it, so one unreadable sidecar costs that case's card and not the
whole catalog.

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
  // The engines this version supports, each with the version range it accepts.
  // A launcher offers exactly this set; `minVersion` and `maxVersion` are
  // present only on an engine the case pinned.
  "engines": [{ "slug": "none" }, { "slug": "simple-2d", "minVersion": "1.0.0" }],
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
      // review. Empty when the variant declares none. On an engine-format
      // version each graded point carries its `domains` and `failureCap`.
      "reviewItems": []
    }
  ],
  // True when the version is on the engine-supported manifest format, which
  // makes its runs validator-rated.
  "engineFormat": true,
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

#### Rendering for an engine

An optional `engine` query parameter names the
[engine](/components/core/engines/) each variant's `prompt` is rendered for. The
[rendered specs route](#get-test-casesslugversionsversionspecsvariant) takes the
same parameter, and the two are meant to be read together.

A case's `prompt.hbs` and its `.hbs` specs branch on the selected engine, so one
stored template renders into different text depending on the runtime the build is
written against. The engine is therefore a rendering input rather than part of a
version's identity, which is why it rides as a query parameter here while the
[validation baseline
route](#get-test-casesslugversionsversionvalidation-baselineenginevariantfile)
carries it as a path segment; there it names a distinct stored directory.

A caller showing a run passes the engine that run recorded, including the explicit
`none`, so the reader sees the text that run's harness received. A caller showing
a case passes nothing and gets the engineless rendering, which is what `none`
renders to. An unrecognised slug is a `400`.

### `GET /test-cases/{slug}/versions/{version}/artifacts/{path...}`

Fetch a single seeded artifact, a spec source or an asset file, by its
store-relative `source` key. Returns the raw bytes with an appropriate
`Content-Type`. A `.hbs` spec source is returned verbatim; the runner renders
it. The path is validated to resolve inside the version's store directory. `404`
if the key is unknown for the version.

### `GET /test-cases/{slug}/versions/{version}/specs/{variant}`

The variant's full seeded spec set with each body already rendered for that
variant, in seed order. This is the spec analogue of the inline prompt on the
resolved version, and it is what a console shows on its Inputs tab. It takes the
same optional `engine` query parameter, under the same rule: see [Rendering for
an engine](#rendering-for-an-engine).

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

### `GET /test-cases/{slug}/versions/{version}/validation-baseline/{engine}/{variant}/{file}`

Fetch one reference build's committed baseline validation media
(`<item>__<output>.<ext>`), synthesized from the reference implementation. This
is the case-scoped invariant counterpart to a run's own validation media. The
engine is part of the address because a variant has one reference implementation
per [engine](/components/core/engines/), and a run is only comparable against
the one it was itself built on.

### `GET /game-jams/{slug}/prior-readmes?model=`

The gameplay READMEs of earlier runs of a [game
jam](/testing/game-jam/overview/) built by the required `model`, oldest first,
across every harness: a model repeats its own ideas whichever harness drove it.
The driver reads this before seeding a repeated jam run so the run can be briefed
on earlier entries. Earlier runs count whether or not they were published; only
those that captured a README appear.

## Test case groups

### `GET /test-case-groups`

The ingested [test-case groups](/components/core/test-case-groups/), under
`groups`, in display order: the ordering rank is applied before serving and
does not ride the wire. Each entry carries the group's slug, name, optional
summary, and its member case slugs in authored order. An open read, backing the
home page's per-group leaderboards.

```jsonc
{
  "groups": [
    {
      "slug": "tower-defense",
      "name": "Tower Defense",
      "summary": "Mazes, waves, and tower placement.",
      "cases": ["meltdown", "valence", "arc-foundry"]
    }
  ]
}
```

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
per-domain functional `ratings`, the per-domain `aesthetics`, the markdown
`writeup`, the checklist verdicts, and an `editNote`. Which of them a run
accepts follows its case version. A validator-rated run takes an `aesthetics`
entry for every effective domain and refuses `ratings`, since the functional
rating is the validators'; its checklist verdicts are the validators' and the
body carries none. A legacy run takes `ratings` and the checklist verdicts and
refuses `aesthetics`. The review is attributed to the account the bearer token
resolves to; the reviewer identity is taken from the token rather than the
body. A run carries many reviews, one per account, and re-submitting from the
same account updates that account's own review.

A re-submission that changes the review is an edit. It requires a non-empty
`editNote`, keeps the original `reviewedAt`, stamps `editedAt`, and records the
prior-to-new diff as a public revision, covering the functional ratings, the
aesthetic ratings, the verdicts, and the writeup. A re-submission that changes
nothing is a no-op.

`404` if the run is unknown. `422` when the review carries no rating on either
channel and no checklist verdict, when the writeup is empty, when it rates a
channel the run's case version does not accept or leaves a domain on the
accepted channel unrated, or when an edit arrives without a note. Schema:
[`backend-api/review.schema.json`](https://docs.testcabinet.ai/schema/backend-api/review.schema.json).

### `POST /runs/{id}/publish`

Release a run and make it public. The endpoint gates the run (`422` when it
fails), then enqueues a per-publish `tcab-publisher` Job and answers
`202 Accepted` with the publish-job id and the live URL to observe the release
on. The run flips public when that Job reports a terminal success.

The gate refuses a run that can never be published, an infrastructure failure or
a canceled run, and it refuses a completed legacy run carrying no review. A
completed validator-rated run is admitted with or without a review, since its
functional rating and score are on the record. A publishable failure needs no
review, since it has no review checklist.

```jsonc
{ "publishJobId": "clx…", "liveUrl": "/publish-jobs/clx…/live" }
```

The endpoint is idempotent while a release is under way. A run that already has
a live publish job gets that job's id and live URL back rather than a second
enqueue, so a double-click, a second console tab, or a retry after the live
stream dropped re-attaches to the publish already running. This matters because
a publish is not idempotent externally: every publish job runs `wrangler pages
deploy`, which mints a brand-new Cloudflare Pages deployment, while the `gh`
side reuses an existing repository, so two jobs for one run leave an orphaned
public build behind, visible only on the Pages side. A partial unique index on
the publish queue backs the check, so two concurrent requests cannot both
enqueue.

A publish job whose publisher died before reporting stops blocking after an
hour, since nothing reaps it and it would otherwise wedge the run's publishing
forever, and a failed publish never blocks at all: it stays immediately
retryable. As a second layer, the publisher itself re-checks the run's
publication state before doing any external work, and skips the release,
reporting the links the run already carries, when the run is already published.

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
- `state=publishable` — the publish worklist: the subset of `state=unpublished`
  the publish gate accepts right now, which is a validator-rated completed run,
  a reviewed legacy completed run, or one of the publishable failure tiers. This
  backs the console's Unpublished tab, where every listed run is meant to be
  selected and published, so the slice holds only rows the publish endpoint will
  accept.
- `state=any` — the union of the published and unpublished slices: every
  recorded run, with no lifecycle predicate at all. This is what the consoles'
  run listings draw from, so a produced, and therefore unreviewed, run sorts and
  pages in the same listing as the published ones rather than being merged in
  ahead of them client-side.

`any` and `publishable` are offered only on the summary-plus-offset path below,
since the cursor listings walk one lifecycle slice at a time.

A `canceled` run, one an operator killed mid-flight, reaches `state=unpublished`
and `state=any`. It can never be published, carries no review checklist, and is
not a publishable failure, so the other selectors omit it.

#### Two projections

`fields` selects how much of each run the listing returns:

- Default, `fields` omitted — the full stored run per row, in the shape of the
  [detail endpoint](#get-runsid) (record, reviews, ratings, and score).
- `fields=summary` — a lightweight `RunSummary` card per row: the run's id and
  timestamps, its [subject](/components/core/run-records/#subject) including the
  [test type](/testing/overview/), [metrics](/components/core/metrics/), the
  `validationLoaded` signal, state, the functional `rating`, the `aesthetic`
  rating, `validatorRated`, the `score` and `reviewCount`, the denormalized
  case name, a performance run's fuel result,
  the ranking slice of a run's code analysis, and links. That is enough to
  render a run-list row, a card, a leaderboard entry, or a metrics aggregate
  without fetching each full record; the [detail endpoint](#get-runsid) loads
  the full record and the run's reviews one run at a time. This is the same
  summary shape the [public
  projection](/components/backend/projection/) holds as its run row.

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

- Filters `testCase`, `model`, `harness`, `variant`, `version`, and `engine`,
  each narrowing to runs matching that lifted subject value. They AND together,
  so `testCase=carom&model=…` is expressible, which the free-text `q` alone
  cannot do. A variant slug is unique only within its case, so `variant` is
  paired with `testCase`, the case-detail Runs tab's slice, as `version`
  normally is. `engine` matches the engine slug the run was launched under, and
  the engineless run records the slug `none`.
- Filter `versions`, a comma-separated list of exact versions, narrowing to runs
  matching any of them. This is the case-detail Runs tab's version scope: the
  console computes the versions in the anchored `major.minor` or major line from
  the catalog and sends the concrete list. Like `version`, it silences
  `latestVersions`.
- Filter `testCases`, a comma-separated list of case slugs, narrowing to runs
  matching any of them. This is the home page's group-leaderboard slice: one
  query covers a [test-case group](/components/core/test-case-groups/)'s member
  cases. It ANDs with the other filters, `testCase` included, so naming both
  narrows to their intersection, and `latestVersions` composes with it as with
  any case slice.
- Filter `aesthetic`, one of the aesthetic tiers, narrowing to runs whose
  aggregate aesthetic rating is exactly that tier. A run no review has rated on
  that channel never matches. `aesthetic=legendary` newest-first is the home
  page's showcase query.
- Current versions `latestVersions=true`, restricting every run to its case's
  current `major.minor`: the newest one that case has a run for within the
  selected `state` slice. A case version is frozen once it has runs, so an older
  minor is a different spec whose runs are not comparable with the current one's,
  and this is the console listings' default. The current version is read off the
  runs rather than the definition store, so a newly authored version does not
  blank the listing before anything has run against it, and the static gallery,
  which has only its run index, answers the identical question from the same
  data. `latestVersions` is ignored when `version` names an exact version: an
  explicit version is the more specific instruction, and AND'ing the two would
  silently empty the listing whenever the picked version is not the current one.
- Search `q`, a free-text match across the lifted subject columns: test case
  slug, model id, harness slug, variant, and a [gg](/gg/overview/) run's
  [configuration](/gg/configurations/) name. It matches the recorded ids rather
  than a model's resolved display name.
- Sort `sort`, one of `date` (the default), `runtime`, `tokens`, `cost`,
  `rating`, `testType`, `testCase`, `harness`, `model`, or `variant`, with `dir`
  (`asc` or `desc`), tie-broken by run id. `model` orders by the run's model or
  configuration identity: a gg run sorts by the configuration it was launched
  from, and everything else by its model id. `testCase` orders by the case's
  **display name** — the name the listing shows, not the recorded slug — resolved
  the same way each card's `caseName` is: the latest ingested manifest's `name`,
  a case renamed on disk since the run was recorded (say a `pong` run, shown as
  Carom) by its current name, and a slug the store does not know at all by the
  slug itself. A column that displays names sorting by slugs would file Carom
  under "p".

`limit` defaults to 50 and is clamped to 200.

### `GET /runs/{id}`

One stored run, as `{ record, reviews, published, links, rating, aesthetic,
validatorRated, score }`: its record with links populated, the array of reviews
it carries with each reviewer's identity, whether it is published, its links,
and the run's ratings and score. Each review carries the `ratings` or
`aesthetics` its run's channel accepts. `404` if unknown. The same shape is
what the default projection of [`GET /runs`](#get-runs) lists per row.

- `validatorRated`: whether the run's case version is
  [validator-rated](/testing/end-to-end/evaluation/#rating-channels), so a
  consumer can show the run's points and functional rating from the record
  immediately, offer publish without a review, and ask a reviewer for
  aesthetics only.
- `rating`: the run's **functional** rating. On a validator-rated run the
  validator-decided rating, present from completion and never changed by a
  review; on a legacy run the review aggregate. Composed with the toolchain
  gate either way. `null` while unset — a legacy run with no review.
- `aesthetic`: the run's aggregate **aesthetic** rating, the worst any reviewer
  gave any domain. `null` when no review has rated that channel: every legacy
  run, and an unreviewed validator-rated one.
- `score`: the run's points against its case version's checklist weights — the
  same `{ earned, total, reviews, overallGrade }` the summary card carries. On
  a validator-rated run the validator-decided score (`reviews` is `0`), present
  from completion; on a legacy run the mean across its reviews, `null` while
  unreviewed. `null` when the run's case version is not ingested.

The four are always present (`null` rather than omitted when unset), so a
consumer reads them without defaulting. The functional rating and the score
come through the same seams the summary cards and the snapshot use, so a
validator-rated run's detail and its card never disagree.

```jsonc
{
  "record": { "…": "full RunRecord, links populated" },
  "published": false,
  "validatorRated": true,
  "rating": "great",
  "aesthetic": "amazing",
  "score": { "earned": 66, "total": 68, "reviews": 0, "overallGrade": null },
  "reviews": [
    {
      "reviewerId": "acct_7yq…",
      "reviewer": "Ada",
      "username": "ada",
      "ratings": [],
      "aesthetics": [{ "domain": "single-player", "rating": "amazing" }],
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

## Coverage plans, ladders, and the review buffer

The reviewer scheduling surface: what runs an account wants to exist, and how fast
it wants them arriving. Every endpoint here requires a bearer token and is **keyed
to the token's account** — there is no path parameter naming a user, and an id that
belongs to another account answers `404` rather than `403`, so one account cannot
probe another's plan ids. The concepts, and the reasoning behind them, live on
[Coverage plans](/components/backend/coverage/) and
[Ladders](/components/backend/ladders/); this section is the wire contract.

Two conventions differ from the rest of this page, both because this is a
console-only surface rather than a cross-component one: the collections return
**bare JSON arrays** rather than the wrapped object [above](#conventions), and a
plan's or ladder's *declaration* and its *schedule* (`outerAxis`, `paused`,
`autoTopUp`, `bufferTarget`) are flattened into one object on the way out while
being written separately — an absent `schedule` on a `PUT` means "leave it alone",
so saving an edited model list can never un-pause a running plan.

### Groups and plans

- `GET|POST /coverage-groups`, `PUT|DELETE /coverage-groups/{id}` — reusable member
  groups, each holding either harness+model combinations (`kind: "combo"`) or
  version-pinned cases (`kind: "case"`). Plans and ladders reference them by id, so
  editing a group reshapes everything that points at it. A plan that references a
  deleted group ignores the dangling id at coverage time; there is no cascade.
- `GET|POST /coverage-plans`, `PUT|DELETE /coverage-plans/{id}` — the plans
  themselves. Reads return `CoveragePlanOut` (declaration + schedule flattened).
  `runsPerCell` is clamped server-side, because a mistyped target is a mistyped
  number of queued runs.
- `GET /coverage-plans/summary` — the roll-up the plans list and the Home widget
  render: cell counts, runs missing, runs unreviewed by you, plus `paused` and
  `autoTopUp` so the list can say *why* a plan with missing runs is not filling
  itself.
- `GET /coverage-plans/{id}/coverage` — the full matrix: one cell per
  `case × combination` **in the plan's own emission order**, with the `outerAxis`
  echoed so a reader knows what that order means, and the `runsPending` /
  `runsUnreviewed` / `runsOutstanding` / `bufferTarget` roll-ups. Schemas:
  [`coverage/coverage-plan.schema.json`](https://docs.testcabinet.ai/schema/coverage/coverage-plan.schema.json),
  [`coverage/coverage-matrix.schema.json`](https://docs.testcabinet.ai/schema/coverage/coverage-matrix.schema.json),
  [`coverage/coverage-group.schema.json`](https://docs.testcabinet.ai/schema/coverage/coverage-group.schema.json).

Each cell reports `inFlight` and, separately, the `pending` subset of it — jobs the
queue is deliberately holding back behind a harness parallelism cap or a same-model
game jam. That distinction is the answer to "my buffer is full but nothing is
running", which is otherwise indistinguishable from a wedged queue.

### The review buffer

- `GET|PUT /coverage-settings` — the account-wide `bufferTarget`: how many runs a
  top-up may leave outstanding (in flight, or finished and unreviewed by you) before
  it stops. `GET` reports `isDefault` when the account has never chosen one — no row
  is materialized on read. `0` is a legitimate value meaning "never top up".
  Schema: [`coverage/coverage-settings.schema.json`](https://docs.testcabinet.ai/schema/coverage/coverage-settings.schema.json).
- `GET|PUT /coverage-plans/{id}/schedule` — one plan's `outerAxis`, `paused`,
  `autoTopUp`, and its optional `bufferTarget` override. The override is nullable
  and null is **not** zero: null inherits the account's setting, `0` means never.
- `POST /coverage-plans/{id}/topup` — walk the plan's cells in its own order, skip
  the ones already at target (counted **globally**), and enqueue **whole cells**
  until the requester has `bufferTarget` runs outstanding. There is no background
  daemon; this endpoint is what enqueues. It answers with the buffer target in
  force, the occupancy it observed, and every cell it launched with its job ids, in
  emission order.

  It is **serialized per plan** by a claim on the plan row — two console tabs, or
  one fast double review-submit, would otherwise both observe the same shortfall and
  both enqueue for it — and reports `skipped: "busy"` rather than waiting when the
  claim is held, or `skipped: "paused"` when the plan is paused. A top-up that ran
  and found nothing to do reports neither, with `enqueued: 0`. Otherwise idempotent:
  it recomputes the shortfall on every call.
- `GET /coverage-plans/{id}/queue` — the plan's completed runs the requesting
  account has not reviewed, **in the plan's own order** rather than newest-first
  like the global unreviewed listing, so reviewing walks the buffer in the order it
  was deliberately filled. Capped rather than paginated, with `truncated` set when
  there is more behind it.

### Halting

Three controls per plan, and the same three per ladder, distinguished by what they
cost rather than by how hard they sound:

| endpoint | pauses | cancels |
| --- | --- | --- |
| `POST /coverage-plans/{id}/pause` | yes (body: `{ "paused": true }`) | nothing |
| `POST /coverage-plans/{id}/halt` | yes | its `queued` + `pending` jobs |
| `POST /coverage-plans/{id}/halt-all` | yes | the above **plus** `dispatched`, `starting`, `running` |

`pause` takes the state as a body rather than being two verbs, so a console can
drive a toggle without tracking which direction it is going.

Both halts reuse the same atomic cancel transition
[`POST /jobs/{id}/cancel`](#stopping-runs-in-bulk) uses, and reach only jobs whose
`origin` is this plan — a run launched by hand is never swept up. Both answer with
`{ "canceled": n, "includedActive": bool }`. **The count is the contract**: a halt
that reported only success could not be told apart from a halt whose scope was
wrong, and those call for opposite next moves.

`halt-all` discards work that is partly or wholly paid for. A client must confirm
before calling it and must never make it the default.

### Ladders

A [ladder](/components/backend/ladders/) is a sibling of the coverage plan, not a
mode of it: an ordered list of **rungs** (one version-pinned case each, addressed by
a stable opaque id) that harness+model **climbers** ascend until a **gate** stops
them. It reuses the plan's `kind: "combo"` groups, buffer, top-up, queue, and
halting verbatim, so only its own endpoints are listed here.

- `GET|POST /ladders`, `GET|PUT|DELETE /ladders/{id}` — the declaration: rungs,
  climbers, `runsPerCell`, and the single parameterised `gate` (`floor`,
  `threshold`, `unloadedCountsAsBroken`, `earlyStop`). A create with no `schedule`
  takes the ladder default, which is **`paused: true`, `autoTopUp: true`** — a new
  ladder enqueues nothing until it is enabled, and from then on each review feeds it
  (see [A ladder starts disabled](/components/backend/ladders/#a-ladder-starts-disabled)).
  Rungs are matched on their
  stable ids and **reconciled, never replaced**, so a reorder or a version bump keeps
  every climber's recorded verdicts. A rung holding a
  [performance](/testing/performance/overview/) or
  [game jam](/testing/game-jam/overview/) case is refused with `400`: neither can
  ever produce a rating for the gate to read, so it would stall the climb silently.
  Schema: [`coverage/ladder.schema.json`](https://docs.testcabinet.ai/schema/coverage/ladder.schema.json).
- `GET /ladders/{id}/progress` — the board: every climber's status
  (`climbing` / `awaitingReview` / `walled` / `held` / `toppedOut`), the rung it
  stands on with the gate tally behind that answer, and its verdicts. A **read**:
  verdicts the gate has resolved but nobody has recorded are computed live and
  flagged `recorded: false`, then persisted by the next top-up — a `GET` never
  advances a climber. Schema:
  [`coverage/ladder-progress.schema.json`](https://docs.testcabinet.ai/schema/coverage/ladder-progress.schema.json).
- `POST /ladders/{id}/rungs/order` — reorder the climb by rung id. The body must be
  a permutation of the ladder's current rungs; adding or dropping one is an edit and
  goes through `PUT /ladders/{id}`.
- `POST /ladders/{id}/climbers` — one combination's steering, written whole:
  `priority`, `focused`, and `held`. A hold stops a climber without pretending a
  rung was decided, so clearing it resumes exactly where the climb left off.
- `POST /ladders/{id}/outcomes` — apply or clear a manual override of one recorded
  verdict: promote a climber past a rung its runs failed, or wall one they passed.
  The override is stored **beside** the automatic verdict, so a recompute can never
  silently undo it and `outcome: null` restores exactly what the gate says. `409`
  when the rung has no verdict yet — an undecided rung has nothing to promote past,
  and the control for "stop here regardless" is a hold.
- `GET|PUT /ladders/{id}/schedule`, `POST /ladders/{id}/topup`,
  `GET /ladders/{id}/queue`, `POST /ladders/{id}/pause`, `.../halt`,
  `.../halt-all` — the plan endpoints above, with two differences. A top-up only
  ever launches a climber's **current** rung, while the queue and the buffer cover
  every rung a climber has **reached**, so a rung the gate has decided keeps
  offering the runs nobody reviewed
  ([why](/components/backend/ladders/#feeding-and-reviewing-are-different-sets-of-rungs)).
  And `pause` is the ladder's enable/disable switch: a ladder starts on its paused
  side, and `{ "paused": false }` only permits spending, so the caller that enables
  follows with a `topup` (the console does).

## Stopping runs in bulk

Three global sweeps back the console's Runs-page controls. All require a bearer
token, and all answer
`{ "canceled": n, "includedWaiting": bool, "includedActive": bool }` — the scope
flags let a client phrase what it just did ("stopped 12 runs, including 3 already
executing") from the response rather than from which button it pressed.

| endpoint | sweeps | console label |
| --- | --- | --- |
| `POST /jobs/cancel-waiting` | `queued`, `pending` | Clear pending |
| `POST /jobs/cancel-active` | `dispatched`, `starting`, `running` | Kill active |
| `POST /jobs/cancel-all` | both, in one transition | Stop all |

They are named after the job states they reach rather than after those labels,
because `pending` is a distinct state that is surfaced on its own — a
"cancel-pending" endpoint that also swept `queued` would be actively misleading.

These are **global and scoped to nothing**: they cancel matching jobs whatever
launched them, including runs launched by hand and runs launched by another account.
That is deliberate — they are the "stop the cabinet" controls, and narrowing them by
account would silently skip every job recorded before jobs carried an account at
all. The scoped equivalent is a plan's or ladder's
[`halt`](#halting). Cancelling a single job by id remains
`POST /jobs/{id}/cancel`, which these reuse rather than reimplement.

`cancel-active` and `cancel-all` discard work in progress, so a client confirms
first; `cancel-waiting` throws nothing away and does not need to.

## Model probes

A model probe is a responses-as-code readiness check of one catalog model,
answering whether the model can drive [gg](/gg/overview/)'s RaC mode before any
run is spent on it. The backend replays gg's RaC turn-1 request per case: two
scenarios over several input prompts (at least three prompts across them), on
one program-language arm or on every arm. Each case's conversation is an
embedded per-language fixture projected out of gg's own machinery by
`scripts/gg-probe-fixtures.sh` — the real system prompt, the real bootstrap
program and module listing, the real documentation views, and a seeded spec file
view carrying its total-line-count heading — sent whole, never trimmed. The
replay goes through OpenRouter chat/completions
with the one `submit_program` tool offered and `tool_choice` forced to it, the
wire shape gg sends, and each case is sampled `samples` times with no
temperature set.

The two scenarios check different readiness properties:

- `baseline` — the conversation holds an open documentation view of every
  function the task needs. A passing program is bare code that calls them all
  (`correct-calls`; a bare program lacking one is `missing-calls`).
- `missing-docview` — the task needs a function whose documentation view is not
  open, and the system prompt instructs the model to open a documentation view
  of each function it intends to call and write the call on a later turn. A
  passing program opens the missing view and stops (`docview-first`); calling
  the undocumented function in the same program is `called-undocumented`, and
  doing neither is `no-docview`.

Shape faults outrank the scenario checks (`fenced`, `tool-token`,
`xml-pseudo-tools`, `cot-leak`, `empty`), and a reply that submits nothing is
labeled by how it dodged (`no-submission`, `stray-tool-call`, `no-program`).
Call detection strips string literals and matches call spellings on identifier
boundaries, so a documentation key passed as a string never reads as a call.
The verdict is `ready` when every probed (language, scenario) group passes at
least 80% of its scored calls, and `not-ready` otherwise; the per-call labels
say why.

Probes are append-only history: a re-run is a new dated record. They are
console-only data and never feed the public snapshot. A probe executes inside
the backend process, so a backend restart fails any probe still `running`.

### `POST /models/{slug}/probes`

Trigger a probe. Requires a bearer token: the backend spends its own OpenRouter
key (`TCAB_OPENROUTER_API_KEY`, see
[Configuration](/components/backend/overview/#configuration)) on the caller's
behalf. The request body is optional JSON, every field optional:

```jsonc
{
  // Pin every call to this provider (provider.order, fallbacks disabled).
  "provider": "…",
  // Probe this one program-language arm; absent probes every arm.
  "language": "typescript",
  // Completion calls per input prompt (default 8, at most 128).
  "samples": 8,
  // Completion-token cap per call.
  "maxTokens": 3500
}
```

Answers `202 Accepted` with the probe row already `running`; the probe executes
in the backend and the row is read back by polling. `409` when a probe of the
model is already running. `422` when `language` names no gg program language,
or when the model has no OpenRouter slug to target: a probe targets a curated
model's configured OpenRouter slug, falling back to the catalog slug itself
when it reads as an OpenRouter id. `503` with
code `openrouter_key_missing` when the backend has no key configured.

### `GET /models/{slug}/probes`

The model's probe history, newest first, under `probes`. Each probe carries
its language selection, status (`running`, `complete`, or `failed`), verdict,
overall pass rate, USD spend, and timestamps. An open read.

### `GET /model-probes/{id}`

One probe with its per-call items and the per-case requests exactly as sent
under `requests`, one entry per probed (language, scenario, prompt) with its
message array (the case's `submit_program` tool definition and forced
`tool_choice` ride beside them on the wire to the provider). Each item records
its (language, scenario, prompt, sample) coordinate, serving provider, finish
reasons, outcome label and pass flag, the submitted program, the reply's own
text with any separate reasoning text, token counts, USD cost, duration, and
the error that voided the call. An open read.

### `GET /models/{slug}/probe-providers`

The providers OpenRouter lists for the model, as name and context length, for
pinning a probe to one. Requires a bearer token, because it reaches a third
party on the caller's behalf, like the OpenRouter form fill.

## Cabinet statistics

### `GET /stats/cabinet`

The cabinet's whole-of-corpus headline figures, folded over every stored run
whatever its state or publication. An open read, backing the home page's totals
band and activity chart.

- `runs`: the total recorded run count.
- `tokens`: the summed total tokens, with `unreportedRuns` counting the runs
  whose metrics reported no tokens; those contribute nothing to the sum.
- `cost`: the summed [comparable cost](/components/core/metrics/#cost) in USD,
  with `unreportedRuns` counting the runs whose comparable cost is unknown;
  those contribute nothing to the sum.
- `testCases` and `models`: distinct test-case slugs and distinct model ids
  across the same corpus.
- `weekly`: runs bucketed by the UTC Monday of the ISO week they started, as
  `weekStart` in `YYYY-MM-DD` form, covering the last 26 weeks up to now,
  ascending. A week with no runs is present with a zero count, so a consumer
  charts the series without filling gaps.

```jsonc
{
  "runs": 4210,
  "tokens": { "total": 91250000000, "unreportedRuns": 12 },
  "cost": { "total": 48230.55, "unreportedRuns": 40 },
  "testCases": 47,
  "models": 63,
  "weekly": [
    { "weekStart": "2026-03-02", "runs": 0 },
    { "weekStart": "2026-03-09", "runs": 118 }
  ]
}
```

## Provider and accuracy statistics

Two aggregate reads fold cross-run statistics for the console's Providers view
and the model detail's accuracy figures. Both fold from stored gg session
summaries reached through the gg document index — the same per-id-reconciled,
TTL-refreshed corpus the gg query endpoints read — so a request
never re-parses the run store. Provider figures exist only on runs whose
summary recorded `providerStats`; older runs are counted as scanned but
contribute no provider rows, and a figure an older record omitted is never
defaulted.

### `GET /stats/providers`

Per-provider health across every stored gg run, plus the probe store's
per-provider evidence, kept strictly separate. An open read.

Run evidence: one entry per upstream provider observed in any run's
`providerStats` slices, each carrying its per-model rows and a total. A row
reports contributing runs, calls with their summed tokens and USD cost,
length-capped rejections, and the attributed turns split into working turns and
an error breakdown keyed by turn error type. The `provider: null` entry
collects the calls that named no provider — a gateway that stamps none, or a
turn whose call produced no reply to name one — and sorts last; a `modelId:
null` row is a slice recorded before the agent's first usage delta named its
model, on a run more than one model served.

Probe evidence: one entry per provider observed on
[model-probe](#model-probes) items, per probed model: item count, case-check
pass count, and errored calls. Probe rows are single-completion
replays rather than full runs, which is why they are reported beside the run
evidence rather than folded into it.

The response also reports `runsScanned` (every stored gg run with a recorded
session summary) and
`runsWithProviderData`, so a consumer can present sparse provider coverage as
sparse rather than as zero.

### `GET /stats/model-accuracy`

Per-model accuracy across every stored gg run, split by execution mode. An
open read.

For responses-as-code runs, a model's entry counts turns and splits them into
valid (progressed or finished), compile errors, runtime errors (program faults
plus sandbox limits), model-API errors, and missing completions, with the full
per-type breakdown beside the named groups. Runs whose summaries carry
`providerStats` contribute exact per-model figures; older single-model runs
contribute the run-level error rollup with valid derived as turns minus errors
(a fatal turn counts as valid there, so the figure can overcount by at most one
turn per agent) and are tallied under `approximateRuns`.

For tool-calling runs, a model's entry counts dispatched tool calls and splits
them into ok and failed by failure class. A run contributes only when its
summary recorded the `toolCalls` dispatch total; a tool-calling run with
failure evidence but no recorded total is tallied under
`runsWithoutCallTotals` instead.

A run that cannot be attributed to a single model — an older multi-model run
with no per-model slices — is counted once under the response's
`unattributableRuns`. Models are ordered by evidence volume (responses-as-code
turns plus tool calls), largest first.

## The console stream

One SSE connection carries everything the console learns about runs it is not
individually watching: the alerts it shows a person, and the lifecycle transitions
it maintains its in-flight list from. It is **worker-wide** — every console sees
every run, whoever launched it — and **live-only**: nothing is replayed, and there
is no backlog to catch up on.

### `GET /notifications` — subscribe

Opens the stream. Every frame is a **named** SSE event, so there is no unnamed
`message` frame and a client using `EventSource.onmessage` alone receives nothing.

| `event:` | payload | topic |
| --- | --- | --- |
| `stream` | `{ "streamId": "…" }` | always — the first frame |
| `notification` | `Notification` | `notifications` |
| `run` | `RunEvent` | `runs` |
| `resync` | `{ "dropped": n }` | always |
| `heartbeat` | *(none)* | always — every 15s while idle |

The **hello frame** (`stream`) arrives first and carries the id the client quotes
back to change its topics. The id is minted per *connection*, not per client: an
`EventSource` reconnects on its own, and the reconnected stream is a new subscriber
with default topics, so a client must re-apply what it wanted each time a hello
frame arrives.

The **`resync` frame** says this client fell behind far enough that the backend
dropped messages for it. Nothing can be replayed, so the client's recovery is to
re-read the authoritative lists (`GET /jobs/active`, and the run listing if it is
showing produced runs). It exists because this is one of the two ways a client can
stop being current *without* the connection dropping.

The **`heartbeat` frame** covers the other. It carries no payload — its arrival is
the whole message — and it is why an SSE *comment* keep-alive is not enough here:
the browser's `EventSource` consumes comments internally and surfaces nothing to
the page, so a client cannot tell a healthy idle stream from a half-open socket
that will never deliver anything again. With a heartbeat it can: arm a watchdog,
rearm it on every frame, and treat an overdue one as a dead connection to tear
down and reopen. `Sse::keep_alive` still runs alongside it, for the proxies that
want the comment traffic.

### Topics

| topic | carries | default |
| --- | --- | --- |
| `notifications` | a run finished; a publish failed | **on** |
| `runs` | every in-flight list transition | **off** |

The split is between *alerting* and *list maintenance*. A notification is
something a person should be told about, filed to the bell and raised as a toast,
so it fires only for the two things worth interrupting someone over. A run event
is every transition a list must reflect, including the many nobody wants a toast
for — a queued run held back to `pending`, a driver reaching `starting`, forty runs
ending at once under a bulk sweep.

That is why `runs` is off by default and why the two are not one topic: the alerts
must arrive wherever the user is, so the console holds one stream open for the
whole session, while the churn is worth carrying only while a page is showing it.

A `RunEvent` carries enough to patch a list in place without a round-trip — the
run's identity and its state *after* the transition:

```json
{
  "kind": "state-changed",
  "runId": "…",
  "testCaseSlug": "carom",
  "testCaseVersion": "v1.0.0",
  "variant": "base",
  "harnessSlug": "claude",
  "modelId": "…",
  "state": "running"
}
```

`kind` is `enqueued` (joined the queue), `state-changed` (moved between two
non-terminal states), or `finished` (reached `succeeded`, `failed`, or `canceled`,
and left the in-flight set). A `finished` event adds `recordId` when the run
produced one and `detail` when it failed or was cancelled. Note that a cancelled
run raises a run event but **no** notification: it is an operator action, not a
failure to alert on — but the list must still drop the row.

A run that produced a record also makes the *produced-run* listing stale, which the
event does not carry; a client re-reads that separately.

### `PUT /notifications/{stream}/topics` — change topics

The control channel SSE itself does not have. Body:

```json
{ "runs": true }
```

Both `notifications` and `runs` are optional, and an omitted field leaves that
topic unchanged — so a client toggling one never disturbs the other. Answers `204`,
or `404` when no such stream is connected.

A `404` is a normal, expected outcome rather than an error to surface: it means the
client's stream died and its `EventSource` has reconnected (or is about to) under a
new id. The recovery is to wait for the next hello frame and re-apply, which is
what the console does.

The topic change applies to the already-open stream, taking effect on the very
next message. That is the whole point: the alternative — a second stream opened
and closed per page — would drop the alerts riding the first one on every
navigation, and cost a reconnect each time.

### Staying current without polling

A client does not poll this queue. It re-reads `GET /jobs/active` only when
something tells it its own list may be wrong, and lives on the events in between.
There are four such moments, and between them they cover every way a client can
fall out of step:

| trigger | what it recovers |
| --- | --- |
| the `runs` topic goes from off to on | anything published while it was off, which is never replayed |
| the stream (re)connects | the gap, since the stream keeps no backlog |
| a `resync` frame | messages the backend dropped for a client that fell behind |
| the watchdog forces a reopen | a stream that died without saying so |

The last two are the ones that make dropping the poll safe, and both are new: a
lagged client used to be skipped in silence, and a wedged `EventSource` was
undetectable. A poll was the only thing covering either.

Two client-side details are load-bearing, and a client that omits them will look
correct in testing and go stale in production:

- **Reopen a stream the browser has abandoned.** After enough failed attempts
  `EventSource.readyState` settles on `CLOSED` and the browser stops retrying,
  permanently. Only an explicit reopen recovers it. While `readyState` is
  `CONNECTING` a retry is already under way and should be left alone — racing it
  just multiplies connections.
- **Re-base, then replay.** The active-list snapshot describes the queue as of the
  moment the request was served. Applying it over a list that live events have
  since moved forward undoes them — re-adding a run that finished a moment ago, and
  stranding that row for good with no poll to correct it. Buffer events for the
  duration of the fetch and apply them on top of the snapshot.

## Reference rendering

A test case's reference mockups are rendered to screenshots once, by the
backend, at ingest. Rendering there makes the validation baseline byte-identical
across every runner: a runner downloads the rendered image, seeds it as the
visual target, and uses it as the [validation](/components/core/validation/)
baseline. Runners still need a headless browser locally for the load check and
per-check capture; only the reference baseline render lives on the backend.
