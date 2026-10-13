//! Tests for the publish rules: one run's retry schedule, the hold several
//! failing runs put on new runs, and the probe of a held queue. Every instant is
//! given, so nothing here reads a clock.

use time::macros::datetime;

use super::*;

/// The instant every test counts its minutes from.
const T0: OffsetDateTime = datetime!(2026-10-01 00:00:00 UTC);

/// `minutes` after [`T0`].
fn at(minutes: i64) -> OffsetDateTime {
    T0 + Duration::minutes(minutes)
}

/// A publish job of `run` in `state` whose last transition was `minutes` after
/// [`T0`].
fn job(id: &str, run: &str, state: &str, minutes: i64) -> publish_job::Model {
    let stamp = at(minutes).format(&Rfc3339).unwrap();
    publish_job::Model {
        id: id.to_string(),
        state: state.to_string(),
        run_id: run.to_string(),
        job_token: format!("token-{id}"),
        source_repo: None,
        playable_build: None,
        detail: (state == "failed").then(|| format!("error of {id}")),
        created_at: stamp.clone(),
        updated_at: stamp,
    }
}

/// Facts over `jobs` in which every run named is releasable.
fn facts(jobs: Vec<publish_job::Model>) -> PublishFacts {
    let releasable = jobs.iter().map(|job| job.run_id.clone()).collect();
    PublishFacts {
        jobs,
        releasable,
        last_success: None,
    }
}

/// One failed job for each of `runs`, a minute apart from [`T0`].
fn one_failure_each(runs: &[&str]) -> Vec<publish_job::Model> {
    runs.iter()
        .enumerate()
        .map(|(index, run)| job(&format!("p-{run}"), run, "failed", index as i64))
        .collect()
}

// --- One run's schedule -----------------------------------------------------

#[test]
fn the_wait_starts_at_five_minutes_doubles_and_stops_at_four_hours() {
    let minutes = |failures| retry_wait(failures).whole_minutes();
    assert_eq!(minutes(1), 5);
    assert_eq!(minutes(2), 10);
    assert_eq!(minutes(3), 20);
    assert_eq!(minutes(4), 40);
    assert_eq!(minutes(5), 80);
    assert_eq!(minutes(6), 160);
    assert_eq!(minutes(7), 240, "320 minutes is past the four-hour cap");
    assert_eq!(minutes(8), 240);
    assert_eq!(
        minutes(u32::MAX),
        240,
        "a long streak neither overflows nor loops"
    );
    assert_eq!(
        minutes(0),
        5,
        "a streak is never empty, and this is not a panic"
    );
}

#[test]
fn a_run_is_retried_five_minutes_after_its_first_failure_and_not_before() {
    let assessment = assess(&facts(vec![job("p1", "r1", "failed", 0)]), 5, at(0));
    let [run] = assessment.failed_runs.as_slice() else {
        panic!("one failed run, got {:?}", assessment.failed_runs);
    };
    assert_eq!(run.consecutive_failures, 1);
    assert_eq!(run.retry_at(), at(5));
    assert!(!run.due(at(0)));
    assert!(!run.due(at(5) - Duration::seconds(1)));
    assert!(run.due(at(5)), "due at the boundary itself");
    assert!(run.due(at(6)));
}

#[test]
fn each_consecutive_failure_doubles_the_wait_from_the_latest_failure() {
    let jobs = vec![
        job("p1", "r1", "failed", 0),
        job("p2", "r1", "failed", 5),
        job("p3", "r1", "failed", 15),
    ];
    let assessment = assess(&facts(jobs), 5, at(15));
    let run = &assessment.failed_runs[0];
    assert_eq!(run.consecutive_failures, 3);
    assert_eq!(run.first_failed_at, at(0));
    assert_eq!(run.last_failed_at, at(15));
    assert_eq!(
        run.retry_at(),
        at(35),
        "twenty minutes after the third failure"
    );
    assert!(!run.due(at(34)));
    assert!(run.due(at(35)));
}

