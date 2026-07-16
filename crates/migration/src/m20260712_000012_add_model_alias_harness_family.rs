//! Adds `model_alias.harness_family`: the harness family a curated model's slug is
//! usable with (`test_cabinet_core::run_record::HarnessFamily` — `claude`,
//! `codex`, `antigravity`, or `openrouter`), so a run form can offer only the
//! slugs the selected harness can actually launch.
//!
//! The column is `NOT NULL` with a portable `openrouter` default, which is the
//! correct family for the great majority of existing aliases (every OpenRouter
//! `provider/model` slug). The native-harness slugs that predate this column
//! (`claude-opus-4-8`, `gpt-5.5`, …) are corrected to their true family by the
//! idempotent startup backfill in `backend::bootstrap`, per the module doc in
//! `lib.rs`: data normalization that needs application logic lives there, not in a
//! migration. Built from the portable schema builder so it applies identically to
//! SQLite and PostgreSQL.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(ModelAlias::Table)
                    .add_column(
                        ColumnDef::new(ModelAlias::HarnessFamily)
                            .string()
                            .not_null()
                            .default("openrouter"),
                    )
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(ModelAlias::Table)
                    .drop_column(ModelAlias::HarnessFamily)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum ModelAlias {
    Table,
    HarnessFamily,
}
