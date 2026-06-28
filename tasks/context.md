# In-cluster publishing — working context

A handoff document for closing the **in-cluster publishing gap**: making the
per-run GitHub-repo + Cloudflare Pages release happen *through the cluster* instead
of only when a human runs `tcab publish` on a host with `gh`/`wrangler`
authenticated. Self-contained so it survives a fresh session.

This `tasks/` directory was reset for this work; the previous contents (the
completed per-run-Job refactor) were deleted. The companion files
`task-1.md … task-7.md` hold the remaining implementation, in dependency order.

## The gap (why this work exists)

Tracing the code (confirmed this session):

- `BackendPublisher` (`crates/core/src/publish.rs:310`) is the **only** thing that
  creates a per-run **public GitHub repo** (`gh`/`git`) and deploys the playable
  build to **Cloudflare Pages** (`wrangler`). It is **never instantiated in
  production** — only in tests.
- The **driver** wires `NoopPublisher` (`crates/driver/src/run.rs:~246`,
  "publishing is a separate, explicit backend operation").
- The backend's `POST /runs/{id}/publish` (`crates/backend/src/api/runs.rs:171`)
  only flips the DB `published` flag (`crates/backend/src/db.rs:361`) and queues a
  snapshot refresh — **no `gh`/`wrangler`**.
- The **CLI** `tcab publish` (`crates/cli/src/commands/publish.rs`) only calls that
  HTTP endpoint; it does **not** drive `BackendPublisher` either.

So today the GitHub/Pages release happens nowhere in the deployed system. With the
k8s design the run's implementation lives in the cluster (uploaded to the artifact
service), so publishing must be triggerable through the cluster.

## Target architecture (decided)

A **dedicated per-publish Kubernetes Job**, reusing the run path's
queue→dispatcher→Job machinery via a **separate, parallel publish queue** (so the
run path — `LaunchBody`/`ClaimedJob`/the driver — is completely untouched). The
**dispatcher** owns all Job creation (it already has the k8s client + RBAC); the
**backend** gains no k8s client.

```
console / CLI ──POST /runs/{id}/publish──> backend
                                            │  gate-check (reviewed, not infra)
                                            │  enqueue publish_job (queued)
                                            ▼
                               publish queue (publish_job table)
                                            ▲ claim
                        dispatcher ──POST /publish-jobs/next──┘
                            │ build_publish_job  (k8s API)
                            ▼
                   tcab-publisher Job  (new image: node + git + gh + wrangler)
                     │ 1. GET /runs/{id}/tree.tar  ← artifact service (download)
                     │ 2. BackendPublisher.release_code   (gh/git → public repo)
                     │ 3. BackendPublisher.release_playable_build (wrangler → Pages)
                     │ 4. stream progress + terminal result ─┐
                     ▼                                        │
console / CLI ◀─ GET /publish-jobs/{id}/live (NDJSON) ◀── backend relay
                                            │ on terminal success:
                                            │  attach links (run_link + record blob),
                                            │  flip published, queue snapshot refresh
```

### Streaming, not polling (operator preference, 2026-06-27)

The console/CLI must observe a publish over a **live NDJSON stream**, mirroring the
run path's live relay (`crates/backend/src/api/jobs.rs` `live`/`event_stream`,
`crates/backend/src/relay.rs`) — **not** by polling a status endpoint. The
publisher streams progress events to the backend, which fans them out to
subscribers, ending with a terminal item carrying the outcome. This keeps the
first cut simple *and* makes future per-step progress (creating repo → pushing →
deploying) a non-breaking extension: add more event kinds, same stream.

## What's already done (this work)

**Committed** on branch `chore/azure-prod-keyvault-csi`:

- `7cb94bb` — **publish-job scaffolding** (inert, compiles, no behavior change):
  - `crates/core/src/publish_job_api.rs` — wire types `PublishClaim`,
    `PublishResult`, `PublishState`, `PublishJobState` (no `contract` codegen
    derives — these cross only backend↔dispatcher↔publisher, no console TS
    binding). Re-exported from `crates/core/src/lib.rs`.
  - `crates/entities/src/publish_job.rs` — the `publish_job` SeaORM entity
    (`id, state, run_id, job_token, source_repo, playable_build, detail,
    created_at, updated_at`). Registered in `crates/entities/src/lib.rs`.
  - `crates/migration/src/m20260628_000004_create_publish_job.rs` — creates the
    `publish_job` table + `idx_publish_job_state_created`. Registered in
    `crates/migration/src/lib.rs`.

