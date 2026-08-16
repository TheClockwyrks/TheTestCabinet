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
    /// The per-job bearer token the driver presents to stream this job's
    /// events/preview/status. Minted at enqueue, never leaves the cluster.
    pub job_token: String,
    /// The produced run record's id once the job succeeded, else `NULL`. What the
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
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
