//! Adds the gg columns the coverage counts are grouped by to the `run` and `job`
//! tables: `run.gg_models`, `job.gg_preset`, and `job.gg_models`.
//!
//! A harness cell is identified by its harness and the one model it runs. A gg run has
//! neither — it is launched from a saved **configuration** and binds a model per agent —
//! so a gg cell is identified by the configuration it came from (its id, added by
//! `m20260901_000041_add_gg_config_id`) and by the models the launched capability set
//! binds to its agents. The models, because one configuration can run several: two
//! members that agree on the root agent's model and differ on a reviewer's are two arms
//! of a study, and a cell keyed on the root model alone would merge them.
//!
//! - `run.gg_models` — which agent the recorded capability set binds which model to,
//!   sorted, de-duplicated, and comma-joined, lifted at push beside the existing
//!   `run.gg_preset` (the configuration's name, which the run log shows and slices by).
//! - `job.gg_preset` / `job.gg_models` — the same two values lifted at enqueue, so an
//!   in-flight job carries what the run it produces will without deserializing
//!   `gg_config_json`. `job` carries them for the same reason it already carries
//!   `harness_slug` and `model_id`: the queue counts a cell's in-flight runs in SQL.
//!
//! All three are nullable, so the migration itself stamps nothing: a
//! third-party-harness row carries none of them, and every grouped coverage query
//! coalesces `gg_models` to the empty string — which is exactly the harness form of the
//! cell key. The **gg** rows that predate the columns do need filling, and are filled
//! by a startup backfill (`Db::backfill_gg_models` for runs,
//! `Db::backfill_in_flight_gg_cells` for the jobs still queued across the deploy)
//! rather than in SQL here, because the value is derived from the capability set
//! inside each row's JSON blob.

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
                    .add_column(ColumnDef::new(Run::GgModels).text().null())
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Job::Table)
                    .add_column(ColumnDef::new(Job::GgPreset).text().null())
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Job::Table)
                    .add_column(ColumnDef::new(Job::GgModels).text().null())
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Job::Table)
                    .drop_column(Job::GgModels)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Job::Table)
                    .drop_column(Job::GgPreset)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Run::Table)
                    .drop_column(Run::GgModels)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Run {
    Table,
    GgModels,
}

#[derive(DeriveIden)]
enum Job {
    Table,
    GgPreset,
    GgModels,
}
