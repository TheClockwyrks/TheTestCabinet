//! Adds the `agent_sources_json` column to the `gg_config` table.
//!
//! A configuration's capability set holds every agent written out in full, exactly as gg
//! reads it: gg is handed a configuration whose agents are already whole. This column
//! records, beside that set, *where* each agent came from — the saved agent it was
//! imported from, and which of its fields this configuration overrides locally.
//!
//! An import is therefore a live reference rather than a copy. A field the configuration
//! does not override follows the saved agent, so editing the saved agent reshapes every
//! configuration that imported it; a field it does override is pinned here, and the
//! saved agent stays as it is.
//!
//! Nullable, defaulting to `NULL`: a configuration whose agents are all declared inline
//! records no sources at all, and every row already stored when this migration runs
//! reads as `NULL` and stays valid. JSON text, read and written whole like the
//! capability set beside it.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(GgConfig::Table)
                    .add_column(ColumnDef::new(GgConfig::AgentSourcesJson).text().null())
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(GgConfig::Table)
                    .drop_column(GgConfig::AgentSourcesJson)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum GgConfig {
    Table,
    AgentSourcesJson,
}
