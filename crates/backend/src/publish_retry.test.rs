//! The retry schedule: the wait table, the end of a run's retries, and which runs a
//! set of publish jobs makes candidates.

use test_cabinet_entities::publish_job;
use time::format_description::well_known::Rfc3339;
use time::macros::datetime;
use time::{Duration, OffsetDateTime};

use super::*;

const T: OffsetDateTime = datetime!(2026-10-01 00:00:00 UTC);

fn at(offset: Duration) -> String {
    (T + offset).format(&Rfc3339).unwrap()
}

/// A publish job of `run_id` created at `T + created` and last updated at
/// `T + updated`.
fn job(
    id: &str,
    run_id: &str,
    state: &str,
    created: Duration,
    updated: Duration,
) -> publish_job::Model {
    publish_job::Model {
        id: id.to_string(),
        state: state.to_string(),
        run_id: run_id.to_string(),
        job_token: format!("token-{id}"),
        source_repo: None,
        playable_build: None,
        detail: None,
        created_at: at(created),
        updated_at: at(updated),
        lease_expires_at: None,
    }
}

fn failed_run(consecutive_failures: u32, first: Duration, last: Duration) -> FailedRun {
    FailedRun {
        run_id: "run".to_string(),
        consecutive_failures,
        first_failed_at: T + first,
        last_failed_at: T + last,
    }
}

#[test]
fn the_wait_doubles_from_five_minutes_up_to_four_hours() {
    let minutes: Vec<i64> = (1..=8).map(|n| retry_wait(n).whole_minutes()).collect();
    assert_eq!(minutes, [5, 10, 20, 40, 80, 160, 240, 240]);
    assert_eq!(retry_wait(50), MAX_RETRY_WAIT);
    assert_eq!(retry_wait(u32::MAX), MAX_RETRY_WAIT);
}

#[test]
fn a_run_is_due_once_its_wait_has_passed() {
    let run = failed_run(1, Duration::ZERO, Duration::ZERO);
    assert!(!run.due(T));
    assert!(!run.due(T + Duration::minutes(5) - Duration::seconds(1)));
    assert!(run.due(T + Duration::minutes(5)));
    assert!(run.due(T + Duration::hours(3)));

    let third = failed_run(3, Duration::ZERO, Duration::hours(1));
    assert!(!third.due(T + Duration::hours(1) + Duration::minutes(19)));
    assert!(third.due(T + Duration::hours(1) + Duration::minutes(20)));
}

#[test]
fn the_retries_end_a_day_after_the_first_failure() {
    let run = failed_run(1, Duration::ZERO, Duration::ZERO);
    assert!(run.due(T + Duration::hours(24) - Duration::seconds(1)));
    assert!(!run.due(T + Duration::hours(24)));
    assert!(!run.due(T + Duration::hours(30)));

    // The latest failure's wait runs out exactly at the end: no retry.
    let late = failed_run(
        1,
        Duration::ZERO,
        Duration::hours(23) + Duration::minutes(55),
    );
    assert!(!late.due(late.retry_at()));

    // A seventh failure's four hours run past the end: it is never due.
    let seventh = failed_run(7, Duration::ZERO, Duration::hours(21));
    for hours in 21..30 {
        assert!(!seventh.due(T + Duration::hours(hours)), "due at {hours} h");
    }
}

#[test]
fn consecutive_failures_count_back_from_the_latest_job() {
    let jobs = [
        job("a", "run", "failed", Duration::ZERO, Duration::minutes(1)),
        job(
            "b",
            "run",
            "succeeded",
            Duration::minutes(10),
            Duration::minutes(11),
        ),
        job(
            "c",
            "run",
            "failed",
            Duration::minutes(20),
            Duration::minutes(21),
        ),
        job(
            "d",
            "run",
            "failed",
            Duration::minutes(40),
            Duration::minutes(41),
        ),
    ];
    let runs = failed_runs(&jobs);
    assert_eq!(
        runs,
        [FailedRun {
            run_id: "run".to_string(),
            consecutive_failures: 2,
            // The budget runs from the run's first failed publish job.
            first_failed_at: T + Duration::minutes(1),
            last_failed_at: T + Duration::minutes(41),
        }]
    );
}

