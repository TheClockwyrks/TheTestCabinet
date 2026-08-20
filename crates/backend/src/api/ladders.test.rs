//! Unit tests for the ladder transport's pure parts: how a submitted climb becomes a
//! stored one, how a gate is sanitized on the way in, the order climbers are fed in,
//! and the wiring between a stored gate and the pure core that evaluates it.
//!
//! The gate's own arithmetic is the core's to prove (`crate::coverage::gate`); what is
//! tested here is that this module hands it the right rule and reads its answer back
//! correctly — including the three worked examples the ladder feature was specified
//! against, which are exactly the shapes a wrong sanitization would break silently.

use super::*;

use test_cabinet_core::review::Rating;

fn combo(model: &str) -> ReviewPlanCombo {
    ReviewPlanCombo {
        harness: HarnessSlug::Claude,
        model: model.to_string(),
        provider: None,
    }
}

fn rung_input(slug: &str) -> LadderRungInput {
    LadderRungInput {
        id: None,
        slug: slug.to_string(),
        version: "v1.0.0".to_string(),
        variant: "base".to_string(),
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
        schedule: None,
    }
}

fn steering(key: &str, priority: i32, focused: bool) -> StoredLadderClimber {
    StoredLadderClimber {
        combination_key: key.to_string(),
        priority,
        focused,
        held: false,
        updated_at: "2026-08-15T00:00:00Z".to_string(),
    }
}

/// A three-rung ladder to resolve cell sets against.
fn climb_of(slugs: &[&str]) -> StoredLadder {
    ladder_from_input(
        "l1".to_string(),
        input(slugs.iter().map(|slug| rung_input(slug)).collect()),
        "2026-08-15T00:00:00Z",
    )
    .expect("a valid climb")
}

/// One climber's standing: the rung it stands on (if any), and everywhere it reached.
fn standing<'a>(
    combo: &'a ReviewPlanCombo,
    status: ClimberStatus,
    current: Option<usize>,
    reached: &'a [usize],
) -> ClimberStanding<'a> {
    ClimberStanding {
        combo,
        status,
        current,
        reached,
    }
}

/// The `(model, rung position)` pairs a cell set names, for comparing sets by eye.
fn placed(cells: &[RungCell], ladder: &StoredLadder) -> Vec<(String, usize)> {
    cells
        .iter()
        .map(|cell| {
            let position = ladder
                .rungs
                .iter()
                .position(|rung| rung.id == cell.rung_id)
                .expect("a cell names one of the ladder's rungs");
            (cell.combo.model.clone(), position)
        })
        .collect()
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
    // A non-finite fraction degrades to "always advance" rather than walling every
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
    // A count no rung is allowed to reach would wall every climber forever.
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
        gate::evaluate(&three_good, target, &over_half),
        GateOutcome::Advance
    );
    let two_good = vec![
        rated(Rating::Scuffed),
        rated(Rating::Scuffed),
        rated(Rating::Broken),
        rated(Rating::Broken),
        rated(Rating::Broken),
    ];
    assert_eq!(
        gate::evaluate(&two_good, target, &over_half),
        GateOutcome::Wall
    );

    // "stop when all are broken" — floor scuffed, count 1. One survivor is enough.
    let all_broken = sanitize_gate(Gate {
        floor: Rating::Scuffed,
        threshold: GateThreshold::Count { runs: 1 },
        ..Gate::default()
    });
    assert_eq!(
        gate::evaluate(&two_good, target, &all_broken),
        GateOutcome::Advance
    );
    let nothing_playable = vec![rated(Rating::Broken); 5];
    assert_eq!(
        gate::evaluate(&nothing_playable, target, &all_broken),
        GateOutcome::Wall
    );

    // "pass if any run is passable or better" — the same threshold with a higher floor.
    let any_passable = sanitize_gate(Gate {
        floor: Rating::Passable,
        threshold: GateThreshold::Count { runs: 1 },
        ..Gate::default()
    });
    assert_eq!(
        gate::evaluate(&three_good, target, &any_passable),
        GateOutcome::Advance
    );
    assert_eq!(
        gate::evaluate(&two_good, target, &any_passable),
        GateOutcome::Wall
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
        gate::evaluate(&never_loaded, 5, &gate_rule),
        GateOutcome::Wall
    );
    // Turned off, the same runs are simply unjudged and the climber waits.
    let patient = Gate {
        unloaded_counts_as_broken: false,
        ..gate_rule
    };
    assert_eq!(
        gate::evaluate(&never_loaded, 5, &patient),
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
        gate::evaluate(&so_far, 5, &gate_rule),
        GateOutcome::Undecided
    );
    let impatient = Gate {
        early_stop: true,
        ..gate_rule
    };
    assert_eq!(gate::evaluate(&so_far, 5, &impatient), GateOutcome::Wall);
}

