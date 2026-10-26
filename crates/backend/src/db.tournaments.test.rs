//! Tests for recording a tournament from acceptance to its standings.

use test_cabinet_contracts::match_play::{
    ControllerKind, ControllerRef, MatchSummary, PendingTournament, Standing, TournamentPairing,
    TournamentRecord, TournamentState, TournamentTransition, match_id,
};
use test_cabinet_contracts::validation::AdversarialOutcome;
use test_cabinet_entities::tournament;

use super::*;
use crate::error::BackendError;

fn pairing(red: &str, blue: &str) -> TournamentPairing {
    TournamentPairing {
        match_id: match_id(red, blue),
        red_id: red.to_string(),
        blue_id: blue.to_string(),
    }
}

/// A pending three-controller field: `a`, `b` and `c`, three pairings.
fn pending(id: &str) -> PendingTournament {
    PendingTournament {
        id: id.to_string(),
        created_at: "2026-10-26T00:00:00Z".to_string(),
        test_case_slug: "foray".to_string(),
        test_case_version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        participants: ["a", "b", "c"]
            .iter()
            .map(|id| ControllerRef {
                id: id.to_string(),
                kind: ControllerKind::Baseline,
                label: None,
            })
            .collect(),
        pairings: vec![pairing("a", "b"), pairing("a", "c"), pairing("b", "c")],
    }
}

/// `red` beat `blue`.
fn won(red: &str, blue: &str) -> MatchSummary {
    MatchSummary {
        match_id: match_id(red, blue),
        red_id: red.to_string(),
        blue_id: blue.to_string(),
        winner: Some(red.to_string()),
        win_type: "swept".to_string(),
        outcome_for_red: AdversarialOutcome::Win,
        red_score: 3,
        blue_score: 0,
        ticks: 100,
        red_kills: 1,
        blue_kills: 0,
        red_fuel: 10,
        blue_fuel: 20,
        replay_key: Some(match_id(red, blue)),
        detail: None,
    }
}

fn standings() -> Vec<Standing> {
    vec![Standing {
        participant_id: "a".to_string(),
        wins: 2,
        losses: 0,
        draws: 0,
        rank: 1,
    }]
}

