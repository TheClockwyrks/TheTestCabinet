//! Adversarial tournaments, recorded from the moment the arena accepts one (the
//! arena overview's "Durable tournaments" and the API's "Tournaments").
//!
//! A tournament is a `tournament` row and one `tournament_match` row per pairing
//! of its field. The arena records the field and its pairings first, in state
//! `queued`, then each match's summary as it completes, and finally the standings,
//! which moves it to `succeeded`. Until then the row's record holds the field
//! alone, and a read assembles the recorded matches from the pairing rows; at
//! success the whole record is written to the row. Tournaments are live-only, so
//! nothing here marks the snapshot dirty.

use sea_orm::ActiveValue::Set;
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
    TransactionTrait,
};
use test_cabinet_contracts::match_play::{
    MatchSummary, PendingTournament, RecordedTournament, TournamentPairing, TournamentRecord,
    TournamentState, TournamentTransition,
};
use test_cabinet_entities::{tournament, tournament_match};

use super::Db;
use crate::error::{BackendError, Result};

/// How many pairings one insert writes.
const PAIRING_CHUNK: usize = 1000;

/// What recording a pending tournament came to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PendingRecorded {
    /// The tournament was newly recorded.
    Recorded,
    /// The same tournament was already recorded; nothing changed.
    Unchanged,
}

impl Db {
    /// Record a pending tournament in state `queued`: its field, with every pairing
    /// as a match without a result. A repeat with identical content changes
    /// nothing, and a different tournament under a recorded id is a
    /// [`BackendError::Conflict`].
    pub async fn record_pending_tournament(
        &self,
        pending: &PendingTournament,
        recorded_at: &str,
    ) -> Result<PendingRecorded> {
        let txn = self.conn().begin().await?;
        if let Some(existing) = recorded(&txn, &pending.id).await? {
            if same_field(&existing, pending) {
                return Ok(PendingRecorded::Unchanged);
            }
            return Err(BackendError::Conflict(format!(
                "tournament `{}` is already recorded with a different field",
                pending.id
            )));
        }
        let record = TournamentRecord {
            id: pending.id.clone(),
            created_at: pending.created_at.clone(),
            test_case_slug: pending.test_case_slug.clone(),
            test_case_version: pending.test_case_version.clone(),
            variant: pending.variant.clone(),
            participants: pending.participants.clone(),
            standings: Vec::new(),
            matches: Vec::new(),
        };
        tournament::Entity::insert(tournament::ActiveModel {
            id: Set(pending.id.clone()),
            published_at: Set(recorded_at.to_string()),
            created_at: Set(pending.created_at.clone()),
            test_case_slug: Set(pending.test_case_slug.clone()),
            test_case_version: Set(pending.test_case_version.clone()),
            variant: Set(pending.variant.clone()),
            participant_count: Set(pending.participants.len() as i32),
            record_json: Set(serde_json::to_string(&record)?),
            state: Set(TournamentState::Queued.as_str().to_string()),
            detail: Set(None),
        })
        .exec_without_returning(&txn)
        .await?;
        // Inserted in chunks, so a large field stays under PostgreSQL's limit on a
        // statement's bind parameters (six a row).
        for (chunk_index, chunk) in pending.pairings.chunks(PAIRING_CHUNK).enumerate() {
            let rows =
                chunk
                    .iter()
                    .enumerate()
                    .map(|(offset, pairing)| tournament_match::ActiveModel {
                        tournament_id: Set(pending.id.clone()),
                        match_id: Set(pairing.match_id.clone()),
                        ordinal: Set((chunk_index * PAIRING_CHUNK + offset) as i32),
                        red_id: Set(pairing.red_id.clone()),
                        blue_id: Set(pairing.blue_id.clone()),
                        summary_json: Set(None),
                    });
            tournament_match::Entity::insert_many(rows)
                .exec_without_returning(&txn)
                .await?;
        }
        txn.commit().await?;
        Ok(PendingRecorded::Recorded)
    }