#[test]
fn the_two_shapes_of_undecided_are_kept_apart() {
    let gate_rule = Gate::default();
    // Runs still to come: the ladder's problem, and it will keep feeding this climber.
    let climbing = gate::tally(&[rated(Rating::Broken)], 5, &gate_rule);
    assert_eq!(undecided_status(&climbing), ClimberStatus::Climbing);
    // Everything ran and nobody has looked: the reviewer's problem, and exactly what a
    // full review buffer is made of.
    let waiting = gate::tally(
        &[RungRun {
            rating: None,
            loaded: true,
        }],
        1,
        &gate_rule,
    );
    assert_eq!(undecided_status(&waiting), ClimberStatus::AwaitingReview);
}

#[test]
fn a_required_fraction_is_reported_as_the_run_count_it_actually_takes() {
    let half = Gate {
        threshold: GateThreshold::Fraction { fraction: 0.5 },
        ..Gate::default()
    };
    let tally = RungTally::from_gate(gate::tally(&[rated(Rating::Great)], 5, &half));
    // Half of five is 2.5, which three runs clear and two do not — "over half".
    assert_eq!(tally.required, 3);
    assert_eq!(tally.completed, 1);
    assert_eq!(tally.pending, 4);
    assert_eq!(tally.passing, 1);
    assert_eq!(tally.unjudged, 0);
}

#[test]
fn steering_decides_the_climb_order_and_declaration_order_breaks_ties() {
    let combos = vec![combo("opus"), combo("sonnet"), combo("haiku")];
    let mut steer = HashMap::new();
    steer.insert(
        combination_key(&combos[2]),
        steering(&combination_key(&combos[2]), 10, false),
    );
    steer.insert(
        combination_key(&combos[1]),
        steering(&combination_key(&combos[1]), 0, true),
    );
    let order = climb_order(&combos, &steer);
    // Priority first (haiku), then the focused tiebreak among equal priorities
    // (sonnet), then declaration order for the rest (opus).
    assert_eq!(
        order
            .iter()
            .map(|&index| combos[index].model.as_str())
            .collect::<Vec<_>>(),
        vec!["haiku", "sonnet", "opus"]
    );
}

