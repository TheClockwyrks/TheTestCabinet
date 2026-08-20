---
title: HTTP API
---

The backend exposes a single HTTP API that every other component talks to: the
[runners](/components/architecture/#runners-and-reporters) resolve test case
definitions through it, the operator's component reviews and publishes runs to it,
and reporters read published runs back from it. User identity is **not**
served here — it lives in the standalone [auth service](/components/auth/overview/),
whose tokens this API verifies. Container images are **not** part of
this API — a runner pulls them from its own configured registry (see
[Container images](#container-images)). This page is the authoritative contract
for that interface — the cross-component surface. How the backend stores what it
serves (its SeaORM system of record, its on-disk definition store) is an internal
concern covered in the [Overview](/components/backend/overview/), not part of
this contract.

## Conventions

- The API is JSON over HTTP. Request and response bodies are **camelCase**,
  matching the [run record](/components/core/run-records/) contract.
- **Collections are returned as a wrapped object**, never a bare top-level JSON
  array — each list endpoint nests its items under a named key (e.g.
  `{ "testCases": [...] }`). This keeps every response an object that can grow new
  fields without breaking clients.
- Timestamps are **RFC 3339** strings.
- Harness slugs are the eight defined in
  [Harnesses](/components/core/harnesses/).
- Ratings are the five tiers defined in
  [Reviews](/components/core/results/#reviews):
  `flawless`, `great`, `passable`, `scuffed`, `broken`.
- **Reads are open; mutations require a bearer token.** Reachability is the first
  line of access control — the backend sits on a private network — but the
  mutating run endpoints (review, publish) additionally require an
  `Authorization: Bearer <token>` header identifying the acting
  [account](/components/backend/overview/#accounts), which the backend verifies
  against the [auth service](/components/auth/overview/). A missing or invalid
  token is a `401`. Reads (definitions, runs, snapshot refresh) need no token. See
  [Authentication](/components/backend/overview/#authentication).
- Errors use one envelope across every endpoint, paired with an appropriate HTTP
  status (`400`, `401`, `404`, `409`, `422`, `500`):

  ```jsonc
  { "error": { "code": "string", "message": "string" } }
  ```

  Schema: [`backend-api/error.schema.json`](https://docs.testcabinet.ai/schema/backend-api/error.schema.json).

## Health and ingest

### `GET /healthz`

**Liveness** probe and service identity. Always `200` while the process is
serving. Returns the service status, its contract version, and `storeReady` —
whether the definition store can resolve test-case versions yet.

`storeReady` is reported here for display (the console's Connections page shows
it); it is deliberately *not* what makes this endpoint `200`, because a backend
whose store is still filling is alive and must not be restarted.

### `GET /readyz`

**Readiness** probe: `200` once the definition store holds versions, `503` while
it is still empty.

Keep this separate from the `/healthz` liveness probe in every deployment. A
backend whose definition store lives on an ephemeral volume starts with an empty
store and re-ingests the whole catalog on boot, which takes minutes:

- A **liveness** probe on this signal would kill the pod mid-ingest, and it would
  never converge.
- A **readiness** probe on `/healthz` admits traffic to an empty store, so every
  run launched in that window fails with a spurious
  `test-case version ... is not ingested` 404.

The signal latches: once the store is populated the backend stays ready, and a
later re-ingest does not withdraw it. Re-ingest swaps each version into place
atomically, so resolution keeps working throughout one — and since the backend
runs at a single replica, going unready would empty its Service and fail every
caller outright rather than 404 one case.

### `POST /ingest`

Trigger a scan of the repository checkout the backend ingests from. New or
changed [test case versions](/testing/end-to-end/overview/) are copied into the
backend's store, with each reference mockup rendered to a screenshot during
ingest (see [Reference Rendering](#reference-rendering)). The scan reports what
changed; an already-ingested, unchanged version is a no-op unless re-ingestion
is forced. The request may restrict the scan to specific cases — or to
individual versions of a case. The scan runs to completion before the default
response returns; a client can instead stream per-version progress (see below).

The request body is optional JSON:

```jsonc
{
  "testCases": ["carom", "coil@v1.1.0"], // restrict the scan (default: all)
  "force": true,             // re-ingest even versions already in the store
  "catalogVersion": "a1b2c3" // tag a whole-catalog ingest with its content version
}
```

Each `testCases` entry is either a bare case **id** — its slug or folder name,
expanding to every version the case declares (`"carom"`) — or a
version-qualified **`id@version`** targeting exactly that one version
(`"coil@v1.1.0"`). The version-qualified form lets a client that edited a single
version re-ingest only it, rather than re-rendering every version of the case;
`scripts/reingest.sh` uses it to send just the versions whose files changed.

`force` overwrites a version already stored, re-rendering its references. It
exists for **development** iteration on a version no run has been published
against; a version that published runs reference is immutable and must be
revised by adding a new version, not re-ingested (see
[Test Cases](/testing/end-to-end/overview/)).

`catalogVersion` is an opaque token identifying the catalog content of a
whole-catalog ingest (the calling build's commit). The backend records it in the
store and, on the next ingest, **skips the re-render entirely when the token is
unchanged** — the store already holds exactly that catalog. A changed or
first-seen token forces a full re-ingest (content can change under unchanged
version strings, e.g. an edited spec on the same `v1.0.0`) and advances the
recorded marker. It is how the **desktop app** avoids re-ingesting its bundled
catalog on every launch: the bundle is baked at build time, so its build commit
identifies it, and a clean restart at the same build is a no-op. The marker lives
in the store, so a fresh store re-ingests unconditionally. A partial scan
(`testCases` set) ignores `catalogVersion` and leaves the marker untouched. A
`-dirty` build does not send it (content is not pinned), forcing a re-ingest.

A full re-render can take a minute or more, so the response shape is content
negotiated. By default the call answers once with the full JSON report above. A
client that sends `Accept: application/x-ndjson` instead receives a **streamed
progress feed** — one [NDJSON](https://github.com/ndjson/ndjson-spec) object per
line, flushed as each version finishes, so a long scan reports progress instead
of looking like a hang. The streaming and default paths run the identical scan;
only the framing differs. The lines are discriminated by an `event` tag:

```jsonc
{ "event": "start", "total": 31 }                  // once, before the first version
{ "event": "version", "index": 1, "total": 31,     // one per completed version
  "slug": "carom", "version": "v1.0.0",
  "ingested": true, "renderedReferences": 3 }
{ "event": "done", "total": 31, "ingested": 25, "skipped": 6 } // closing summary on success
{ "event": "error", "message": "…" }               // closing line if the scan aborts
```

Because the stream has already sent a `200` by the time it knows the outcome, a
late failure arrives as a closing `error` line rather than an HTTP error status.
[`scripts/reingest.sh`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/scripts/reingest.sh)
consumes this feed (it is also what `make local-ingest` runs).

Container images are **not** part of this API at all — they are distributed
through a container registry and resolved by each runner directly from its own
registry configuration (see [Execution](/components/core/execution/#containerization)).
The backend neither stores nor serves image references.

## Test case resolution

These endpoints are how a runner resolves the definition it needs to seed and
validate a run. They mirror the catalog and version model described in
[Test Cases](/testing/end-to-end/overview/), sourced from the backend's store
rather than a local checkout.

### `GET /test-cases`

The catalog: every ingested case and its available versions, under `testCases`.
Each entry also carries the **display metadata a listing renders** — the name,
test type, asset shape, difficulty, tags, and summary — read from the case's
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

- Host paths are rewritten to **store-relative `source` keys**. Spec and asset
  **bodies** are not inlined (a case can be large); the runner fetches each by
  key from the [artifact endpoint](#get-test-casesslugversionsversionartifactspath).
- References are resolved to their **rendered screenshot URLs** rather than
  mockup source — the runner never receives mockup HTML.
- The prompt template is served **inline**, because the runner renders it locally
  and it never hits the runner's disk.

A representative response:

```jsonc
{
  "slug": "carom",
  "version": "v1.0.0",
  "name": "Carom",
  "difficulty": "easy",
  "tags": ["arcade", "2d"],
  "summary": "A two-paddle rally game.",
  "description": "## Carom\n…",
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
      "specs": [],
      "references": [
        {
          "view": "title",
          "screenshotUrl": "/test-cases/carom/v1.0.0/references/base/title.png"
        }
      ],
      // Variant-specific reviewer checklist items, for the consoles' guided
      // review (see Reviews). Empty when the variant declares none.
      "reviewItems": []
    }
  ],
  "commonReferences": [
    {
      "view": "gameplay",
      "screenshotUrl": "/test-cases/carom/v1.0.0/references/_common/gameplay.png"
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
  ]
}
```

`404` if the version has not been ingested. Schema:
[`backend-api/resolved-test-case-version.schema.json`](https://docs.testcabinet.ai/schema/backend-api/resolved-test-case-version.schema.json).

### `GET /test-cases/{slug}/versions/{version}/artifacts/{path...}`

Fetch a single seeded artifact — a spec source or an asset file — by its
store-relative `source` key. Returns the raw bytes with an appropriate
`Content-Type`. `.hbs` spec sources are returned verbatim; the runner renders
them. The path is validated to resolve inside the version's store directory.
`404` if the key is unknown for the version.

### `GET /test-cases/{slug}/versions/{version}/references/{scope}/{view}.png`

Fetch a rendered reference screenshot as `image/png`. `scope` is `_common` for a
common reference or a variant slug for a variant-specific one. The `screenshotUrl`
fields in the resolved version point here.

### `GET /test-cases/{slug}/versions/{version}/validation-files`

List the store-relative keys of every file under the version's reporter-side
automated-validation script directory (`validation/`) — the debug drivers plus any
shared modules they import (for example `validation/_helpers.mjs`) — as a JSON
string array, walked recursively and sorted. A backend-driven run fetches this whole
set (each via the `artifacts` route above) into its definition store so a script's
sibling `import`s resolve when the [validator](/components/core/validation/) runs it;
the review-item-named scripts alone are not enough. Like the scripts themselves,
these are **reporter-side** and never seeded into the model's run container. Empty
for a version that declares no scripted items.

## Container images

Container images are **not** part of this API. Harness run-container images are
distributed through a container registry, and each runner resolves the image for
a harness directly from its own registry configuration — defaulting to the
published images on the `latest` tag — without consulting the backend. This keeps
image resolution working against any backend (staging, production, or a
self-hosted one) and with no backend at all. See
[Execution](/components/core/execution/#containerization) for how a runner
resolves and records the image it ran.

## Reviewing, publishing, and reading runs

A run reaches the gallery through two mutating steps — attach one or more
**reviews**, then **publish** it (the
[lifecycle](/components/core/results/#lifecycle)). Each requires a bearer token
(`401` without). Reads need none.

A produced run's [run record](/components/core/run-records/) is stored privately
**when the run finishes**: the [driver](/components/driver/overview/) reports it
when it posts the job's terminal status (it is not posted by an operator), and the
produced build and media land on the [artifact service](/components/artifacts/overview/),
playable for review. The public release of the source repo and Cloudflare build is
done by the publisher at **publish** time, not before.

### `POST /runs/{id}/reviews` — submit a review

Submit a [review](/components/core/results/#reviews) for a produced run: the
per-domain `ratings`, the markdown `writeup`, and the checklist verdicts. The
review is **attributed to the account the bearer token resolves to** — the
reviewer identity is taken from the token, not the body. A run may carry **many
reviews, one per account**; re-submitting from the same account replaces that
account's own review. `404` if the run is unknown; `422` if a declared domain is
unrated or a declared checklist item lacks a verdict; `401` without a token.
Schema:
[`backend-api/review.schema.json`](https://docs.testcabinet.ai/schema/backend-api/review.schema.json).

### `POST /runs/{id}/publish` — publish

**Release** a reviewed run and flip it **public** — the gate that puts it in the
snapshot and the gallery. **Refuses a run that has no review** (`422`). The release
(source repo + Cloudflare build) runs asynchronously in a per-publish
`tcab-publisher` Job; this endpoint gates the run and enqueues that Job, answering
`202 Accepted` with the publish-job id and the live URL to observe the release on
(the run flips public when the Job reports a terminal success). Requires a bearer
token.

It is **idempotent while a release is under way**: if the run already has a live
publish job, this returns *that* job's id and live URL instead of enqueuing a second
one, so a double-click, a second console tab, or a retry after the live stream
dropped re-attaches to the publish already running. This matters because a publish
is **not** idempotent externally — every publish job runs `wrangler pages deploy`,
which mints a brand-new Cloudflare Pages deployment, while the `gh` side reuses an
existing repository. Two jobs for one run therefore leave an orphaned public build
behind, visible only on the Pages side. A partial unique index on the publish queue
backs the check so two concurrent requests cannot both enqueue.

A publish job whose publisher died before reporting stops blocking after an hour
(nothing reaps it, so it would otherwise wedge the run's publishing forever), and a
**failed** publish never blocks — it stays immediately retryable. As a second layer,
the publisher itself re-checks the run's publication state before doing any external
work and skips the release (reporting the links the run already carries) if the run
is already published.

### `DELETE /runs/{id}` — delete

Permanently delete a run: its record, its reviews, its links, and its stored
media (proof, asset, and controller bytes). **Refuses a published run** (`422`) —
a public run is in the snapshot and the gallery, so it can never be deleted; only
an unpublished run can be removed. Because the run was not public, no snapshot
refresh is needed. `404` if unknown. Requires a bearer token. The response reports
the run id and `deleted: true`.

A run's playable build and recorded logs live in the separate
[artifact service](/components/artifacts/overview/), which the backend asks to
prune the run's tree too (`DELETE /runs/{id}/artifacts`, presenting the shared
service token). That prune is **best-effort**: the record is already gone, so a
failure is logged and the unreferenced tree is left for a later sweep — it never
fails the delete. It runs only when the artifact service URL and the service token
are both configured.

The consoles (web and Tauri) expose this as a **Delete run** control on the run
detail page, shown only for an unpublished run the active worker produced.

### `GET /runs`

List stored runs, newest first. A `state` query parameter selects which runs:

- `state=published` (the **default**) — published runs only, ordered by publish
  time, for reporters and the public-facing views.
- `state=review` — the **reviewer worklist**: **completed** runs (produced but not
  yet published, plus published ones), ordered by finish time, so a reviewer can
  find runs to assess. The failure tiers are excluded — they carry no review
  checklist.
- `state=failures` — the **publishable-failure worklist**: catastrophic, validation-error, and
  timed-out runs (pending and published), for the publish-failures affordance.
  Infrastructure failures are excluded (never publishable).
- `state=unpublished` — **every** unpublished run whatever its terminal
  state (completed, every failure tier, including the never-publishable
  infrastructure failures), ordered by finish time. This is the console's
  "produced" worklist — every run that exists but is not yet public, so an
  infrastructure failure stays inspectable rather than appearing in no list.
  Disjoint from the default published listing.
- `state=publishable` — the **publish worklist**: the subset of `unpublished`
  that would publish *right now*, i.e. exactly what the
  [publish gate](/components/core/results/#publish) accepts — a reviewed
  completed run, or one of the publishable failure tiers (which need no review) —
  and never an infrastructure failure, whatever reviews it carries. This backs the
  console's **Unpublished** tab, where every listed run is meant to be selected and
  published; listing the unreviewed and never-publishable runs there would offer
  rows the publish endpoint is about to refuse.
- `state=any` — the **union** of the published and unpublished slices: every
  stored run, whatever its terminal state. This is what the consoles' run
  listings draw from, so a produced (and therefore unreviewed) run sorts and
  pages in the *same* listing as the published ones instead of being merged in
  ahead of them client-side.

`any` and `publishable` are offered only in the numbered-offset mode below (the
cursor listings walk one lifecycle slice at a time).

#### Two projections

`fields` selects **how much** of each run the listing returns:

- Default (`fields` omitted) — the full stored run per row. Heavy, and used only
  where the whole record is needed.
- `fields=summary` — a lightweight **`RunSummary`** card per row: the run's id and
  timestamps, its [subject](/components/core/run-records/#subject) (including the
  [test type](/testing/overview/)), [metrics](/components/core/metrics/), the
  `validationLoaded` signal, state, the aggregate `rating` and `reviewCount`, the
  denormalized case name, and links — enough to render a run-list row, a card, a
  leaderboard entry, or a metrics aggregate **without** fetching each full record.
  The [detail](#get-runsid) endpoint loads the full record (and the run's reviews)
  lazily, one run at a time. This is the same summary shape the
  [public snapshot](/components/backend/snapshot/#runsjson--the-run-index) ships as
  its run index; its schema is
  [`snapshot/runs.schema.json`](https://docs.testcabinet.ai/schema/snapshot/runs.schema.json).

#### Two pagination modes

- **Cursor.** `before` (a run id) plus `limit` walks the whole set newest-first,
  page by page; the response carries the runs and the cursor for the next page
  (`null` when there are no more). This is the drain the public-snapshot export
  uses, and it is unaffected by the filter/sort params below.
- **Numbered offset.** `offset` plus `limit` returns a single page of a
  filtered, sorted listing as `{ runs, total }`, where `total` is the count under
  the same filters — enough to drive a numbered (jump-to-page) pager without
  walking the set. Only available with `fields=summary`.

The offset mode additionally accepts:

- **Filters** `testCase`, `model`, `harness`, `variant`, and `version` — each
  narrows to runs matching that lifted subject value, and they **AND** together
  (so `testCase=carom&model=…` is expressible, which the free-text `q` alone
  cannot do). A variant slug is unique only within its case, so `variant` is
  paired with `testCase` (the case-detail Runs tab's slice), as `version`
  normally is.
- **Current versions** `latestVersions=true` — restrict every run to its case's
  **current** `major.minor`: the newest one that case has a run for *within the
  selected `state` slice*. A case version is frozen once it has runs, so an older
  minor is a different spec whose runs are not comparable with the current one's;
  this is the console listings' default. The current version is read off the runs
  rather than the definition store, so a newly authored version does not blank the
  listing before anything has run against it, and the static gallery — which has
  only its run index — answers the identical question from the same data.
  `latestVersions` is **ignored** when `version` names an exact version: an
  explicit version is the more specific instruction, and AND'ing the two would
  silently empty the listing whenever the picked version is not the current one.
- **Search** `q` — a free-text match across the lifted subject columns (test case
  slug, model id, harness slug, variant). It matches the **raw** recorded ids, not
  a model's resolved display name.
- **Sort** `sort` — one of `date` (default), `runtime`, `tokens`, `cost`,
  `rating`, `testType`, `testCase`, `harness`, `model`, or `variant` — with
  `dir` (`asc` or `desc`), tie-broken by run id.

To keep `sort`/`q`/the filters DB-native, the run row lifts the fields the record
otherwise buries in its JSON blob — the test type, run time, total tokens,
comparable cost — alongside the rating and review count derived from the reviews
table, into indexed columns. These are added by a versioned migration with an
idempotent startup backfill, and kept current as runs are recorded, reviewed, and
published. (The columns are an internal detail; the projection and params above
are the contract.)

### `GET /runs/{id}`

One stored run, as `{ record, reviews, published, links }`: its record (with
links populated), the **array** of reviews it carries (each with its reviewer
identity), whether it is `published`, and its links. `404` if unknown.

```jsonc
{
  "record": { "…": "full RunRecord, links populated" },
  "published": false,
  "reviews": [
    {
      "reviewerId": "acct_7yq…",
      "reviewer": "Ada",
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

The published run's recorded normalized [event stream](/components/core/events/)
as a JSON array — an empty array when the run recorded none (or was published
before events were captured). Raw harness output is never published, so it is not
served here. Backs the run-detail Events tab for reporters reading published
runs. `404` for an unknown run.

### `POST /snapshot/refresh`

Force an immediate [public snapshot](/components/backend/snapshot/) regeneration,
upload, and deploy-hook fire, outside the normal coalescing window. For operator
recovery. The response reports whether the snapshot was refreshed, the run count
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
  `.../halt-all` — the plan endpoints above, with two differences: a top-up only ever
  launches a climber's **current** rung — while the queue and the buffer cover every
  rung a climber has **reached**, so a rung the gate has decided keeps offering the
  runs nobody reviewed
  ([why](/components/backend/ladders/#feeding-and-reviewing-are-different-sets-of-rungs))
  — and `pause` is the ladder's enable/disable switch — a ladder starts on its paused side, and `{ "paused": false }` only permits
  spending, so the caller that enables follows with a `topup` (the console does).

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

A test case's reference mockups are rendered to screenshots **once, by the
backend, at ingest** — not by each runner. Rendering on ingest makes the
validation baseline byte-identical across every runner: a runner downloads the
rendered PNG, seeds it as the visual target, and uses it as the
[validation](/components/core/validation/) baseline, and never receives the
mockup HTML. Runners still need a headless browser locally for the load check and
per-check capture; only the reference baseline render lives on the backend.
