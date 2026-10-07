//! Adds the `updated_at` **mutation timestamp** to the `run` table: RFC 3339 of
//! the last write that changed anything a consumer of the row can observe.
//!
//! `finished_at` is the *record's* timestamp — the moment the run stopped
//! executing — and nothing that happens to a stored run afterwards moves it.
//! Adding a review, publishing, completing a publish job, and re-pushing a
//! rewritten record all change what the row means without changing when the run
//! finished, and a run pushed long after it finished sorts as though it had been
//! stored back then. Any cache or index keyed on `finished_at` therefore serves
//! permanently stale rows and never notices a late arrival at all. This column is
//! the key such a consumer can trust: the in-memory document index that backs the
//! gg query language reconciles **per id** against a narrow
//! `(id, updated_at)` projection, evicting ids that vanished and reloading only
//! the ids whose stamp differs from the one it holds.
//!
//! Because that reconcile compares stamps for **inequality**, not order, the
//! column carries no monotonicity guarantee and must not be used as a sort key:
//! the RFC 3339 rendering omits the fractional part when it is exactly zero, which
//! makes string ordering across two stamps unreliable at sub-second distances.
//!
//! `NOT NULL DEFAULT ''` so rows already stored when this migration runs stay
//! valid; the migration then fills them from `finished_at`, the best evidence the
//! row itself carries of when it last meant something different. (A `''` residue
//! would still reconcile correctly — it is a stable value like any other — but it
//! reads as a lie to anything that displays the column.) Every write after this
//! stamps the column through the backend store's `touch_run` helper — the single
//! writer every [`Db`](../../test_cabinet_backend/db/struct.Db.html) mutator of a
//! `run` row routes through.
//!
//! No index: the projection the reconcile reads is a full scan of two narrow
//! columns by design (it must see deletions, which no index over survivors can
//! report), and nothing filters or orders on this column.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Run::Table)
                    .add_column(
                        ColumnDef::new(Run::UpdatedAt)
                            .string()
                            .not_null()
                            .default(""),
                    )
                    .to_owned(),
            )
            .await?;

        // Seed the existing rows from `finished_at`. This is pure SQL over columns
        // the table already holds — no application logic and no network — so it
        // belongs here rather than in a startup routine, and it means the `''`
        // default is never observed by a reader.
        manager
            .exec_stmt(
                Query::update()
                    .table(Run::Table)
                    .value(Run::UpdatedAt, Expr::col(Run::FinishedAt))
                    .and_where(Expr::col(Run::UpdatedAt).eq(""))
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Run::Table)
                    .drop_column(Run::UpdatedAt)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Run {
    Table,
    UpdatedAt,
    FinishedAt,
}