#[test]
fn an_unsteered_climber_takes_its_declared_place_without_a_row() {
    let combos = vec![combo("opus"), combo("sonnet")];
    // No steering rows at all — which is exactly the state of a model added to a
    // standing ladder — and the order is simply the ladder's own.
    let order = climb_order(&combos, &HashMap::new());
    assert_eq!(order, vec![0, 1]);
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
fn a_schedule_round_trips_through_the_stores_shape() {
    let schedule = LadderSchedule {
        outer_axis: LadderAxis::Combination,
        paused: true,
        auto_top_up: true,
        buffer_target: Some(6),
    };
    assert_eq!(LadderSchedule::from_db(schedule.to_db()), schedule);
    let default = LadderSchedule::default();
    assert_eq!(default.outer_axis, LadderAxis::Rung);
    // Disabled on creation: saving a climb describes the question, and a ladder that
    // enqueued the moment it was saved would spend a whole buffer before its author had
    // read it back.
    assert!(default.paused);
    // On, so that once the ladder *is* enabled the reviews that decide its rungs are
    // what keep it climbing. It can start nothing on its own — a top-up of a disabled
    // ladder enqueues nothing.
    assert!(default.auto_top_up);
    assert_eq!(default.buffer_target, None);
}

#[test]
fn a_manual_override_governs_the_climb_without_erasing_the_gates_verdict() {
    let stored = StoredLadderOutcome {
        rung_id: "r1".to_string(),
        combination_key: "claude|opus|".to_string(),
        decided_version: "v1.0.0".to_string(),
        outcome: LadderOutcomeKind::Walled,
        override_outcome: Some(LadderOutcomeKind::Advanced),
        override_at: Some("2026-08-15T01:00:00Z".to_string()),
        decided_at: "2026-08-15T00:00:00Z".to_string(),
    };
    let wire = outcome_to_wire(&stored, false, true);
    // Both are reported: the disagreement between reviewer and gate stays legible, and
    // clearing the override restores exactly what the gate says.
    assert_eq!(wire.outcome, LadderOutcome::Walled);
    assert_eq!(wire.override_outcome, Some(LadderOutcome::Advanced));
    assert_eq!(wire.effective, LadderOutcome::Advanced);
    assert!(wire.recorded);
    assert!(!wire.stale);
}

#[test]
fn a_verdict_decided_live_is_flagged_as_not_yet_recorded() {
    let rung = StoredLadderRung {
        id: "r1".to_string(),
        slug: "carom".to_string(),
        version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        runs_override: None,
    };
    let wire = live_outcome(&rung, LadderOutcome::Advanced, "2026-08-15T00:00:00Z");
    // A read never writes, so a verdict the gate resolved during a dashboard fetch is
    // reported as computed rather than stored; the next top-up writes it down.
    assert!(!wire.recorded);
    assert_eq!(wire.decided_version, "v1.0.0");
    assert_eq!(wire.effective, LadderOutcome::Advanced);
}

#[test]
fn a_rung_is_counted_as_the_same_cell_a_plan_would_count() {
    let rung = StoredLadderRung {
        id: "r1".to_string(),
        slug: "carom".to_string(),
        version: "v1.2.0".to_string(),
        variant: "hard".to_string(),
        runs_override: None,
    };
    // The rung's case and a plan's case are the same identity, so a run of this rung
    // counts toward the ladder and any plan covering it — counts stay global.
    let case = rung_case(&rung);
    assert_eq!(case.slug, "carom");
    assert_eq!(case.version, "v1.2.0");
    assert_eq!(case.variant, "hard");
    assert_eq!(
        cell_key(&case, &combo("opus")),
        (
            "carom".to_string(),
            "v1.2.0".to_string(),
            "hard".to_string(),
            "claude".to_string(),
            "opus".to_string(),
        )
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

#[test]
fn a_decided_rungs_unreviewed_runs_stay_reviewable_after_the_climber_moves_on() {
    // The bug this exists to prevent: under the default gate one review of a five-run
    // rung is enough to advance, and a queue drawn from the current rung alone would
    // drop the four runs nobody had looked at the instant the first was judged — while
    // they went on occupying the review buffer they had disappeared from.
    let ladder = climb_of(&["carom", "pong", "breakout"]);
    let model = combo("claude-opus-5");
    let (active, reviewable) = cell_sets(
        &ladder,
        LadderAxis::Rung,
        &[standing(
            &model,
            ClimberStatus::Climbing,
            Some(2),
            &[0, 1, 2],
        )],
    );

    // Only the rung it is working is fed: launching the ones it has already cleared
    // would be paying twice for a question the ladder has answered.
    assert_eq!(placed(&active, &ladder), vec![("claude-opus-5".into(), 2)]);
    // Everywhere it has been is still the reviewer's to judge.
    assert_eq!(
        placed(&reviewable, &ladder),
        vec![
            ("claude-opus-5".into(), 0),
            ("claude-opus-5".into(), 1),
            ("claude-opus-5".into(), 2),
        ],
    );
}

#[test]
fn a_climber_that_is_not_fed_is_still_reviewed() {
    // Walled, held, and topped-out climbers are all stopped for different reasons, and
    // none of them is a reason to hide runs that have already been paid for: a walled
    // climber's runs are the very ones a re-review would unwall it with, and a hold
    // stops spending rather than reviewing.
    let ladder = climb_of(&["carom", "pong", "breakout"]);
    let walled = combo("walled-model");
    let held = combo("held-model");
    let topped = combo("topped-model");
    let (active, reviewable) = cell_sets(
        &ladder,
        LadderAxis::Combination,
        &[
            standing(&walled, ClimberStatus::Walled, Some(1), &[0, 1]),
            standing(&held, ClimberStatus::Held, Some(0), &[0]),
            standing(&topped, ClimberStatus::ToppedOut, None, &[0, 1, 2]),
        ],
    );

    assert!(
        active.is_empty(),
        "none of these three is worth spending on"
    );
    assert_eq!(
        placed(&reviewable, &ladder),
        vec![
            ("walled-model".into(), 0),
            ("walled-model".into(), 1),
            ("held-model".into(), 0),
            ("topped-model".into(), 0),
            ("topped-model".into(), 1),
            ("topped-model".into(), 2),
        ],
    );
}

#[test]
fn awaiting_review_is_fed_because_the_review_is_what_it_is_waiting_on() {
    // `awaitingReview` is a rung that has run everything it was going to, so it feeds
    // nothing new — but it stays in the fed set, because the moment the review lands
    // the climber moves and the next rung is launched from exactly here.
    let ladder = climb_of(&["carom", "pong"]);
    let model = combo("claude-opus-5");
    let (active, reviewable) = cell_sets(
        &ladder,
        LadderAxis::Rung,
        &[standing(
            &model,
            ClimberStatus::AwaitingReview,
            Some(1),
            &[0, 1],
        )],
    );
    assert_eq!(placed(&active, &ladder), vec![("claude-opus-5".into(), 1)]);
    assert_eq!(reviewable.len(), 2);
}

#[test]
fn both_cell_sets_come_out_in_the_ladders_own_order() {
    let ladder = climb_of(&["carom", "pong", "breakout"]);
    let ahead = combo("ahead-model");
    let behind = combo("behind-model");
    let standings = [
        standing(&ahead, ClimberStatus::Climbing, Some(2), &[0, 1, 2]),
        standing(&behind, ClimberStatus::Climbing, Some(1), &[0, 1]),
    ];

    // Rung-major: the whole board is offered a rung at a time, so the two climbers'
    // runs on rung 0 are reviewed against each other before rung 1 is looked at.
    let (_, by_rung) = cell_sets(&ladder, LadderAxis::Rung, &standings);
    assert_eq!(
        placed(&by_rung, &ladder),
        vec![
            ("ahead-model".into(), 0),
            ("behind-model".into(), 0),
            ("ahead-model".into(), 1),
            ("behind-model".into(), 1),
            ("ahead-model".into(), 2),
        ],
    );

    // Combination-major: one climber's whole climb, then the next — the steering order
    // the caller passed, untouched.
    let (_, by_combo) = cell_sets(&ladder, LadderAxis::Combination, &standings);
    assert_eq!(
        placed(&by_combo, &ladder),
        vec![
            ("ahead-model".into(), 0),
            ("ahead-model".into(), 1),
            ("ahead-model".into(), 2),
            ("behind-model".into(), 0),
            ("behind-model".into(), 1),
        ],
    );
}

#[test]
fn one_case_pinned_on_two_rungs_is_one_cell() {
    // Rungs are distinct, but the runs underneath them are keyed by the case and the
    // combination: counting the cell twice would inflate the review buffer, and
    // offering it twice would ask for the same run to be judged under two headings.
    let ladder = climb_of(&["carom", "carom"]);
    let model = combo("claude-opus-5");
    let (_, reviewable) = cell_sets(
        &ladder,
        LadderAxis::Rung,
        &[standing(&model, ClimberStatus::Climbing, Some(1), &[0, 1])],
    );
    assert_eq!(
        placed(&reviewable, &ladder),
        vec![("claude-opus-5".into(), 0)]
    );
}
