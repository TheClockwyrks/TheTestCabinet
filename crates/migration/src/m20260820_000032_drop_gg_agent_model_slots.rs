//! Drops the `model_slots_json` column from the `gg_agent` table.
//!
//! A model slot is declared by the agent whose bindings defer to it, so a saved agent's
//! slots are part of the `GgAgentConfig` in `agent_json` and there is nothing beside it
//! to store. A configuration's own launch inputs, and the mapping from each onto the
//! agent slots it fills, live on the configuration's capability set.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(GgAgent::Table)
                    .drop_column(GgAgent::ModelSlotsJson)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(GgAgent::Table)
                    .add_column(
                        ColumnDef::new(GgAgent::ModelSlotsJson)
                            .text()
                            .not_null()
                            .default("[]"),
                    )
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum GgAgent {
    Table,
    ModelSlotsJson,
}
