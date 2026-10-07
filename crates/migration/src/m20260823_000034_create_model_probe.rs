//! Adds the `model_probe` and `model_probe_item` tables: the stored results of
//! responses-as-code readiness probes run against a catalog model.
//!
//! A probe replays gg's real RaC turn-1 request against a model through
//! OpenRouter (no tools array) across a fixed matrix of prompt conditions,
//! classifies each reply's shape, and reduces the results to a verdict on
//! whether the model can drive RaC at all. The probe row records what was
//! launched (target slug, optional pinned provider, sampling parameters, the
//! base request as sent) and the outcome (status, verdict, clean rates, spend);
//! each item row is one completion call with its classification and the model's
//! raw reply. Probes are append-only history: re-running a probe adds a new row
//! rather than replacing an old one, so the model page can show how a provider's
//! behavior changed over time. Built from the portable schema builder so it
//! applies identically to SQLite and PostgreSQL; timestamps are RFC 3339
//! strings.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ModelProbe::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ModelProbe::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(ModelProbe::ModelSlug).string().not_null())
                    .col(
                        ColumnDef::new(ModelProbe::OpenrouterSlug)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(ModelProbe::Provider).string().null())
                    .col(ColumnDef::new(ModelProbe::UserId).string().not_null())
                    .col(ColumnDef::new(ModelProbe::Samples).integer().not_null())
                    .col(ColumnDef::new(ModelProbe::MaxTokens).integer().not_null())
                    .col(ColumnDef::new(ModelProbe::FullContext).boolean().not_null())
                    .col(ColumnDef::new(ModelProbe::RequestJson).text().not_null())
                    .col(ColumnDef::new(ModelProbe::Status).string().not_null())
                    .col(ColumnDef::new(ModelProbe::Error).text().null())
                    .col(ColumnDef::new(ModelProbe::Verdict).string().null())
                    .col(ColumnDef::new(ModelProbe::BaseCleanRate).double().null())
                    .col(
                        ColumnDef::new(ModelProbe::BestVariationCleanRate)
                            .double()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(ModelProbe::Spend)
                            .double()
                            .not_null()
                            .default(0.0),
                    )
                    .col(ColumnDef::new(ModelProbe::CreatedAt).string().not_null())
                    .col(ColumnDef::new(ModelProbe::FinishedAt).string().null())
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_model_probe_model")
                    .table(ModelProbe::Table)
                    .col(ModelProbe::ModelSlug)
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(ModelProbeItem::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ModelProbeItem::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(ModelProbeItem::ProbeId).string().not_null())
                    .col(
                        ColumnDef::new(ModelProbeItem::Condition)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(ModelProbeItem::Sample).integer().not_null())
                    .col(ColumnDef::new(ModelProbeItem::Provider).string().null())
                    .col(ColumnDef::new(ModelProbeItem::FinishReason).string().null())
                    .col(
                        ColumnDef::new(ModelProbeItem::NativeFinishReason)
                            .string()
                            .null(),
                    )
                    .col(ColumnDef::new(ModelProbeItem::Label).string().null())
                    .col(
                        ColumnDef::new(ModelProbeItem::Clean)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(
                        ColumnDef::new(ModelProbeItem::ResponseText)
                            .text()
                            .not_null(),
                    )
                    .col(ColumnDef::new(ModelProbeItem::ReasoningText).text().null())
                    .col(
                        ColumnDef::new(ModelProbeItem::PromptTokens)
                            .big_integer()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(ModelProbeItem::CompletionTokens)
                            .big_integer()
                            .null(),
                    )
                    .col(ColumnDef::new(ModelProbeItem::Cost).double().null())
                    .col(
                        ColumnDef::new(ModelProbeItem::DurationMs)
                            .big_integer()
                            .not_null(),
                    )
                    .col(ColumnDef::new(ModelProbeItem::Error).text().null())
                    .col(
                        ColumnDef::new(ModelProbeItem::CreatedAt)
                            .string()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_model_probe_item_probe")
                    .table(ModelProbeItem::Table)
                    .col(ModelProbeItem::ProbeId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(ModelProbeItem::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(ModelProbe::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum ModelProbe {
    Table,
    Id,
    ModelSlug,
    OpenrouterSlug,
    Provider,
    UserId,
    Samples,
    MaxTokens,
    FullContext,
    RequestJson,
    Status,
    Error,
    Verdict,
    BaseCleanRate,
    BestVariationCleanRate,
    Spend,
    CreatedAt,
    FinishedAt,
}

#[derive(DeriveIden)]
enum ModelProbeItem {
    Table,
    Id,
    ProbeId,
    Condition,
    Sample,
    Provider,
    FinishReason,
    NativeFinishReason,
    Label,
    Clean,
    ResponseText,
    ReasoningText,
    PromptTokens,
    CompletionTokens,
    Cost,
    DurationMs,
    Error,
    CreatedAt,
}
