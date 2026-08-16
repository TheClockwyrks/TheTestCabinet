//! Adds the `coverage_settings` table: an account's coverage preferences, of which
//! the review **buffer target** is the first.
//!
//! The buffer target is how many runs a reviewer is willing to have outstanding at
//! once — in-flight jobs plus completed runs they have not reviewed — across a
//! plan's or a ladder's cells. Top-up emits whole cells until the outstanding count
//! reaches it, then stops. That number is a property of the *person* (how much
//! reviewing they can absorb in a sitting), not of any one plan, so it belongs to
//! the account and is inherited by every plan and ladder they own. Each of those
//! may override it with its own nullable `buffer_target` when one particular sweep
//! warrants a deeper or shallower queue.
//!
//! One row per account, keyed by the auth-service `user_id`, so the table is a
//! sibling of the legacy per-account `review_plan` rather than of the many-per-
//! account `coverage_plan`. A reviewer who has never touched the setting has no
//! row: the backend applies its compiled-in default rather than writing a row on
//! first read, which keeps this a record of deliberate choices only.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(CoverageSettings::Table)
                    .if_not_exists()
                    // The account id is the key: settings are per-account, one row.
                    .col(
                        ColumnDef::new(CoverageSettings::UserId)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    // How many runs this account tolerates outstanding at once. Not
                    // null — the row exists only because the reviewer chose a value.
                    .col(
                        ColumnDef::new(CoverageSettings::BufferTarget)
                            .integer()
                            .not_null(),
                    )
                    // RFC 3339 of the last save, matching the other reviewer-owned
                    // tables so the console can show when a preference last changed.
                    .col(
                        ColumnDef::new(CoverageSettings::UpdatedAt)
                            .string()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(CoverageSettings::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum CoverageSettings {
    Table,
    UserId,
    BufferTarget,
    UpdatedAt,
}
