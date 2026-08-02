//! Adds the `code_analyzer_version` column to the `run` table: the **generation** of
//! the static code analyzer that produced the run's `codeAnalysis` figures, or `NULL`
//! for a run that carries none.
//!
//! The column exists because a corpus that spans two analyzer generations is otherwise
//! *silently* incomparable. A metric whose definition changed — or whose caps changed,
//! which is the same thing, because a cap decides which files contribute — produces a
//! step change in the aggregate that reads exactly like a model getting better or worse.
//! Lifting the version out of the record blob is what lets that be sliced, filtered and
//! warned about in SQL instead of by deserializing every record.
//!
//! It is also what **licenses improving the analyzer**. Without a recorded generation,
//! every improvement is a silent data-corruption event, so nobody makes one.
//!
//! **There is no backfill of the analysis itself.** The corpus starts at ship day: a
//! historical run's tree can only be re-read in its archived, post-validation state, and
//! a figure computed from a tree that carries build output, a rewritten lockfile and
//! toolchain caches is not the figure a fresh run reports. So this column is forward
//! comparability only, and a `NULL` here means "never analysed", never "analysed by an
//! unknown generation". What *is* backfilled is the column itself, from records that
//! already carry a summary but predate the column — see
//! [`Db::backfill_code_analyzer_version`](../../test_cabinet_backend/db/struct.Db.html).
//!
//! Nullable, defaulting to `NULL`: every run recorded before the analyzer shipped carries
//! no summary, and so does any run whose host wired no analyzer. Every write after this
//! sets the column directly from the record on the ordinary insert path.
//!
//! No index. This is a slicing and warning column read alongside a run row that is
//! already being fetched, not a filter the listing paginates on — and it joins the other
//! lifted non-sort columns in being unindexed.

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
                    .add_column(ColumnDef::new(Run::CodeAnalyzerVersion).integer().null())
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Run::Table)
                    .drop_column(Run::CodeAnalyzerVersion)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Run {
    Table,
    CodeAnalyzerVersion,
}
