//! Puts ladders on one plain vocabulary and drops the controls an automatic climb has no
//! use for.
//!
//! - A recorded rung verdict is `passed` or `failed` (`ladder_outcome.outcome`).
//! - A ladder's verdicts are the gate's alone, so `ladder_outcome` has no override columns.
//! - An enabled ladder always launches its own climb, so `ladder` has no `auto_top_up`
//!   switch, and since every launch pass is automatic, no `top_up_requested` flag marking
//!   one as the owner's.
//! - A climber's per-model stop is `ladder_climber.paused`.
//! - `ladder_climber.retried_at` records when the owner last retried a climber whose rung
//!   kept failing on infrastructure; only jobs that ended after it count toward the
//!   failing streak.
//!
//! The down migration restores the old columns and spellings. An enabled ladder climbs
//! by itself, so `auto_top_up` comes back `TRUE`; the dropped overrides are not restored.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        rename_outcome(manager, "advanced", "passed").await?;
        rename_outcome(manager, "walled", "failed").await?;
        // SQLite takes one column change per ALTER TABLE statement.
        manager
            .alter_table(
                Table::alter()
                    .table(LadderOutcome::Table)
                    .drop_column(LadderOutcome::OverrideOutcome)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(LadderOutcome::Table)
                    .drop_column(LadderOutcome::OverrideAt)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Ladder::Table)
                    .drop_column(Ladder::AutoTopUp)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Ladder::Table)
                    .drop_column(Ladder::TopUpRequested)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(LadderClimber::Table)
                    .rename_column(LadderClimber::Held, LadderClimber::Paused)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(LadderClimber::Table)
                    .add_column(ColumnDef::new(LadderClimber::RetriedAt).string().null())
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(LadderClimber::Table)
                    .drop_column(LadderClimber::RetriedAt)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(LadderClimber::Table)
                    .rename_column(LadderClimber::Paused, LadderClimber::Held)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Ladder::Table)
                    .add_column(
                        ColumnDef::new(Ladder::TopUpRequested)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Ladder::Table)
                    .add_column(
                        ColumnDef::new(Ladder::AutoTopUp)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(LadderOutcome::Table)
                    .add_column(ColumnDef::new(LadderOutcome::OverrideAt).string().null())
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(LadderOutcome::Table)
                    .add_column(
                        ColumnDef::new(LadderOutcome::OverrideOutcome)
                            .string()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;
        rename_outcome(manager, "failed", "walled").await?;
        rename_outcome(manager, "passed", "advanced").await?;
        Ok(())
    }
}

/// Rewrite every recorded verdict spelled `from` as `to`.
async fn rename_outcome(manager: &SchemaManager<'_>, from: &str, to: &str) -> Result<(), DbErr> {
    let update = Query::update()
        .table(LadderOutcome::Table)
        .value(LadderOutcome::Outcome, to)
        .and_where(Expr::col(LadderOutcome::Outcome).eq(from))
        .to_owned();
    manager.exec_stmt(update).await
}

#[derive(DeriveIden)]
enum Ladder {
    Table,
    AutoTopUp,
    TopUpRequested,
}

#[derive(DeriveIden)]
enum LadderOutcome {
    Table,
    Outcome,
    OverrideOutcome,
    OverrideAt,
}

#[derive(DeriveIden)]
enum LadderClimber {
    Table,
    Held,
    Paused,
    RetriedAt,
}