#[test]
fn the_rows_are_ordered_by_instant_whatever_order_they_arrive_in() {
    let jobs = vec![
        job("p3", "r1", "failed", 15),
        job("p1", "r1", "failed", 0),
        job("p2", "r1", "failed", 5),
    ];
    let run = &assess(&facts(jobs), 5, at(15)).failed_runs[0];
    assert_eq!((run.first_failed_at, run.last_failed_at), (at(0), at(15)));
}

#[test]
fn retries_end_twenty_four_hours_after_the_first_failure() {
    let day = 24 * 60;
    // The seventh failure, four hours before the budget ends.
    let mut jobs: Vec<_> = (0..6)
        .map(|index| job(&format!("p{index}"), "r1", "failed", index))
        .collect();
    jobs.push(job("p6", "r1", "failed", day - 240));
    let run = assess(&facts(jobs), 5, at(day)).failed_runs[0].clone();
    assert_eq!(
        run.retry_at(),
        at(day),
        "four hours after the latest failure"
    );

    assert!(!run.due(at(day) - Duration::seconds(1)), "still waiting");
    assert!(run.within_budget(at(day) - Duration::seconds(1)));
    assert!(
        !run.within_budget(at(day)),
        "twenty-four hours after the first failure the budget is spent"
    );
    assert!(
        !run.due(at(day)),
        "the wait has passed, and the budget with it"
    );
    assert!(!run.due(at(day + 600)));
}

#[test]
fn a_success_of_the_run_starts_its_streak_again() {
    let jobs = vec![
        job("p1", "r1", "failed", 0),
        job("p2", "r1", "succeeded", 5),
        job("p3", "r1", "failed", 60),
    ];
    let run = &assess(&facts(jobs), 5, at(60)).failed_runs[0];
    assert_eq!(run.consecutive_failures, 1);
    assert_eq!(run.first_failed_at, at(60));
}

#[test]
fn a_run_with_a_publish_job_in_flight_is_no_candidate() {
    for state in ["queued", "dispatched"] {
        let jobs = vec![job("p1", "r1", "failed", 0), job("p2", "r1", state, 5)];
        let assessment = assess(&facts(jobs), 5, at(600));
        assert!(
            assessment.failed_runs.is_empty(),
            "a {state} job is the run's attempt"
        );
        assert!(assessment.in_flight);
    }
}

#[test]
fn a_run_whose_latest_job_succeeded_is_no_candidate() {
    let jobs = vec![
        job("p1", "r1", "failed", 0),
        job("p2", "r1", "succeeded", 5),
    ];
    assert!(assess(&facts(jobs), 5, at(600)).failed_runs.is_empty());
}

#[test]
fn a_run_that_cannot_be_released_is_neither_retried_nor_counted() {
    let mut facts = facts(one_failure_each(&["r1", "r2", "r3"]));
    facts.releasable.remove("r2");
    let assessment = assess(&facts, 2, at(600));
    let retried: Vec<&str> = assessment
        .failed_runs
        .iter()
        .map(|run| run.run_id.as_str())
        .collect();
    assert_eq!(retried, ["r1", "r3"]);
    assert_eq!(
        assessment
            .hold
            .expect("two releasable runs failed")
            .failing_runs,
        2
    );
}

#[test]
fn the_failed_runs_come_oldest_streak_first() {
    let jobs = vec![
        job("p1", "late", "failed", 30),
        job("p2", "early", "failed", 0),
        job("p3", "early", "failed", 40),
    ];
    let order: Vec<String> = assess(&facts(jobs), 5, at(60))
        .failed_runs
        .into_iter()
        .map(|run| run.run_id)
        .collect();
    assert_eq!(order, ["early", "late"]);
}

