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
are specified [here](#stopping-runs-in-bulk) instead, as an operator surface.

## Conventions

- The API is JSON over HTTP. Request and response bodies are camelCase, matching
  the [run record](/components/core/run-records/) contract.
- A collection of objects is returned wrapped, under a named key (for example
  `{ "testCases": [...] }`). The three reads that return a plain list of values
  are bare JSON arrays: the validation-file keys, a run's events, and a jam's
  prior READMEs. The
  [reviewer scheduling](#coverage-plans-ladders-and-the-review-buffer)
  collections are bare arrays too.
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

Liveness probe and service identity. Always `200` while the process is serving,
including while the definition store is still filling. Returns the service
status, the API contract version, and `storeReady`, whether the definition store
can resolve test case versions yet.

### `GET /readyz`

Readiness probe. `200` once the definition store holds versions the running
build can read, `503` otherwise.

Two states hold it at `503`: an empty store, and a store stamped with another
record format, which holds versions this build cannot read (see [Test case
definitions](/components/backend/overview/#test-case-definitions)). Both are
cleared by an ingest scan.

Every deployment keeps this separate from the `/healthz` liveness probe. A
backend whose definition store lives on an ephemeral volume re-ingests the whole
catalog on boot, taking minutes, so a liveness probe on this signal would kill
the pod mid-ingest and a readiness probe on `/healthz` would admit traffic to an
empty store.

The signal latches. Once the store is populated the backend stays ready, and a
later re-ingest does not withdraw it: a re-ingest swaps each version into place
atomically, so resolution keeps working throughout one.

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
  "force": true, // re-ingest even versions already in the store
  "catalogVersion": "a1b2c3", // tag a whole-catalog ingest with its content version
}
```

Each `testCases` entry is either a bare case id, its slug or folder name,
expanding to every version the case declares (`"carom"`), or a version-qualified
`id@version` targeting exactly that version (`"coil@v1.1.0"`). The
version-qualified form re-ingests a single edited version without re-rendering
the case's others.

`force` overwrites a version already stored and re-renders its references, for
development iteration on a version no run has been published against. A version
that published runs reference is immutable and is revised by adding a new
version.

A scan against a store stamped with another record format is promoted to a
forced whole-catalog scan, whatever the request asked for. This repairs a store
after a backend upgrade that changed the record shapes.

`catalogVersion` is an opaque token identifying the catalog content of a
whole-catalog ingest, such as the calling build's commit. The backend records it
in the store and, while the token is unchanged, reuses the already-ingested
versions instead of re-rendering them. A changed or first-seen token forces a
full re-ingest and advances the recorded marker, so content that changed under
an unchanged version string is still picked up. The marker lives in the store,
so a fresh store re-ingests unconditionally. A partial scan ignores
`catalogVersion` and leaves the marker untouched.

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

A scan that actually (re)ingested a version queues a [public
snapshot](/components/backend/snapshot/) refresh.

## Test case resolution

These endpoints are how a runner resolves the definition it needs to seed and
validate a run, sourced from the backend's store rather than a local checkout.

### `GET /test-cases`

The catalog: every ingested case and its available versions, under `testCases`.
Experimental versions are included only when the backend is configured to offer
them. Each entry also carries the display metadata a listing renders, the name,
test type, asset shape, difficulty, tags, and summary, read from the case's
latest visible version, plus the case's
[showcase](/components/core/showcase/#the-case-showcase) preview when that
version has one: the first variant, in manifest order, that declares a
showcase, with its media list. The preview carries only the addressing; each
file is fetched from the [showcase
route](#get-test-casesslugversionsversionshowcasevariantfile), and the
description rides the resolved version's variant.

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
      "summary": "A duel of angles.",
      // The showcase preview, or null when no variant of the latest visible
      // version declares a showcase.
      "showcase": {
        "version": "v1.1.0",
        "variant": "base",
        "media": [
          {
            "file": "ai-block.json.gz",
            "name": "The AI blocks a shot",
            "kind": "replay",
          },
        ],
      },
    },
  ],
}
```

This is the summary half of the catalog contract, and it is self-sufficient: a
client renders the whole catalog listing from this one request. Anything
heavier, the description, the variants with their prompts, seeded specs,
references and checklists, plus the changelog and errata, lives on [`GET
/test-cases/{slug}/versions/{version}`](#get-test-casesslugversionsversion) and
is fetched only for the case a visitor opens.

A case whose latest manifest cannot be read is omitted from this listing rather
than failing it.

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
  "engines": [
    { "slug": "none" },
    { "slug": "simple-2d", "minVersion": "1.0.0" },
  ],
  "build": { "install": "npm ci", "build": "npm run build" },
  "promptTemplate": "…handlebars source…",
  "commonSpecs": [
    {
      "source": "specs/overview.hbs",
      "dest": "specs/overview.md",
      "template": true,
    },
  ],
  "assets": [{ "source": "assets/ball.png", "dest": "assets/ball.png" }],
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
          "mediaUrl": "/test-cases/carom/versions/v1.0.0/references/base/title.png",
        },
      ],
      // Variant-specific reviewer checklist items, for the consoles' guided
      // review. Empty when the variant declares none. On an engine-format
      // version each graded point carries its `domains` and `failureCap`.
      "reviewItems": [],
      // The variant's authored showcase, or null when it declares none. Each
      // media file is fetched from the showcase route below.
      "showcase": {
        "description": "…the authored showcase.md, verbatim markdown…",
        "media": [
          {
            "file": "ai-block.json.gz",
            "name": "The AI blocks a shot",
            "kind": "replay",
          },
        ],
      },
    },
  ],
  // True when the version is on the engine-supported manifest format, which
  // makes its runs validator-rated.
  "engineFormat": true,
  "commonReferences": [
    {
      "view": "gameplay",
      "kind": "rendered",
      "mediaUrl": "/test-cases/carom/versions/v1.0.0/references/_common/gameplay.png",
    },
  ],
  "checks": [
    {
      "view": "title",
      "name": "Title",
      "referenceView": "title",
      "actions": [{ "type": "wait", "ms": 500 }],
    },
  ],
  // Reviewer checklist items common to every variant.
  "commonReviewItems": [
    {
      "id": "controls",
      "title": "Controls",
      "text": "Both paddles respond to input.",
    },
  ],
  // Known-issue errata recorded for this version. Empty when it has none.
  "errata": [],
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
same parameter, under the same rule. A case's `prompt.hbs` and its `.hbs` specs
branch on the selected engine, so one stored template renders into different
text depending on the runtime the build is written against.

