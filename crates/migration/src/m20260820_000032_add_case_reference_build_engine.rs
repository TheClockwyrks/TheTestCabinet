//! Adds the `engine` column to `case_reference_build` and takes it into the
//! primary key.
//!
//! A reference implementation is the *correct* build of a test-case variant, and
//! that build genuinely differs per engine: an
//! engineless one carries its own runtime, an engine-backed one hands the same
//! surfaces to the runtime it vendors. So a variant has one deployed URL **per
//! engine**, and the row's identity is the `(slug, version, variant, engine)`
//! tuple rather than the triple it was.
//!
//! Every row written before this column existed is an engineless build — no case
//! declared an engine when it was deployed — so the backfill is the literal
//! `none`, which is what re-ingesting the migrated lockfile writes anyway.
//!
//! SQLite cannot alter a primary key in place, so the table is rebuilt: create the
//! new shape beside it, copy every row through with the backfilled engine, drop the
//! old, rename. The same script applies on PostgreSQL, so the two backends stay on
//! one path rather than diverging into a dialect-specific `ALTER`.

use sea_orm_migration::prelude::*;

/// The engine every row predating this column was deployed for.
const ENGINELESS: &str = "none";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(NewCaseReferenceBuild::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(CaseReferenceBuild::Slug).string().not_null())
                    .col(
                        ColumnDef::new(CaseReferenceBuild::Version)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(CaseReferenceBuild::Variant)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(CaseReferenceBuild::Engine)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(CaseReferenceBuild::Url).text().not_null())
                    .col(
                        ColumnDef::new(CaseReferenceBuild::UpdatedAt)
                            .string()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .col(CaseReferenceBuild::Slug)
                            .col(CaseReferenceBuild::Version)
                            .col(CaseReferenceBuild::Variant)
                            .col(CaseReferenceBuild::Engine),
                    )
                    .to_owned(),
            )
            .await?;

        let conn = manager.get_connection();
        conn.execute_unprepared(&format!(
            "INSERT INTO case_reference_build_new \
             (slug, version, variant, engine, url, updated_at) \
             SELECT slug, version, variant, '{ENGINELESS}', url, updated_at \
             FROM case_reference_build"
        ))
        .await?;

        manager
            .drop_table(Table::drop().table(CaseReferenceBuild::Table).to_owned())
            .await?;
        manager
            .rename_table(
                Table::rename()
                    .table(NewCaseReferenceBuild::Table, CaseReferenceBuild::Table)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Reversing drops the engine dimension, so only the engineless rows survive
        // — the rest have no place in a table keyed by the triple, and keeping one
        // arbitrarily would put a build under an identity it is not the answer for.
        manager
            .create_table(
                Table::create()
                    .table(NewCaseReferenceBuild::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(CaseReferenceBuild::Slug).string().not_null())
                    .col(
                        ColumnDef::new(CaseReferenceBuild::Version)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(CaseReferenceBuild::Variant)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(CaseReferenceBuild::Url).text().not_null())
                    .col(
                        ColumnDef::new(CaseReferenceBuild::UpdatedAt)
                            .string()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .col(CaseReferenceBuild::Slug)
                            .col(CaseReferenceBuild::Version)
                            .col(CaseReferenceBuild::Variant),
                    )
                    .to_owned(),
            )
            .await?;

        let conn = manager.get_connection();
        conn.execute_unprepared(&format!(
            "INSERT INTO case_reference_build_new (slug, version, variant, url, updated_at) \
             SELECT slug, version, variant, url, updated_at FROM case_reference_build \
             WHERE engine = '{ENGINELESS}'"
        ))
        .await?;

        manager
            .drop_table(Table::drop().table(CaseReferenceBuild::Table).to_owned())
            .await?;
        manager
            .rename_table(
                Table::rename()
                    .table(NewCaseReferenceBuild::Table, CaseReferenceBuild::Table)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum CaseReferenceBuild {
    Table,
    Slug,
    Version,
    Variant,
    Engine,
    Url,
    UpdatedAt,
}

/// The table the rebuilt shape is created under before it takes the real name.
#[derive(DeriveIden)]
enum NewCaseReferenceBuild {
    #[sea_orm(iden = "case_reference_build_new")]
    Table,
}
