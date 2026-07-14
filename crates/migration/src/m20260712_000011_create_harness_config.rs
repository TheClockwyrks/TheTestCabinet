//! Adds the `harness_config` table: the operator-tunable, per-harness configuration
//! the backend and dispatcher consult at run time (today just a harness's maximum
//! parallelism). Keyed by harness slug; a harness with no row runs fully default
//! (unlimited parallelism). Harness *identity* stays in the checked-in
//! `harnesses/<slug>/harness.toml` + code — only the mutable knobs live here.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(HarnessConfig::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(HarnessConfig::HarnessSlug)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    // The maximum concurrent runs of this harness the Test Cabinet
                    // will drive, or NULL for no limit.
                    .col(ColumnDef::new(HarnessConfig::MaxParallelism).integer().null())
                    .col(ColumnDef::new(HarnessConfig::UpdatedAt).string().not_null())
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(HarnessConfig::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum HarnessConfig {
    Table,
    HarnessSlug,
    MaxParallelism,
    UpdatedAt,
}
