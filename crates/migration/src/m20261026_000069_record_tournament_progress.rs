//! Records a tournament from the moment the arena accepts it rather than once it
//! has finished (the arena overview's "Durable tournaments").
//!
//! The `tournament` table gains `state` (`queued`, `running`, `succeeded` or
//! `failed`) and `detail`, a failed tournament's reason. Every row already present
//! was published finished, so it is `succeeded`. An index over `state` answers the
//! arena's listing of the unfinished tournaments and the gallery's of the
//! succeeded ones.
//!
//! The new `tournament_match` table holds one row per pairing of a tournament's
//! field, recorded with the tournament and without a result: `ordinal` is the
//! pairing's place in the order it is played, and `summary_json` its
//! `MatchSummary`, `NULL` until the match is recorded. A tournament published
//! before this table existed has no rows in it, and its record carries its
//! matches.

use sea_orm_migration::prelude::*;

const STATE_INDEX: &str = "idx_tournament_state";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // One column per statement: SQLite's `ALTER TABLE` adds one at a time.
        manager
            .alter_table(
                Table::alter()
                    .table(Tournament::Table)
                    .add_column(
                        ColumnDef::new(Tournament::State)
                            .string()
                            .not_null()
                            .default("succeeded"),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Tournament::Table)
                    .add_column(ColumnDef::new(Tournament::Detail).text().null())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name(STATE_INDEX)
                    .table(Tournament::Table)
                    .col(Tournament::State)
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(TournamentMatch::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(TournamentMatch::TournamentId)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(TournamentMatch::MatchId).string().not_null())
                    .col(
                        ColumnDef::new(TournamentMatch::Ordinal)
                            .integer()
                            .not_null(),
                    )
                    .col(ColumnDef::new(TournamentMatch::RedId).string().not_null())
                    .col(ColumnDef::new(TournamentMatch::BlueId).string().not_null())
                    .col(ColumnDef::new(TournamentMatch::SummaryJson).text().null())
                    .primary_key(
                        Index::create()
                            .col(TournamentMatch::TournamentId)
                            .col(TournamentMatch::MatchId),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(TournamentMatch::Table).to_owned())
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(STATE_INDEX)
                    .table(Tournament::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Tournament::Table)
                    .drop_column(Tournament::Detail)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Tournament::Table)
                    .drop_column(Tournament::State)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Tournament {
    Table,
    State,
    Detail,
}

#[derive(DeriveIden)]
enum TournamentMatch {
    Table,
    TournamentId,
    MatchId,
    Ordinal,
    RedId,
    BlueId,
    SummaryJson,
}
