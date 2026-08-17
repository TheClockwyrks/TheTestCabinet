//! Adds a **partial unique index** on `publish_job (run_id)` covering the `queued`
//! state: at most one queued publish job per run.
//!
//! A publish is not idempotent externally. Each publish job runs `wrangler pages
//! deploy`, which mints a brand-new Cloudflare Pages deployment every invocation, so
//! two publish jobs for one run leave a second, orphaned public build behind. The
//! `gh` side hides this — it reuses an existing repository — which is why the
//! duplication only ever surfaces as extra Pages deployments.
//!
//! `POST /runs/{id}/publish` already refuses to enqueue a duplicate
//! (`Db::active_publish_job_for_run`), but that check and the insert are two
//! statements: two concurrent requests can both observe "no active job" and both
//! insert. This index is the database-level backstop that makes the second insert
//! fail instead.
//!
//! **Why `queued` only.** The application-level check also covers `dispatched`, but
//! that state must *not* be constrained here: nothing reaps a publish job whose
//! publisher pod died before reporting, so a stuck `dispatched` row would wedge its
//! run's publishing forever with no way out. The application check handles it with a
//! staleness cutoff instead, which an index cannot express. A `queued` job carries no
//! such risk — it is always claimable by the dispatcher.
//!
//! Any pre-existing duplicates are collapsed first (oldest kept) so the index can be
//! created on a database that already recorded the double-enqueue this prevents.

use sea_orm_migration::prelude::*;

/// The index name, shared by `up` and `down`.
const INDEX_NAME: &str = "idx_publish_job_unique_queued_run";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();

        // Collapse any duplicate queued jobs first — a unique index cannot be created
        // over rows that already violate it. Keep the oldest (the publish the console
        // is most likely already watching) and drop every later sibling for the same
        // run: they are exactly the duplicates that would each deploy again. Written
        // as a correlated EXISTS rather than a window function so it runs unchanged on
        // both PostgreSQL and SQLite.
        conn.execute_unprepared(
            "DELETE FROM publish_job \
             WHERE state = 'queued' \
               AND EXISTS ( \
                 SELECT 1 FROM publish_job AS keep \
                 WHERE keep.state = 'queued' \
                   AND keep.run_id = publish_job.run_id \
                   AND ( keep.created_at < publish_job.created_at \
                      OR ( keep.created_at = publish_job.created_at \
                           AND keep.id < publish_job.id ) ) \
               )",
        )
        .await?;

        // Partial unique indexes are not expressible through sea-query's index
        // builder, so this is raw SQL. The `... WHERE <predicate>` form is identical
        // on PostgreSQL and SQLite, the two backends this schema runs on.
        conn.execute_unprepared(&format!(
            "CREATE UNIQUE INDEX IF NOT EXISTS {INDEX_NAME} \
             ON publish_job (run_id) WHERE state = 'queued'"
        ))
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(&format!("DROP INDEX IF EXISTS {INDEX_NAME}"))
            .await?;
        Ok(())
    }
}
