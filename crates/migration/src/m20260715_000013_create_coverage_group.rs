//! Adds the `coverage_group` table: a reviewer's named, reusable set of harness+
//! model **combinations** or version-pinned **cases** that coverage plans
//! reference as pointers.
//!
//! A group is per-account (the auth-service `user_id`) and identified by an opaque
//! id, so an account may hold many groups and a plan can reference several. `kind`
//! is `"combo"` or `"case"`; `members_json` is the JSON array of that kind's
//! members (`{ harness, model, provider? }` for a combo group,
//! `{ slug, version, variant }` for a case group), stored whole like the other
//! plan/review JSON columns. Built from the portable schema builder so it applies
//! identically to SQLite and PostgreSQL; the timestamp is an RFC 3339 string to
//! match the other tables. A `user_id` index keeps the per-account list query
//! cheap.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(CoverageGroup::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(CoverageGroup::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(CoverageGroup::UserId).string().not_null())
                    .col(ColumnDef::new(CoverageGroup::Kind).string().not_null())
                    .col(ColumnDef::new(CoverageGroup::Name).string().not_null())
                    .col(ColumnDef::new(CoverageGroup::MembersJson).text().not_null())
                    .col(ColumnDef::new(CoverageGroup::UpdatedAt).string().not_null())
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_coverage_group_user")
                    .table(CoverageGroup::Table)
                    .col(CoverageGroup::UserId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(CoverageGroup::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum CoverageGroup {
    Table,
    Id,
    UserId,
    Kind,
    Name,
    MembersJson,
    UpdatedAt,
}
