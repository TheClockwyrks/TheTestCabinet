//! Adds the lease columns to the `model_probe` table and makes each probe call's
//! coordinate unique.
//!
//! A probe runs inside a backend process, which holds a lease on the probe's row
//! while it runs: `lease_holder` names the runner holding it (an opaque token minted
//! when the runner takes it) and `lease_expires_at` when it expires. The trigger sets
//! both two minutes out, the runner renews the expiry while it runs, and finishing the
//! probe clears both. A `running` probe whose lease has lapsed has lost its runner, as
//! one does when its backend restarts, and another runner may take the lease over.
//!
//! `lease_expires_at` is nullable text holding an RFC 3339 UTC instant written at
//! whole-second precision (`YYYY-MM-DDTHH:MM:SSZ`), like the job lease. Both columns
//! are `NULL` on every row already present when they were added, which reads as a
//! lapsed lease.
//!
//! The unique index on `model_probe_item(probe_id, language, scenario, prompt,
//! sample)` holds one item per call of a probe, so a runner that lost its lease and a
//! runner that took it over can never both record the same call. A runner records
//! each coordinate once, so every existing probe already satisfies it.

use sea_orm_migration::prelude::*;

/// The unique index over a probe item's call coordinate.
const ITEM_COORDINATE_INDEX: &str = "idx_model_probe_item_coordinate";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // One column per statement: SQLite alters a table one column at a time.
        manager
            .alter_table(
                Table::alter()
                    .table(ModelProbe::Table)
                    .add_column(ColumnDef::new(ModelProbe::LeaseExpiresAt).text().null())
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(ModelProbe::Table)
                    .add_column(ColumnDef::new(ModelProbe::LeaseHolder).text().null())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name(ITEM_COORDINATE_INDEX)
                    .table(ModelProbeItem::Table)
                    .col(ModelProbeItem::ProbeId)
                    .col(ModelProbeItem::Language)
                    .col(ModelProbeItem::Scenario)
                    .col(ModelProbeItem::Prompt)
                    .col(ModelProbeItem::Sample)
                    .unique()
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(ITEM_COORDINATE_INDEX)
                    .table(ModelProbeItem::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(ModelProbe::Table)
                    .drop_column(ModelProbe::LeaseHolder)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(ModelProbe::Table)
                    .drop_column(ModelProbe::LeaseExpiresAt)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum ModelProbe {
    Table,
    LeaseExpiresAt,
    LeaseHolder,
}

#[derive(DeriveIden)]
enum ModelProbeItem {
    Table,
    ProbeId,
    Language,
    Scenario,
    Prompt,
    Sample,
}
