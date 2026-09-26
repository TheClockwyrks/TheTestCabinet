//! Adds the `gg_preset` column to the `run` table.
//!
//! A **gg** run has no single harness model to identify it by — it binds a model
//! per agent, and the lifted `model_id` is only its representative primary-slot
//! value — so the console's run log shows the **configuration** the run was
//! launched from in that cell instead. This lifts that name out of the record's
//! capability set into a column of its own, so the server-side listing can search
//! and order by what the cell actually shows rather than by the model behind it.
//!
//! Nullable, defaulting to `NULL`: every third-party-harness run carries no
//! capability set, and a gg run assembled by hand carries no configuration name.
//! Every write sets the column directly.
//!
//! No index of its own. The `model` sort becomes an ordering over
//! `COALESCE(gg_preset, model_id)`, which `idx_run_model` could not have served
//! anyway (nor could it serve the `id` tiebreak every sort carries), and it joins
//! the other lifted sort columns — run time, tokens, cost, rating — in being
//! unindexed. `idx_run_model` still serves the `model=` equality filter, which is
//! unchanged.

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
                    .add_column(ColumnDef::new(Run::GgPreset).string().null())
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
                    .drop_column(Run::GgPreset)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Run {
    Table,
    GgPreset,
}