#[test]
fn the_latest_job_is_the_latest_created_whatever_the_row_order() {
    // Listed newest first, and with offsets the text order would misplace.
    let jobs = [
        job(
            "b",
            "run",
            "failed",
            Duration::minutes(30),
            Duration::minutes(31),
        ),
        job(
            "a",
            "run",
            "succeeded",
            Duration::ZERO,
            Duration::minutes(1),
        ),
    ];
    let mut shifted = jobs.clone();
    // The older job's creation, written five hours ahead, sorts last as text.
    let plus_five = time::UtcOffset::from_hms(5, 0, 0).unwrap();
    shifted[1].created_at = T.to_offset(plus_five).format(&Rfc3339).unwrap();
    assert!(shifted[1].created_at > shifted[0].created_at);
    for jobs in [jobs, shifted] {
        let runs = failed_runs(&jobs);
        assert_eq!(runs.len(), 1, "{jobs:?}");
        assert_eq!(runs[0].consecutive_failures, 1);
    }

    // Two jobs created at one instant are ordered by id.
    let tied = [
        job("y", "run", "failed", Duration::ZERO, Duration::minutes(2)),
        job(
            "x",
            "run",
            "succeeded",
            Duration::ZERO,
            Duration::minutes(1),
        ),
    ];
    assert_eq!(failed_runs(&tied).len(), 1);
    let tied = [
        job("x", "run", "failed", Duration::ZERO, Duration::minutes(2)),
        job(
            "y",
            "run",
            "succeeded",
            Duration::ZERO,
            Duration::minutes(1),
        ),
    ];
    assert!(failed_runs(&tied).is_empty());
}

#[test]
fn a_run_with_a_job_in_flight_or_a_latest_success_is_no_candidate() {
    for in_flight in ["queued", "dispatched"] {
        let jobs = [
            job("a", "run", "failed", Duration::ZERO, Duration::minutes(1)),
            job(
                "b",
                "run",
                in_flight,
                Duration::minutes(10),
                Duration::minutes(10),
            ),
        ];
        assert!(failed_runs(&jobs).is_empty(), "{in_flight}");
    }
    let jobs = [
        job("a", "run", "failed", Duration::ZERO, Duration::minutes(1)),
        job(
            "b",
            "run",
            "succeeded",
            Duration::minutes(10),
            Duration::minutes(11),
        ),
    ];
    assert!(failed_runs(&jobs).is_empty());
    assert!(failed_runs(&[]).is_empty());
}

#[test]
fn each_run_is_judged_on_its_own_jobs() {
    let jobs = [
        job("a", "one", "failed", Duration::ZERO, Duration::minutes(1)),
        job(
            "b",
            "two",
            "queued",
            Duration::minutes(1),
            Duration::minutes(1),
        ),
        job(
            "c",
            "three",
            "failed",
            Duration::minutes(2),
            Duration::minutes(3),
        ),
        job("d", "two", "failed", Duration::ZERO, Duration::minutes(1)),
    ];
    let ids: Vec<String> = failed_runs(&jobs)
        .into_iter()
        .map(|run| run.run_id)
        .collect();
    assert_eq!(ids, ["one", "three"]);
}

#[test]
fn a_run_with_an_unreadable_instant_is_no_candidate() {
    let mut created = job("a", "run", "failed", Duration::ZERO, Duration::minutes(1));
    created.created_at = "yesterday".to_string();
    assert!(failed_runs(&[created]).is_empty());

    let mut updated = job("a", "run", "failed", Duration::ZERO, Duration::minutes(1));
    updated.updated_at = "yesterday".to_string();
    assert!(failed_runs(&[updated]).is_empty());
}
