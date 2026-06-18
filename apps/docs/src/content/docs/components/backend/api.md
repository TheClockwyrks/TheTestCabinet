---
title: HTTP API
---

The backend exposes a single HTTP API that every other component talks to: the
[runners](/components/architecture/#runners-and-reporters) resolve test case
definitions and container images through it, the build/push step posts image
references to it, the operator's component publishes runs to it, and reporters
read published runs back from it. This page is the authoritative contract for
that interface — the cross-component surface. How the backend stores what it
serves (its database, its on-disk layout) is an internal concern covered in the
[Overview](/components/backend/overview/), not part of this contract.

## Conventions

- The API is JSON over HTTP. Request and response bodies are **camelCase**,
  matching the [run record](/components/core/run-records/) contract.
- Timestamps are **RFC 3339** strings.
- Harness slugs are the eight defined in
  [Harnesses](/components/core/harnesses/); `base` additionally names the shared
  base container image.
- Ratings are the four tiers defined in
  [Reviews](/components/core/results/#reviews):
  `flawless`, `great`, `scuffed`, `broken`.
- There is **no application-level authentication.** Reachability is the access
  control — the backend sits on a private network and trusts every caller that
  can reach it (see [Authentication](/components/backend/overview/#authentication)).
- Errors use one envelope across every endpoint, paired with an appropriate HTTP
  status (`400`, `404`, `409`, `422`, `500`):

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
changed [test case versions](/components/core/test-cases/) are copied into the
backend's store, with each reference mockup rendered to a screenshot during
ingest (see [Reference Rendering](#reference-rendering)). The scan is
synchronous and reports what changed; an already-ingested, unchanged version is
a no-op unless re-ingestion is forced. The request may restrict the scan to
specific case slugs.

Container images are **not** ingested here — they are distributed through a
registry and posted separately via [`POST /containers`](#post-containers).

## Test case resolution

These endpoints are how a runner resolves the definition it needs to seed and
validate a run. They mirror the catalog and version model described in
[Test Cases](/components/core/test-cases/), sourced from the backend's store
rather than a local checkout.

### `GET /test-cases`

The catalog: every ingested case and its available versions.

### `GET /test-cases/{slug}/versions`

The available versions for one case. `404` if the slug is unknown.

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
      ]
    }
  ],
  "commonReferences": [
    { "view": "gameplay", "screenshotUrl": "/test-cases/pong/v1.0.0/references/_common/gameplay.png" }
  ],
  "checks": [
    { "view": "title", "name": "Title", "referenceView": "title", "actions": [ { "type": "wait", "ms": 500 } ] }
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

## Container image resolution

Harness images are distributed through a container registry and pulled by
digest. The backend tracks the latest pullable **reference** per harness; runners
resolve it and pull it verbatim. There is no build context, file manifest, or
content hash in this contract — see
[Execution](/components/core/execution/#containerization).

### `GET /containers`

List the tracked harness image references.

### `GET /containers/{harness}`

Resolve a harness to its pullable image reference — the registry-qualified digest
ref the runner pulls (`--pull missing`) and records as the run record's
`environment.containerImage`. The runner never composes a registry, org, or tag
of its own. `404` if the harness has no posted reference.

```jsonc
{ "harness": "claude", "reference": "ghcr.io/theclockwyrks/test-cabinet-claude@sha256:1a7b…" }
```

### `POST /containers`

Record the latest pullable image reference for a harness. Posted by the image
build/push step after it pushes an image and pins it by digest; it overwrites any
previous reference for that harness (latest wins). `400` if `harness` or
`reference` is empty.

Both the request and the resolved response share one schema:
[`backend-api/container-image.schema.json`](https://docs.testcabinet.ai/schema/backend-api/container-image.schema.json).

## Publishing and reading runs

### `POST /runs`

Submit a published run: its [run record](/components/core/run-records/), its
[review](/components/core/results/#reviews), and the resolved links. The
operator's component has already released the source repo and deployed the build
before calling, so it sends the captured URLs; the backend writes the
authoritative links onto the stored record. The call is **idempotent on the
record's id** — re-publishing an existing run updates its review, links, and
record blob without changing when it was first published.

```jsonc
{
  "record": { "…": "a full RunRecord; its links MAY be empty here" },
  "review": { "rating": "great", "writeup": "Plays well, but…" },
  "links": {
    "sourceRepo": "https://github.com/TheClockwyrks/tcab-pong-claude-…",
    "playableBuild": "https://abc123.test-cabinet-runs.pages.dev"
  }
}
```

The `playableBuild` link is the URL the deploy tool **reported**, recorded
verbatim — not a host constructed from the run id and project, which Cloudflare's
branch-alias sanitization may truncate (see
[Hosting](/components/site/overview/#hosting)).

Publishing **refuses a run without a review** (`422`): the rating must be a valid
tier and the writeup must be non-empty. The response reports the run id, whether
it was newly published, and whether a snapshot refresh was queued or coalesced
into a pending one. Schema:
[`backend-api/publish-run-request.schema.json`](https://docs.testcabinet.ai/schema/backend-api/publish-run-request.schema.json).

### `GET /runs`

List stored published runs, newest first, paginated by a `before` cursor and a
`limit`. The response carries the runs and the cursor for the next page (`null`
when there are no more). Used by reporters.

### `GET /runs/{id}`

One stored run: its record (with links populated), its review, and its links.
`404` if unknown.

### `POST /snapshot/refresh`

Force an immediate [public snapshot](/components/backend/snapshot/) regeneration,
upload, and deploy-hook fire, outside the normal coalescing window. For operator
recovery.

## Reference rendering

A test case's reference mockups are rendered to screenshots **once, by the
backend, at ingest** — not by each runner. Rendering on ingest makes the
validation baseline byte-identical across every runner: a runner downloads the
rendered PNG, seeds it as the visual target, and uses it as the
[validation](/components/core/validation/) baseline, and never receives the
mockup HTML. Runners still need a headless browser locally for the load check and
per-check capture; only the reference baseline render lives on the backend.
