//! Adds the `retried_by` column to the `job` table.
//!
//! A job that ends on a retryable failure enqueues a fresh attempt of the same launch, and the
//! failed attempt's run is kept. A ladder counts a run that ended on the model's own failure as
//! one of its rung's runs, so without a marker the failed attempt and its retry would both count
//! for one launch, and the attempt would decide the rung while its retry was still queued. The
//! column holds the id of the retry a job enqueued, or `NULL` when it enqueued none, and a
//! ladder leaves the run of a job that was retried out of its counts.
//!
//! The rows already stored are backfilled from the one trace a retry leaves: it is enqueued
//! with the attempt's launch request verbatim and the next attempt number, by the same account
//! and for the same origin, moments after the attempt ended. Identical requests are ordinary
//! (a launch's repeats, the same launch made twice), so the pairing is kept narrow:
//!
//! - an attempt is a candidate only when it ended in a way a retry follows: a `succeeded` or
//!   `failed` job whose run is missing or ended `infrastructure`, `catastrophic`,
//!   `harness_error` or `hung` — a catastrophic, harness-error or hung run lands on a
//!   `succeeded` job, so the job's state alone does not say;
//! - its retry is created no earlier than the attempt's terminal stamp (`updated_at`) and at
//!   most [`RETRY_WINDOW`] after it;
//! - the pairs are taken closest first, and each attempt and each retry is in at most one.
//!
//! An attempt the backfill cannot pair keeps `NULL`, which counts it as it was counted before.
//! The pairing is done here rather than in SQL because the stored timestamps are RFC 3339
//! text with a fraction of varying length, which neither SQLite nor Postgres orders reliably
//! as text.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Job::Table)
                    .add_column(ColumnDef::new(Job::RetriedBy).string().null())
                    .to_owned(),
            )
            .await?;
        backfill(manager).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Job::Table)
                    .drop_column(Job::RetriedBy)
                    .to_owned(),
            )
            .await
    }
}

/// The longest an automatic retry is enqueued after the attempt it replaces ended. The retry
/// follows the attempt's terminal stamp within the same status report, after at most a
/// pause check and a price lookup, so the bound is generous.
const RETRY_WINDOW: time::Duration = time::Duration::minutes(10);

/// The run states an automatic retry follows (`is_retryable` in the backend's job API).
const RETRYABLE_RUN_STATES: [&str; 4] = ["infrastructure", "catastrophic", "harness_error", "hung"];

/// One stored job, as the backfill reads it.
struct JobRow {
    id: String,
    request_json: String,
    attempt: i32,
    user_id: Option<String>,
    origin: Option<String>,
    state: String,
    created_at: Option<time::OffsetDateTime>,
    updated_at: Option<time::OffsetDateTime>,
    /// The state of the run the job produced, `None` when it produced none (or the run is
    /// gone).
    run_state: Option<String>,
}

impl JobRow {
    /// Whether the job ended in a way an automatic retry follows.
    fn retryable_attempt(&self) -> bool {
        matches!(self.state.as_str(), "succeeded" | "failed")
            && self
                .run_state
                .as_deref()
                .is_none_or(|state| RETRYABLE_RUN_STATES.contains(&state))
    }

    /// Whether `retry` is a launch of the same request by the same account for the same
    /// origin, one attempt on.
    fn same_launch(&self, retry: &JobRow) -> bool {
        retry.attempt == self.attempt + 1
            && retry.request_json == self.request_json
            && retry.user_id == self.user_id
            && retry.origin == self.origin
    }
}

fn parse_stamp(stamp: &str) -> Option<time::OffsetDateTime> {
    time::OffsetDateTime::parse(stamp, &time::format_description::well_known::Rfc3339).ok()
}

/// Pair each stored retry with the attempt it replaced, as the module docs describe, and
/// stamp the attempt's `retried_by`.
async fn backfill(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    let conn = manager.get_connection();
    let backend = manager.get_database_backend();
    let select = Query::select()
        .column((Job::Table, Job::Id))
        .column((Job::Table, Job::RequestJson))
        .column((Job::Table, Job::Attempt))
        .column((Job::Table, Job::UserId))
        .column((Job::Table, Job::Origin))
        .column((Job::Table, Job::State))
        .column((Job::Table, Job::CreatedAt))
        .column((Job::Table, Job::UpdatedAt))
        .column((Run::Table, Run::State))
        .from(Job::Table)
        .left_join(
            Run::Table,
            Expr::col((Run::Table, Run::Id)).equals((Job::Table, Job::RecordId)),
        )
        .to_owned();
    let rows = conn.query_all(backend.build(&select)).await?;
    let mut jobs = Vec::with_capacity(rows.len());
    for row in rows {
        jobs.push(JobRow {
            id: row.try_get("", "id")?,
            request_json: row.try_get("", "request_json")?,
            attempt: row.try_get("", "attempt")?,
            user_id: row.try_get("", "user_id")?,
            origin: row.try_get("", "origin")?,
            state: row.try_get("", "state")?,
            created_at: parse_stamp(&row.try_get::<String>("", "created_at")?),
            updated_at: parse_stamp(&row.try_get::<String>("", "updated_at")?),
            run_state: row.try_get("", "run_state")?,
        });
    }

    let pairs = pair_retries(&jobs);
    for (attempt, retry) in &pairs {
        manager
            .exec_stmt(
                Query::update()
                    .table(Job::Table)
                    .value(Job::RetriedBy, retry.clone())
                    .and_where(Expr::col(Job::Id).eq(attempt.clone()))
                    .to_owned(),
            )
            .await?;
    }
    Ok(())
}

/// The pairing itself: every candidate pair, closest first, each side taken once.
fn pair_retries(jobs: &[JobRow]) -> Vec<(String, String)> {
    let mut candidates = Vec::new();
    for (a, attempt) in jobs.iter().enumerate() {
        let Some(ended) = attempt.updated_at.filter(|_| attempt.retryable_attempt()) else {
            continue;
        };
        for (r, retry) in jobs.iter().enumerate() {
            let Some(created) = retry.created_at else {
                continue;
            };
            let gap = created - ended;
            if attempt.same_launch(retry) && gap >= time::Duration::ZERO && gap <= RETRY_WINDOW {
                candidates.push((gap, a, r));
            }
        }
    }
    candidates.sort();
    let mut attempt_taken = vec![false; jobs.len()];
    let mut retry_taken = vec![false; jobs.len()];
    let mut pairs = Vec::new();
    for (_, a, r) in candidates {
        if attempt_taken[a] || retry_taken[r] {
            continue;
        }
        attempt_taken[a] = true;
        retry_taken[r] = true;
        pairs.push((jobs[a].id.clone(), jobs[r].id.clone()));
    }
    pairs
}

#[derive(DeriveIden)]
enum Job {
    Table,
    Id,
    RequestJson,
    Attempt,
    UserId,
    Origin,
    State,
    CreatedAt,
    UpdatedAt,
    RecordId,
    RetriedBy,
}

#[derive(DeriveIden)]
enum Run {
    Table,
    Id,
    #[sea_orm(iden = "run_state")]
    State,
}
