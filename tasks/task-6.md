# Task 6 — Publish & score failures as first-class results

**Status:** ✅ **DONE** (2026-06-23, uncommitted) on the **backend-driven path**.
Reverses the "failed runs are never publishable" stance for two
objectively-classified tiers. **Scope boundary:** the desktop in-process path is
untouched — desktop-produced failure publishing waits on the desktop/k3d
unification (`task-9.md`).

> **What landed:**
> - **Contract** (`crates/core/src/run_record.rs`): `RunState` is now
>   `completed | catastrophic | timed_out | infrastructure` (was
>   `completed | failed | unevaluable`), with `is_publishable`,
>   `is_publishable_failure`, and `classify_failure(&Error)` helpers. Bindings +
>   JSON Schema regenerated (`npm run gen:contract`).
> - **Classification** (objective, at run end): a clean harness exit splits
>   `completed` vs `catastrophic` via `completed_state()` (gated to the
>   human-reviewed types — end-to-end, asset-generation — using `validation.loaded`;
>   adversarial/performance keep their auto-scored result). A pre-impl failure
>   classifies via `RunState::classify_failure` (runtime-cap `RunTimedOut` →
>   `timed_out`, everything else → `infrastructure`); threaded through
>   `write_failed_record` and `RunFailure` (driver), and the desktop catch.
> - **Backend** (`crates/backend`): publish gate now refuses `infrastructure`,
>   waives the ≥1-review requirement for `catastrophic`/`timed_out`, keeps it for
>   `completed`. Review worklist (`state=review`) is now completed-only; new
>   `state=failures` listing for publishable failures. Tests updated/added.
> - **Gallery** (`packages/ui`, `apps/web`): shared `data/runState.ts`
>   presentation helper; Play tab hidden for non-playable outcomes; per-tier
>   failure banner + card chips; verdict copy; a new **Publish failures** page
>   (`/runs/failures`, console-only) listing `state=failures` with a one-click
>   publish (no review editor); leaderboard gains a per-model reliability section
>   (catastrophic/timeout counts, separate from the score). Docs updated
>   (`run-records.md` Status, `results.md` Publish).
> - **Verified:** workspace `cargo build`/`clippy -D warnings`/`test` green;
>   `gen:contract` drift-clean; `npm run typecheck` + `vite build` for `apps/web`
>   and `apps/desktop`; `packages/ui` vitest green; docs build (120 pages).
>
> The original design write-up is kept below as the record.

## The idea

As test cases grow, smaller models will legitimately produce unusable output, or
loop without ever finishing. For a frontier benchmark those outcomes are *signal*,
not noise — worth publishing (including the generated broken code) so people can
see *how* the agent failed. Failures in two specific tiers become first-class,
publishable results.

## Outcome taxonomy (the load-bearing decision)

Classification is **objective and derivable at the point a run ends** — no
model-vs-infra heuristic. The single axis is *how* the run terminated:

| Outcome | Trigger (objective) | Publishable | Reviews | Scored | Model stats |
| --- | --- | --- | --- | --- | --- |
| **Completed** | harness exit 0 → validation playable | yes | ≥1 (unchanged) | checklist score | avg score |
| **Catastrophic** | harness exit 0 → validation failed / unevaluable | yes — **manual publish, 0 reviews** | no | no | catastrophic rate |
| **Timed out** | run hit the runtime cap (`core::Error::RunTimedOut`, `crates/core/src/error.rs:130`) | yes — **manual publish, 0 reviews** | no | no | timeout rate |
| **Infra failure** | anything else: non-zero harness exit, harness unavailable/invocation/install failure, init/seeding failure, container-runtime error, image pull, OOM, pod death | **never** | — | no | excluded entirely |

Rationale for the boundaries:

- **Harness exit 0 = the model claims completion.** If validation then finds the
  build broken/unevaluable, that's the model's failure → **catastrophic**,
  publishable. A non-zero harness exit means the harness itself errored → infra.