#[test]
fn a_held_queue_probes_the_run_attempted_longest_ago() {
    // `early` began failing first and was attempted again last, so it is the
    // oldest streak and the most recent attempt.
    let jobs = vec![
        job("p1", "late", "failed", 30),
        job("p2", "early", "failed", 0),
        job("p3", "early", "failed", 40),
        job("p4", "middle", "failed", 35),
    ];
    let assessment = assess(&facts(jobs), 5, at(60));
    let order: Vec<&str> = assessment
        .probe_order()
        .into_iter()
        .map(|run| run.run_id.as_str())
        .collect();
    assert_eq!(order, ["late", "middle", "early"]);
}

// --- The hold ---------------------------------------------------------------

#[test]
fn five_different_runs_failing_in_a_row_hold_new_runs() {
    let four = assess(&facts(one_failure_each(&["a", "b", "c", "d"])), 5, at(10));
    assert_eq!(four.hold, None, "four runs are one short");

    let five = assess(
        &facts(one_failure_each(&["a", "b", "c", "d", "e"])),
        5,
        at(10),
    );
    assert_eq!(
        five.hold,
        Some(PublishHold {
            failing_runs: 5,
            latest_error: Some("error of p-e".to_string()),
        })
    );
}

#[test]
fn one_run_failing_over_and_over_never_holds() {
    let jobs: Vec<_> = (0..40)
        .map(|index| job(&format!("p{index}"), "r1", "failed", index))
        .collect();
    assert_eq!(assess(&facts(jobs), 5, at(60)).hold, None);
}

#[test]
fn four_runs_failing_repeatedly_do_not_hold_either() {
    let mut jobs = Vec::new();
    for round in 0..5 {
        for (index, run) in ["a", "b", "c", "d"].iter().enumerate() {
            let minutes = round * 10 + index as i64;
            jobs.push(job(&format!("p{round}{run}"), run, "failed", minutes));
        }
    }
    assert_eq!(assess(&facts(jobs), 5, at(600)).hold, None);
}

#[test]
fn a_success_among_the_failures_starts_the_count_again() {
    let mut facts = facts(one_failure_each(&["a", "b", "c", "d", "e"]));
    // A publish succeeded after the third failure.
    facts.last_success = Some(at(2) + Duration::seconds(30));
    assert_eq!(assess(&facts, 5, at(10)).hold, None, "two runs since");

    facts.last_success = Some(at(4) + Duration::seconds(1));
    assert_eq!(assess(&facts, 5, at(10)).hold, None, "none since");

    facts.last_success = Some(T0 - Duration::seconds(1));
    assert!(assess(&facts, 5, at(10)).hold.is_some(), "all five since");
}

#[test]
fn a_failure_at_the_instant_of_the_success_is_before_it() {
    let mut facts = facts(one_failure_each(&["a", "b"]));
    facts.last_success = Some(at(1));
    assert_eq!(assess(&facts, 1, at(10)).hold, None);
}

#[test]
fn a_threshold_of_zero_never_holds() {
    let assessment = assess(
        &facts(one_failure_each(&["a", "b", "c", "d", "e", "f", "g"])),
        0,
        at(600),
    );
    assert_eq!(assessment.hold, None);
    assert!(!assessment.probe_due);
    assert_eq!(
        assessment.failed_runs.len(),
        7,
        "the runs are still retried"
    );
}

#[test]
fn the_threshold_is_the_setting() {
    let jobs = one_failure_each(&["a", "b", "c"]);
    assert_eq!(assess(&facts(jobs.clone()), 4, at(10)).hold, None);
    assert_eq!(
        assess(&facts(jobs.clone()), 3, at(10))
            .hold
            .map(|hold| hold.failing_runs),
        Some(3)
    );
    assert!(assess(&facts(jobs), 1, at(10)).hold.is_some());
}

