//! The `job` table: one entry in the backend's run queue — a requested run and
//! its lifecycle, from enqueue through dispatch, execution, and a terminal state.
//!
//! The produced `RunRecord` itself lands in the `run` table; a job holds only the
//! launch request, the state machine, the per-job driver token, and the columns
//! lifted out for the active-run list.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "job")]
pub struct Model {
    /// The job id; the primary key, minted by the backend at enqueue.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// The lifecycle state: `queued`, `pending`, `dispatched`, `starting`,
    /// `running`, `succeeded`, `failed`, or `canceled`.
    ///
    /// `pending` is a *held back* job, distinct from `queued`: it is eligible but
    /// deliberately not dispatched yet, because its harness is at its parallelism cap
    /// or another run of the same game jam and model is still in flight. The console
    /// surfaces it separately from `queued` so a review buffer that is full of jobs
    /// nothing is executing reads as serialization rather than as a stuck queue.
    /// `starting` is a job whose driver Job exists but has not begun the run.
    ///
    /// Neither `queued` nor `pending` has a driver, which is why they are the pair a
    /// `halt` (and the Runs page's "Clear pending") can cancel for free.
    pub state: String,
    /// The launch request serialized verbatim (the `RunRequest` HTTP shape the
    /// console submitted), handed to the driver when the job is claimed.
    #[sea_orm(column_type = "Text")]
    pub request_json: String,
    /// The test-case slug, lifted from the request for the active-run list.
    pub test_case_slug: String,
    /// The test-case version, lifted from the request for the active-run list.
    pub test_case_version: String,
    /// The variant, lifted for the active-run list.
    pub variant: String,
    /// The test case's type (`end-to-end`, `game-jam`, …), lifted from the resolved
    /// test case at enqueue. The queue reads it to serialize the runs that must not
    /// overlap: a **game-jam** job waits while another run of the same jam and model
    /// is in flight, since a repeated jam run is briefed with the earlier runs'
    /// gameplay READMEs. Empty for rows enqueued before the column existed (treated
    /// as a non-jam type).
    pub test_type: String,
    /// The harness slug, lifted for the active-run list.
    pub harness_slug: String,
    /// The opaque model id, lifted for the active-run list.
    pub model_id: String,
    /// The slug of the engine the queued run's case pin names (see
    /// `test_cabinet_core::engine`), lifted out of the launch request at enqueue and
    /// mirroring `run.engine_slug` on the run the job produces.
    ///
    /// Part of a job's coverage cell: results are only comparable within one engine, so
    /// one case at one version and variant on two engines is two cells. It is a column
    /// for the same reason `harness_slug` and `model_id` are — a plan counts a cell's
    /// in-flight runs with a grouped query, and deserializing `request_json` per row
    /// cannot be part of a `GROUP BY`. `NULL` where the launch named no engine, which is
    /// the `none` engine: every grouped count coalesces it to that slug rather than
    /// treating it as unknown.
    #[sea_orm(column_type = "Text", nullable)]
    pub engine_slug: Option<String>,
    /// The **gg** run's declarative capability set, serialized to JSON and lifted
    /// out of the launch request at enqueue so a gg job's exact configuration is a
    /// first-class, queryable column rather than only buried in `request_json`.
    /// `NULL` for every third-party-harness job (which carries no capability set).
    #[sea_orm(column_type = "Text", nullable)]
    pub gg_config_json: Option<String>,
    /// The name of the gg **configuration** this job was launched from, lifted from
    /// the capability set at enqueue and mirroring `run.gg_preset` on the run the job
    /// produces.
    ///
    /// Display text and a slicing key, not identity: the active-run list names a gg job
    /// by its configuration, and what the job is *counted* under is
    /// [`gg_config_id`](Self::gg_config_id). `NULL` for every third-party-harness job and
    /// for a gg job assembled by hand rather than from a saved configuration.
    #[sea_orm(column_type = "Text", nullable)]
    pub gg_preset: Option<String>,
    /// The **id** of the gg configuration this job was launched from, lifted from the
    /// capability set at enqueue and mirroring `run.gg_config_id` on the run the job
    /// produces.
    ///
    /// The pair with [`gg_models`](Self::gg_models) is a gg job's coverage cell — the id
    /// rather than the [name](Self::gg_preset) because a name is renamed freely and is
    /// unique to nothing. A plan counts a cell's in-flight runs with a grouped query over
    /// `job`, so both segments have to be columns for the same reason `harness_slug` and
    /// `model_id` already are: deserializing `gg_config_json` per row cannot be part of a
    /// `GROUP BY`. `NULL` for every third-party-harness job and for a gg job assembled by
    /// hand rather than from a saved configuration.
    #[sea_orm(column_type = "Text", nullable)]
    pub gg_config_id: Option<String>,
    /// The models this job's gg capability set binds, sorted, de-duplicated, and
    /// comma-joined, lifted at enqueue and mirroring `run.gg_models`.
    ///
    /// Written from the same helper as the run-side lift, so an in-flight job and the
    /// run it becomes can never be attributed to two different cells. `NULL` for
    /// every non-gg job.
    #[sea_orm(column_type = "Text", nullable)]
    pub gg_models: Option<String>,
    /// The per-job bearer token the driver presents to stream this job's
    /// events/preview/status. Minted at enqueue, never leaves the cluster.
    pub job_token: String,
    /// The produced run record's id once the job succeeded — or the partial record
    /// the driver handed back for a job an operator canceled — else `NULL`. What the
    /// console navigates to when the live run finishes.
    #[sea_orm(nullable)]
    pub record_id: Option<String>,
    /// A terminal failure reason when the job failed, else `NULL`.
    #[sea_orm(column_type = "Text", nullable)]
    pub detail: Option<String>,
    /// Which attempt this job is: `0` for the run the console launched, then `1`,
    /// `2`, … for each automatic retry the backend re-enqueues after a terminal
    /// infrastructure/catastrophic failure. Bounded against the launch request's
    /// `retryCount` so the retry chain always terminates.
    pub attempt: i32,
    /// The queue's ordering key: a monotonic sequence number minted at enqueue, in
    /// the order the runs were submitted (a batch's runs keep the order the console
    /// listed them in). The claim dispatches in ascending `queue_seq`, so a batch of
    /// repeated runs starts — and so finishes — in the order it was requested.
    ///
    /// `created_at` cannot serve as that key: every run of one `POST /jobs/batch`
    /// shares a single enqueue timestamp, and it is stored as a string whose RFC 3339
    /// subsecond part is variable-length, so lexicographic order is not always
    /// chronological order. `0` for rows enqueued before the column existed, which
    /// sorts them ahead of everything minted since — correct, as they are older.
    pub queue_seq: i64,
    /// The account that launched this job (from the auth service, via the verified
    /// bearer token), or `NULL` when unknown — every row enqueued before the column
    /// existed, which reads as an unattributed manual launch.
    ///
    /// Attribution only. Coverage counting stays **global**: a run counts toward its
    /// cell's target whoever launched it, so an existing run is never re-requested
    /// just because a different account produced it. The per-account half of
    /// coverage is *judgement* — whose `review` row exists — not this column.
    #[sea_orm(nullable)]
    pub user_id: Option<String>,
    /// What launched this job: `plan:<id>` for a coverage plan's top-up,
    /// `ladder:<id>` for a ladder's, or `NULL` for a run launched by hand from the
    /// new-run form.
    ///
    /// This is what makes halting safe. `halt` cancels exactly the plan's or
    /// ladder's own `queued`/`pending` jobs; without an origin there is no way to
    /// tell those from the manual run someone kicked off in another tab, and a
    /// `NULL` origin is never swept up by a scoped halt. Like `user_id`, it is
    /// invisible to coverage counting.
    #[sea_orm(nullable)]
    pub origin: Option<String>,
    /// RFC 3339 of when the job was enqueued.
    pub created_at: String,
    /// RFC 3339 of the last state transition.
    pub updated_at: String,
    /// RFC 3339 of when the run itself began — the moment the driver reported
    /// `starting`, which is immediately before it takes the `started_at` the produced
    /// record's `startedAt` and `metrics.runTimeSeconds` are measured from. Anchoring
    /// here is what lets a console tick a live duration that agrees with the figure the
    /// finished row will show, rather than one that jumps when the run completes.
    ///
    /// Neither existing timestamp can serve. [`created_at`](Self::created_at) is when
    /// the run joined the queue, so a run held an hour behind a parallelism cap would
    /// read as an hour old the instant it started; [`updated_at`](Self::updated_at) is
    /// rewritten by every later transition, so a duration measured from it would reset
    /// each time the driver reported in.
    ///
    /// Written once and never overwritten. `NULL` while the job is `queued`, `pending`,
    /// or `dispatched` — none of those is running, and the console shows a dash — and
    /// on every row that was already in flight when the column was added.
    #[sea_orm(nullable)]
    pub started_at: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