Verified: `cargo check -p test-cabinet-core -p test-cabinet-entities -p
test-cabinet-migration` is green.

> NOTE: the streaming decision came *after* the scaffolding. The committed wire
> types include a single `PublishResult` (terminal) and a `PublishJobState`
> (lifecycle, for a status endpoint). Keep `PublishResult` as the **terminal**
> stream item; treat `PublishJobState`/any status endpoint as optional/secondary —
> the live stream is the primary observation path (see task-1).

## Building blocks to reuse (with file refs)

- **`BackendPublisher`** (`crates/core/src/publish.rs:310`): `release_code`
  (`:464`, secret-scrub → `git init/add/commit` → `gh repo view` (idempotent gate,
  `:485`) → `gh repo create --public --source --push`), `release_playable_build`
  (`:513`, scrub → `wrangler pages deploy <dir> --project-name <p> --branch=<run>`
  → parse URL), `push`/`push_run` (these POST `/runs` with an **account** token —
  the publisher must NOT use them; it reports via the publish-job token instead).
  Trait: `Publisher` (`:88`). Inputs: `PushRequest` (`:31`) =
  `{record, artifacts: &ArtifactCollection, build_dir: Option<&Path>, events}`.
  `PublishConfig::from_env` (`:190`): `TCAB_GITHUB_ORG` (default `TheClockwyrks`),
  `TCAB_PAGES_PROJECT`. Helpers: `read_event_log` (`:56`), `implementation_dir`,
  `find_build_output` (`crates/core/src/playable.rs`), `run_slug`.
- **Run queue patterns to mirror** (`crates/backend/src/api/jobs.rs`):
  `launch`/`enqueue_job` (`:64`), `claim` (`:184`, `ServiceAuth`), `update_status`
  (`:251`, per-job-token via `authorize_job` `:411`), `verify_token` (`:360`, what
  the artifact service calls). Live relay: `live` (`:153`) + `event_stream`
  (`:456`); `crates/backend/src/relay.rs`.
- **DB patterns** (`crates/backend/src/db.rs`): `NewJob` (`:891`), `enqueue_job`
  (`:915`), `claim_next_job` (`:939`, txn select-then-update), `set_job_state`
  (`:962`), `get_job` (`:989`), `publish` (`:361`, the gate + flip),
  `push`/`run_link` upsert (`:200`/`:262`). The `run` entity blob column is
  `RecordJson`; `run_link` has `source_repo`/`playable_build`
  (`crates/entities/src/run_link.rs`).
- **Artifact service** (`crates/artifacts/src/api.rs`): upload `:127`, serves
  `build`/proof/asset/events but **no source-tree download yet** (task-4 adds
  `tree.tar`). Store layout: `{store-root}/{run_id}/` = `run-record.json` +
  `implementation/` + `events.jsonl` + `raw.jsonl`. Driver upload client:
  `crates/driver/src/artifacts.rs:73` (`upload_run_tree`, tar of the run dir).
- **Dispatcher** (`crates/dispatcher`): `build_driver_job` (`src/job.rs:97`, pure,
  unit-tested), control loop `claim_next`/`dispatch` (`src/controller.rs:~102`),
  `Config` (`src/config.rs`). Existing RBAC already lets it create Jobs in-namespace
  (`deployments/k8s/base/rbac.yaml:59`).
- **Driver image** (`deployments/images/driver.Dockerfile`): `node:24-bookworm-slim`
  + `git`; **no `gh`/`wrangler`** — the publisher image adds those (task-5).

## Key decisions (load-bearing)

- **Separate publish queue** (`publish_job` table + `/publish-jobs/*` endpoints),
  not a `job_kind` discriminator on the run `job` table — keeps `LaunchBody`/
  `ClaimedJob`/the driver untouched. (Refines the originally-approved "reuse the
  queue→dispatcher→Job machinery" — the *machinery* reused is the dispatcher's
  Job creation + control loop + RBAC, via a parallel small queue.)
- **Dispatcher creates the publish Job**, not the backend (preserves the trust
  boundary: only the dispatcher holds k8s-API/Job-create RBAC; the backend stays a
  pure HTTP/DB service).
- **Publisher reports via the publish-job token**, never `POST /runs` (which needs
  an account token). The backend attaches the links + flips published when the
  terminal stream item arrives.