A caller showing a run passes the engine that run recorded, including the
explicit `none`, so the reader sees the text that run's harness received. A
caller showing a case passes nothing and gets the engineless rendering, which is
what `none` renders to. An unrecognised slug is a `400`.

### `GET /test-cases/{slug}/versions/{version}/artifacts/{path...}`

Fetch a single seeded artifact, a spec source or an asset file, by its
store-relative `source` key. Returns the raw bytes with an appropriate
`Content-Type`. A `.hbs` spec source is returned verbatim; the runner renders
it. The path is validated to resolve inside the version's store directory. `404`
if the key is unknown for the version.

### `GET /test-cases/{slug}/versions/{version}/specs/{variant}`

The variant's full seeded spec set with each body already rendered for that
variant, in seed order. It takes the same optional `engine` query parameter,
under the same rule: see [Rendering for an engine](#rendering-for-an-engine).

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
(`<item>__<output>.<ext>`, or one of the `img.<id>.<ext>` files of the [shared
image store](/components/core/validation/#the-shared-image-store) its recordings
draw from), synthesized from the reference implementation. The engine is part of
the address because a variant has one reference implementation per
[engine](/components/core/engines/), and a run is only comparable against the
one it was itself built on.

### `GET /test-cases/{slug}/versions/{version}/showcase/{variant}/{file}`

Fetch one media file of a variant's authored
[case showcase](/components/core/showcase/#the-case-showcase), where `{file}` is
the plain file name the carousel declares. It is the case-side counterpart of a
run's `GET /runs/{id}/showcase/{file}`, addressed by case, version, and variant
because the showcase is authored material committed with the version rather than
run output. The content type follows the extension. Only a file the
variant's stored carousel lists resolves, and `showcase.toml` is never served.
The catalog preview and the resolved version's `showcase` fields point here.

### `GET /game-jams/{slug}/prior-readmes?model=`

The gameplay READMEs of earlier runs of a [game
jam](/testing/game-jam/overview/) built by the required `model`, oldest first,
across every harness. The driver reads this before seeding a repeated jam run so
the run can be briefed on earlier entries. Earlier runs count whether or not
they were published; only those that captured a README appear.

## Test case groups

### `GET /test-case-groups`

The ingested [test-case groups](/components/core/test-case-groups/), under
`groups`, in display order: the ordering rank is applied before serving and
does not ride the wire. Each entry carries the group's slug, name, optional
summary, and its member case slugs in authored order. An open read.

```jsonc
{
  "groups": [
    {
      "slug": "tower-defense",
      "name": "Tower Defense",
      "summary": "Mazes, waves, and tower placement.",
      "cases": ["meltdown", "valence", "arc-foundry"],
    },
  ],
}
```

## Reviewing, publishing, and reading runs

A run reaches the gallery through two mutating steps: attach one or more
reviews, then publish it (the [lifecycle](/components/core/results/#lifecycle)).
Each requires a bearer token. Reads require none.

A produced run's [run record](/components/core/run-records/) is stored privately
when the run finishes, reported by the [driver](/components/driver/overview/)
with the job's terminal status, and the produced build and media land on the
[artifact service](/components/artifacts/overview/), playable for review. The
public release of the source repo and the Cloudflare build happens at publish
time.

`POST /jobs/{id}/status`, the driver-authenticated status endpoint that carries
that record, also accepts a `canceled` status, and it is the only status
accepted on a job already in the terminal `canceled` state. Every other late
report from a winding-down driver is discarded. A `canceled` status must carry a
run record (`422` without one), normally a complete partial record: the driver
[winds a gg run down](/components/driver/overview/#cancellation) and posts what
the ordinary post-session path produced, including metrics, the collected tree
and the session summary. The backend persists it with the events its relay
accumulated and attaches the record id to the already-canceled job. The job
keeps its `canceled` state and its cancellation detail, no completion
notification fires, and no retry is enqueued.

Only the driver of a killed gg run whose session had been launched posts this
status. A killed run of any other harness, and a gg run killed before its
session was launched, is destroyed by its driver, which posts nothing further,
so the job stays `canceled` with no record attached.

### `POST /runs/{id}/reviews`

Submit a [review](/components/core/results/#reviews) for a produced run: the
per-domain functional `ratings`, the run-wide `aesthetic` tier, the markdown
`writeup`, the checklist verdicts, and an `editNote`. Which of them a run
accepts follows its case version. A validator-rated run requires the single
`aesthetic` tier and refuses `ratings`, since the functional verdicts are the
validators'; its `checklist` is optional and partial, carrying only the points
the reviewer overrides. A legacy run takes `ratings` and the full checklist and
refuses `aesthetic`. The review is attributed to the account the bearer token
resolves to, taken from the token rather than the body. A run carries many
reviews, one per account, and re-submitting from the same account updates that
account's own review.

On a validator-rated run each `checklist` entry is the reviewer's verdict for
one declared verdict id, an item id or an `<item>.<sub>` composite, with a
binary `pass` or `fail` status and an optional note. Points not listed keep the
validators' verdicts: the review's effective checklist is the validators'
verdicts overlaid with its overrides, and an override may also decide a point
the validators left undecided. Overriding is the exception, for a validator
whose precondition could not be met or a build that clearly does the right
thing despite broken instrumentation. The run's score and functional rating
fold overrides in as [`GET /runs/{id}`](#get-runsid) specifies.

A re-submission that changes the review is an edit. It requires a non-empty
`editNote`, keeps the original `reviewedAt`, stamps `editedAt`, and records the
prior-to-new diff as a public revision, covering the functional ratings, the
aesthetic rating, the verdicts, and the writeup. A re-submission that changes
nothing is a no-op.

`404` if the run is unknown. `422` when the review carries no rating on either
channel and no checklist verdict, when the writeup is empty, when it rates a
channel the run's case version does not accept, when a legacy review leaves a
functional domain unrated, when a validator-rated review omits its `aesthetic`
tier or a checklist entry names an undeclared id or a non-binary status, or
when an edit arrives without a note. Schema:
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
enqueue, and two concurrent requests cannot both enqueue. A publish is not
idempotent externally: every publish job mints a brand-new Cloudflare Pages
deployment, so two jobs for one run would leave an orphaned public build behind.

A publish job whose publisher died before reporting stops blocking after an
hour, and a failed publish never blocks at all: it stays immediately retryable.
As a second layer, the publisher itself re-checks the run's publication state
before doing any external work, and skips the release, reporting the links the
run already carries, when the run is already published.

### `DELETE /runs/{id}`

Permanently delete a run: its record, its reviews, its links, and its stored
media. A published run whose record this build can read is refused (`422`),
because a public run is in the snapshot and the gallery. A published run whose
record this build cannot read is deleted, since it is already absent from both.
`404` if unknown. The response reports the run id and `deleted: true`.

The run's playable build and recorded logs live in the separate [artifact
service](/components/artifacts/overview/), which the backend asks over
`TCAB_ARTIFACTS_URL` to prune the run's tree as well. That prune is best-effort
and never fails the delete; it runs only when that URL and the service token are
both configured. A tree a failed prune leaves behind is reclaimed by the
[sweep](/components/backend/overview/#artifact-reclamation).

Deletion acts on the stored row rather than on the record, so it also deletes a
run whose stored record this build cannot read.

### `GET /runs/unreadable`

The stored runs whose records this build cannot read, as `{ runs, total }`,
newest first by finish time. Each row carries the run's lifted identity, its id,
timestamps, case slug, version, variant and engine, harness, model, gg
configuration, test type, run state, published flag and review count, together
with the `error` its stored record produces when decoded now. An open read.

`offset` and `limit` page it as the numbered mode of [`GET /runs`](#get-runs)
does, with `limit` defaulting to 50 and clamped to 200, and `total` counts every
unreadable run the cabinet holds, so a pager sized from it offers only pages that
hold rows.

This is how a run that appears in no listing stays reachable: an operator reads
why the record no longer decodes and deletes the run with [`DELETE
/runs/{id}`](#delete-runsid). A re-push of the same run with a record this build
can read returns it to the ordinary listings.

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
  including infrastructure failures and the canceled gg runs that were recorded,
  ordered by finish time. This is the console's produced worklist, disjoint from
  the default published listing.
- `state=publishable` — the publish worklist: the subset of `state=unpublished`
  the publish gate accepts right now, which is a validator-rated completed run,
  a reviewed legacy completed run, or one of the publishable failure tiers.
  Every listed run is one the publish endpoint will accept.
- `state=any` — the union of the published and unpublished slices: every
  recorded run, with no lifecycle predicate at all. This is what the consoles'
  run listings draw from.

`any` and `publishable` are offered only on the summary-plus-offset path below,
since the cursor listings walk one lifecycle slice at a time.

A `canceled` run, a gg run an operator killed mid-flight, reaches
`state=unpublished` and `state=any`. It can never be published, carries no review
checklist, and is not a publishable failure, so the other selectors omit it. A
killed run of any other harness, and a gg run killed before its session was
launched, leaves no record, so it is listed by no selector.

#### Two projections

`fields` selects how much of each run the listing returns:

- Default, `fields` omitted — the full stored run per row, in the shape of the
  [detail endpoint](#get-runsid) (record, reviews, ratings, and score).
- `fields=summary` — a lightweight summary card per row: the run's id and
  timestamps, its [subject](/components/core/run-records/#subject) including the
  test type, [metrics](/components/core/metrics/), the `validationLoaded`
  signal, state, the functional `rating`, the `aesthetic` rating,
  `validatorRated`, the `score` and `reviewCount`, the denormalized case name, a
  performance run's fuel result, the ranking slice of a run's code analysis, and
  links. This is the same summary shape the [public
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

Both projections and both modes serve only the runs whose stored record this
build can read, and `total` counts exactly those rows, so a numbered pager sized
from it offers only pages that hold rows. A run this build cannot read is listed
by [`GET /runs/unreadable`](#get-runsunreadable) instead.

The offset mode additionally accepts:

- Filters `testCase`, `model`, `harness`, `variant`, `version`, and `engine`,
  each narrowing to runs matching that lifted subject value. They AND together,
  so `testCase=carom&model=…` is expressible, which the free-text `q` alone
  cannot do. A variant slug is unique only within its case, so `variant` is
  paired with `testCase`, as `version` normally is. `engine` matches the engine
  slug the run was launched under, and the engineless run records the slug
  `none`.
- Filter `versions`, a comma-separated list of exact versions, narrowing to runs
  matching any of them. Like `version`, it silences `latestVersions`.
- Filter `testCases`, a comma-separated list of case slugs, narrowing to runs
  matching any of them, so one query covers a [test-case
  group](/components/core/test-case-groups/)'s member cases. It ANDs with the
  other filters, `testCase` included, and `latestVersions` composes with it as
  with any case slice.
- Filter `ggConfigId`, the id of a [gg configuration](/gg/configurations/),
  narrowing to the runs launched from it. A [coverage
  cell](/components/backend/coverage/#what-identifies-a-gg-cell) counts by the same
  id, so a listing narrowed by it holds exactly the runs behind that cell's figure.
  A run launched from no configuration matches no id.
- Filter `aesthetic`, one of the aesthetic tiers, narrowing to runs whose
  aggregate aesthetic rating, the worst run-wide tier across their reviews, is
  exactly that tier. A run no review has rated on that channel never matches.
- Current versions `latestVersions=true`, restricting every run to its case's
  current `major.minor`: the newest one that case has a run for within the
  selected `state` slice. A case version is frozen once it has runs, so an older
  minor is a different spec whose runs are not comparable with the current one's.
  The current version is read off the runs rather than the definition store, so a
  newly authored version does not blank the listing before anything has run
  against it. `latestVersions` is ignored when `version` names an exact version.
- Search `q`, a free-text match across the lifted subject columns: test case
  slug, model id, harness slug, variant, and a gg run's
  [configuration](/gg/configurations/) name. It matches the recorded ids rather
  than a model's resolved display name.
- Sort `sort`, one of `date` (the default), `runtime`, `tokens`, `cost`,
  `rating`, `testType`, `testCase`, `harness`, `model`, or `variant`, with `dir`
  (`asc` or `desc`), tie-broken by run id. `model` orders by the run's model or
  configuration identity: a gg run sorts by the configuration it was launched
  from, and everything else by its model id. `testCase` orders by the case's
  display name, resolved the same way each card's `caseName` is: the latest
  ingested manifest's `name`, a case renamed on disk since the run was recorded
  by its current name, and a slug the store does not know at all by the slug
  itself.

`limit` defaults to 50 and is clamped to 200.

### `GET /runs/{id}`

One stored run, as `{ record, reviews, published, links, rating, aesthetic,
validatorRated, score }`: its record with links populated, the array of reviews
it carries with each reviewer's identity, whether it is published, its links,
and the run's ratings and score. Each review carries the `ratings` or the
run-wide `aesthetic` its run's channel accepts. `404` if unknown. The same
shape is what the default projection of [`GET /runs`](#get-runs) lists per row.

This endpoint answers with the record, so a run whose stored record this build
cannot read answers `404` here and is reached through [`GET
/runs/unreadable`](#get-runsunreadable).

- `validatorRated`: whether the run's case version is
  [validator-rated](/testing/end-to-end/evaluation/#rating-channels), so a
  consumer can show the run's points and functional rating from the record
  immediately, offer publish without a review, and pre-fill a review from the
  validators' verdicts.
- `rating`: the run's functional rating. On a validator-rated run the
  validators' rating while the run has no reviews, present from completion,
  and the worst of its reviews' effective ratings once it has any; on a legacy
  run the review aggregate. Composed with the toolchain gate either way. `null`
  while unset, which is a legacy run with no review, and `null` for every run
  that did not complete: a catastrophic failure, a timeout, or any other
  failure tier is unscored, whatever its case version, since no build loaded
  for a validator or reviewer to rate.
- `aesthetic`: the run's aggregate aesthetic rating, the worst run-wide
  tier across its reviews. `null` when no review has rated that channel: every
  legacy run, and an unreviewed validator-rated one.
- `score`: the run's points against its case version's checklist weights, the
  same `{ earned, total, reviews, overallGrade }` the summary card carries. On
  a validator-rated run the validators' score while the run has no reviews
  (`reviews` is `0`), present from completion, and the mean of its reviews'
  effective scores once it has any, with `reviews` counting them; on a legacy
  run the mean across its reviews, `null` while unreviewed. `null` when the
  run's case version is not ingested, and `null` for every run that did not
  complete, for the same reason its `rating` is.

The four are always present, `null` rather than omitted when unset. A run's
detail and its summary card always report the same functional rating and score.

```jsonc
{
  "record": { "…": "full RunRecord, links populated" },
  "published": false,
  "validatorRated": true,
  "rating": "great",
  "aesthetic": "amazing",
  "score": { "earned": 64, "total": 68, "reviews": 1, "overallGrade": null },
  "reviews": [
    {
      "reviewerId": "acct_7yq…",
      "reviewer": "Ada",
      "username": "ada",
      "ratings": [],
      "aesthetic": "amazing",
      "writeup": "Plays well, but…",
      // A validator-rated review's checklist holds only its overrides.
      "checklist": [
        {
          "id": "controls.ai",
          "status": "fail",
          "note": "Precondition unmet.",
        },
      ],
      "reviewedAt": "2026-06-21T18:00:00Z",
    },
  ],
  "links": {
    "sourceRepo": "https://github.com/…",
    "playableBuild": "https://…",
  },
}
```

### `GET /runs/{id}/events`

The run's recorded normalized [event stream](/components/core/events/) as a JSON
array, empty when the run recorded none. Raw harness output is never served.
`404` for an unknown run.

### `POST /snapshot/refresh`

Force an immediate [public snapshot](/components/backend/snapshot/)
regeneration, upload, and deploy-hook fire, outside the normal coalescing
window. The response reports whether the snapshot was refreshed, the run count
it covers, and whether the deploy hook fired.

## Coverage plans, ladders, and the review buffer

The reviewer scheduling surface: what runs an account wants to exist, and how fast
it wants them arriving. Every endpoint here requires a bearer token and is keyed
to the token's account. There is no path parameter naming a user, and an id that
belongs to another account answers `404` rather than `403`, so one account cannot
probe another's plan ids. The concepts live on
[Coverage plans](/components/backend/coverage/) and
[Ladders](/components/backend/ladders/); this section is the wire contract.

Two conventions differ from the rest of this page. The collections return bare
JSON arrays rather than the wrapped object [above](#conventions), and a plan's or
ladder's declaration and its schedule (`outerAxis`, `paused`, `autoTopUp`,
`bufferTarget`) are flattened into one object on the way out while being written
separately. An absent `schedule` on a `PUT` leaves the schedule alone, so saving
an edited model list can never un-pause a running plan.

### Pinned cases

Every case list on this surface, a `kind: "case"` group and a plan's or ladder's
one-off cases, carries the same fields: `slug`, `version`, `variant`, and an
optional `engine`. An absent `engine` is the `none` engine, so a list written
without the field covers the engineless run.

A [cell](/components/backend/coverage/#pinned-cases) is that whole pin crossed with
the combination, so every cell, launch, and queue entry this surface returns names
its `engine`, and a cell counts only the runs recorded on it. A run recorded with
no engine counts as a `none` run. A top-up launches each cell's runs on the cell's
engine, in a harness launch and a gg launch alike.

A pin naming a version the backend has not ingested, or an engine the pinned
version does not declare, is accepted and reported by the run rather than refused
at save time.

### Combinations

Every member list on this surface, a `kind: "combo"` group, a plan's or ladder's
one-off members, and the body of `POST /ladders/{id}/climbers`, carries the same
member shape, which is one of two:

| shape   | fields                                                                |
| ------- | --------------------------------------------------------------------- |
| harness | `harness`, `model`, optional `provider`                               |
| gg      | `ggConfigId` (`saved:<id>`), `ggSlotModels` (a model per launch slot) |

A member naming a `ggConfigId` is a [gg
combination](/components/backend/coverage/#combinations) and runs the `gg` harness;
one without it is a harness combination. The two shapes are unioned into one list
rather than split across two fields, so a plan crossing both against its cases needs
no second axis.

Reads add the resolved facts a client would otherwise recompute: the gg
configuration's current `ggConfigName`, and the `model` its root agent binds to.

A member's runs and a run launched by hand from the same configuration share one
[coverage cell](/components/backend/coverage/#what-identifies-a-gg-cell), so every
endpoint that enqueues a gg run applies one rule to the capability set it carries.
The set's `presetId` must name a gg configuration the token's account holds, or the
launch is refused with `400`; `POST /gg/runs` and the gg runs of `POST /jobs` and
`POST /jobs/batch` each answer to it, and a batch reports the refusal at that run's
own index. The enqueued set records that configuration's current name in
`preset`, so the label the run log slices by is the one the configuration bears
rather than the one the client last read. A set carrying no `presetId` is enqueued
as it arrived and belongs to no configuration's cell.

### Groups and plans

- `GET|POST /coverage-groups`, `PUT|DELETE /coverage-groups/{id}` — reusable member
  groups, each holding either combinations (`kind: "combo"`) or
  [pinned cases](#pinned-cases) (`kind: "case"`). Plans and ladders reference them
  by id, so editing a group reshapes everything that points at it. A plan that
  references a deleted group ignores the dangling id at coverage time; there is no
  cascade. A `combo` member naming a gg configuration the account does not own is
  refused with `400`.
- `GET|POST /coverage-plans`, `PUT|DELETE /coverage-plans/{id}` — the plans
  themselves. Reads return the declaration and schedule flattened.
  `runsPerCell` is clamped server-side.
- `GET /coverage-plans/summary` — the roll-up: cell counts, runs missing, runs
  unreviewed by you, plus `paused` and `autoTopUp`.
- `GET /coverage-plans/{id}/coverage` — the full matrix: one cell per
  `case × combination` in the plan's own emission order, with the `outerAxis`
  echoed so a reader knows what that order means, and the `runsPending` /
  `runsUnreviewed` / `runsOutstanding` / `bufferTarget` roll-ups. A cell whose
  combination cannot be launched carries the reason in `unlaunchable`. Schemas:
  [`coverage/coverage-plan.schema.json`](https://docs.testcabinet.ai/schema/coverage/coverage-plan.schema.json),
  [`coverage/coverage-matrix.schema.json`](https://docs.testcabinet.ai/schema/coverage/coverage-matrix.schema.json),
  [`coverage/coverage-group.schema.json`](https://docs.testcabinet.ai/schema/coverage/coverage-group.schema.json).

Each cell reports `inFlight` and, separately, the `pending` subset of it: jobs the
queue is deliberately holding back behind a harness parallelism cap or a same-model
game jam.

### The review buffer

- `GET|PUT /coverage-settings` — the account-wide `bufferTarget`: how many runs a
  top-up may leave outstanding (in flight, or finished and unreviewed by you) before
  it stops. It is a [tagged shape](/components/backend/coverage/#the-buffer-target),
  `{ "kind": "bounded", "runs": N }` or `{ "kind": "unbounded" }`: a bound of `0`
  is a legitimate value meaning "never top up", and unbounded means a top-up runs
  through everything. `GET` reports `isDefault` when the account has never chosen
  one, and no row is materialized on read.
  Schema: [`coverage/coverage-settings.schema.json`](https://docs.testcabinet.ai/schema/coverage/coverage-settings.schema.json).
- `GET|PUT /coverage-plans/{id}/schedule` — one plan's `outerAxis`, `paused`,
  `autoTopUp`, and its optional `bufferTarget` override, in the same tagged
  shape. The override is nullable and null is not zero: null inherits the
  account's setting, a bound of `0` means never, and unbounded means everything.
- `POST /coverage-plans/{id}/topup` — walk the plan's cells in its own order, skip
  the ones already at target (counted globally), and enqueue whole cells until
  the requester has `bufferTarget` runs outstanding, or every missing cell when
  the target is unbounded. There is no background daemon; this endpoint is what
  enqueues. It answers with the buffer target in force, the occupancy it
  observed, every cell it launched with its job ids in emission order, and every
  cell it could not launch with why.

  It is serialized per plan by a claim on the plan row, and reports
  `skipped: "busy"` rather than waiting when the claim is held, or
  `skipped: "paused"` when the plan is paused. A top-up that ran and found
  nothing to do reports neither, with `enqueued: 0`. Otherwise idempotent: it
  recomputes the shortfall on every call.

- `GET /coverage-plans/{id}/queue` — the plan's completed runs the requesting
  account has not reviewed, in the plan's own order rather than newest-first
  like the global unreviewed listing, so reviewing walks the buffer in the order it
  was deliberately filled. Capped rather than paginated, with `truncated` set when
  there is more behind it.

### Halting

Three controls per plan, and the same three per ladder:

| endpoint                             | pauses                           | cancels                                            |
| ------------------------------------ | -------------------------------- | -------------------------------------------------- |
| `POST /coverage-plans/{id}/pause`    | yes (body: `{ "paused": true }`) | nothing                                            |
| `POST /coverage-plans/{id}/halt`     | yes                              | its `queued` + `pending` jobs                      |
| `POST /coverage-plans/{id}/halt-all` | yes                              | the above plus `dispatched`, `starting`, `running` |

`pause` takes the state as a body rather than being two verbs.

Both halts reuse the same atomic cancel transition
[`POST /jobs/{id}/cancel`](#stopping-runs-in-bulk) uses, and reach only jobs whose
`origin` is this plan, so a run launched by hand is never swept up. Both answer with
`{ "canceled": n, "includedActive": bool }`.

`halt-all` discards work that is partly or wholly paid for. A client must confirm
before calling it and must never make it the default.

### Ladders

A [ladder](/components/backend/ladders/) is a sibling of the coverage plan: an
ordered list of rungs (one [pinned case](#pinned-cases) each, addressed by a
stable opaque id) that climbers ascend until a gate stops them. It reuses the
plan's `kind: "combo"` groups, buffer, top-up, queue, and halting verbatim, so
only its own endpoints are listed here.

- `GET|POST /ladders`, `GET|PUT|DELETE /ladders/{id}` — the declaration: rungs,
  climbers, `runsPerCell`, and the single parameterised `gate` (`floor`,
  `threshold`, `unloadedCountsAsBroken`, `earlyStop`). A create with no `schedule`
  takes the ladder default, `paused: true, autoTopUp: true`: a new ladder
  enqueues nothing until it is enabled, and from then on each review feeds it
  (see [A ladder starts disabled](/components/backend/ladders/#a-ladder-starts-disabled)).
  Rungs are matched on their stable ids and reconciled rather than replaced, so a
  reorder, a version bump, or an engine re-pin keeps every climber's recorded
  verdicts. A rung holding a
  [performance](/testing/performance/overview/) or
  [game jam](/testing/game-jam/overview/) case is refused with `400`: neither can
  ever produce a rating for the gate to read, so it would stall the climb silently.
  Schema: [`coverage/ladder.schema.json`](https://docs.testcabinet.ai/schema/coverage/ladder.schema.json).
- `GET /ladders/{id}/progress` — the board: every climber's status
  (`climbing` / `awaitingReview` / `walled` / `held` / `toppedOut`), the rung it
  stands on with the gate tally behind that answer, and its verdicts. It is a read:
  verdicts the gate has resolved but nobody has recorded are computed live and
  flagged `recorded: false`, then persisted by the next top-up, and a `GET` never
  advances a climber. A climber whose combination cannot be launched carries the
  reason in `unlaunchable`. Schema:
  [`coverage/ladder-progress.schema.json`](https://docs.testcabinet.ai/schema/coverage/ladder-progress.schema.json).
- `POST /ladders/{id}/rungs/order` — reorder the climb by rung id. The body must be
  a permutation of the ladder's current rungs; adding or dropping one is an edit and
  goes through `PUT /ladders/{id}`.
- `POST /ladders/{id}/climbers` — one combination's steering, written whole:
  `priority`, `focused`, and `held`. A hold stops a climber without pretending a
  rung was decided, so clearing it resumes exactly where the climb left off.
- `POST /ladders/{id}/outcomes` — apply or clear a manual override of one recorded
  verdict: promote a climber past a rung its runs failed, or wall one they passed.
  The override is stored beside the automatic verdict, so a recompute can never
  silently undo it and `outcome: null` restores exactly what the gate says. `409`
  when the rung has no verdict yet, since an undecided rung has nothing to promote
  past and the control for "stop here regardless" is a hold.
- `GET|PUT /ladders/{id}/schedule`, `POST /ladders/{id}/topup`,
  `GET /ladders/{id}/queue`, `POST /ladders/{id}/pause`, `.../halt`,
  `.../halt-all` — the plan endpoints above, with two differences. A top-up only
  ever launches a climber's current rung, while the queue and the buffer cover
  every rung a climber has reached, so a rung the gate has decided keeps
  offering the runs nobody reviewed
  ([why](/components/backend/ladders/#feeding-and-reviewing-are-different-sets-of-rungs)).
  And `pause` is the ladder's enable/disable switch: a ladder starts on its paused
  side, and `{ "paused": false }` only permits spending, so the caller that enables
  follows with a `topup`.

## Stopping runs in bulk

Three global sweeps. All require a bearer token, and all answer
`{ "canceled": n, "includedWaiting": bool, "includedActive": bool }`.

| endpoint                    | sweeps                              |
| --------------------------- | ----------------------------------- |
| `POST /jobs/cancel-waiting` | `queued`, `pending`                 |
| `POST /jobs/cancel-active`  | `dispatched`, `starting`, `running` |
| `POST /jobs/cancel-all`     | both, in one transition             |

These are global and scoped to nothing: they cancel matching jobs whatever
launched them, including runs launched by hand and runs launched by another
account. They are the "stop the cabinet" controls; the scoped equivalent is a
plan's or ladder's [`halt`](#halting). Cancelling a single job by id remains
`POST /jobs/{id}/cancel`, which these reuse rather than reimplement.

`cancel-active` and `cancel-all` discard work in progress, so a client confirms
first. `cancel-waiting` needs no confirmation.

## Model probes

A model probe is a responses-as-code readiness check of one catalog model,
answering whether the model can drive [gg](/gg/overview/)'s RaC mode before any
run is spent on it. The backend replays gg's RaC turn-1 request per case: two
scenarios over several input prompts (at least three prompts across them), on
one program-language arm or on every arm. Each case's conversation is an
embedded per-language fixture projected out of gg's own machinery by
`scripts/gg-probe-fixtures.sh`, holding the real system prompt, the real
bootstrap program and module listing, the real documentation views, and a seeded
spec file view carrying its total-line-count heading, sent whole and never
trimmed. The replay goes through OpenRouter chat/completions with the one
`submit_program` tool offered and `tool_choice` forced to it, the wire shape gg
sends, and each case is sampled `samples` times with no temperature set.

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
least 80% of its scored calls, and `not-ready` otherwise.

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
  "maxTokens": 3500,
}
```

Answers `202 Accepted` with the probe row already `running`; the probe executes
in the backend and the row is read back by polling. `409` when a probe of the
model is already running. `422` when `language` names no gg program language,
or when the model has no OpenRouter slug to target: a probe targets a curated
model's configured OpenRouter slug, falling back to the catalog slug itself when
it reads as an OpenRouter id. `503` with code `openrouter_key_missing` when the
backend has no key configured.

### `GET /models/{slug}/probes`

The model's probe history, newest first, under `probes`. Each probe carries
its language selection, status (`running`, `complete`, or `failed`), verdict,
overall pass rate, USD spend, and timestamps. An open read.

### `GET /model-probes/{id}`

One probe with its per-call items and the per-case requests exactly as sent
under `requests`, one entry per probed (language, scenario, prompt) with its
message array. The case's `submit_program` tool definition and forced
`tool_choice` ride beside them on the wire to the provider. Each item records
its (language, scenario, prompt, sample) coordinate, serving provider, finish
reasons, outcome label and pass flag, the submitted program, the reply's own
text with any separate reasoning text, token counts, USD cost, duration, and
the error that voided the call. An open read.

### `GET /models/{slug}/probe-providers`

The providers OpenRouter lists for the model, as name and context length, for
pinning a probe to one. Requires a bearer token, because it reaches a third
party on the caller's behalf.

## Cabinet statistics

### `GET /stats/cabinet`

The cabinet's whole-of-corpus headline figures, folded over every stored run
whatever its state or publication. An open read.

Every figure here is folded from lifted columns, so the corpus covers the runs
whose records this build cannot read as well. This count and a listing's `total`
therefore answer different questions.

- `runs`: the total recorded run count.
- `tokens`: the summed total tokens, with `unreportedRuns` counting the runs
  whose metrics reported no tokens; those contribute nothing to the sum.
- `cost`: the summed [comparable cost](/components/core/metrics/#cost) in USD,
  with `unreportedRuns` counting the runs whose comparable cost is unknown;
  those contribute nothing to the sum.
- `testCases` and `models`: distinct test-case slugs and distinct model ids
  across the same corpus.
- `weekly`: runs bucketed by the UTC Monday of the ISO week they started, as
  `weekStart` in `YYYY-MM-DD` form, covering the last 52 weeks up to now,
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
    { "weekStart": "2026-03-09", "runs": 118 },
  ],
}
```

## Provider and accuracy statistics

Two aggregate reads fold cross-run statistics. Both fold from stored gg session
summaries reached through the gg document index rather than re-parsing the run
store. Provider figures exist only on runs whose summary recorded
`providerStats`; older runs are counted as scanned but contribute no provider
rows, and a figure an older record omitted is never defaulted.

### `GET /stats/providers`

Per-provider health across every stored gg run, plus the probe store's
per-provider evidence, kept strictly separate. An open read.

Run evidence: one entry per upstream provider observed in any run's
`providerStats` slices, each carrying its per-model rows and a total. A row
reports contributing runs, calls with their summed tokens and USD cost,
length-capped rejections, and the attributed turns split into working turns and
an error breakdown keyed by turn error type. The `provider: null` entry
collects the calls that named no provider and sorts last; a `modelId: null` row
is a slice recorded before the agent's first usage delta named its model, on a
run more than one model served.

Probe evidence: one entry per provider observed on
[model-probe](#model-probes) items, per probed model: item count, case-check
pass count, and errored calls.

The response also reports `runsScanned` (every stored gg run with a recorded
session summary) and `runsWithProviderData`, so a consumer can present sparse
provider coverage as sparse rather than as zero.

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

A run that cannot be attributed to a single model is counted once under the
response's `unattributableRuns`. Models are ordered by evidence volume
(responses-as-code turns plus tool calls), largest first.

## The console stream

One SSE connection carries everything the console learns about runs it is not
individually watching: the alerts it shows a person, and the lifecycle transitions
it maintains its in-flight list from. It is worker-wide, so every console sees
every run whoever launched it, and live-only, with nothing replayed and no
backlog to catch up on.

### `GET /notifications` — subscribe

Opens the stream. Every frame is a named SSE event, so there is no unnamed
`message` frame and a client using `EventSource.onmessage` alone receives nothing.

| `event:`       | payload               | topic                         |
| -------------- | --------------------- | ----------------------------- |
| `stream`       | `{ "streamId": "…" }` | always — the first frame      |
| `notification` | `Notification`        | `notifications`               |
| `run`          | `RunEvent`            | `runs`                        |
| `resync`       | `{ "dropped": n }`    | always                        |
| `heartbeat`    | _(none)_              | always — every 15s while idle |

The hello frame (`stream`) arrives first and carries the id the client quotes
back to change its topics. The id is minted per connection rather than per
client: an `EventSource` reconnects on its own, and the reconnected stream is a
new subscriber with default topics, so a client must re-apply what it wanted
each time a hello frame arrives.

The `resync` frame says this client fell behind far enough that the backend
dropped messages for it. Nothing can be replayed, so the client's recovery is to
re-read the authoritative lists (`GET /jobs/active`, and the run listing if it is
showing produced runs).

The `heartbeat` frame carries no payload; its arrival is the whole message. A
client arms a watchdog, rearms it on every frame, and treats an overdue one as a
dead connection to tear down and reopen. Comment keep-alive traffic runs
alongside it, for the proxies that want it.

### Topics

| topic           | carries                          | default |
| --------------- | -------------------------------- | ------- |
| `notifications` | a run finished; a publish failed | on      |
| `runs`          | every in-flight list transition  | off     |

The split is between alerting and list maintenance. A notification is something
a person should be told about, and it fires only for the two things worth
interrupting someone over. A run event is every transition a list must reflect.
The console holds one stream open for the whole session and carries the run
churn only while a page is showing it.

A `RunEvent` carries enough to patch a list in place without a round-trip, the
run's identity and its state after the transition:

```json
{
  "kind": "state-changed",
  "runId": "…",
  "testCaseSlug": "carom",
  "testCaseVersion": "v1.0.0",
  "variant": "base",
  "harnessSlug": "claude",
  "modelId": "…",
  "engine": "simple-2d",
  "startedAt": "2026-09-06T00:02:00Z",
  "state": "running"
}
```

The identity carries `engine` only when the run names one, an absent field being the
`none` engine as it is on a launch request. The engine is a segment of the run's
[cell](/components/backend/coverage/#pinned-cases), so a client listing one cell's
runs keeps another engine's live rows out with it. `GET /jobs/active` reports the
same identity.

`startedAt` is when the run itself began, present from the moment the job reaches
`starting`. That transition is the anchor because the driver posts it immediately
before taking the `startedAt` the produced record is measured from, so the
reported start and the recorded one name the same moment. A queued, pending, or
dispatched run omits the field, since it has not started.

A duration ticked from `startedAt` is elapsed wall clock, so it reads higher than the
[run time](/components/core/metrics/#durations) the finished run records, and steps
down once the run lands.

`kind` is `enqueued` (joined the queue), `state-changed` (moved between two
non-terminal states), or `finished` (reached `succeeded`, `failed`, or `canceled`,
and left the in-flight set). A `finished` event adds `recordId` when the run
produced one and `detail` when it failed or was cancelled. A cancelled run raises
a run event but no notification, since it is an operator action rather than a
failure to alert on, and the list must still drop the row.

A run that produced a record also makes the produced-run listing stale, which the
event does not carry. A client re-reads that separately.

### `PUT /notifications/{stream}/topics` — change topics

The control channel SSE itself does not have. Body:

```json
{ "runs": true }
```

Both `notifications` and `runs` are optional, and an omitted field leaves that
topic unchanged, so a client toggling one never disturbs the other. Answers `204`,
or `404` when no such stream is connected.

A `404` is a normal, expected outcome rather than an error to surface: it means the
client's stream died and its `EventSource` has reconnected (or is about to) under a
new id. The recovery is to wait for the next hello frame and re-apply.

The topic change applies to the already-open stream, taking effect on the very
next message.

### Staying current without polling

A client does not poll this queue. It re-reads `GET /jobs/active` only when
something tells it its own list may be wrong, and lives on the events in between.
There are four such moments, and between them they cover every way a client can
fall out of step:

| trigger                              | what it recovers                                             |
| ------------------------------------ | ------------------------------------------------------------ |
| the `runs` topic goes from off to on | anything published while it was off, which is never replayed |
| the stream (re)connects              | the gap, since the stream keeps no backlog                   |
| a `resync` frame                     | messages the backend dropped for a client that fell behind   |
| the watchdog forces a reopen         | a stream that died without saying so                         |

Two client-side details are load-bearing:

- Reopen a stream the browser has abandoned. After enough failed attempts
  `EventSource.readyState` settles on `CLOSED` and the browser stops retrying,
  permanently. Only an explicit reopen recovers it. While `readyState` is
  `CONNECTING` a retry is already under way and is left alone.
- Re-base, then replay. The active-list snapshot describes the queue as of the
  moment the request was served, so applying it over a list that live events have
  since moved forward would undo them. Buffer events for the duration of the fetch
  and apply them on top of the snapshot.

## Reference rendering

A test case's reference mockups are rendered to screenshots once, by the
backend, at ingest. Rendering there makes the validation baseline byte-identical
across every runner: a runner downloads the rendered image, seeds it as the
visual target, and uses it as the [validation](/components/core/validation/)
baseline. Runners still need a headless browser locally for the load check and
per-check capture; only the reference baseline render lives on the backend.
