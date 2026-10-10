//! Unit tests for the ladder transport's pure parts: how a submitted climb becomes a
//! stored one, how a gate is sanitized on the way in, the order climbers are fed in,
//! and the wiring between a stored gate and the pure core that evaluates it.
//!
//! The gate's own arithmetic is the core's to prove (`crate::coverage::gate`); what is
//! tested here is that this module hands it the right rule and reads its answer back
//! correctly — including the three worked examples the ladder feature was specified
//! against, which are exactly the shapes a wrong sanitization would break silently.

use super::*;

use super::super::coverage::gg_member_defect;
use super::super::coverage::{cell_key, resolve_member};
use test_cabinet_core::gg::{
    GgAgentConfig, GgCapabilitySet, GgConfigSlot, GgModelSlot, GgSlotTarget,
};
use test_cabinet_core::review::Rating;

use crate::coverage::gate::GateOutcome;

fn combo(model: &str) -> ReviewPlanCombo {
    ReviewPlanCombo {
        harness: HarnessSlug::Claude,
        model: model.to_string(),
        provider: None,
        gg_config_id: None,
        gg_slot_models: BTreeMap::new(),
        gg_config_name: None,
    }
}

/// The same combination resolved into the member a board actually walks. Every climber in
/// this file is a harness member, which resolves without consulting any configuration.
fn member(model: &str) -> PlanMember {
    resolve_member(&combo(model), &GgLibrary::default())
}

fn rung_input(slug: &str) -> LadderRungInput {
    LadderRungInput {
        id: None,
        slug: slug.to_string(),
        version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        engine: None,
        runs: None,
    }
}

fn input(rungs: Vec<LadderRungInput>) -> LadderInput {
    LadderInput {
        name: "climb".to_string(),
        runs_per_cell: 5,
        gate: None,
        combo_group_ids: vec![],
        combos: vec![],
        rungs,
        outer_axis: LadderAxis::Rung,
        in_flight_limit: None,
        retry_count: None,
    }
}

/// A run the requester rated, that loaded.
fn rated(rating: Rating) -> RungRun {
    RungRun {
        rating: Some(rating),
        loaded: true,
    }
}

