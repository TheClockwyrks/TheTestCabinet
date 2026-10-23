//! An adversarial run's pushed `controller.wasm`, kept in the database beside the
//! run's row (the backend overview's "Durable state").
//!
//! The driver pushes the module before the terminal report that creates the run's
//! row, so a controller is stored whether or not its run is recorded yet, and it is
//! offered to the arena only once the run is ([`Db::runs_with_controllers`] answers
//! from the ids it is given, which the caller reads off the run rows). Deleting a run
//! deletes its controller ([`Db::delete_run`]).

use std::collections::HashSet;

use sea_orm::ActiveValue::Set;
use sea_orm::sea_query::OnConflict;
use sea_orm::{ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QuerySelect};
use test_cabinet_entities::{run, run_controller};

use super::Db;
use crate::error::Result;

impl Db {
    /// Store run `run_id`'s controller module, replacing one already stored: a re-push
    /// carries the same run's module again.
    pub async fn store_run_controller(&self, run_id: &str, module: &[u8]) -> Result<()> {
        run_controller::Entity::insert(run_controller::ActiveModel {
            run_id: Set(run_id.to_string()),
            module: Set(module.to_vec()),
        })
        .on_conflict(
            OnConflict::column(run_controller::Column::RunId)
                .update_column(run_controller::Column::Module)
                .to_owned(),
        )
        .exec_without_returning(&self.conn())
        .await?;
        Ok(())
    }

    /// Run `run_id`'s stored controller module, or `None` when none was pushed.
    pub async fn run_controller(&self, run_id: &str) -> Result<Option<Vec<u8>>> {
        Ok(run_controller::Entity::find_by_id(run_id.to_string())
            .one(&self.conn())
            .await?
            .map(|row| row.module))
    }

    /// Which of `run_ids` have a stored controller module. Reads the keys only, so a
    /// listing never loads the modules themselves.
    pub async fn runs_with_controllers(&self, run_ids: &[String]) -> Result<HashSet<String>> {
        if run_ids.is_empty() {
            return Ok(HashSet::new());
        }
        let ids: Vec<String> = run_controller::Entity::find()
            .select_only()
            .column(run_controller::Column::RunId)
            .filter(run_controller::Column::RunId.is_in(run_ids.iter().map(String::as_str)))
            .into_tuple()
            .all(&self.conn())
            .await?;
        Ok(ids.into_iter().collect())
    }

    /// Whether run `run_id` has a row, readable or not.
    pub async fn run_exists(&self, run_id: &str) -> Result<bool> {
        Ok(run::Entity::find_by_id(run_id.to_string())
            .count(&self.conn())
            .await?
            > 0)
    }
}
