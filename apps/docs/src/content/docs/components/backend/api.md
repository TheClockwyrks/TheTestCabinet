---
title: HTTP API
---

The backend exposes a single HTTP API that every other component talks to: the
[runners](/components/architecture/#runners-and-reporters) resolve test case
definitions through it, the operator's component pushes, reviews, and publishes
runs to it, and reporters read published runs back from it. User identity is **not**
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
- Ratings are the four tiers defined in
  [Reviews](/components/core/results/#reviews):
  `flawless`, `great`, `scuffed`, `broken`.
- **Reads are open; mutations require a bearer token.** Reachability is the first
  line of access control — the backend sits on a private network — but the
  mutating run endpoints (push, review, publish) additionally require an
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

Liveness and readiness probe. Returns the service status, its version, and
whether its store is ready.

### `POST /ingest`

Trigger a scan of the repository checkout the backend ingests from. New or
changed [test case versions](/testing/end-to-end/overview/) are copied into the
backend's store, with each reference mockup rendered to a screenshot during
ingest (see [Reference Rendering](#reference-rendering)). The scan reports what
changed; an already-ingested, unchanged version is a no-op unless re-ingestion
is forced. The request may restrict the scan to specific case slugs. The scan
runs to completion before the default response returns; a client can instead
stream per-version progress (see below).

The request body is optional JSON:

```jsonc
{
  "testCases": ["pong"], // restrict the scan to these slugs (default: all)
  "force": true          // re-ingest even versions already in the store
}
```

`force` overwrites a version already stored, re-rendering its references. It
exists for **development** iteration on a version no run has been published
against; a version that published runs reference is immutable and must be
revised by adding a new version, not re-ingested (see
[Test Cases](/testing/end-to-end/overview/)).

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
  "slug": "pong", "version": "v1.0.0",
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

```jsonc
{
  "testCases": [
    { "slug": "pong", "versions": ["v1.0.0", "v1.1.0"] }
  ]
}
```

Schema:
[`backend-api/test-case-catalog.schema.json`](https://docs.testcabinet.ai/schema/backend-api/test-case-catalog.schema.json).

### `GET /test-cases/{slug}/versions`

The available versions for one case, echoing the requested `slug`. `404` if the
slug is unknown.

```jsonc
{ "slug": "pong", "versions": ["v1.0.0", "v1.1.0"] }
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
  "slug": "pong",
  "version": "v1.0.0",
  "name": "Pong",
  "difficulty": "easy",
  "tags": ["arcade", "2d"],
  "summary": "A two-paddle rally game.",
  "description": "## Pong\n…",
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
        { "view": "title", "screenshotUrl": "/test-cases/pong/v1.0.0/references/base/title.png" }
      ],
      // Variant-specific reviewer checklist items, for the consoles' guided
      // review (see Reviews). Empty when the variant declares none.
      "reviewItems": []
    }
  ],
  "commonReferences": [
    { "view": "gameplay", "screenshotUrl": "/test-cases/pong/v1.0.0/references/_common/gameplay.png" }
  ],
  "checks": [
    { "view": "title", "name": "Title", "referenceView": "title", "actions": [ { "type": "wait", "ms": 500 } ] }
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

## Container images

Container images are **not** part of this API. Harness run-container images are
distributed through a container registry, and each runner resolves the image for
a harness directly from its own registry configuration — defaulting to the
published images on the `latest` tag — without consulting the backend. This keeps
image resolution working against any backend (staging, production, or a
self-hosted one) and with no backend at all. See
[Execution](/components/core/execution/#containerization) for how a runner
resolves and records the image it ran.

## Pushing, reviewing, publishing, and reading runs

A run reaches the gallery through three mutating steps — **push** the run, attach
one or more **reviews**, then **publish** it (the
[lifecycle](/components/core/results/#lifecycle)). Each of the three requires a
bearer token (`401` without). Reads need none.

### `POST /runs` — push

**Push** a finished run: its [run record](/components/core/run-records/) and the
resolved links — **no review**. The operator's component has already released the
source repo and deployed the build before calling, so it sends the captured URLs;
the backend writes the authoritative links onto the stored record. A pushed run is
stored **privately** — it is *not* in the public snapshot, but its build is
playable so it can be reviewed. The call is **idempotent on the record's id** —
re-pushing updates the links and record blob without changing when it was first
pushed and without disturbing any reviews already attached. Requires a bearer
token.

```jsonc
{
  "record": { "…": "a full RunRecord; its links MAY be empty here" },
  "links": {
    "sourceRepo": "https://github.com/TheClockwyrks/tcab-pong-claude-…",
    "playableBuild": "https://abc123.test-cabinet-runs.pages.dev"
  },
  // The run's recorded normalized event stream, stored and re-emitted to the
  // snapshot for the run's Events tab once published. Optional; an array of
  // HarnessEvents. Raw harness output is never published.
  "events": [{ "timestamp": "…", "type": "agent", "message": "…" }]
}
```

The `playableBuild` link is the URL the deploy tool **reported**, recorded
verbatim — not a host constructed from the run id and project, which Cloudflare's
branch-alias sanitization may truncate (see
[Hosting](/components/site/overview/#hosting)).

The response reports the run id and whether it was newly stored. Schema:
[`backend-api/publish-run-request.schema.json`](https://docs.testcabinet.ai/schema/backend-api/publish-run-request.schema.json).

### `POST /runs/{id}/reviews` — submit a review

Submit a [review](/components/core/results/#reviews) for a pushed run: the
per-domain `ratings`, the markdown `writeup`, and the checklist verdicts. The
review is **attributed to the account the bearer token resolves to** — the
reviewer identity is taken from the token, not the body. A run may carry **many
reviews, one per account**; re-submitting from the same account replaces that
account's own review. `404` if the run is unknown; `422` if a declared domain is
unrated or a declared checklist item lacks a verdict; `401` without a token.
Schema:
[`backend-api/review.schema.json`](https://docs.testcabinet.ai/schema/backend-api/review.schema.json).

### `POST /runs/{id}/publish` — publish

Flip a pushed run **public** — the gate that puts it in the snapshot and the
gallery. **Refuses a run that has no review** (`422`). Idempotent: re-publishing
an already-published run is a no-op success. The response reports the run id,
whether it was newly published, and whether a snapshot refresh was queued or
coalesced into a pending one. Requires a bearer token.

### `GET /runs`

List stored runs, newest first, paginated by a `before` cursor and a `limit`. A
`state` query parameter selects which runs:

- `state=published` (the **default**) — published runs only, ordered by publish
  time, for reporters and the public-facing views.
- `state=review` — the **reviewer worklist**: **completed** runs (pushed but not
  yet published, plus published ones), ordered by finish time, so a reviewer can
  find runs to assess. The failure tiers are excluded — they carry no review
  checklist.
- `state=failures` — the **publishable-failure worklist**: catastrophic and
  timed-out runs (pending and published), for the publish-failures affordance.
  Infrastructure failures are excluded (never publishable).
- `state=unpublished` — **every** pushed-but-unpublished run whatever its terminal
  state (completed, every failure tier, including the never-publishable
  infrastructure failures), ordered by finish time. This is the console's
  "produced" worklist — every run that exists but is not yet public, so an
  infrastructure failure stays inspectable rather than appearing in no list.
  Disjoint from the default published listing.

The response carries the runs and the cursor for the next page (`null` when there
are no more).

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

## Reference rendering

A test case's reference mockups are rendered to screenshots **once, by the
backend, at ingest** — not by each runner. Rendering on ingest makes the
validation baseline byte-identical across every runner: a runner downloads the
rendered PNG, seeds it as the visual target, and uses it as the
[validation](/components/core/validation/) baseline, and never receives the
mockup HTML. Runners still need a headless browser locally for the load check and
per-check capture; only the reference baseline render lives on the backend.