#[test]
fn a_finished_job_whose_instant_does_not_parse_counts_for_nothing() {
    let mut jobs = one_failure_each(&["a", "b", "c", "d", "e"]);
    jobs[4].updated_at = "yesterday".to_string();
    let assessment = assess(&facts(jobs), 5, at(10));
    assert_eq!(assessment.hold, None);
    assert_eq!(assessment.failed_runs.len(), 4);
}

#[test]
fn the_hold_carries_the_error_of_the_latest_failure() {
    let mut jobs = one_failure_each(&["a", "b"]);
    jobs.push(job("again", "a", "failed", 30));
    let hold = assess(&facts(jobs), 2, at(31)).hold.unwrap();
    assert_eq!(hold.failing_runs, 2);
    assert_eq!(hold.latest_error.as_deref(), Some("error of again"));
}

// --- The probe --------------------------------------------------------------

#[test]
fn the_probe_interval_starts_at_five_minutes_and_stops_at_thirty() {
    let minutes = |failures| probe_interval(failures).whole_minutes();
    assert_eq!(minutes(0), 5);
    assert_eq!(minutes(1), 10);
    assert_eq!(minutes(2), 20);
    assert_eq!(minutes(3), 30, "forty minutes is past the cap");
    assert_eq!(minutes(4), 30);
    assert_eq!(minutes(u32::MAX), 30);
}

#[test]
fn a_held_queue_is_probed_five_minutes_after_the_failure_that_held_it() {
    // The fifth run fails at minute 4.
    let facts = facts(one_failure_each(&["a", "b", "c", "d", "e"]));
    assert!(!assess(&facts, 5, at(4)).probe_due);
    assert!(!assess(&facts, 5, at(9) - Duration::seconds(1)).probe_due);
    assert!(assess(&facts, 5, at(9)).probe_due);
}

#[test]
fn each_failure_after_the_hold_began_doubles_the_probe_interval() {
    let mut jobs = one_failure_each(&["a", "b", "c", "d", "e"]);
    let mut latest = 4;
    for (index, expected) in [10, 20, 30, 30, 30].into_iter().enumerate() {
        latest += 60;
        jobs.push(job(&format!("probe{index}"), "a", "failed", latest));
        let facts = facts(jobs.clone());
        assert!(
            !assess(&facts, 5, at(latest + expected) - Duration::seconds(1)).probe_due,
            "after {} probes the interval is {expected} minutes",
            index + 1
        );
        assert!(assess(&facts, 5, at(latest + expected)).probe_due);
    }
}

#[test]
fn nothing_is_probed_while_a_publish_job_is_in_flight() {
    for state in ["queued", "dispatched"] {
        let mut jobs = one_failure_each(&["a", "b", "c", "d", "e"]);
        jobs.push(job("probe", "a", state, 20));
        let assessment = assess(&facts(jobs), 5, at(600));
        assert!(
            assessment.hold.is_some(),
            "the hold stands until it succeeds"
        );
        assert!(!assessment.probe_due, "the {state} job is the probe");
    }
}

#[test]
fn a_held_queue_always_has_a_run_to_probe_with() {
    // Every run that counted toward the hold is a run the probe can take, even
    // one past its own budget.
    let assessment = assess(
        &facts(one_failure_each(&["a", "b", "c", "d", "e"])),
        5,
        at(3 * 24 * 60),
    );
    assert!(assessment.hold.is_some());
    assert!(assessment.probe_due);
    assert_eq!(assessment.failed_runs.len(), 5);
    assert!(
        assessment
            .failed_runs
            .iter()
            .all(|run| !run.due(at(3 * 24 * 60))),
        "none is due on its own schedule after three days"
    );
    assert_eq!(assessment.failed_runs[0].run_id, "a", "the oldest leads");
}

#[test]
fn nothing_is_due_a_probe_without_a_hold() {
    let assessment = assess(&facts(one_failure_each(&["a", "b"])), 5, at(600));
    assert!(!assessment.probe_due);
}