    /// Record one pairing's result, overwriting one already recorded. A `queued`
    /// tournament becomes `running`. An unknown tournament or pairing is
    /// [`BackendError::NotFound`], a summary naming another pairing
    /// [`BackendError::BadRequest`], and a terminal tournament
    /// [`BackendError::Conflict`] unless the summary is the one it holds.
    pub async fn record_tournament_match(
        &self,
        tournament_id: &str,
        match_id: &str,
        summary: &MatchSummary,
    ) -> Result<()> {
        let txn = self.conn().begin().await?;
        let row = tournament_row(&txn, tournament_id).await?;
        let pairing =
            tournament_match::Entity::find_by_id((tournament_id.to_string(), match_id.to_string()))
                .one(&txn)
                .await?
                .ok_or_else(|| {
                    BackendError::NotFound(format!(
                        "tournament `{tournament_id}` has no pairing `{match_id}`"
                    ))
                })?;
        if summary.match_id != pairing.match_id
            || summary.red_id != pairing.red_id
            || summary.blue_id != pairing.blue_id
        {
            return Err(BackendError::BadRequest(format!(
                "the summary is of `{}` ({} against {}), not of pairing `{match_id}` ({} \
                 against {})",
                summary.match_id, summary.red_id, summary.blue_id, pairing.red_id, pairing.blue_id
            )));
        }
        let summary_json = serde_json::to_string(summary)?;
        let state = row_state(&row)?;
        if state.is_terminal() {
            let held = pairing
                .summary_json
                .as_deref()
                .map(serde_json::from_str::<MatchSummary>)
                .transpose()?;
            if held.as_ref() == Some(summary) {
                return Ok(());
            }
            return Err(BackendError::Conflict(format!(
                "tournament `{tournament_id}` is {} and takes no new result",
                state.as_str()
            )));
        }
        tournament_match::Entity::update(tournament_match::ActiveModel {
            tournament_id: Set(tournament_id.to_string()),
            match_id: Set(match_id.to_string()),
            summary_json: Set(Some(summary_json)),
            ..Default::default()
        })
        .exec(&txn)
        .await?;
        if state == TournamentState::Queued {
            set_state(&txn, tournament_id, TournamentState::Running, None).await?;
        }
        txn.commit().await?;
        Ok(())
    }

    /// Move a tournament's state. `succeeded` is a [`BackendError::Conflict`]
    /// while any pairing lacks a result, and a terminal tournament takes only a
    /// repeat of its own state, which changes nothing.
    pub async fn transition_tournament(
        &self,
        tournament_id: &str,
        transition: &TournamentTransition,
        at: &str,
    ) -> Result<()> {
        let txn = self.conn().begin().await?;
        let row = tournament_row(&txn, tournament_id).await?;
        let state = row_state(&row)?;
        let target = transition.state();
        if state.is_terminal() {
            if state == target {
                return Ok(());
            }
            return Err(BackendError::Conflict(format!(
                "tournament `{tournament_id}` is {} and cannot become {}",
                state.as_str(),
                target.as_str()
            )));
        }
        match transition {
            TournamentTransition::Running => {
                if state != TournamentState::Running {
                    set_state(&txn, tournament_id, TournamentState::Running, None).await?;
                }
            }
            TournamentTransition::Failed { detail } => {
                set_state(
                    &txn,
                    tournament_id,
                    TournamentState::Failed,
                    Some(detail.clone()),
                )
                .await?;
            }
            TournamentTransition::Succeeded { standings } => {
                let pairings = pairing_rows(&txn, tournament_id).await?;
                let unplayed: Vec<&str> = pairings
                    .iter()
                    .filter(|pairing| pairing.summary_json.is_none())
                    .map(|pairing| pairing.match_id.as_str())
                    .collect();
                if !unplayed.is_empty() {
                    return Err(BackendError::Conflict(format!(
                        "tournament `{tournament_id}` cannot succeed with pairings unplayed: {}",
                        unplayed.join(", ")
                    )));
                }
                let mut record: TournamentRecord = serde_json::from_str(&row.record_json)?;
                record.matches = recorded_matches(&pairings)?;
                record.standings = standings.clone();
                tournament::Entity::update(tournament::ActiveModel {
                    id: Set(tournament_id.to_string()),
                    record_json: Set(serde_json::to_string(&record)?),
                    state: Set(TournamentState::Succeeded.as_str().to_string()),
                    detail: Set(None),
                    published_at: Set(at.to_string()),
                    ..Default::default()
                })
                .exec(&txn)
                .await?;
            }
        }
        txn.commit().await?;
        Ok(())
    }

    /// One recorded tournament in any state.
    pub async fn get_tournament(&self, id: &str) -> Result<Option<RecordedTournament>> {
        recorded(&self.conn(), id).await
    }

    /// The succeeded tournaments newest-first (by `published_at`), paginated by a
    /// `published_at` cursor, the same scheme as [`Db::list_published`].
    pub async fn list_tournaments(
        &self,
        limit: usize,
        before: Option<&str>,
    ) -> Result<(Vec<RecordedTournament>, Option<String>)> {
        let fetch = limit.saturating_add(1);
        let mut query = tournament::Entity::find()
            .filter(tournament::Column::State.eq(TournamentState::Succeeded.as_str()));
        if let Some(before) = before {
            query = query.filter(tournament::Column::PublishedAt.lt(before));
        }
        let rows = query
            .order_by_desc(tournament::Column::PublishedAt)
            .order_by_desc(tournament::Column::Id)
            .limit(fetch as u64)
            .all(&self.conn())
            .await?;
        let mut tournaments = Vec::with_capacity(rows.len());
        for row in rows {
            tournaments.push(assemble(&self.conn(), row).await?);
        }
        let next_before = if tournaments.len() > limit {
            tournaments.truncate(limit);
            tournaments.last().map(|t| t.published_at.clone())
        } else {
            None
        };
        Ok((tournaments, next_before))
    }

