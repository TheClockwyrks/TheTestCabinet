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
use test_cabinet_core::gg::{
    GgAgentConfig, GgCapabilitySet, GgConfigSlot, GgModelSlot, GgSlotTarget,
};
use test_cabinet_core::review::Rating;

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
    member: &'a PlanMember,
    status: ClimberStatus,
    current: Option<usize>,
    reached: &'a [usize],
) -> ClimberStanding<'a> {
    ClimberStanding {
        member,
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
            (cell.member.combo.model.clone(), position)
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
    let combos = vec![member("opus"), member("sonnet"), member("haiku")];
    let mut steer = HashMap::new();
    steer.insert(
        combination_key(&combos[2].combo),
        steering(&combination_key(&combos[2].combo), 10, false),
    );
    steer.insert(
        combination_key(&combos[1].combo),
        steering(&combination_key(&combos[1].combo), 0, true),
    );
    let order = climb_order(&combos, &steer);
    // Priority first (haiku), then the focused tiebreak among equal priorities
    // (sonnet), then declaration order for the rest (opus).
    assert_eq!(
        order
            .iter()
            .map(|&index| combos[index].combo.model.as_str())
            .collect::<Vec<_>>(),
        vec!["haiku", "sonnet", "opus"]
    );
}

#[test]
fn an_unsteered_climber_takes_its_declared_place_without_a_row() {
    let combos = vec![member("opus"), member("sonnet")];
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
        cell_key(&case, &member("opus")),
        (
            "carom".to_string(),
            "v1.2.0".to_string(),
            "hard".to_string(),
            "claude".to_string(),
            "opus".to_string(),
            // A harness combination has no gg identity: both segments are empty.
            String::new(),
            String::new(),
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
    let model = member("claude-opus-5");
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
    let walled = member("walled-model");
    let held = member("held-model");
    let topped = member("topped-model");
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
    let model = member("claude-opus-5");
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
    let ahead = member("ahead-model");
    let behind = member("behind-model");
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
    let model = member("claude-opus-5");
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

    // They climb as separate rows on the board, each taking its own steering.
    let combos = vec![
        gg_member("cfg-1", "opus", "haiku"),
        gg_member("cfg-1", "opus", "sonnet"),
    ];
    let mut steer = HashMap::new();
    steer.insert(critic_sonnet.clone(), steering(&critic_sonnet, 10, false));
    assert_eq!(climb_order(&combos, &steer), vec![1, 0]);
}

#[test]
fn a_gg_climber_read_off_the_board_is_steered_and_overridden_as_itself() {
    // What a board hands a client: the configuration's name and the root model filled in,
    // and the harness resolved to gg.
    let read = gg_member("cfg-1", "opus", "haiku").combo;
    assert_eq!(read.gg_config_name.as_deref(), Some("Critic sweep"));
    assert_eq!(read.model, "opus");
    assert_eq!(read.harness, HarnessSlug::Gg);

    // A console echoing that straight back into `POST /ladders/{id}/climbers` or
    // `.../outcomes` addresses the climber it was reading, not a second one nothing on the
    // ladder refers to — because both keys are taken from the member as it is stored.
    let stored = gg_combo("cfg-1", "opus", "haiku");
    assert_ne!(read, stored, "the read shape really does differ");
    assert_eq!(climber_key(&read), climber_key(&stored));

    // Even a client that hands back a stale name and a stale root model — a configuration
    // renamed and re-bound since it was read — steers the same climber, since neither is
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
        runs_override: None,
    };
    let case = rung_case(&rung);
    // The key `rung_runs` asks the store for. The two gg segments are what keep one
    // configuration's runs out of another's evidence: the configuration's id, because that is
    // what it is across time, and the bound models, because one configuration runs several.
    assert_eq!(
        cell_key(&case, &gg_member("cfg-1", "opus", "haiku")),
        (
            "carom".to_string(),
            "v1.2.0".to_string(),
            "hard".to_string(),
            "gg".to_string(),
            "opus".to_string(),
            "cfg-1".to_string(),
            "reviewer=haiku,root=opus".to_string(),
        )
    );
    // Same case, same root model, a different configuration: a different cell, so a climber
    // walled on one configuration is not walled by the other's runs.
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
        cell_key(&case, &gg_member("cfg-1", "opus", "haiku")).5,
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
    // And it still keys as itself, so the verdicts and the steering it earned stay
    // attached to it and come back the moment the configuration does.
    assert_eq!(
        climber_key(&member.combo),
        climber_key(&gg_combo("cfg-9", "opus", "haiku"))
    );

    // What the top-up walk sees: a rung that wants nothing more, so the buffer is spent on
    // the climbers that can still move.
    let demand = CellDemand {
        target: 5,
        completed: 2,
        in_flight: 1,
        unreviewed: 2,
        harness: 0,
    };
    let held_back = launchable_demand(demand, &member);
    assert_eq!(held_back.missing(), 0);
    // Its occupancy is untouched, though. Runs already launched have not un-launched
    // themselves, and they hold the review-buffer slots they always held.
    assert_eq!(held_back.outstanding(), demand.outstanding());
    assert!(
        demand.outstanding() > 0,
        "the demand really did occupy the buffer"
    );

    // A resolvable climber is handed through unchanged.
    assert_eq!(
        launchable_demand(demand, &gg_member("cfg-1", "opus", "haiku")),
        demand
    );
}