- **Timeout is a legitimate model finding** (a small model looping on a hard task
  and never converging) — but it is *not* catastrophic, so it carries a **separate
  "timed out" label** rather than being folded into the catastrophic tier.
- **Infra failures are the Test Cabinet's fault** (our container/cluster/harness
  plumbing). Retained with a diagnostic `detail` for inspection, **never**
  publishable, and **excluded from every model statistic**.

Catastrophic and timed-out runs are a **distinct tier outside the 0..total score
scale** — they have no checklist review and no score. That keeps a model's average
score meaningful (computed only over runs that were at least workable) while
catastrophic-rate and timeout-rate are reported as separate stats alongside it.

## Authority & integrity

The backend decides publishability from the run's **own recorded outcome**, never
from a client-supplied label. On the backend-driven path this is sound: the driver
(our trusted per-run pod) records the outcome it observed, and the dispatcher
independently reports infra reasons when a driver pod dies before reporting
(`crates/dispatcher/src/kubernetes.rs:113`). A partial/absent record is infra by
construction → non-publishable.

## Implementation plan (backend-driven path)

1. **Carry the outcome on the record.** Extend the run record / `RunStatus`
   (`crates/core/src/run_record.rs:189`, TS mirror `packages/run-record`) with an
   explicit outcome classification covering the four tiers above (rather than
   overloading the existing `Completed`/`Failed`/`Unevaluable` `RunState` + free
   text). The driver sets it from: harness exit code, the validation result, and
   whether the failure was `Error::RunTimedOut`. Regenerate contract bindings
   (`npm run gen:contract`) — see `schema-binding-autogen-goal`.
2. **Relax the publish gate** (`crates/backend/src/db.rs:370`) to allow
   **catastrophic** and **timed-out** outcomes (manual publish, **review-count
   gate waived for these tiers**) while keeping the **≥1-review** requirement for
   **completed** runs and **refusing infra** outcomes outright.
3. **Leave the push guard as-is** (`crates/backend/src/api/runs.rs:57`,
   `completed`-only). Failures reach the DB via the backend-driven `/jobs`
   retain path (`persist_produced`), not via `POST /runs`. The desktop/CLI push
   path stays completed-only until `task-9.md`.
4. **Scoring / stats.** Keep the checklist score over completed runs unchanged.
   Add catastrophic-rate and timeout-rate as separate per-model stats in the
   snapshot (`crates/backend/src/snapshot.rs`) and surface them in the
   gallery/leaderboard UI (`packages/ui` — `src/ratings.ts` + model-comparison
   views) without polluting the average score.
5. **Gallery rendering.** A published failure shows its `links.sourceRepo` (the
   broken code) but has `links.playableBuild === null`. The UI already degrades
   gracefully (`PlayableSection.tsx:58`, metadata "Not published"); the remaining
   fix is the **Play tab gating** — `RunDetailLayout.tsx:79` gates on test *type*,
   not outcome, so a failed run shows an empty Play tab. Hide Play for
   non-playable outcomes, and badge cards/detail with the tier (catastrophic /
   timed out).
6. **Reviewer worklist filter + a separate "publish failures" affordance.** The
   review worklist (`GET /runs?state=review`, `crates/backend/src/api/runs.rs:213`)
   must **exclude every non-completed outcome** — infra failures (never
   publishable) and catastrophic/timeout (publishable but with no review items to
   complete). Catastrophic/timeout runs instead surface in their **own "publish
   failures" affordance** that lists publishable failures and offers a single
   publish button (no review editor). Decision locked 2026-06-23.

## Already handled (so this pass loses no data)

The backend retains **every** produced record regardless of outcome, with the
event timeline and a specific failure `detail` (commit `4a80f99`). Artifact
retention (`tcab-artifacts`, commit `099148b`) keeps the generated code. The data
this pass needs is already there.

## Explicitly out of scope

- Desktop/CLI failure publishing — waits on `task-9.md` (desktop/k3d unification).
- Per-account credential vault (separate follow-up in `context.md`).
