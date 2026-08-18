//! Adds the `gg_agent` table: an operator's named, reusable **agent profile**.
//!
//! One row per saved agent, held independently of any configuration, so a reviewer used
//! by several configurations is authored once. A configuration imports one and may
//! override fields on its own copy, leaving the profile stored here as it is.
//!
//! A saved agent holds one profile's configuration and nothing more. Memories, skills and
//! every other per-agent store belong to the run that creates them, so each run gets its
//! own however many configurations import the same agent.
//!
//! One row per saved agent, keyed by the auth-service `user_id`, holding the agent's own
//! `GgAgentConfig` as JSON text plus the model slots its bindings defer to (also JSON,
//! so an importing configuration can declare a slot it does not already have). Built
//! from the portable schema builder so it applies identically to SQLite and PostgreSQL;
//! the timestamp is an RFC 3339 string. A `user_id` index keeps the per-account list
//! query cheap.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(GgAgent::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(GgAgent::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(GgAgent::UserId).string().not_null())
                    .col(ColumnDef::new(GgAgent::Name).string().not_null())
                    .col(ColumnDef::new(GgAgent::Description).string().not_null())
                    .col(ColumnDef::new(GgAgent::AgentJson).text().not_null())
                    .col(ColumnDef::new(GgAgent::ModelSlotsJson).text().not_null())
                    .col(ColumnDef::new(GgAgent::UpdatedAt).string().not_null())
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_gg_agent_user")
                    .table(GgAgent::Table)
                    .col(GgAgent::UserId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(GgAgent::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum GgAgent {
    Table,
    Id,
    UserId,
    Name,
    Description,
    AgentJson,
    ModelSlotsJson,
    UpdatedAt,
}
