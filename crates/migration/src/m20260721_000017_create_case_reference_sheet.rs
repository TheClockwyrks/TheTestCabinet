//! Adds the `case_reference_sheet` table: the published **reference sheet** of an
//! asset-generation test-case variant — which frames of that variant's authored,
//! correct reference the public snapshot bucket actually holds.
//!
//! The asset-generation analogue of `case_reference_build`. An end-to-end or
//! full-stack reference implementation is a deployed site, so one URL describes it;
//! an asset reference has no site, only a set of rendered frames published under
//! deterministic object keys (`media/references/<slug>/<version>/<variant>/frames/…`,
//! see `test_cabinet_core::asset_reference`). There is therefore nothing to record
//! but *which* frames exist — every URL is derivable from the triple plus an index.
//!
//! One row per `(slug, version, variant)` triple — the composite primary key — so
//! re-publishing the same variant upserts its frame list in place. A variant with no
//! published reference simply has no row.
//!
//! `frames` is a text column rather than an integer array or a child table:
//! - SeaORM's portable schema builder has no array type that maps onto both SQLite
//!   and PostgreSQL, and this table must apply identically to each.
//! - The payload is a handful of small non-negative integers, so a child table would
//!   trade a join and a second migration for nothing.
//! - The stored form is canonical (ascending, de-duplicated, comma-separated, no
//!   whitespace), which lets the reconcile compare rows as plain strings and skip a
//!   write when nothing moved.
//!
//! Timestamps are RFC 3339 strings, matching `case_reference_build` and the
//! model-catalog tables.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(CaseReferenceSheet::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(CaseReferenceSheet::Slug).string().not_null())
                    .col(
                        ColumnDef::new(CaseReferenceSheet::Version)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(CaseReferenceSheet::Variant)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(CaseReferenceSheet::Frames).text().not_null())
                    .col(
                        ColumnDef::new(CaseReferenceSheet::UpdatedAt)
                            .string()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .col(CaseReferenceSheet::Slug)
                            .col(CaseReferenceSheet::Version)
                            .col(CaseReferenceSheet::Variant),
                    )
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(CaseReferenceSheet::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum CaseReferenceSheet {
    Table,
    Slug,
    Version,
    Variant,
    Frames,
    UpdatedAt,
}
