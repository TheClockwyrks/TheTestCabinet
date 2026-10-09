//! Unit tests for the pure admission decision. No cluster and no backend: the
//! decision reads only the `Job`s the dispatcher owns, the two caps, and whether a
//! publisher image is configured.

use super::*;

const RUN_CAP: usize = 8;
const PUBLISH_CAP: usize = 2;

/// `count` managed `Job`s of one kind in one phase.
fn jobs(kind: JobKind, phase: JobPhase, count: usize) -> Vec<ManagedJob> {
    let prefix = match kind {
        JobKind::Run => "tcab-driver",
        JobKind::Publish => "tcab-publisher",
    };
    (0..count)
        .map(|n| ManagedJob {
            job_id: Some(format!("{prefix}-{n}")),
            name: format!("{prefix}-{n}"),
            kind,
            phase,
        })
        .collect()
}

/// The managed set holding `runs` active driver `Job`s and `publishes` active
/// publish `Job`s.
fn active(runs: usize, publishes: usize) -> Vec<ManagedJob> {
    let mut managed = jobs(JobKind::Run, JobPhase::Active, runs);
    managed.extend(jobs(JobKind::Publish, JobPhase::Active, publishes));
    managed
}

#[test]
fn an_idle_cluster_opens_both_lanes() {
    assert_eq!(
        admission(&[], RUN_CAP, PUBLISH_CAP, true),
        Admission {
            run: true,
            publish: true
        }
    );
}

/// The case the lanes exist for: every run slot taken, and a publish still starts.
#[test]
fn a_full_run_lane_leaves_the_publish_lane_open() {
    assert_eq!(
        admission(&active(RUN_CAP, 0), RUN_CAP, PUBLISH_CAP, true),
        Admission {
            run: false,
            publish: true
        }
    );
    // Over the cap too (the cap was lowered under running work).
    assert!(admission(&active(RUN_CAP + 3, 1), RUN_CAP, PUBLISH_CAP, true).publish);
}

/// The decision takes no queue length at all, so a long run queue cannot bear on
/// the publish lane. Whatever the run lane holds, the publish answer is the same.
#[test]
fn the_publish_decision_ignores_the_run_lane() {
    for runs in 0..=RUN_CAP + 2 {
        assert!(
            admission(&active(runs, 0), RUN_CAP, PUBLISH_CAP, true).publish,
            "{runs} active runs closed an empty publish lane"
        );
        assert!(
            !admission(&active(runs, PUBLISH_CAP), RUN_CAP, PUBLISH_CAP, true).publish,
            "{runs} active runs opened a full publish lane"
        );
    }
}

#[test]
fn a_full_publish_lane_leaves_the_run_lane_open() {
    assert_eq!(
        admission(&active(0, PUBLISH_CAP), RUN_CAP, PUBLISH_CAP, true),
        Admission {
            run: true,
            publish: false
        }
    );
    assert_eq!(
        admission(
            &active(RUN_CAP - 1, PUBLISH_CAP + 1),
            RUN_CAP,
            PUBLISH_CAP,
            true
        ),
        Admission {
            run: true,
            publish: false
        }
    );
}

#[test]
fn both_lanes_full_closes_both() {
    assert_eq!(
        admission(&active(RUN_CAP, PUBLISH_CAP), RUN_CAP, PUBLISH_CAP, true),
        Admission {
            run: false,
            publish: false
        }
    );
}

#[test]
fn no_publisher_image_never_opens_the_publish_lane() {
    for (runs, publishes) in [(0, 0), (RUN_CAP, 0), (0, PUBLISH_CAP), (3, 1)] {
        assert!(
            !admission(&active(runs, publishes), RUN_CAP, PUBLISH_CAP, false).publish,
            "the publish lane opened with no publisher image ({runs} runs, {publishes} publishes)"
        );
    }
    // The run lane is unaffected by publishing being off.
    assert!(admission(&[], RUN_CAP, PUBLISH_CAP, false).run);
}

/// Publish `Job`s take no run slots: one short of the run cap plus any number of
/// publishers still leaves the run lane its last slot.
#[test]
fn publish_jobs_do_not_consume_run_slots() {
    assert!(admission(&active(RUN_CAP - 1, 0), RUN_CAP, PUBLISH_CAP, true).run);
    assert!(admission(&active(RUN_CAP - 1, 50), RUN_CAP, PUBLISH_CAP, true).run);
    assert!(admission(&active(0, 50), 1, PUBLISH_CAP, true).run);
}

#[test]
fn run_jobs_do_not_consume_publish_slots() {
    assert!(admission(&active(50, PUBLISH_CAP - 1), RUN_CAP, PUBLISH_CAP, true).publish);
    assert!(admission(&active(50, 0), RUN_CAP, 1, true).publish);
}

/// A finished `Job` lingers in the listing until its TTL reaps it; only an `Active`
/// one holds a slot, in either lane.
#[test]
fn terminal_jobs_hold_no_slot() {
    let mut managed = jobs(JobKind::Run, JobPhase::Complete, RUN_CAP);
    managed.extend(jobs(JobKind::Run, JobPhase::Failed, RUN_CAP));
    managed.extend(jobs(JobKind::Publish, JobPhase::Complete, PUBLISH_CAP));
    managed.extend(jobs(JobKind::Publish, JobPhase::Failed, PUBLISH_CAP));
    assert_eq!(
        admission(&managed, RUN_CAP, PUBLISH_CAP, true),
        Admission {
            run: true,
            publish: true
        }
    );
}

#[test]
fn each_lane_closes_exactly_at_its_cap() {
    assert!(admission(&active(0, 0), 1, 1, true).run);
    assert!(!admission(&active(1, 0), 1, 1, true).run);
    assert!(admission(&active(0, 0), 1, 1, true).publish);
    assert!(!admission(&active(0, 1), 1, 1, true).publish);
}

#[test]
fn a_failed_lane_admitted_nothing() {
    assert!(lane_admitted("run", Ok(true)));
    assert!(!lane_admitted("run", Ok(false)));
    assert!(!lane_admitted(
        "publish",
        Err(anyhow::anyhow!("backend down"))
    ));
}
