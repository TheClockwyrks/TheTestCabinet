//! Adds the five columns the artifact reclamation sweep's retention rules read and
//! write on the `run` table.
//!
//! - `media_confirmed_at`: RFC 3339 of the snapshot refresh that found every media
//!   file of the published run in the bucket. `NULL` until one has, and `NULL`
//!   again when a later refresh could not confirm the run, or the run's record
//!   was stored again. A published run's tree is reclaimed only with this set.
//! - `media_checked_at`: RFC 3339 of the latest refresh that evaluated the
//!   published run's media, whatever it found. It is what tells a run no refresh
//!   has looked at from one a refresh could not confirm, so a backend requests a
//!   refresh at startup for the former only.
//! - `media_bucket`: the bucket that evaluation was made against, as its endpoint
//!   and name. A confirmation counts only for the bucket it names, so a database
//!   restored beside another bucket deletes no tree on the strength of it.
//! - `artifacts_reclaimed_at`, `artifacts_reclaimed_reason`: when and why the sweep
//!   deleted the run's tree on purpose (`published`, `failed` or `canceled`). `NULL`
//!   for every run whose tree was never reclaimed, which keeps a reclaimed tree
//!   apart from one that was lost.
//!
//! Every existing row starts with all five `NULL`. Each is its own statement
//! because SQLite adds one column per `ALTER TABLE`.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

/// The added columns, in the order they are added and the reverse of the order
/// they are dropped.
const COLUMNS: [Run; 5] = [
    Run::MediaConfirmedAt,
    Run::MediaCheckedAt,
    Run::MediaBucket,
    Run::ArtifactsReclaimedAt,
    Run::ArtifactsReclaimedReason,
];

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in COLUMNS {
            manager
                .alter_table(
                    Table::alter()
                        .table(Run::Table)
                        .add_column(ColumnDef::new(column).string().null())
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in COLUMNS.into_iter().rev() {
            manager
                .alter_table(
                    Table::alter()
                        .table(Run::Table)
                        .drop_column(column)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum Run {
    Table,
    MediaConfirmedAt,
    MediaCheckedAt,
    MediaBucket,
    ArtifactsReclaimedAt,
    ArtifactsReclaimedReason,
}