#[test]
fn a_ladder_needs_at_least_one_rung() {
    // An empty climb has nothing to gate, so it is refused rather than stored as a
    // ladder that can never do anything.
    let err = ladder_from_input("l1".to_string(), input(vec![]), "2026-08-15T00:00:00Z")
        .expect_err("an empty ladder is refused");
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

#[test]
fn a_climb_longer_than_the_cap_is_refused() {
    let rungs: Vec<LadderRungInput> = (0..=MAX_LADDER_RUNGS)
        .map(|i| rung_input(&format!("case-{i}")))
        .collect();
    let err = ladder_from_input("l1".to_string(), input(rungs), "2026-08-15T00:00:00Z")
        .expect_err("a ladder past the cap is refused");
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

#[test]
fn a_new_rung_gets_a_minted_id_and_an_existing_one_keeps_its_own() {
    let mut existing = rung_input("carom");
    existing.id = Some("rung-keep".to_string());
    let stored = ladder_from_input(
        "l1".to_string(),
        input(vec![existing, rung_input("pong")]),
        "2026-08-15T00:00:00Z",
    )
    .expect("a valid climb");
    // The supplied id survives — it is what every recorded verdict references, so a
    // reorder or a re-save must not mint a new one.
    assert_eq!(stored.rungs[0].id, "rung-keep");
    assert!(!stored.rungs[1].id.is_empty());
    assert_ne!(stored.rungs[1].id, stored.rungs[0].id);
}

#[test]
fn two_rungs_may_not_share_an_id() {
    let mut first = rung_input("carom");
    first.id = Some("dup".to_string());
    let mut second = rung_input("pong");
    second.id = Some("dup".to_string());
    // Two rungs under one id would share one set of recorded verdicts, so a climber's
    // progress on one would silently decide the other.
    let err = ladder_from_input(
        "l1".to_string(),
        input(vec![first, second]),
        "2026-08-15T00:00:00Z",
    )
    .expect_err("a duplicated rung id is refused");
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

#[test]
fn a_rung_needs_a_slug_and_an_exact_version() {
    let mut blank = rung_input("carom");
    blank.version = "  ".to_string();
    let err = ladder_from_input("l1".to_string(), input(vec![blank]), "2026-08-15T00:00:00Z")
        .expect_err("a rung with no version is refused");
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

#[test]
fn ladder_and_rung_targets_are_clamped() {
    let mut greedy = rung_input("carom");
    greedy.runs = Some(9_999);
    let mut body = input(vec![greedy]);
    body.runs_per_cell = 0;
    let stored =
        ladder_from_input("l1".to_string(), body, "2026-08-15T00:00:00Z").expect("a valid climb");
    // A target of zero would declare a cell nobody wants any runs of.
    assert_eq!(stored.runs_per_cell, 1);
    assert_eq!(
        stored.rungs[0].runs_override,
        Some(clamp_runs_per_cell(9_999))
    );
}

#[test]
fn the_default_gate_is_the_gentlest_one_that_still_stops_a_hopeless_climb() {
    let stored = ladder_from_input(
        "l1".to_string(),
        input(vec![rung_input("carom")]),
        "2026-08-15T00:00:00Z",
    )
    .expect("a valid climb");
    assert_eq!(stored.gate.floor, Rating::Scuffed);
    assert_eq!(stored.gate.threshold, GateThreshold::Count { runs: 1 });
    // Both defaults are the settled ones: an unloaded build is judged without a
    // reviewer, and a rung still finishes its runs even when the verdict is certain.
    assert!(stored.gate.unloaded_counts_as_broken);
    assert!(!stored.gate.early_stop);
}

#[test]
fn a_nonsense_gate_threshold_is_clamped_rather_than_stored() {
    let over = sanitize_gate(Gate {
        threshold: GateThreshold::Fraction { fraction: 4.0 },
        ..Gate::default()
    });
    assert_eq!(over.threshold, GateThreshold::Fraction { fraction: 1.0 });

    let nan = sanitize_gate(Gate {
        threshold: GateThreshold::Fraction { fraction: f64::NAN },
        ..Gate::default()
    });
    // A non-finite fraction degrades to "always pass" rather than failing every
    // climber forever — the loud failure over the silent one.
    assert_eq!(nan.threshold, GateThreshold::Fraction { fraction: 0.0 });

    let zero = sanitize_gate(Gate {
        threshold: GateThreshold::Count { runs: 0 },
        ..Gate::default()
    });
    assert_eq!(zero.threshold, GateThreshold::Count { runs: 1 });

    let huge = sanitize_gate(Gate {
        threshold: GateThreshold::Count { runs: 9_999 },
        ..Gate::default()
    });
    // A count no rung is allowed to reach would fail every climber forever.
    assert_eq!(
        huge.threshold,
        GateThreshold::Count {
            runs: clamp_runs_per_cell(9_999)
        }
    );
}

#[test]
fn the_three_worked_gate_shapes_hold_at_five_runs_a_rung() {
    let target = 5;

    // "stop when over half are broken" — floor scuffed, fraction 0.5. Three playable
    // runs out of five clear it; two do not.
    let over_half = sanitize_gate(Gate {
        floor: Rating::Scuffed,
        threshold: GateThreshold::Fraction { fraction: 0.5 },
        ..Gate::default()
    });
    let three_good = vec![
        rated(Rating::Passable),
        rated(Rating::Scuffed),
        rated(Rating::Great),
        rated(Rating::Broken),
        rated(Rating::Broken),
    ];
    assert_eq!(
        gate::evaluate(&three_good, target, 0, &over_half),
        GateOutcome::Passed
    );
    let two_good = vec![
        rated(Rating::Scuffed),
        rated(Rating::Scuffed),
        rated(Rating::Broken),
        rated(Rating::Broken),
        rated(Rating::Broken),
    ];
    assert_eq!(
        gate::evaluate(&two_good, target, 0, &over_half),
        GateOutcome::Failed
    );

    // "stop when all are broken" — floor scuffed, count 1. One survivor is enough.
    let all_broken = sanitize_gate(Gate {
        floor: Rating::Scuffed,
        threshold: GateThreshold::Count { runs: 1 },
        ..Gate::default()
    });
    assert_eq!(
        gate::evaluate(&two_good, target, 0, &all_broken),
        GateOutcome::Passed
    );
    let nothing_playable = vec![rated(Rating::Broken); 5];
    assert_eq!(
        gate::evaluate(&nothing_playable, target, 0, &all_broken),
        GateOutcome::Failed
    );

    // "pass if any run is passable or better" — the same threshold with a higher floor.
    let any_passable = sanitize_gate(Gate {
        floor: Rating::Passable,
        threshold: GateThreshold::Count { runs: 1 },
        ..Gate::default()
    });
    assert_eq!(
        gate::evaluate(&three_good, target, 0, &any_passable),
        GateOutcome::Passed
    );
    assert_eq!(
        gate::evaluate(&two_good, target, 0, &any_passable),
        GateOutcome::Failed
    );
}

#[test]
fn a_build_that_never_loaded_is_judged_without_a_reviewer() {
    let gate_rule = sanitize_gate(Gate::default());
    // Five unreviewed runs whose builds never loaded: nothing for a human to play, so
    // the gate decides now rather than stalling the climb and holding buffer slots.
    let never_loaded = vec![
        RungRun {
            rating: None,
            loaded: false
        };
        5
    ];
    assert_eq!(
        gate::evaluate(&never_loaded, 5, 0, &gate_rule),
        GateOutcome::Failed
    );
    // Turned off, the same runs are simply unjudged and the climber waits.
    let patient = Gate {
        unloaded_counts_as_broken: false,
        ..gate_rule
    };
    assert_eq!(
        gate::evaluate(&never_loaded, 5, 0, &patient),
        GateOutcome::Undecided
    );
}

#[test]
fn a_rung_finishes_its_runs_before_it_is_judged_unless_early_stop_is_on() {
    // "every run must be passable" — the strictest shape, where a single bad run
    // already settles the rung whatever the remaining four do.
    let gate_rule = sanitize_gate(Gate {
        floor: Rating::Passable,
        threshold: GateThreshold::Fraction { fraction: 1.0 },
        ..Gate::default()
    });
    let so_far = vec![rated(Rating::Broken)];
    // Off by default: the verdict is already certain, and the rung still finishes its
    // runs, because five runs of a case on a model are evidence worth having in full.
    assert_eq!(
        gate::evaluate(&so_far, 5, 0, &gate_rule),
        GateOutcome::Undecided
    );
    let impatient = Gate {
        early_stop: true,
        ..gate_rule
    };
    assert_eq!(
        gate::evaluate(&so_far, 5, 0, &impatient),
        GateOutcome::Failed
    );
}

#[test]
fn an_undecided_rung_is_climbing_while_the_ladder_can_feed_it_and_blocked_otherwise() {
    let gate_rule = Gate::default();
    let model = member("claude-opus-5");
    // Runs still to come: the ladder's to solve, and it keeps feeding this climber.
    let climbing = gate::tally(&[rated(Rating::Broken)], 5, 0, &gate_rule);
    assert_eq!(
        undecided_standing(&climbing, model.unlaunchable.as_deref(), 0, None),
        (ClimberStatus::Running, None)
    );
    // Every run completed and one carries no validator rating: nothing the ladder
    // launches can decide it, so it is blocked, naming how many runs are unrated.
    let unrated = gate::tally(
        &[RungRun {
            rating: None,
            loaded: true,
        }],
        1,
        0,
        &gate_rule,
    );
    assert_eq!(
        undecided_standing(&unrated, model.unlaunchable.as_deref(), 0, None),
        (
            ClimberStatus::Blocked,
            Some(ClimberBlock::Unrated { runs: 1 })
        )
    );
    // Runs still to come, but its launch used up its two attempts and nothing of it is in
    // flight.
    assert_eq!(
        undecided_standing(&climbing, model.unlaunchable.as_deref(), 0, Some(2)),
        (
            ClimberStatus::Blocked,
            Some(ClimberBlock::Failing { attempts: 2 })
        )
    );
    // With a run still in flight it is climbing: that run may yet complete.
    assert_eq!(
        undecided_standing(&climbing, model.unlaunchable.as_deref(), 1, Some(2)),
        (ClimberStatus::Running, None)
    );
    // A climber that cannot be launched is blocked for that reason first.
    let gone = gg_member("cfg-9", "opus", "haiku");
    let (status, blocked) = undecided_standing(&climbing, gone.unlaunchable.as_deref(), 0, Some(2));
    assert_eq!(status, ClimberStatus::Blocked);
    assert!(
        matches!(blocked, Some(ClimberBlock::Unlaunchable { ref reason }) if reason.contains("cfg-9")),
        "{blocked:?}"
    );
}

#[test]
fn a_slot_is_blocked_by_a_job_that_used_up_its_retries_until_a_later_launch_replaces_it() {
    let job =
        |state: &str, counted: bool, retried: bool, attempt: u32, ended_at: &str| TerminalJob {
            state: state.to_string(),
            counted,
            retried,
            attempt,
            ended_at: ended_at.to_string(),
        };
    let failed = |attempt: u32, ended_at: &str| job("failed", false, false, attempt, ended_at);
    let at = |text: &str| {
        Some(
            time::OffsetDateTime::parse(text, &time::format_description::well_known::Rfc3339)
                .unwrap(),
        )
    };
    let launched_together = at("2026-10-02T00:00:00Z");
    assert_eq!(slot_failing(&[], None, None), None);
    // One failure with no retries left is enough, and it names its attempts.
    assert_eq!(
        slot_failing(
            &[failed(0, "2026-10-02T00:00:01Z")],
            None,
            launched_together
        ),
        Some(1)
    );
    assert_eq!(
        slot_failing(
            &[
                failed(1, "2026-10-02T00:00:02Z"),
                job("failed", false, true, 0, "2026-10-02T00:00:01Z"),
            ],
            None,
            launched_together
        ),
        Some(2)
    );
    // A job that was retried, that was canceled, or whose run counts blocks nothing.
    for other in [
        job("failed", false, true, 0, "2026-10-02T00:00:02Z"),
        job("canceled", false, false, 0, "2026-10-02T00:00:02Z"),
        job("succeeded", true, false, 0, "2026-10-02T00:00:02Z"),
    ] {
        assert_eq!(
            slot_failing(std::slice::from_ref(&other), None, launched_together),
            None
        );
        // Ending after a failure it was launched together with does not replace the
        // failure either.
        assert_eq!(
            slot_failing(
                &[other, failed(0, "2026-10-02T00:00:01Z")],
                None,
                launched_together
            ),
            Some(1)
        );
    }
    // A launch created after the failure ended replaces it. One created at the instant
    // it ended does not.
    let terminal = [failed(0, "2026-10-02T00:00:01Z")];
    assert_eq!(
        slot_failing(&terminal, None, at("2026-10-02T00:00:01.000000001Z")),
        None
    );
    assert_eq!(
        slot_failing(&terminal, None, at("2026-10-02T00:00:01Z")),
        Some(1)
    );
    // Of two failures, the one that ended after the newest launch was created blocks, and
    // the attempts are those of the most recently ended one that does.
    let terminal = [
        failed(2, "2026-10-02T00:00:05Z"),
        failed(1, "2026-10-02T00:00:04Z"),
        failed(0, "2026-10-02T00:00:01Z"),
    ];
    assert_eq!(
        slot_failing(&terminal, None, at("2026-10-02T00:00:03Z")),
        Some(3)
    );
    // Only jobs that ended after the climber's retry are read.
    let terminal = [failed(0, "2026-10-02T00:00:01Z")];
    assert_eq!(
        slot_failing(&terminal, Some("2026-10-02T00:00:01Z"), launched_together),
        None
    );
    assert_eq!(
        slot_failing(&terminal, Some("2026-10-02T00:00:00Z"), launched_together),
        Some(1)
    );
}

#[test]
fn a_snapshot_taken_before_the_retry_limit_reads_one_retry() {
    let snapshot: DispatchSnapshot = serde_json::from_str(
        r#"{"rungs":[],"gate":{"floor":"scuffed","threshold":{"kind":"count","runs":1}},
            "outerAxis":"rung","inFlightLimit":{"kind":"unbounded"},"runsPerCell":2}"#,
    )
    .unwrap();
    assert_eq!(snapshot.retry_count, 1);
}

#[test]
fn a_stored_dispatch_status_never_reads_as_needing_attention() {
    for (token, status) in [
        ("running", DispatchStatus::Running),
        ("finished", DispatchStatus::Finished),
        ("stopped", DispatchStatus::Stopped),
        ("needsAttention", DispatchStatus::Stopped),
    ] {
        assert_eq!(DispatchStatus::parse(token), status);
    }
    // It is stored as the running dispatch it is.
    assert_eq!(DispatchStatus::NeedsAttention.as_str(), "running");
}

#[test]
fn a_blocked_reason_names_its_kind_on_the_wire() {
    let json = serde_json::to_value(ClimberBlock::Failing { attempts: 3 }).unwrap();
    assert_eq!(
        json,
        serde_json::json!({ "kind": "failing", "attempts": 3 })
    );
    let json = serde_json::to_value(ClimberBlock::Unlaunchable {
        reason: "gone".to_string(),
    })
    .unwrap();
    assert_eq!(
        json,
        serde_json::json!({ "kind": "unlaunchable", "reason": "gone" })
    );
    assert_eq!(
        serde_json::to_value(ClimberStatus::Blocked).unwrap(),
        serde_json::json!("blocked")
    );
}

#[test]
fn a_required_fraction_is_reported_as_the_run_count_it_actually_takes() {
    let half = Gate {
        threshold: GateThreshold::Fraction { fraction: 0.5 },
        ..Gate::default()
    };
    let tally = RungTally::from_gate(gate::tally(&[rated(Rating::Great)], 5, 0, &half));
    // Half of five is 2.5, which three runs clear and two do not — "over half".
    assert_eq!(tally.required, 3);
    assert_eq!(tally.counted, 1);
    assert_eq!(tally.in_flight, 0);
    assert_eq!(tally.pending, 4);
    assert_eq!(tally.passing, 1);
    assert_eq!(tally.unrated, 0);
}

#[test]
fn an_unknown_stored_axis_falls_back_to_the_default() {
    assert_eq!(LadderAxis::parse("rung"), LadderAxis::Rung);
    assert_eq!(LadderAxis::parse("combination"), LadderAxis::Combination);
    // A token from a newer build (or a plan's vocabulary) degrades to today's ordering
    // rather than making the ladder unreadable.
    assert_eq!(LadderAxis::parse("case"), LadderAxis::Rung);
}

#[test]
fn ladder_statuses_and_verdicts_use_the_plain_words_on_the_wire() {
    let word = |value: serde_json::Value| value.as_str().unwrap().to_string();
    let statuses = [
        (ClimberStatus::Running, "running"),
        (ClimberStatus::Blocked, "blocked"),
        (ClimberStatus::Failed, "failed"),
        (ClimberStatus::Completed, "completed"),
    ];
    for (status, expected) in statuses {
        assert_eq!(word(serde_json::to_value(status).unwrap()), expected);
        assert_eq!(climber_status_word(status), expected);
    }
    for (status, expected) in [
        (SlotStatus::Running, "running"),
        (SlotStatus::Blocked, "blocked"),
        (SlotStatus::Passed, "passed"),
        (SlotStatus::Failed, "failed"),
        (SlotStatus::Pending, "pending"),
        (SlotStatus::Skipped, "skipped"),
    ] {
        assert_eq!(word(serde_json::to_value(status).unwrap()), expected);
    }
    for status in [
        DispatchStatus::Running,
        DispatchStatus::Finished,
        DispatchStatus::Stopped,
    ] {
        assert_eq!(word(serde_json::to_value(status).unwrap()), status.as_str());
        assert_eq!(DispatchStatus::parse(status.as_str()), status);
    }
    // A status nobody recognises reads as ended, never as running.
    assert_eq!(DispatchStatus::parse("paused"), DispatchStatus::Stopped);
    assert_eq!(
        word(serde_json::to_value(GateOutcome::Passed).unwrap()),
        "passed"
    );
    assert_eq!(
        word(serde_json::to_value(GateOutcome::Failed).unwrap()),
        "failed"
    );
    assert_eq!(
        word(serde_json::to_value(GateOutcome::Undecided).unwrap()),
        "undecided"
    );
    // The stored tokens match the wire.
    assert_eq!(LadderOutcomeKind::Passed.as_str(), "passed");
    assert_eq!(LadderOutcomeKind::Failed.as_str(), "failed");
    assert!(LadderOutcomeKind::parse("advanced").is_err());
    assert!(LadderOutcomeKind::parse("walled").is_err());
}

#[test]
fn a_rung_is_counted_as_the_same_cell_a_plan_would_count() {
    let rung = StoredLadderRung {
        id: "r1".to_string(),
        slug: "carom".to_string(),
        version: "v1.2.0".to_string(),
        variant: "hard".to_string(),
        engine: None,
        runs_override: None,
    };
    // The rung's case and a plan's case are the same identity, so a run of this rung
    // counts toward the ladder and any plan covering it — counts stay global.
    let case = rung_case(&rung);
    assert_eq!(case.slug, "carom");
    assert_eq!(case.version, "v1.2.0");
    assert_eq!(case.variant, "hard");
    assert_eq!(case.engine, None);
    assert_eq!(
        cell_key(&case, &member("opus")),
        (
            "carom".to_string(),
            "v1.2.0".to_string(),
            "hard".to_string(),
            // A rung that pins no engine climbs the engineless run, which is the segment
            // a run recording no engine is counted under.
            "none".to_string(),
            "claude".to_string(),
            "opus".to_string(),
            // A harness combination has no gg identity: both segments are empty.
            String::new(),
            String::new(),
        )
    );
}

#[test]
fn the_same_case_on_two_engines_is_two_rungs() {
    let ladder = ladder_from_input(
        "l-1".to_string(),
        input(vec![
            rung_input("carom"),
            LadderRungInput {
                engine: Some("simple-2d".to_string()),
                ..rung_input("carom")
            },
        ]),
        "2026-08-15T00:00:00Z",
    )
    .expect("two engines are two rungs, not a duplicate");

    // Clearing a case with a runtime underneath is a different achievement from clearing
    // it with nothing, so a climb may ask for both — and the two are counted and gated
    // apart.
    let cases: Vec<ReviewPlanCase> = ladder.rungs.iter().map(rung_case).collect();
    assert_eq!(
        cases.iter().map(|c| c.engine_slug()).collect::<Vec<_>>(),
        vec!["none", "simple-2d"]
    );
    assert_ne!(
        cell_key(&cases[0], &member("opus")),
        cell_key(&cases[1], &member("opus"))
    );
    // And the engine survives the round trip onto the wire, so a re-save does not quietly
    // re-pin the rung to the engineless run.
    assert_eq!(
        rung_to_wire(&ladder.rungs[1]).engine.as_deref(),
        Some("simple-2d")
    );
}

#[test]
fn a_rung_saved_before_the_engine_existed_climbs_the_engineless_run() {
    // A console built against the previous contract sends no engine key, and the stored
    // rungs written by one carry a `NULL` column. Both must keep meaning what they always
    // meant — the engineless run — rather than becoming a rung nothing can resolve.
    let sent: LadderRungInput =
        serde_json::from_str(r#"{"slug":"carom","version":"v1.0.0","variant":"base"}"#)
            .expect("a pre-engine rung input still parses");
    assert_eq!(sent.engine, None);

    let stored = StoredLadderRung {
        id: "r1".to_string(),
        slug: "carom".to_string(),
        version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        engine: None,
        runs_override: None,
    };
    assert_eq!(rung_case(&stored).engine_slug(), "none");
    // And it goes back out the way it came in: no engine key on the wire, so a console
    // round-tripping a ladder does not re-pin every rung it touches.
    let wire = rung_to_wire(&stored);
    assert_eq!(wire.engine, None);
    assert!(
        !serde_json::to_value(&wire)
            .unwrap()
            .as_object()
            .unwrap()
            .contains_key("engine")
    );
}

#[test]
fn a_performance_case_can_never_be_a_rung() {
    // The two ineligible types are ineligible for different reasons, and both would
    // stall a climb silently rather than fail loudly.
    assert!(RUNG_INELIGIBLE_TEST_TYPES.contains(&TestType::Performance));
    assert!(RUNG_INELIGIBLE_TEST_TYPES.contains(&TestType::GameJam));
    assert!(!RUNG_INELIGIBLE_TEST_TYPES.contains(&TestType::EndToEnd));
}

// ---- gg climbers -----------------------------------------------------------

/// A saved configuration with **two** launch inputs: a configuration slot (`primary`)
/// filling the root agent's binding, and a passthrough slot on a second profile
/// (`reviewer.critic`).
///
/// Two, because one is not enough to show what a ladder needs: a climber keyed on the root
/// model alone would merge two climbers that differ only on the reviewer's model, and those
/// are exactly the two arms a ladder exists to keep apart.
fn gg_config(id: &str, name: &str) -> crate::api::GgConfig {
    let mut set = GgCapabilitySet::minimal("");
    let root_key = format!("k-{}", set.agents[0].slug);
    set.agents[0].id = Some(root_key.clone());
    set.agents[0].model_slot = Some("main".to_string());
    set.agents[0].model_slots = vec![GgModelSlot {
        name: "main".to_string(),
        default_model_id: None,
        passthrough: false,
    }];
    set.model_slots = vec![GgConfigSlot {
        name: "primary".to_string(),
        default_model_id: None,
        targets: vec![GgSlotTarget {
            agent: root_key,
            slot: "main".to_string(),
        }],
    }];
    set.agents.push(GgAgentConfig {
        id: Some("k-reviewer".to_string()),
        slug: "reviewer".to_string(),
        name: "reviewer".to_string(),
        model_slot: Some("critic".to_string()),
        model_slots: vec![GgModelSlot {
            name: "critic".to_string(),
            default_model_id: None,
            passthrough: true,
        }],
        ..GgAgentConfig::root()
    });
    crate::api::GgConfig {
        id: id.to_string(),
        name: name.to_string(),
        description: String::new(),
        capability_set: set,
        agent_sources: Vec::new(),
        updated_at: "2026-08-15T00:00:00Z".to_string(),
    }
}

/// The account's gg library: two saved configurations, no saved agents.
fn gg_configs() -> GgLibrary {
    GgLibrary::from_parts(
        vec![
            gg_config("cfg-1", "Critic sweep"),
            gg_config("cfg-2", "Solo sweep"),
        ],
        Vec::new(),
    )
}

/// A gg climber of one configuration, binding `root` to its primary slot and `critic` to the
/// reviewer's — spelled the way the console's picker values a configuration.
fn gg_combo(config: &str, root: &str, critic: &str) -> ReviewPlanCombo {
    ReviewPlanCombo {
        harness: HarnessSlug::Gg,
        model: String::new(),
        provider: None,
        gg_config_id: Some(format!("saved:{config}")),
        gg_slot_models: BTreeMap::from([
            ("primary".to_string(), root.to_string()),
            ("reviewer.critic".to_string(), critic.to_string()),
        ]),
        gg_config_name: None,
    }
}

/// The same climber, resolved against the account's configurations.
fn gg_member(config: &str, root: &str, critic: &str) -> PlanMember {
    resolve_member(&gg_combo(config, root, critic), &gg_configs())
}

#[test]
fn a_harness_climbers_key_is_still_its_harness_model_provider_triple() {
    // Byte-identical to what every ladder recorded before gg was a climber at all: a
    // verdict written against the old key must still address the same climber, so this
    // literal is the contract and not an example.
    assert_eq!(climber_key(&combo("opus")), "claude|opus|");
}

#[test]
fn a_gg_climbers_key_names_its_configuration_and_the_models_it_binds() {
    let key = climber_key(&gg_combo("cfg-1", "opus", "haiku"));
    assert_eq!(key, "gg:cfg-1|primary=opus,reviewer.critic=haiku");
    // It cannot be mistaken for a harness climber's, whose key has no `gg:` configuration
    // in the first segment — the two forms share one column of stored verdicts.
    assert!(!key.contains("claude"));
    assert_ne!(key, climber_key(&combo("opus")));
    // A bare id and the picker's `saved:` spelling name one configuration, so they are one
    // climber: a ladder written through the API and the same ladder written in the console
    // must not climb twice.
    let bare = ReviewPlanCombo {
        gg_config_id: Some("cfg-1".to_string()),
        ..gg_combo("cfg-1", "opus", "haiku")
    };
    assert_eq!(climber_key(&bare), key);
}

#[test]
fn two_gg_climbers_of_one_configuration_are_two_climbers() {
    let critic_haiku = climber_key(&gg_combo("cfg-1", "opus", "haiku"));
    let critic_sonnet = climber_key(&gg_combo("cfg-1", "opus", "sonnet"));
    // One configuration, one root model, one subagent changed: the two arms a ladder is
    // being asked to compare, so they must not share a rung's verdicts.
    assert_ne!(critic_haiku, critic_sonnet);
    // The same models bound to swapped slots is a third climber, because which agent runs
    // which model is the whole question.
    assert_ne!(
        critic_haiku,
        climber_key(&gg_combo("cfg-1", "haiku", "opus"))
    );
    // And the same bindings on a different configuration is a fourth.
    assert_ne!(
        critic_haiku,
        climber_key(&gg_combo("cfg-2", "opus", "haiku"))
    );

    // A Run stores them as two climbers of the dispatch.
    let climbers = dispatch_climbers_of(&[
        gg_member("cfg-1", "opus", "haiku"),
        gg_member("cfg-1", "opus", "sonnet"),
    ])
    .unwrap();
    assert_eq!(
        climbers
            .iter()
            .map(|climber| (climber.climber_key.clone(), climber.position))
            .collect::<Vec<_>>(),
        vec![(critic_haiku, 0), (critic_sonnet, 1)]
    );
}

#[test]
fn a_gg_climber_read_off_the_board_is_retried_as_itself() {
    // What a board hands a client: the configuration's name and the root model filled in,
    // and the harness resolved to gg.
    let read = gg_member("cfg-1", "opus", "haiku").combo;
    assert_eq!(read.gg_config_name.as_deref(), Some("Critic sweep"));
    assert_eq!(read.model, "opus");
    assert_eq!(read.harness, HarnessSlug::Gg);

    // A console echoing that straight back into `.../climbers/retry` addresses the climber it was reading, not a second one nothing on the
    // ladder refers to — because both keys are taken from the member as it is stored.
    let stored = gg_combo("cfg-1", "opus", "haiku");
    assert_ne!(read, stored, "the read shape really does differ");
    assert_eq!(climber_key(&read), climber_key(&stored));

    // Even a client that hands back a stale name and a stale root model — a configuration
    // renamed and re-bound since it was read — retries the same climber, since neither is
    // part of what the climber is.
    let stale = ReviewPlanCombo {
        gg_config_name: Some("what it used to be called".to_string()),
        model: "some-other-model".to_string(),
        provider: Some("openrouter".to_string()),
        harness: HarnessSlug::Claude,
        ..read.clone()
    };
    assert_eq!(climber_key(&stale), climber_key(&stored));
}

#[test]
fn a_gg_rungs_gate_evidence_is_read_from_its_own_configurations_cell() {
    let rung = StoredLadderRung {
        id: "r1".to_string(),
        slug: "carom".to_string(),
        version: "v1.2.0".to_string(),
        variant: "hard".to_string(),
        engine: None,
        runs_override: None,
    };
    let case = rung_case(&rung);
    // The key a dispatch groups this slot's evidence by. The two gg segments are what keep one
    // configuration's runs out of another's evidence: the configuration's id, because that is
    // what it is across time, and the bound models, because one configuration runs several.
    assert_eq!(
        cell_key(&case, &gg_member("cfg-1", "opus", "haiku")),
        (
            "carom".to_string(),
            "v1.2.0".to_string(),
            "hard".to_string(),
            "none".to_string(),
            "gg".to_string(),
            "opus".to_string(),
            "cfg-1".to_string(),
            "reviewer=haiku,root=opus".to_string(),
        )
    );
    // Same case, same root model, a different configuration: a different cell, so a climber
    // failing on one configuration is not failed by the other's runs.
    assert_ne!(
        cell_key(&case, &gg_member("cfg-1", "opus", "haiku")),
        cell_key(&case, &gg_member("cfg-2", "opus", "haiku"))
    );
    // Same configuration, one subagent's model changed: also a different cell.
    assert_ne!(
        cell_key(&case, &gg_member("cfg-1", "opus", "haiku")),
        cell_key(&case, &gg_member("cfg-1", "opus", "sonnet"))
    );
    // And never the harness cell of the same root model, whose gg segments are both empty.
    assert_ne!(
        cell_key(&case, &gg_member("cfg-1", "opus", "haiku")),
        cell_key(&case, &member("opus"))
    );
}

#[test]
fn a_climbers_key_and_its_cell_name_one_configuration() {
    let rung = StoredLadderRung {
        id: "r1".to_string(),
        slug: "carom".to_string(),
        version: "v1.2.0".to_string(),
        variant: "hard".to_string(),
        engine: None,
        runs_override: None,
    };
    let case = rung_case(&rung);
    let combo = gg_combo("cfg-1", "opus", "haiku");

    // The two halves of a ladder — the verdicts it records against a climber, and the runs
    // it counts under that climber's cells — name the configuration by the same value. A
    // ladder whose halves disagreed would keep a climber's history while resetting the
    // evidence beneath it.
    let key = climber_key(&combo);
    assert_eq!(key, "gg:cfg-1|primary=opus,reviewer.critic=haiku");
    assert_eq!(
        cell_key(&case, &gg_member("cfg-1", "opus", "haiku")).6,
        "cfg-1"
    );

    // Rename the configuration and neither half moves.
    let renamed = GgLibrary::from_parts(
        vec![
            gg_config("cfg-1", "Sweep, take two"),
            gg_config("cfg-2", "Solo sweep"),
        ],
        Vec::new(),
    );
    let after = resolve_member(&combo, &renamed);
    assert_eq!(climber_key(&after.combo), key);
    assert_eq!(
        cell_key(&case, &after),
        cell_key(&case, &gg_member("cfg-1", "opus", "haiku"))
    );

    // Two configurations an account gave one name are two climbers and two cells, on both
    // halves at once.
    let twins = GgLibrary::from_parts(
        vec![
            gg_config("cfg-1", "Critic sweep"),
            gg_config("cfg-2", "Critic sweep"),
        ],
        Vec::new(),
    );
    let first = resolve_member(&combo, &twins);
    let second = resolve_member(&gg_combo("cfg-2", "opus", "haiku"), &twins);
    assert_ne!(climber_key(&first.combo), climber_key(&second.combo));
    assert_ne!(cell_key(&case, &first), cell_key(&case, &second));
}

#[test]
fn a_gg_climber_is_stored_as_the_pointer_it_is() {
    // A ladder saved from a board read: the derived fields arrive filled in, and the store
    // must not keep them — a configuration is renamed in one place, and a ladder holding the
    // name it bore at save time would show the old one forever.
    let read = gg_member("cfg-1", "opus", "haiku").combo;
    let mut body = input(vec![rung_input("carom")]);
    body.combos = vec![read.clone(), combo("opus")];
    let stored =
        ladder_from_input("l1".to_string(), body, "2026-08-15T00:00:00Z").expect("a valid climb");
    assert!(stored.combos[0].model.is_empty());
    assert!(stored.combos[0].gg_config_name.is_none());
    assert_eq!(
        stored.combos[0].gg_config_id.as_deref(),
        Some("saved:cfg-1")
    );
    assert_eq!(stored.combos[0].gg_slot_models, read.gg_slot_models);
    // The harness climber beside it is stored exactly as it arrived.
    assert_eq!(stored.combos[1], combo("opus"));
    // And what was stored still names the climber the board was showing.
    assert_eq!(climber_key(&stored.combos[0]), climber_key(&read));
}

#[test]
fn a_climber_naming_a_configuration_the_account_does_not_own_is_refused() {
    // The same validator a plan's members go through, so a climber a ladder accepts and a
    // member a plan accepts are one set. A ladder is where the alternative would be worst:
    // an unlaunchable climber simply never moves, and nothing says why.
    let missing = gg_member_defect(&gg_combo("cfg-9", "opus", "haiku"), &gg_configs())
        .expect("a configuration nobody owns is a defect");
    assert!(missing.contains("cfg-9"), "unexpected: {missing}");

    let mut unbound = gg_combo("cfg-1", "opus", "haiku");
    unbound.gg_slot_models.remove("reviewer.critic");
    let defect = gg_member_defect(&unbound, &gg_configs()).expect("an unbound slot is a defect");
    // Both halves of what the reviewer has to go and change.
    assert!(defect.contains("reviewer.critic"), "unexpected: {defect}");
    assert!(defect.contains("Critic sweep"), "unexpected: {defect}");

    // A harness climber has nothing to check.
    assert!(gg_member_defect(&combo("opus"), &gg_configs()).is_none());
}

#[test]
fn a_climber_whose_configuration_vanished_keeps_its_place_and_stops_being_fed() {
    // The configuration was deleted after the ladder was written. The climber is not
    // dropped from the board: a row that quietly disappeared would be indistinguishable
    // from a model nobody ever added, which is the one thing a standing ladder must not
    // do to a climber that has history on it.
    let member = resolve_member(&gg_combo("cfg-9", "opus", "haiku"), &gg_configs());
    let reason = member
        .unlaunchable
        .clone()
        .expect("a configuration that is gone cannot be launched");
    assert!(reason.contains("cfg-9"), "unexpected: {reason}");
    // And it still keys as itself, so a retry addresses it once the configuration is
    // back.
    assert_eq!(
        climber_key(&member.combo),
        climber_key(&gg_combo("cfg-9", "opus", "haiku"))
    );

    // What the launch pass sees: a slot that wants nothing more, so the limit is spent on
    // the climbers that can still move.
    let demand = CellDemand {
        target: 5,
        counted: 2,
        in_flight: 1,
        harness: 0,
    };
    let held_back = launchable_demand(demand, &member);
    assert_eq!(held_back.missing(), 0);
    // Its runs in flight are untouched, though: runs already launched have not
    // un-launched themselves, and they still count against the limit.
    assert_eq!(held_back.in_flight, 1);

    // A resolvable climber is handed through unchanged.
    assert_eq!(
        launchable_demand(demand, &gg_member("cfg-1", "opus", "haiku")),
        demand
    );
}

// ---- The walk and the progress bar ---------------------------------------------

/// A slot's evidence: its counted runs, its jobs in flight, and any recorded verdict.
fn evidence(runs: &[Rating], in_flight: u32, recorded: Option<LadderOutcomeKind>) -> SlotEvidence {
    SlotEvidence {
        runs: runs.iter().map(|rating| rated(*rating)).collect(),
        in_flight,
        failing: None,
        recorded,
    }
}

/// Walk climbers over their evidence and total their slots the way the board does.
fn totals(
    targets: &[u32],
    climbers: &[Vec<SlotEvidence>],
    stopped: bool,
) -> (SlotCounts, DispatchRuns) {
    let gate = Gate::default();
    let mut counts = SlotCounts::default();
    let mut runs = DispatchRuns::default();
    for slots in climbers {
        let walk = walk_climber(targets, slots, &gate, None, stopped);
        for (position, slot) in walk.slots.iter().enumerate() {
            let target = targets[position];
            let ev = &slots[position];
            counts.add(slot.status);
            runs.total += target;
            runs.done += slot_runs_done(slot.status, target, ev.runs.len() as u32, ev.in_flight);
            runs.in_flight += ev.in_flight;
        }
    }
    (counts, runs)
}

/// Worked example A's three climbers on four rungs of 2, 2, 2 and 3 runs: one two rungs
/// up and running its third, one failed on the first, one running its first.
fn example_a() -> (Vec<u32>, Vec<Vec<SlotEvidence>>) {
    use LadderOutcomeKind::{Failed, Passed};
    let great = Rating::Great;
    let broken = Rating::Broken;
    let none = || evidence(&[], 0, None);
    (
        vec![2, 2, 2, 3],
        vec![
            vec![
                evidence(&[great, great], 0, Some(Passed)),
                evidence(&[great, broken], 0, Some(Passed)),
                evidence(&[great], 1, None),
                none(),
            ],
            vec![
                evidence(&[broken, broken], 0, Some(Failed)),
                none(),
                none(),
                none(),
            ],
            vec![evidence(&[], 2, None), none(), none(), none()],
        ],
    )
}

#[test]
fn worked_example_a_a_running_dispatch_fills_its_bar_with_what_needs_no_more_executing() {
    let (targets, climbers) = example_a();
    let (counts, runs) = totals(&targets, &climbers, false);
    assert_eq!(
        runs,
        DispatchRuns {
            total: 27,
            done: 14,
            in_flight: 3,
        }
    );
    assert_eq!(
        counts,
        SlotCounts {
            total: 12,
            running: 2,
            blocked: 0,
            passed: 2,
            failed: 1,
            pending: 4,
            skipped: 3,
        }
    );
}

#[test]
fn worked_example_b_an_early_stop_fills_a_decided_slot_but_its_runs_still_in_flight() {
    let gate = Gate {
        early_stop: true,
        ..Gate::default()
    };
    // Run 1 passed while run 2 runs; run 3 was cancelled by the pass.
    let walk = walk_climber(
        &[3],
        &[evidence(&[Rating::Great], 1, None)],
        &gate,
        None,
        false,
    );
    assert_eq!(walk.slots[0].status, SlotStatus::Passed);
    assert_eq!(walk.slots[0].newly, Some(LadderOutcomeKind::Passed));
    assert_eq!(slot_runs_done(SlotStatus::Passed, 3, 1, 1), 2);
    // Run 2 finishing broken changes nothing recorded, and fills the slot.
    let walk = walk_climber(
        &[3],
        &[evidence(
            &[Rating::Great, Rating::Broken],
            0,
            Some(LadderOutcomeKind::Passed),
        )],
        &gate,
        None,
        false,
    );
    assert_eq!(walk.slots[0].status, SlotStatus::Passed);
    assert_eq!(walk.slots[0].newly, None);
    assert_eq!(slot_runs_done(SlotStatus::Passed, 3, 2, 0), 3);
}

#[test]
fn worked_example_c_a_stopped_dispatch_skips_every_slot_left_and_waits_only_on_its_runs() {
    let (targets, mut climbers) = example_a();
    let (counts, runs) = totals(&targets, &climbers, true);
    assert_eq!(
        runs,
        DispatchRuns {
            total: 27,
            done: 24,
            in_flight: 3,
        }
    );
    assert_eq!(
        (
            counts.running,
            counts.passed,
            counts.failed,
            counts.skipped,
            counts.pending
        ),
        (0, 2, 1, 9, 0)
    );
    // As the runs in flight finish, the bar fills.
    climbers[0][2] = evidence(&[Rating::Great, Rating::Broken], 0, None);
    climbers[2][0] = evidence(&[Rating::Broken, Rating::Broken], 0, None);
    let (_, runs) = totals(&targets, &climbers, true);
    assert_eq!((runs.done, runs.total), (27, 27));
}

#[test]
fn a_slot_never_counts_more_done_runs_than_its_target() {
    assert_eq!(slot_runs_done(SlotStatus::Running, 2, 5, 0), 2);
    assert_eq!(slot_runs_done(SlotStatus::Blocked, 2, 1, 0), 1);
    assert_eq!(slot_runs_done(SlotStatus::Skipped, 2, 0, 5), 0);
    assert_eq!(slot_runs_done(SlotStatus::Pending, 2, 0, 0), 0);
    assert_eq!(slot_runs_done(SlotStatus::Failed, 2, 2, 0), 2);
}

#[test]
fn a_broken_run_never_fails_a_rung_a_run_still_in_flight_can_pass() {
    // One passing run needed, one broken counted, one more in flight: undecided.
    let gate = Gate::default();
    let walk = walk_climber(
        &[1, 1],
        &[evidence(&[Rating::Broken], 1, None), evidence(&[], 0, None)],
        &gate,
        None,
        false,
    );
    assert_eq!(walk.status, ClimberStatus::Running);
    assert_eq!(walk.slots[0].status, SlotStatus::Running);
    assert_eq!(walk.slots[0].newly, None);
    assert_eq!(walk.slots[0].tally.pending, 1);
    // The second passes it.
    let walk = walk_climber(
        &[1, 1],
        &[
            evidence(&[Rating::Broken, Rating::Great], 0, None),
            evidence(&[], 0, None),
        ],
        &gate,
        None,
        false,
    );
    assert_eq!(walk.slots[0].status, SlotStatus::Passed);
    assert_eq!(walk.slots[0].newly, Some(LadderOutcomeKind::Passed));
    assert_eq!(walk.current, Some(1));
}

#[test]
fn a_recorded_verdict_governs_its_slot_whatever_the_runs_say_now() {
    let gate = Gate::default();
    let walk = walk_climber(
        &[1, 1],
        &[
            evidence(&[Rating::Great], 0, Some(LadderOutcomeKind::Failed)),
            evidence(&[], 0, None),
        ],
        &gate,
        None,
        false,
    );
    assert_eq!(walk.status, ClimberStatus::Failed);
    assert_eq!(walk.current, Some(0));
    assert_eq!(
        walk.slots
            .iter()
            .map(|slot| slot.status)
            .collect::<Vec<_>>(),
        vec![SlotStatus::Failed, SlotStatus::Skipped]
    );
    assert!(walk.slots.iter().all(|slot| slot.newly.is_none()));
}

#[test]
fn a_climber_that_passed_every_rung_is_completed_and_stands_nowhere() {
    let gate = Gate::default();
    let walk = walk_climber(
        &[1],
        &[evidence(&[Rating::Great], 0, None)],
        &gate,
        None,
        true,
    );
    assert_eq!(walk.status, ClimberStatus::Completed);
    assert_eq!(walk.current, None);
    // A stop never un-passes a slot.
    assert_eq!(walk.slots[0].status, SlotStatus::Passed);
}

#[test]
fn a_dispatch_snapshot_resolves_each_rungs_target_and_round_trips() {
    let mut submitted = input(vec![rung_input("pong"), rung_input("carom")]);
    submitted.rungs[1].runs = Some(3);
    submitted.outer_axis = LadderAxis::Combination;
    let stored = ladder_from_input("l1".to_string(), submitted, "2026-10-02T00:00:00Z").unwrap();
    let snapshot = snapshot_of(&stored, InFlightLimit::Unbounded);
    assert_eq!(
        snapshot
            .rungs
            .iter()
            .map(|rung| rung.target)
            .collect::<Vec<_>>(),
        vec![5, 3]
    );
    assert_eq!(snapshot.rungs[0].runs, None);
    assert_eq!(snapshot.outer_axis, LadderAxis::Combination);
    let json = serde_json::to_string(&snapshot).unwrap();
    let back: DispatchSnapshot = serde_json::from_str(&json).unwrap();
    assert_eq!(back, snapshot);
    assert_eq!(snapshot.rungs[1].to_wire().runs, Some(3));
}