#[test]
fn a_climber_that_cannot_be_launched_says_so_on_the_board() {
    // The reason is the plan cell's reason, on the row the reviewer is actually looking at.
    // A ladder is where it is hardest to infer: a climber that cannot launch simply stops
    // moving, which reads exactly like one waiting on capacity, and the board is the only
    // place anybody looks between top-ups.
    let gone = gg_member("cfg-9", "opus", "haiku");
    let row = climber_row(
        climber_key(&gone.combo),
        &gone,
        None,
        ClimberStatus::Climbing,
        None,
        Vec::new(),
    );
    assert_eq!(row.unlaunchable, gone.unlaunchable);
    let reason = row.unlaunchable.expect("the board carries the reason");
    assert!(reason.contains("cfg-9"), "unexpected: {reason}");

    // And a climber that can be launched carries nothing, so the row is a reason to act
    // rather than a decoration every climber wears.
    let fine = gg_member("cfg-1", "opus", "haiku");
    let row = climber_row(
        climber_key(&fine.combo),
        &fine,
        Some(&steering(
            "gg:cfg-1|primary=opus,reviewer.critic=haiku",
            3,
            true,
        )),
        ClimberStatus::Climbing,
        None,
        Vec::new(),
    );
    assert!(row.unlaunchable.is_none());
    // The steering still arrives with it.
    assert_eq!(row.priority, 3);
    assert!(row.focused);
}

#[test]
fn two_climbers_that_cannot_be_launched_are_two_cells() {
    // Neither resolves to a launch identity, so both carry the same cell key with no runs
    // under it. They are still two climbers, and a top-up that reported one of them would
    // leave the other stuck on a rung with nothing said about why.
    let ladder = climb_of(&["carom"]);
    let gone = gg_member("cfg-8", "opus", "haiku");
    let also_gone = gg_member("cfg-9", "opus", "haiku");
    assert!(gone.unlaunchable.is_some() && also_gone.unlaunchable.is_some());
    let (active, _) = cell_sets(
        &ladder,
        LadderAxis::Rung,
        &[
            standing(&gone, ClimberStatus::Climbing, Some(0), &[0]),
            standing(&also_gone, ClimberStatus::Climbing, Some(0), &[0]),
        ],
    );
    let named: Vec<Option<&str>> = active
        .iter()
        .map(|cell| cell.member.combo.gg_config_id.as_deref())
        .collect();
    assert_eq!(named, vec![Some("saved:cfg-8"), Some("saved:cfg-9")]);

    // One such climber standing where two rungs pin one case is still one cell: the
    // de-dupe that stops a case being counted and offered twice is untouched.
    let twice = climb_of(&["carom", "carom"]);
    let (_, reviewable) = cell_sets(
        &twice,
        LadderAxis::Rung,
        &[standing(&gone, ClimberStatus::Climbing, Some(1), &[0, 1])],
    );
    assert_eq!(reviewable.len(), 1);
}
