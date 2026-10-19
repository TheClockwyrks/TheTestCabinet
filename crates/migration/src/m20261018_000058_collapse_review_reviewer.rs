//! Collapses a review's three reviewer columns into one identity, and indexes the
//! job tokens.
//!
//! A review was attributed to an account of the retired auth service, stored as
//! three denormalized columns: `reviewer_user_id`, `reviewer_username` and
//! `reviewer_display_name`. The identity the edge asserts is now the one identity
//! of every call, so a review carries one `reviewer` column holding the Access
//! assertion's email (or a service token's common name), and `(run_id, reviewer)`
//! is unique in place of `(run_id, reviewer_user_id)`.
//!
//! The auth service's database is not reachable from here, and it held no email,
//! so a legacy review cannot be mapped onto the identity its author now signs in
//! with. Each existing row is backfilled from the display name it was recorded
//! with, which is what the public dataset already showed beside the review: the
//! username when the display name is empty, and the account id when both are. Two
//! accounts that shared a display name and reviewed the same run would collide on
//! the new unique index, so each of those rows takes its account id in parentheses
//! after the name. The account ids and usernames are dropped with their columns.
//!
//! The backend now looks a per-job and a per-publish-job token up as the identity
//! of a call (`job.job_token`, `publish_job.job_token`), on every request a driver
//! or publisher makes, so both columns are indexed.
//!
//! Rolling back restores the three reviewer columns, each holding the `reviewer`
//! value: the account ids and usernames themselves are not recoverable.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

/// The unique `(run_id, <reviewer>)` index, before and after: the name is kept.
const REVIEW_INDEX: &str = "idx_review_run_reviewer";
/// The index on `job.job_token`.
const JOB_TOKEN_INDEX: &str = "idx_job_job_token";
/// The index on `publish_job.job_token`.
const PUBLISH_JOB_TOKEN_INDEX: &str = "idx_publish_job_job_token";

/// The three legacy reviewer columns, in the order the table was created with them.
const LEGACY_COLUMNS: [Review; 3] = [
    Review::ReviewerUserId,
    Review::ReviewerUsername,
    Review::ReviewerDisplayName,
];

/// The backfill: a review's display name, else its username, else its account id.
/// Plain SQL both SQLite and PostgreSQL accept.
const BACKFILL: &str = "UPDATE review SET reviewer = CASE \
     WHEN reviewer_display_name <> '' THEN reviewer_display_name \
     WHEN reviewer_username <> '' THEN reviewer_username \
     ELSE reviewer_user_id END";

/// Disambiguates the rows the backfill left sharing a `(run_id, reviewer)` pair:
/// each takes its account id in parentheses, which the old unique index made
/// distinct within a run.
const DISAMBIGUATE: &str = "UPDATE review SET reviewer = \
     reviewer || ' (' || reviewer_user_id || ')' \
     WHERE EXISTS (SELECT 1 FROM review AS other \
     WHERE other.run_id = review.run_id \
     AND other.reviewer = review.reviewer \
     AND other.id <> review.id)";

/// The rollback's restore of the three legacy columns from the one identity.
const RESTORE: &str = "UPDATE review SET reviewer_user_id = reviewer, \
     reviewer_username = reviewer, reviewer_display_name = reviewer";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Review::Table)
                    .add_column(
                        ColumnDef::new(Review::Reviewer)
                            .string()
                            .not_null()
                            .default(""),
                    )
                    .to_owned(),
            )
            .await?;
        let conn = manager.get_connection();
        conn.execute_unprepared(BACKFILL).await?;
        conn.execute_unprepared(DISAMBIGUATE).await?;

        // SQLite refuses to drop a column an index names, so the index goes first.
        drop_index(manager, REVIEW_INDEX, Review::Table).await?;
        for column in LEGACY_COLUMNS {
            manager
                .alter_table(
                    Table::alter()
                        .table(Review::Table)
                        .drop_column(column)
                        .to_owned(),
                )
                .await?;
        }
        // An identity reviews a run at most once: re-submitting updates that one
        // review rather than adding another.
        manager
            .create_index(
                Index::create()
                    .name(REVIEW_INDEX)
                    .table(Review::Table)
                    .col(Review::RunId)
                    .col(Review::Reviewer)
                    .unique()
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name(JOB_TOKEN_INDEX)
                    .table(Job::Table)
                    .col(Job::JobToken)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name(PUBLISH_JOB_TOKEN_INDEX)
                    .table(PublishJob::Table)
                    .col(PublishJob::JobToken)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        drop_index(manager, PUBLISH_JOB_TOKEN_INDEX, PublishJob::Table).await?;
        drop_index(manager, JOB_TOKEN_INDEX, Job::Table).await?;

        for column in LEGACY_COLUMNS {
            manager
                .alter_table(
                    Table::alter()
                        .table(Review::Table)
                        .add_column(ColumnDef::new(column).string().not_null().default(""))
                        .to_owned(),
                )
                .await?;
        }
        manager.get_connection().execute_unprepared(RESTORE).await?;

        drop_index(manager, REVIEW_INDEX, Review::Table).await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Review::Table)
                    .drop_column(Review::Reviewer)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name(REVIEW_INDEX)
                    .table(Review::Table)
                    .col(Review::RunId)
                    .col(Review::ReviewerUserId)
                    .unique()
                    .to_owned(),
            )
            .await
    }
}

/// Drop the index `name` on `table`.
async fn drop_index<T: IntoIden + 'static>(
    manager: &SchemaManager<'_>,
    name: &str,
    table: T,
) -> Result<(), DbErr> {
    manager
        .drop_index(Index::drop().name(name).table(table).to_owned())
        .await
}

#[derive(DeriveIden, Clone, Copy)]
enum Review {
    Table,
    RunId,
    Reviewer,
    ReviewerUserId,
    ReviewerUsername,
    ReviewerDisplayName,
}

#[derive(DeriveIden)]
enum Job {
    Table,
    JobToken,
}

#[derive(DeriveIden)]
enum PublishJob {
    Table,
    JobToken,
}