    /// Every `queued` and `running` tournament, oldest first: the ones an arena
    /// resumes on start.
    pub async fn unfinished_tournaments(&self) -> Result<Vec<RecordedTournament>> {
        let rows = tournament::Entity::find()
            .filter(tournament::Column::State.is_in([
                TournamentState::Queued.as_str(),
                TournamentState::Running.as_str(),
            ]))
            .order_by_asc(tournament::Column::CreatedAt)
            .order_by_asc(tournament::Column::Id)
            .all(&self.conn())
            .await?;
        let mut tournaments = Vec::with_capacity(rows.len());
        for row in rows {
            tournaments.push(assemble(&self.conn(), row).await?);
        }
        Ok(tournaments)
    }
}

/// The `tournament` row of `id`, or [`BackendError::NotFound`].
async fn tournament_row(conn: &impl ConnectionTrait, id: &str) -> Result<tournament::Model> {
    tournament::Entity::find_by_id(id.to_string())
        .one(conn)
        .await?
        .ok_or_else(|| BackendError::NotFound(format!("tournament `{id}` not found")))
}

/// The recorded tournament `id`, assembled from its rows.
async fn recorded(conn: &impl ConnectionTrait, id: &str) -> Result<Option<RecordedTournament>> {
    match tournament::Entity::find_by_id(id.to_string())
        .one(conn)
        .await?
    {
        Some(row) => Ok(Some(assemble(conn, row).await?)),
        None => Ok(None),
    }
}

/// A tournament's pairing rows, in the order they are played.
async fn pairing_rows(
    conn: &impl ConnectionTrait,
    tournament_id: &str,
) -> Result<Vec<tournament_match::Model>> {
    Ok(tournament_match::Entity::find()
        .filter(tournament_match::Column::TournamentId.eq(tournament_id))
        .order_by_asc(tournament_match::Column::Ordinal)
        .all(conn)
        .await?)
}

/// The summaries of the pairings with a recorded result, in pairing order.
fn recorded_matches(pairings: &[tournament_match::Model]) -> Result<Vec<MatchSummary>> {
    pairings
        .iter()
        .filter_map(|pairing| pairing.summary_json.as_deref())
        .map(|json| serde_json::from_str(json).map_err(BackendError::from))
        .collect()
}

/// Assemble a recorded tournament from its row and its pairing rows. A succeeded
/// tournament's row holds the whole record, so its pairings are those of its
/// matches, which also covers a tournament published before pairings were
/// recorded. Any other holds the field alone, and its matches are the recorded
/// pairing rows.
async fn assemble(
    conn: &impl ConnectionTrait,
    row: tournament::Model,
) -> Result<RecordedTournament> {
    let state = row_state(&row)?;
    let mut record: TournamentRecord = serde_json::from_str(&row.record_json)?;
    let pairings = if state == TournamentState::Succeeded {
        record
            .matches
            .iter()
            .map(|summary| TournamentPairing {
                match_id: summary.match_id.clone(),
                red_id: summary.red_id.clone(),
                blue_id: summary.blue_id.clone(),
            })
            .collect()
    } else {
        let rows = pairing_rows(conn, &row.id).await?;
        record.matches = recorded_matches(&rows)?;
        rows.into_iter()
            .map(|pairing| TournamentPairing {
                match_id: pairing.match_id,
                red_id: pairing.red_id,
                blue_id: pairing.blue_id,
            })
            .collect()
    };
    Ok(RecordedTournament {
        record,
        state,
        detail: row.detail,
        pairings,
        published_at: row.published_at,
    })
}

/// The row's state, refusing a value no release writes.
fn row_state(row: &tournament::Model) -> Result<TournamentState> {
    TournamentState::parse(&row.state).ok_or_else(|| {
        BackendError::Internal(format!(
            "tournament `{}` holds the unknown state `{}`",
            row.id, row.state
        ))
    })
}

/// Whether `existing` was recorded from the same field as `pending`.
fn same_field(existing: &RecordedTournament, pending: &PendingTournament) -> bool {
    let record = &existing.record;
    record.created_at == pending.created_at
        && record.test_case_slug == pending.test_case_slug
        && record.test_case_version == pending.test_case_version
        && record.variant == pending.variant
        && record.participants == pending.participants
        && existing.pairings == pending.pairings
}

/// Set a tournament's state and detail.
async fn set_state(
    conn: &impl ConnectionTrait,
    tournament_id: &str,
    state: TournamentState,
    detail: Option<String>,
) -> Result<()> {
    tournament::Entity::update(tournament::ActiveModel {
        id: Set(tournament_id.to_string()),
        state: Set(state.as_str().to_string()),
        detail: Set(detail),
        ..Default::default()
    })
    .exec(conn)
    .await?;
    Ok(())
}