- **Async + streaming.** `POST /runs/{id}/publish` becomes async (enqueue, return a
  job id/ack); the result is observed over `GET /publish-jobs/{id}/live`. This
  **changes the CLI + console** (task-7).
- **Reuse `BackendPublisher.release_code` + `release_playable_build` only**
  (the two gh/wrangler steps); the link-attach + publish-flip live in a new backend
  DB method (`complete_publish_job`) so events on the run aren't disturbed.
- **Idempotency:** duplicate publish jobs are tolerable — `gh repo view` gates repo
  creation and the publish-flip preserves `published_at`. (A guard against
  enqueuing a second in-flight publish for the same run is a nice-to-have, not
  required.)

## Credentials & deployment (already provisioned this session)

- The cluster (`tcab-prod` on AKS `testcabinet-prod-westus2-aks`) sources all
  secrets from **Azure Key Vault `testcabinet-clockwyrks`** via the Secrets Store
  CSI driver + workload identity (`deployments/k8s/components/keyvault-csi/`,
  managed identity `tcab-keyvault-csi`, clientId
  `8a5a62e4-7a86-4571-acc5-73107be6e015`). See the `azure-prod-deployment` memory.
- **`GITHUB_PAT`** is in the repo `.env` (gitignored), not yet in Key Vault — it
  goes to the publisher Job (task-6).
- **Cloudflare token for `wrangler`** is **resolved** (verified 2026-06-27):
  `CLOUDFLARE_PAGES_API_KEY` in the repo `.env` — despite the `_API_KEY` name — is a
  valid, active scoped **API token** (passes `/user/tokens/verify`: `status: active`)
  with Pages access (it lists the account's Pages projects). The separate
  `CLOUDFLARE_API_TOKEN` is the one that failed verify; ignore it for publishing. No
  new token needs minting — the operator just uploads the `CLOUDFLARE_PAGES_API_KEY`
  **value** to Key Vault as `cloudflare-pages-api-token` (task-6). The target Pages
  project **`test-cabinet-runs` already exists**, matching the `PublishConfig`
  default, so `TCAB_PAGES_PROJECT` needs **no** override.
- **CSI gotcha:** the CSI driver *creates* synced Secrets but does NOT add keys to
  an existing one on remount — `kubectl delete` the Secret then restart
  `tcab-keyvault-sync` so it's recreated complete (or enable rotation).

## Release implication

Shipping this rebuilds **three** service images — `tcab-backend`,
`tcab-dispatcher`, and the new `tcab-publisher` — via the GitHub-mirror CI
(`.github/workflows/build-service-images.yml`; canonical remote is Azure DevOps).
Write the code + manifests + KV wiring; the image build/publish + the overlay tag
bump happen via the operator's pipeline.

## Remaining work (companion files, dependency order)

- `task-1.md` — **Backend**: publish-queue DB methods, async `/publish` (enqueue),
  `/publish-jobs/next` claim, the **streaming live relay** + progress/terminal
  ingestion, `complete_publish_job` (attach links + flip published), AppState +
  routes.
- `task-2.md` — **Dispatcher**: poll the publish queue, `build_publish_job`, config
  (`TCAB_PUBLISHER_IMAGE`, publisher secrets).
- `task-3.md` — **`tcab-publisher` crate**: download `tree.tar`, run
  `BackendPublisher` release steps, stream progress + report the terminal result.
- `task-4.md` — **Artifacts**: `GET /runs/{id}/tree.tar` (job-token auth).
- `task-5.md` — **Image + CI**: `publisher.Dockerfile` + add `tcab-publisher` to
  `build-service-images.yml`.
- `task-6.md` — **Manifests + KV**: overlay (publisher image, SA, secrets via CSI),
  `tcab-publisher-secrets` in the SPC, upload `GITHUB_PAT` (+ the Cloudflare token
  once minted).
- `task-7.md` — **CLI + console**: async/streaming publish UX (subscribe to
  `/publish-jobs/{id}/live` instead of expecting a synchronous `newlyPublished`).

## References

- Branch: `chore/azure-prod-keyvault-csi` (this session's commits live here).
- Memory: `azure-prod-deployment.md` (how the cluster + Key Vault + Postgres are
  wired and operated — read it before touching the deployment).
- The whole deploy + subscription auth + R2 publishing from this session are
  **done and live**; this publishing feature is the only remaining piece.