async fn record_all(db: &Db, id: &str) {
    for (red, blue) in [("a", "b"), ("a", "c"), ("b", "c")] {
        db.record_tournament_match(id, &match_id(red, blue), &won(red, blue))
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn a_pending_tournament_is_queued_with_every_pairing_unplayed() {
    let db = Db::connect_in_memory().await.unwrap();
    let recorded = db
        .record_pending_tournament(&pending("t1"), "2026-10-26T00:00:01Z")
        .await
        .unwrap();
    assert_eq!(recorded, PendingRecorded::Recorded);

    let tournament = db.get_tournament("t1").await.unwrap().unwrap();
    assert_eq!(tournament.state, TournamentState::Queued);
    assert_eq!(tournament.pairings, pending("t1").pairings);
    assert!(tournament.record.matches.is_empty());
    assert!(tournament.record.standings.is_empty());
    assert_eq!(tournament.record.participants.len(), 3);
    assert_eq!(tournament.unplayed_pairings().len(), 3);
    assert_eq!(tournament.published_at, "2026-10-26T00:00:01Z");
}

#[tokio::test]
async fn recording_a_pending_tournament_again_changes_nothing_and_another_field_conflicts() {
    let db = Db::connect_in_memory().await.unwrap();
    db.record_pending_tournament(&pending("t1"), "2026-10-26T00:00:01Z")
        .await
        .unwrap();
    db.record_tournament_match("t1", &match_id("a", "b"), &won("a", "b"))
        .await
        .unwrap();
    let again = db
        .record_pending_tournament(&pending("t1"), "2026-10-26T00:00:09Z")
        .await
        .unwrap();
    assert_eq!(again, PendingRecorded::Unchanged);
    let tournament = db.get_tournament("t1").await.unwrap().unwrap();
    assert_eq!(tournament.record.matches.len(), 1, "a repeat keeps results");
    assert_eq!(tournament.published_at, "2026-10-26T00:00:01Z");

    let mut other = pending("t1");
    other.pairings.pop();
    let err = db
        .record_pending_tournament(&other, "2026-10-26T00:00:09Z")
        .await
        .unwrap_err();
    assert!(matches!(err, BackendError::Conflict(_)), "{err}");
}

#[tokio::test]
async fn a_recorded_match_runs_the_tournament_and_reads_back_in_pairing_order() {
    let db = Db::connect_in_memory().await.unwrap();
    db.record_pending_tournament(&pending("t1"), "2026-10-26T00:00:01Z")
        .await
        .unwrap();
    // Recorded out of pairing order, read back in it.
    db.record_tournament_match("t1", &match_id("b", "c"), &won("b", "c"))
        .await
        .unwrap();
    db.record_tournament_match("t1", &match_id("a", "b"), &won("a", "b"))
        .await
        .unwrap();

    let tournament = db.get_tournament("t1").await.unwrap().unwrap();
    assert_eq!(tournament.state, TournamentState::Running);
    let ids: Vec<&str> = tournament
        .record
        .matches
        .iter()
        .map(|m| m.match_id.as_str())
        .collect();
    assert_eq!(ids, vec!["a__vs__b", "b__vs__c"]);
    let unplayed: Vec<String> = tournament
        .unplayed_pairings()
        .into_iter()
        .map(|p| p.match_id)
        .collect();
    assert_eq!(unplayed, vec![match_id("a", "c")]);

    // Recording a match again overwrites it.
    let mut replayed = won("a", "b");
    replayed.ticks = 7;
    db.record_tournament_match("t1", &match_id("a", "b"), &replayed)
        .await
        .unwrap();
    let tournament = db.get_tournament("t1").await.unwrap().unwrap();
    assert_eq!(tournament.record.matches[0].ticks, 7);
}

#[tokio::test]
async fn a_match_outside_the_field_or_of_another_pairing_is_refused() {
    let db = Db::connect_in_memory().await.unwrap();
    let err = db
        .record_tournament_match("nope", &match_id("a", "b"), &won("a", "b"))
        .await
        .unwrap_err();
    assert!(matches!(err, BackendError::NotFound(_)), "{err}");

    db.record_pending_tournament(&pending("t1"), "2026-10-26T00:00:01Z")
        .await
        .unwrap();
    let err = db
        .record_tournament_match("t1", &match_id("a", "z"), &won("a", "z"))
        .await
        .unwrap_err();
    assert!(matches!(err, BackendError::NotFound(_)), "{err}");
    let err = db
        .record_tournament_match("t1", &match_id("a", "b"), &won("a", "c"))
        .await
        .unwrap_err();
    assert!(matches!(err, BackendError::BadRequest(_)), "{err}");
}

#[tokio::test]
async fn a_tournament_succeeds_only_once_every_pairing_has_a_result() {
    let db = Db::connect_in_memory().await.unwrap();
    db.record_pending_tournament(&pending("t1"), "2026-10-26T00:00:01Z")
        .await
        .unwrap();
    db.record_tournament_match("t1", &match_id("a", "b"), &won("a", "b"))
        .await
        .unwrap();
    let succeed = TournamentTransition::Succeeded {
        standings: standings(),
    };
    let err = db
        .transition_tournament("t1", &succeed, "2026-10-26T01:00:00Z")
        .await
        .unwrap_err();
    assert!(matches!(err, BackendError::Conflict(_)), "{err}");

    record_all(&db, "t1").await;
    db.transition_tournament("t1", &succeed, "2026-10-26T01:00:00Z")
        .await
        .unwrap();
    let tournament = db.get_tournament("t1").await.unwrap().unwrap();
    assert_eq!(tournament.state, TournamentState::Succeeded);
    assert_eq!(tournament.record.standings, standings());
    assert_eq!(tournament.record.matches.len(), 3);
    assert_eq!(tournament.pairings, pending("t1").pairings);
    assert_eq!(tournament.published_at, "2026-10-26T01:00:00Z");

    // A repeat changes nothing; any other move, or a new result, conflicts.
    db.transition_tournament("t1", &succeed, "2026-10-27T00:00:00Z")
        .await
        .unwrap();
    let again = db.get_tournament("t1").await.unwrap().unwrap();
    assert_eq!(again.published_at, "2026-10-26T01:00:00Z");
    let fail = TournamentTransition::Failed {
        detail: "late".to_string(),
    };
    let err = db
        .transition_tournament("t1", &fail, "2026-10-27T00:00:00Z")
        .await
        .unwrap_err();
    assert!(matches!(err, BackendError::Conflict(_)), "{err}");
    db.record_tournament_match("t1", &match_id("a", "b"), &won("a", "b"))
        .await
        .expect("the result it holds is taken again");
    let mut changed = won("a", "b");
    changed.ticks = 1;
    let err = db
        .record_tournament_match("t1", &match_id("a", "b"), &changed)
        .await
        .unwrap_err();
    assert!(matches!(err, BackendError::Conflict(_)), "{err}");
}

#[tokio::test]
async fn a_failed_tournament_carries_its_reason_and_takes_no_result() {
    let db = Db::connect_in_memory().await.unwrap();
    db.record_pending_tournament(&pending("t1"), "2026-10-26T00:00:01Z")
        .await
        .unwrap();
    db.transition_tournament("t1", &TournamentTransition::Running, "x")
        .await
        .unwrap();
    db.transition_tournament(
        "t1",
        &TournamentTransition::Failed {
            detail: "the engine failed".to_string(),
        },
        "x",
    )
    .await
    .unwrap();
    let tournament = db.get_tournament("t1").await.unwrap().unwrap();
    assert_eq!(tournament.state, TournamentState::Failed);
    assert_eq!(tournament.detail.as_deref(), Some("the engine failed"));
    let err = db
        .record_tournament_match("t1", &match_id("a", "b"), &won("a", "b"))
        .await
        .unwrap_err();
    assert!(matches!(err, BackendError::Conflict(_)), "{err}");
    let err = db
        .transition_tournament("t1", &TournamentTransition::Running, "x")
        .await
        .unwrap_err();
    assert!(matches!(err, BackendError::Conflict(_)), "{err}");
}

#[tokio::test]
async fn the_unfinished_are_listed_oldest_first_and_the_gallery_lists_the_succeeded() {
    let db = Db::connect_in_memory().await.unwrap();
    for (id, created) in [
        ("done", "2026-10-26T00:00:00Z"),
        ("late", "2026-10-26T00:00:03Z"),
        ("early", "2026-10-26T00:00:01Z"),
        ("failed", "2026-10-26T00:00:02Z"),
    ] {
        let mut field = pending(id);
        field.created_at = created.to_string();
        db.record_pending_tournament(&field, created).await.unwrap();
    }
    record_all(&db, "done").await;
    db.transition_tournament(
        "done",
        &TournamentTransition::Succeeded {
            standings: standings(),
        },
        "2026-10-26T02:00:00Z",
    )
    .await
    .unwrap();
    db.transition_tournament(
        "failed",
        &TournamentTransition::Failed {
            detail: "x".to_string(),
        },
        "x",
    )
    .await
    .unwrap();
    db.record_tournament_match("late", &match_id("a", "b"), &won("a", "b"))
        .await
        .unwrap();

    let unfinished = db.unfinished_tournaments().await.unwrap();
    let ids: Vec<&str> = unfinished.iter().map(|t| t.record.id.as_str()).collect();
    assert_eq!(ids, vec!["early", "late"]);
    assert_eq!(unfinished[1].record.matches.len(), 1, "results come along");

    let (page, next) = db.list_tournaments(50, None).await.unwrap();
    let ids: Vec<&str> = page.iter().map(|t| t.record.id.as_str()).collect();
    assert_eq!(ids, vec!["done"]);
    assert_eq!(next, None);
}

#[tokio::test]
async fn the_gallery_pages_newest_first() {
    let db = Db::connect_in_memory().await.unwrap();
    for (id, at) in [
        ("t1", "2026-06-21T10:00:00Z"),
        ("t2", "2026-06-21T11:00:00Z"),
    ] {
        db.record_pending_tournament(&pending(id), at)
            .await
            .unwrap();
        record_all(&db, id).await;
        db.transition_tournament(
            id,
            &TournamentTransition::Succeeded {
                standings: standings(),
            },
            at,
        )
        .await
        .unwrap();
    }
    let (page, next) = db.list_tournaments(1, None).await.unwrap();
    assert_eq!(page[0].record.id, "t2", "newest first");
    let cursor = next.expect("a second page remains");
    let (page2, _) = db.list_tournaments(1, Some(&cursor)).await.unwrap();
    assert_eq!(page2[0].record.id, "t1");
}

#[tokio::test]
async fn a_tournament_published_before_pairings_were_recorded_reads_its_pairings_from_its_matches()
{
    let db = Db::connect_in_memory().await.unwrap();
    let record = TournamentRecord {
        id: "old".to_string(),
        created_at: "2026-06-21T00:00:00Z".to_string(),
        test_case_slug: "foray".to_string(),
        test_case_version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        participants: pending("old").participants,
        standings: standings(),
        matches: vec![won("a", "b"), won("a", "c"), won("b", "c")],
    };
    // A row as the earlier release wrote it, which the migration marks succeeded.
    tournament::Entity::insert(tournament::ActiveModel {
        id: Set("old".to_string()),
        published_at: Set("2026-06-21T00:00:00Z".to_string()),
        created_at: Set(record.created_at.clone()),
        test_case_slug: Set(record.test_case_slug.clone()),
        test_case_version: Set(record.test_case_version.clone()),
        variant: Set(record.variant.clone()),
        participant_count: Set(3),
        record_json: Set(serde_json::to_string(&record).unwrap()),
        state: Set("succeeded".to_string()),
        detail: Set(None),
    })
    .exec_without_returning(&db.conn())
    .await
    .unwrap();

    let tournament = db.get_tournament("old").await.unwrap().unwrap();
    assert_eq!(tournament.state, TournamentState::Succeeded);
    assert_eq!(tournament.record, record);
    assert_eq!(tournament.pairings, pending("old").pairings);
}
