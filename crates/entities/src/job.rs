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
    /// The lifecycle state: `queued`, `dispatched`, `running`, `succeeded`,
    /// `failed`, or `canceled`.
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
    /// RFC 3339 of when the job was enqueued (the claim ordering key).
    pub created_at: String,
    /// RFC 3339 of the last state transition.
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
