//! Adds the **two rating channels** to the store: the reviewer-supplied
//! [aesthetic rating](https://docs.testcabinet.ai/testing/end-to-end/evaluation/)
//! beside the functional one, and the flag that says which channel a run's
//! functional rating comes from.
//!
//! - `run.validator_rated` (boolean, `false` for every existing row): whether the
//!   run's case version is **validator-rated** — on the engine manifest format and
//!   not a game jam — so its functional `run.rating` is decided by the validators at
//!   push time (`Db::push`) rather than by its reviews, its score stands without a
//!   review, and the publish gate admits it with zero reviews. Lifted onto the row
//!   so the gate, the review recompute, and the catalog-free summary card can all
//!   branch on it without resolving the case from the definition store. `false` for
//!   every legacy run, which keeps behaving exactly as before.
//! - `run.aesthetic` (nullable text): the run's aggregate **aesthetic** rating as
//!   its lowercase token (`legendary`/`amazing`/`good`/`okay`/`slop`) — the worst
//!   any reviewer gave any domain — maintained by `Db::add_review` exactly like
//!   `run.rating`. `NULL` until a validator-rated run gets its first aesthetic
//!   review, and forever for a legacy run (which carries no aesthetic channel).
//! - `review.aesthetics` (text, `'[]'` for every existing row): the reviewer's
//!   per-domain aesthetic ratings as a JSON array of `{domain, rating}`, the
//!   aesthetic counterpart of `review.ratings`. Empty on every legacy review.
//!
//! No backfill: validator-rated case versions did not exist before this migration,
//! so no stored run needs its flag or rating recomputed — a re-push writes both.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Run::Table)
                    .add_column(
                        ColumnDef::new(Run::ValidatorRated)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Run::Table)
                    .add_column(ColumnDef::new(Run::Aesthetic).text().null())
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Review::Table)
                    .add_column(
                        ColumnDef::new(Review::Aesthetics)
                            .text()
                            .not_null()
                            .default("[]"),
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
                    .table(Review::Table)
                    .drop_column(Review::Aesthetics)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Run::Table)
                    .drop_column(Run::Aesthetic)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Run::Table)
                    .drop_column(Run::ValidatorRated)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Run {
    Table,
    ValidatorRated,
    Aesthetic,
}

#[derive(DeriveIden)]
enum Review {
    Table,
    Aesthetics,
}
