//! Splits a ladder into its configuration and its dispatch, makes plans fill under a
//! runs-in-flight limit, and drops everything reviews used to pace.
//!
//! - The review buffer becomes a **runs-in-flight limit**: `buffer_target` is renamed
//!   `in_flight_limit` on `coverage_settings`, `coverage_plan` and `ladder`, with the same
//!   encoding (a non-negative bound, a negative value for no bound, `NULL` on a plan or a
//!   ladder to inherit the account's).
//! - The launch-pass claim is renamed for what it is: `topping_up_at` becomes
//!   `launch_claimed_at`, and a ladder's `top_up_pending` becomes `launch_requested`. A
//!   plan gains the same `launch_requested` flag, since a filling plan is fed by finished
//!   runs exactly as a running dispatch is.
//! - A plan fills until every launchable cell is filled: `fill_id` names the fill in
//!   progress (`NULL` when the plan is not filling) and is part of the origin of every
//!   job the fill launches. `paused` and `auto_top_up` are gone.
//! - A ladder is a configuration only: `paused` is gone. Running it creates a
//!   `ladder_dispatch` (one per ladder; a new Run replaces an ended one) holding a
//!   snapshot of the rungs, gate, order and limit; its climbers are
//!   `ladder_dispatch_climber` rows and its recorded rung verdicts
//!   `ladder_dispatch_outcome` rows. The old `ladder_climber` steering rows and the
//!   global `ladder_outcome` verdicts are dropped: a dispatch's evidence is its own runs.
//! - `coverage_plan_cell_retry` records when the owner retried a plan cell blocked on
//!   infrastructure failures; only jobs that ended after it count toward the cell's
//!   failing streak.
//!
//! The down migration restores the old columns and tables empty: ladder standing and
//! steering are not restored, and every ladder comes back disabled.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite takes one column change per ALTER TABLE statement.
        rename(
            manager,
            CoverageSettings::Table,
            CoverageSettings::BufferTarget,
            CoverageSettings::InFlightLimit,
        )
        .await?;

        drop_column(manager, CoveragePlan::Table, CoveragePlan::Paused).await?;
        drop_column(manager, CoveragePlan::Table, CoveragePlan::AutoTopUp).await?;
        rename(
            manager,
            CoveragePlan::Table,
            CoveragePlan::BufferTarget,
            CoveragePlan::InFlightLimit,
        )
        .await?;
        rename(
            manager,
            CoveragePlan::Table,
            CoveragePlan::ToppingUpAt,
            CoveragePlan::LaunchClaimedAt,
        )
        .await?;
        add_column(
            manager,
            CoveragePlan::Table,
            ColumnDef::new(CoveragePlan::LaunchRequested)
                .boolean()
                .not_null()
                .default(false)
                .to_owned(),
        )
        .await?;
        add_column(
            manager,
            CoveragePlan::Table,
            ColumnDef::new(CoveragePlan::FillId)
                .string()
                .null()
                .to_owned(),
        )
        .await?;

        drop_column(manager, Ladder::Table, Ladder::Paused).await?;
        rename(
            manager,
            Ladder::Table,
            Ladder::BufferTarget,
            Ladder::InFlightLimit,
        )
        .await?;
        rename(
            manager,
            Ladder::Table,
            Ladder::ToppingUpAt,
            Ladder::LaunchClaimedAt,
        )
        .await?;
        rename(
            manager,
            Ladder::Table,
            Ladder::TopUpPending,
            Ladder::LaunchRequested,
        )
        .await?;

        manager
            .drop_table(Table::drop().table(LadderOutcome::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(LadderClimber::Table).to_owned())
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(LadderDispatch::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(LadderDispatch::LadderId)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(LadderDispatch::Id)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(ColumnDef::new(LadderDispatch::Status).string().not_null())
                    .col(
                        ColumnDef::new(LadderDispatch::StartedAt)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(LadderDispatch::EndedAt).string().null())
                    .col(
                        ColumnDef::new(LadderDispatch::SnapshotJson)
                            .text()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_ladder_dispatch_ladder")
                            .from(LadderDispatch::Table, LadderDispatch::LadderId)
                            .to(Ladder::Table, Ladder::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(LadderDispatchClimber::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(LadderDispatchClimber::DispatchId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(LadderDispatchClimber::ClimberKey)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(LadderDispatchClimber::Position)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(LadderDispatchClimber::ComboJson)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(LadderDispatchClimber::CellJson)
                            .text()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(LadderDispatchClimber::RetriedAt)
                            .string()
                            .null(),
                    )
                    .primary_key(
                        Index::create()
                            .col(LadderDispatchClimber::DispatchId)
                            .col(LadderDispatchClimber::ClimberKey),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_ladder_dispatch_climber_dispatch")
                            .from(
                                LadderDispatchClimber::Table,
                                LadderDispatchClimber::DispatchId,
                            )
                            .to(LadderDispatch::Table, LadderDispatch::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(LadderDispatchOutcome::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(LadderDispatchOutcome::DispatchId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(LadderDispatchOutcome::RungId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(LadderDispatchOutcome::ClimberKey)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(LadderDispatchOutcome::Outcome)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(LadderDispatchOutcome::DecidedAt)
                            .string()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .col(LadderDispatchOutcome::DispatchId)
                            .col(LadderDispatchOutcome::RungId)
                            .col(LadderDispatchOutcome::ClimberKey),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_ladder_dispatch_outcome_dispatch")
                            .from(
                                LadderDispatchOutcome::Table,
                                LadderDispatchOutcome::DispatchId,
                            )
                            .to(LadderDispatch::Table, LadderDispatch::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(CoveragePlanCellRetry::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(CoveragePlanCellRetry::PlanId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(CoveragePlanCellRetry::CellKey)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(CoveragePlanCellRetry::RetriedAt)
                            .string()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .col(CoveragePlanCellRetry::PlanId)
                            .col(CoveragePlanCellRetry::CellKey),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_coverage_plan_cell_retry_plan")
                            .from(CoveragePlanCellRetry::Table, CoveragePlanCellRetry::PlanId)
                            .to(CoveragePlan::Table, CoveragePlan::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in [
            CoveragePlanCellRetry::Table.into_iden(),
            LadderDispatchOutcome::Table.into_iden(),
            LadderDispatchClimber::Table.into_iden(),
            LadderDispatch::Table.into_iden(),
        ] {
            manager
                .drop_table(Table::drop().table(table).to_owned())
                .await?;
        }

        // The 000054 shapes, empty: standing and steering are not restored.
        manager
            .create_table(
                Table::create()
                    .table(LadderClimber::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(LadderClimber::LadderId).string().not_null())
                    .col(
                        ColumnDef::new(LadderClimber::CombinationKey)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(LadderClimber::Priority)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(LadderClimber::Focused)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(
                        ColumnDef::new(LadderClimber::Paused)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(ColumnDef::new(LadderClimber::UpdatedAt).string().not_null())
                    .col(ColumnDef::new(LadderClimber::RetriedAt).string().null())
                    .primary_key(
                        Index::create()
                            .col(LadderClimber::LadderId)
                            .col(LadderClimber::CombinationKey),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_ladder_climber_ladder")
                            .from(LadderClimber::Table, LadderClimber::LadderId)
                            .to(Ladder::Table, Ladder::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(LadderOutcome::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(LadderOutcome::LadderId).string().not_null())
                    .col(ColumnDef::new(LadderOutcome::RungId).string().not_null())
                    .col(
                        ColumnDef::new(LadderOutcome::CombinationKey)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(LadderOutcome::DecidedVersion)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(LadderOutcome::Outcome).string().not_null())
                    .col(ColumnDef::new(LadderOutcome::DecidedAt).string().not_null())
                    .primary_key(
                        Index::create()
                            .col(LadderOutcome::LadderId)
                            .col(LadderOutcome::RungId)
                            .col(LadderOutcome::CombinationKey)
                            .col(LadderOutcome::DecidedVersion),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_ladder_outcome_ladder")
                            .from(LadderOutcome::Table, LadderOutcome::LadderId)
                            .to(Ladder::Table, Ladder::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_ladder_outcome_rung")
                            .from(LadderOutcome::Table, LadderOutcome::RungId)
                            .to(LadderRung::Table, LadderRung::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_ladder_outcome_combination")
                    .table(LadderOutcome::Table)
                    .col(LadderOutcome::LadderId)
                    .col(LadderOutcome::CombinationKey)
                    .to_owned(),
            )
            .await?;

        rename(
            manager,
            Ladder::Table,
            Ladder::LaunchRequested,
            Ladder::TopUpPending,
        )
        .await?;
        rename(
            manager,
            Ladder::Table,
            Ladder::LaunchClaimedAt,
            Ladder::ToppingUpAt,
        )
        .await?;
        rename(
            manager,
            Ladder::Table,
            Ladder::InFlightLimit,
            Ladder::BufferTarget,
        )
        .await?;
        add_column(
            manager,
            Ladder::Table,
            ColumnDef::new(Ladder::Paused)
                .boolean()
                .not_null()
                .default(true)
                .to_owned(),
        )
        .await?;

        drop_column(manager, CoveragePlan::Table, CoveragePlan::FillId).await?;
        drop_column(manager, CoveragePlan::Table, CoveragePlan::LaunchRequested).await?;
        rename(
            manager,
            CoveragePlan::Table,
            CoveragePlan::LaunchClaimedAt,
            CoveragePlan::ToppingUpAt,
        )
        .await?;
        rename(
            manager,
            CoveragePlan::Table,
            CoveragePlan::InFlightLimit,
            CoveragePlan::BufferTarget,
        )
        .await?;
        add_column(
            manager,
            CoveragePlan::Table,
            ColumnDef::new(CoveragePlan::AutoTopUp)
                .boolean()
                .not_null()
                .default(false)
                .to_owned(),
        )
        .await?;
        add_column(
            manager,
            CoveragePlan::Table,
            ColumnDef::new(CoveragePlan::Paused)
                .boolean()
                .not_null()
                .default(false)
                .to_owned(),
        )
        .await?;

        rename(
            manager,
            CoverageSettings::Table,
            CoverageSettings::InFlightLimit,
            CoverageSettings::BufferTarget,
        )
        .await?;
        Ok(())
    }
}

/// Rename one column of `table`.
async fn rename(
    manager: &SchemaManager<'_>,
    table: impl IntoIden + 'static,
    from: impl IntoIden + 'static,
    to: impl IntoIden + 'static,
) -> Result<(), DbErr> {
    manager
        .alter_table(
            Table::alter()
                .table(table)
                .rename_column(from, to)
                .to_owned(),
        )
        .await
}

/// Drop one column of `table`.
async fn drop_column(
    manager: &SchemaManager<'_>,
    table: impl IntoIden + 'static,
    column: impl IntoIden + 'static,
) -> Result<(), DbErr> {
    manager
        .alter_table(Table::alter().table(table).drop_column(column).to_owned())
        .await
}

/// Add one column to `table`.
async fn add_column(
    manager: &SchemaManager<'_>,
    table: impl IntoIden + 'static,
    mut column: ColumnDef,
) -> Result<(), DbErr> {
    manager
        .alter_table(
            Table::alter()
                .table(table)
                .add_column(&mut column)
                .to_owned(),
        )
        .await
}

#[derive(DeriveIden)]
enum CoverageSettings {
    Table,
    BufferTarget,
    InFlightLimit,
}

#[derive(DeriveIden)]
enum CoveragePlan {
    Table,
    Id,
    Paused,
    AutoTopUp,
    BufferTarget,
    InFlightLimit,
    ToppingUpAt,
    LaunchClaimedAt,
    LaunchRequested,
    FillId,
}

#[derive(DeriveIden)]
enum Ladder {
    Table,
    Id,
    Paused,
    BufferTarget,
    InFlightLimit,
    ToppingUpAt,
    LaunchClaimedAt,
    TopUpPending,
    LaunchRequested,
}

#[derive(DeriveIden)]
enum LadderRung {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum LadderClimber {
    Table,
    LadderId,
    CombinationKey,
    Priority,
    Focused,
    Paused,
    UpdatedAt,
    RetriedAt,
}

#[derive(DeriveIden)]
enum LadderOutcome {
    Table,
    LadderId,
    RungId,
    CombinationKey,
    DecidedVersion,
    Outcome,
    DecidedAt,
}

#[derive(DeriveIden)]
enum LadderDispatch {
    Table,
    LadderId,
    Id,
    Status,
    StartedAt,
    EndedAt,
    SnapshotJson,
}

#[derive(DeriveIden)]
enum LadderDispatchClimber {
    Table,
    DispatchId,
    ClimberKey,
    Position,
    ComboJson,
    CellJson,
    RetriedAt,
}

#[derive(DeriveIden)]
enum LadderDispatchOutcome {
    Table,
    DispatchId,
    RungId,
    ClimberKey,
    Outcome,
    DecidedAt,
}

#[derive(DeriveIden)]
enum CoveragePlanCellRetry {
    Table,
    PlanId,
    CellKey,
    RetriedAt,
}
