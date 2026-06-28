//! The `publish_job` table: one entry in the backend's **publish** queue — a
//! request to release an already-pushed, reviewed run to its public GitHub repo +
//! Cloudflare Pages, and its lifecycle from enqueue through dispatch to a terminal
//! state.
//!
//! This is the publish path's analogue of the `job` (run) queue. It is kept
//! separate so the run path is untouched: a publish job references an existing run
//! by id rather than carrying a launch request, and records the links the release
//! produced. The dispatcher claims it and creates one `tcab-publisher` Job; on
//! success the backend stamps the links onto the `run`/`run_link` rows and marks
//! the run published.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "publish_job")]
pub struct Model {
    /// The publish job id; the primary key, minted by the backend at enqueue.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// The lifecycle state: `queued`, `dispatched`, `succeeded`, or `failed`.
    pub state: String,
    /// The id of the run to release. Foreign reference to the `run` table's id,
    /// kept as a plain column (the run is the system of record).
    pub run_id: String,
    /// The per-job bearer token the publisher presents to report its result.
    /// Minted at enqueue, never leaves the cluster.
    pub job_token: String,
    /// The released public source-repo URL, set when the publish succeeds, else
    /// `NULL` (also `NULL` for a run that releases no code).
    #[sea_orm(nullable)]
    pub source_repo: Option<String>,
    /// The deployed playable-build URL, set when the publish succeeds and a build
    /// was deployed, else `NULL`.
    #[sea_orm(nullable)]
    pub playable_build: Option<String>,
    /// A terminal failure reason when the publish failed, else `NULL`.
    #[sea_orm(column_type = "Text", nullable)]
    pub detail: Option<String>,
    /// RFC 3339 of when the publish job was enqueued (the claim ordering key).
    pub created_at: String,
    /// RFC 3339 of the last state transition.
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
