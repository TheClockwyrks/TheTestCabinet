//! A run's tool-call tally for a comparison: loading the held runs without their
//! event streams, and counting a Codex or gg run that was stored before its
//! harness was counted (docs/comparisons/diagnostics.md, "Counting an earlier
//! run").
//!
//! A run is counted once. Its tally is written into its stored record and its
//! `tool_calls_counted` flag is set, so every later load reads the stored tally.

use std::collections::{BTreeMap, HashMap};

use sea_orm::sea_query::Expr;
use sea_orm::{ColumnTrait, EntityTrait, Iterable, QueryFilter, QuerySelect, TransactionTrait};
use test_cabinet_contracts::event::HarnessEvent;
use test_cabinet_contracts::run_record::{HarnessSlug, RunRecord};
use test_cabinet_contracts::tool_tally;
use test_cabinet_entities::run;

use super::{Db, StoredRun, readable_runs, set_dirty, touch_run};
use crate::error::Result;

/// The `tool_calls_counted` a push stores for `record`.
///
/// A record's tally is counted as its run streams, so a pushed record is counted,
/// except a Codex or gg record whose tally is empty: that is either a run that made
/// no tool calls or one recorded before its harness was counted, and only its event
/// stream can tell which, so it is left to be counted on load.
pub(super) fn tool_calls_counted(record: &RunRecord) -> bool {
    !(tool_tally::counted_from_events(record.subject.harness_slug) && record.tool_calls.is_empty())
}

/// The record key the tally is stored under in `record_json`.
const TOOL_CALLS_KEY: &str = "toolCalls";

impl Db {
    /// The stored runs with these ids, in the order given, read as
    /// [`Db::get_runs`] reads them but without each run's event stream, which a
    /// comparison never shows and is the largest thing a run stores. The returned
    /// runs carry no `events_json`.
    pub async fn get_runs_without_events(&self, ids: &[String]) -> Result<Vec<StoredRun>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut by_id: HashMap<String, run::Model> = readable_runs()
            .select_only()
            .columns(
                run::Column::iter().filter(|column| !matches!(column, run::Column::EventsJson)),
            )
            .column_as(Expr::value(Option::<String>::None), run::Column::EventsJson)
            .filter(run::Column::Id.is_in(ids.iter().map(String::as_str)))
            .into_model::<run::Model>()
            .all(&self.conn())
            .await?
            .into_iter()
            .map(|run| (run.id.clone(), run))
            .collect();
        let ordered: Vec<run::Model> = ids.iter().filter_map(|id| by_id.remove(id)).collect();
        self.assemble(ordered).await
    }

    /// Count the tool calls of every Codex or gg run among `runs` whose tally was
    /// never counted, store each tally and set its flag, and put the tally on the
    /// run's record in `runs`.
    ///
    /// A run whose event stream this build cannot decode is left uncounted, and is
    /// tried again on the next load.
    pub async fn count_uncounted_tool_calls(
        &self,
        runs: &mut BTreeMap<String, RunRecord>,
    ) -> Result<()> {
        let harnesses = [HarnessSlug::Codex, HarnessSlug::Gg].map(|slug| slug.as_str());
        let uncounted: Vec<String> = run::Entity::find()
            .select_only()
            .column(run::Column::Id)
            .filter(run::Column::Id.is_in(runs.keys().map(String::as_str)))
            .filter(run::Column::HarnessSlug.is_in(harnesses))
            .filter(run::Column::ToolCallsCounted.eq(false))
            .into_tuple()
            .all(&self.conn())
            .await?;
        for id in uncounted {
            let Some(record) = runs.get_mut(&id) else {
                continue;
            };
            if let Some(tally) = self
                .count_tool_calls(&id, record.subject.harness_slug)
                .await?
            {
                record.tool_calls = tally;
            }
        }
        Ok(())
    }

    /// Count one run's tool calls off its stored event stream and store the tally
    /// and the flag, returning the tally; `None` when the run is gone or its event
    /// stream does not decode.
    ///
    /// The tally is written into the stored record as its `toolCalls` key alone,
    /// so nothing else in the record is rewritten.
    async fn count_tool_calls(
        &self,
        id: &str,
        harness: HarnessSlug,
    ) -> Result<Option<BTreeMap<String, u64>>> {
        let txn = self.conn().begin().await?;
        let row: Option<(String, Option<String>, bool)> = run::Entity::find_by_id(id.to_string())
            .select_only()
            .columns([
                run::Column::RecordJson,
                run::Column::EventsJson,
                run::Column::Published,
            ])
            .into_tuple()
            .one(&txn)
            .await?;
        let Some((record_json, events_json, published)) = row else {
            return Ok(None);
        };
        let events: Vec<HarnessEvent> = match events_json.as_deref().map(serde_json::from_str) {
            None => Vec::new(),
            Some(Ok(events)) => events,
            Some(Err(error)) => {
                tracing::warn!(run = id, %error, "a run's event stream does not decode; its tool calls stay uncounted");
                return Ok(None);
            }
        };
        let Some(tally) = tool_tally::tool_calls_from_events(harness, &events) else {
            return Ok(None);
        };

        let mut record: serde_json::Value = serde_json::from_str(&record_json)?;
        let Some(fields) = record.as_object_mut() else {
            return Ok(None);
        };
        if tally.is_empty() {
            fields.remove(TOOL_CALLS_KEY);
        } else {
            fields.insert(TOOL_CALLS_KEY.to_string(), serde_json::to_value(&tally)?);
        }
        run::Entity::update_many()
            .col_expr(
                run::Column::RecordJson,
                Expr::value(serde_json::to_string(&record)?),
            )
            .col_expr(run::Column::ToolCallsCounted, Expr::value(true))
            .filter(run::Column::Id.eq(id))
            .exec(&txn)
            .await?;
        touch_run(&txn, id).await?;
        // A published run's public record changed with it.
        if published {
            set_dirty(&txn).await?;
        }
        txn.commit().await?;
        Ok(Some(tally))
    }
}
