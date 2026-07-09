//! Adds the model-catalog tables: `model` (operator-curated config), `model_alias`
//! (the canonical run-record ids a curated model covers), and `model_price` (the
//! observed comparable-price history, keyed by canonical model id).
//!
//! `model_alias.alias` is globally unique so an id belongs to at most one curated
//! model, and it cascades on the owning model's deletion. `model_price` is keyed by
//! a canonical model-id string, not by a curated slug, so a model's price history
//! survives its config being added or removed. Built from the portable schema
//! builder so it applies identically to SQLite and PostgreSQL.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Model::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Model::Slug)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Model::DisplayName).string().not_null())
                    .col(ColumnDef::new(Model::Provider).string().not_null())
                    .col(ColumnDef::new(Model::ProviderLogoUrl).string())
                    .col(ColumnDef::new(Model::ProviderLogoSvg).text())
                    .col(ColumnDef::new(Model::DescriptionMd).text())
                    .col(ColumnDef::new(Model::OpenrouterSlug).string())
                    .col(ColumnDef::new(Model::CreatedAt).string().not_null())
                    .col(ColumnDef::new(Model::UpdatedAt).string().not_null())
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(ModelAlias::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ModelAlias::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(ModelAlias::ModelSlug).string().not_null())
                    .col(
                        ColumnDef::new(ModelAlias::Alias)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_model_alias_model")
                            .from(ModelAlias::Table, ModelAlias::ModelSlug)
                            .to(Model::Table, Model::Slug)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_model_alias_model")
                    .table(ModelAlias::Table)
                    .col(ModelAlias::ModelSlug)
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(ModelPrice::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ModelPrice::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(ModelPrice::ModelId).string().not_null())
                    .col(ColumnDef::new(ModelPrice::ObservedAt).string().not_null())
                    .col(ColumnDef::new(ModelPrice::UncachedInput).double())
                    .col(ColumnDef::new(ModelPrice::CachedInput).double())
                    .col(ColumnDef::new(ModelPrice::Output).double())
                    .col(ColumnDef::new(ModelPrice::ContextLength).big_integer())
                    .col(ColumnDef::new(ModelPrice::ReleasedAt).string())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_model_price_model")
                    .table(ModelPrice::Table)
                    .col(ModelPrice::ModelId)
                    .col(ModelPrice::ObservedAt)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(ModelPrice::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(ModelAlias::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Model::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Model {
    Table,
    Slug,
    DisplayName,
    Provider,
    ProviderLogoUrl,
    ProviderLogoSvg,
    DescriptionMd,
    OpenrouterSlug,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum ModelAlias {
    Table,
    Id,
    ModelSlug,
    Alias,
}

#[derive(DeriveIden)]
enum ModelPrice {
    Table,
    Id,
    ModelId,
    ObservedAt,
    UncachedInput,
    CachedInput,
    Output,
    ContextLength,
    ReleasedAt,
}
