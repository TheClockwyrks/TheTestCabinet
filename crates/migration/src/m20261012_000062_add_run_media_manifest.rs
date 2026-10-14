//! Adds the two columns a run's media confirmation gained when it widened to
//! every file of the run.
//!
//! - `media_confirmation_version`: the version of the definition of "confirmed"
//!   that the run's recorded media evaluation was made under. `NULL` for a run
//!   no refresh has evaluated, and for one evaluated before the column existed.
//!   A confirmation counts only under the version the backend currently
//!   implements, so a row confirmed earlier reads as unconfirmed and is evaluated
//!   again by the next refresh.
//! - `media_manifest`: a JSON document listing every file of the run that is in
//!   the bucket, each with the name the backend store knows it by and its object
//!   key or keys. Written together with a confirmation and cleared with it.
//!
//! Every existing row starts with both `NULL`. Each is its own statement because
//! SQLite adds one column per `ALTER TABLE`.

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
                        ColumnDef::new(Run::MediaConfirmationVersion)
                            .integer()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Run::Table)
                    .add_column(ColumnDef::new(Run::MediaManifest).text().null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in [Run::MediaManifest, Run::MediaConfirmationVersion] {
            manager
                .alter_table(
                    Table::alter()
                        .table(Run::Table)
                        .drop_column(column)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum Run {
    Table,
    MediaConfirmationVersion,
    MediaManifest,
}
