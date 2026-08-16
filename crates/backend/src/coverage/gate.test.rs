use super::*;

/// A completed run the requester has reviewed, whose build loaded.
fn rated(rating: Rating) -> RungRun {
    RungRun {
        rating: Some(rating),
        loaded: true,
    }
}

/// A completed run the requester has not reviewed, whose build loaded.
fn unreviewed() -> RungRun {
    RungRun {
        rating: None,
        loaded: true,
    }
}

/// A completed run whose build never loaded, with no review recorded.
fn unloaded() -> RungRun {
    RungRun {
        rating: None,
        loaded: false,
    }
}

/// `n` copies of one run, for stating a rung's evidence in one line.
fn many(run: RungRun, n: usize) -> Vec<RungRun> {
    vec![run; n]
}

/// The gate from the module's first worked example: "stop when over half are
/// broken", deciding as soon as the answer is certain so the tests can state
/// partial rungs.
fn over_half_broken() -> Gate {
    Gate {
        floor: Rating::Scuffed,
        threshold: GateThreshold::Fraction { fraction: 0.5 },
        unloaded_counts_as_broken: true,
        early_stop: true,
    }
}

/// "stop when all are broken" — the default rule, made early-stopping.
fn all_broken() -> Gate {
    Gate {
        early_stop: true,
        ..Gate::default()
    }
}

/// "pass if any run is passable or better".
fn any_passable() -> Gate {
    Gate {
        floor: Rating::Passable,
        threshold: GateThreshold::Count { runs: 1 },
        unloaded_counts_as_broken: true,
        early_stop: true,
    }
}

#[test]
fn the_default_gate_walls_only_a_wholly_broken_rung() {
    // The gentlest useful rule: one playable run out of five is enough.
    let gate = all_broken();
    let mut runs = many(rated(Rating::Broken), 4);
    runs.push(rated(Rating::Scuffed));
    assert_eq!(evaluate(&runs, 5, &gate), GateOutcome::Advance);

    assert_eq!(
        evaluate(&many(rated(Rating::Broken), 5), 5, &gate),
        GateOutcome::Wall
    );
}

#[test]
fn over_half_broken_walls_at_three_of_five() {
    // 0.5 of five is 2.5, so three passing runs clear it and two do not — which is
    // "over half are broken" stated from the other side.
    let gate = over_half_broken();
    let mut passing_three = many(rated(Rating::Scuffed), 3);
    passing_three.extend(many(rated(Rating::Broken), 2));
    assert_eq!(evaluate(&passing_three, 5, &gate), GateOutcome::Advance);

    let mut passing_two = many(rated(Rating::Scuffed), 2);
    passing_two.extend(many(rated(Rating::Broken), 3));
    assert_eq!(evaluate(&passing_two, 5, &gate), GateOutcome::Wall);
}

#[test]
fn any_passable_run_clears_a_passable_floor() {
    let gate = any_passable();
    let mut runs = many(rated(Rating::Scuffed), 4);
    runs.push(rated(Rating::Passable));
    assert_eq!(evaluate(&runs, 5, &gate), GateOutcome::Advance);

    // Scuffed is below the floor however many times it happens.
    assert_eq!(
        evaluate(&many(rated(Rating::Scuffed), 5), 5, &gate),
        GateOutcome::Wall
    );
}

#[test]
fn a_rating_better_than_the_floor_passes_it() {
    // The floor is the *worst* rating that still counts, so everything above it
    // counts too. Guards against the rank comparison being flipped.
    let gate = any_passable();
    for rating in [Rating::Flawless, Rating::Great, Rating::Passable] {
        assert_eq!(
            evaluate(&[rated(rating)], 1, &gate),
            GateOutcome::Advance,
            "{rating:?} should clear a passable floor"
        );
    }
    for rating in [Rating::Scuffed, Rating::Broken] {
        assert_eq!(
            evaluate(&[rated(rating)], 1, &gate),
            GateOutcome::Wall,
            "{rating:?} should not clear a passable floor"
        );
    }
}

#[test]
fn an_unreviewed_run_leaves_the_rung_undecided_rather_than_walling_it() {
    // The requester has not judged these, which is not the same as judging them
    // badly — the climber holds instead of being walled on absent evidence.
    let gate = all_broken();
    assert_eq!(
        evaluate(&many(unreviewed(), 5), 5, &gate),
        GateOutcome::Undecided
    );

    let mut mixed = many(rated(Rating::Broken), 4);
    mixed.push(unreviewed());
    assert_eq!(evaluate(&mixed, 5, &gate), GateOutcome::Undecided);
}

#[test]
fn an_unloaded_run_is_judged_broken_without_a_review() {
    // Nothing loaded, so there is nothing for a reviewer to say: the gate decides
    // immediately rather than stalling the climb and holding a buffer slot.
    let gate = all_broken();
    assert_eq!(evaluate(&many(unloaded(), 5), 5, &gate), GateOutcome::Wall);

    let counts = tally(&many(unloaded(), 5), 5, &gate);
    assert_eq!(counts.judged, 5);
    assert_eq!(counts.unjudged, 0);
    assert_eq!(counts.passing, 0);
}

#[test]
fn an_unloaded_run_is_only_decided_when_the_gate_says_so() {
    // Turned off, an unloaded run is ordinary unreviewed evidence again.
    let gate = Gate {
        unloaded_counts_as_broken: false,
        ..all_broken()
    };
    assert_eq!(
        evaluate(&many(unloaded(), 5), 5, &gate),
        GateOutcome::Undecided
    );
    assert_eq!(tally(&many(unloaded(), 5), 5, &gate).unjudged, 5);
}

#[test]
fn an_unloaded_run_outranks_a_review_that_contradicts_it() {
    // A review of a build that never loaded cannot be describing something that
    // ran, so the unloaded verdict wins rather than being taken at face value.
    let gate = all_broken();
    let contradicted = RungRun {
        rating: Some(Rating::Flawless),
        loaded: false,
    };
    assert_eq!(evaluate(&[contradicted], 1, &gate), GateOutcome::Wall);
}

#[test]
fn a_rung_with_runs_still_to_complete_is_undecided_by_default() {
    // early_stop off: the rung finishes what it started, however certain the
    // outcome already is. Five broken runs out of five would wall — four out of a
    // target of five does not.
    let gate = Gate::default();
    assert_eq!(
        evaluate(&many(rated(Rating::Broken), 4), 5, &gate),
        GateOutcome::Undecided
    );
    // Even an already-certain *pass* waits, because the runs are evidence in their
    // own right.
    assert_eq!(
        evaluate(&[rated(Rating::Flawless)], 5, &gate),
        GateOutcome::Undecided
    );
    // And decides the moment the last run lands.
    assert_eq!(
        evaluate(&many(rated(Rating::Broken), 5), 5, &gate),
        GateOutcome::Wall
    );
}

#[test]
fn early_stop_decides_on_partial_results() {
    let gate = all_broken();
    // One playable run is all this gate ever needed; the remaining four are moot.
    assert_eq!(
        evaluate(&[rated(Rating::Scuffed)], 5, &gate),
        GateOutcome::Advance
    );
    // And a wall lands as soon as the best remaining case cannot clear the bar.
    let gate = Gate {
        threshold: GateThreshold::Count { runs: 3 },
        ..over_half_broken()
    };
    // Three broken of a target of five leaves two runs, one short of the three
    // required, so the answer is already fixed.
    assert_eq!(
        evaluate(&many(rated(Rating::Broken), 3), 5, &gate),
        GateOutcome::Wall
    );
    // With a target of six, three remain and the rung could still clear it.
    assert_eq!(
        evaluate(&many(rated(Rating::Broken), 3), 6, &gate),
        GateOutcome::Undecided
    );
}

#[test]
fn a_fractional_bar_is_measured_against_the_run_count_the_rung_will_finish_with() {
    // Half of the *final* five, not half of however many have landed so far —
    // otherwise the bar would move under the climber as runs complete one by one.
    let gate = over_half_broken();
    assert_eq!(tally(&[], 5, &gate).required, 2.5);
    assert_eq!(
        tally(&many(rated(Rating::Scuffed), 2), 5, &gate).required,
        2.5
    );
    // Hand-launched extras past the target raise it: the rung really will end with
    // seven runs, so half of seven is the honest bar.
    assert_eq!(
        tally(&many(rated(Rating::Scuffed), 7), 5, &gate).required,
        3.5
    );
}

#[test]
fn a_fraction_that_is_exact_in_decimal_is_not_demanded_twice_over() {
    // (3/17) * 85 is a hair above 15 in binary floating point. Without the epsilon
    // this would demand a sixteenth passing run out of a rung of 85.
    let gate = Gate {
        floor: Rating::Scuffed,
        threshold: GateThreshold::Fraction {
            fraction: 3.0 / 17.0,
        },
        unloaded_counts_as_broken: true,
        early_stop: true,
    };
    let mut runs = many(rated(Rating::Scuffed), 15);
    runs.extend(many(rated(Rating::Broken), 70));
    assert_eq!(evaluate(&runs, 85, &gate), GateOutcome::Advance);
    assert_eq!(tally(&runs, 85, &gate).required_runs(), 15);
}

#[test]
fn a_nonsense_fraction_is_clamped_rather_than_propagated() {
    // A corrupt row must not put a bar on the rung that no evidence can describe.
    // Below the range — and a non-finite value, which valid JSON cannot produce but
    // a damaged row can — degrades to "always advance", the harmless direction.
    for fraction in [-1.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let gate = Gate {
            floor: Rating::Flawless,
            threshold: GateThreshold::Fraction { fraction },
            unloaded_counts_as_broken: true,
            early_stop: true,
        };
        assert_eq!(
            evaluate(&many(rated(Rating::Broken), 5), 5, &gate),
            GateOutcome::Advance,
            "fraction {fraction} should not wall"
        );
    }
    // Above the range clamps to "every run must pass" — a real bar, and the
    // strictest one expressible, but never one demanding runs the rung cannot have.
    let gate = Gate {
        floor: Rating::Scuffed,
        threshold: GateThreshold::Fraction { fraction: 2.0 },
        unloaded_counts_as_broken: true,
        early_stop: true,
    };
    assert_eq!(tally(&[], 5, &gate).required, 5.0);
    assert_eq!(
        evaluate(&many(rated(Rating::Scuffed), 5), 5, &gate),
        GateOutcome::Advance
    );
}

#[test]
fn an_empty_rung_advances_only_when_nothing_is_required() {
    // A fractional bar over zero runs is zero, which no evidence clears trivially;
    // an absolute count is not, so a rung with no runs at all is walled by it.
    let fractional = over_half_broken();
    assert_eq!(evaluate(&[], 0, &fractional), GateOutcome::Advance);
    assert_eq!(evaluate(&[], 0, &all_broken()), GateOutcome::Wall);
}

#[test]
fn the_tally_explains_the_decision_it_made() {
    // The dashboard renders these rather than re-deriving the floor and unloaded
    // rules a second time, so they must describe the same rung the outcome did.
    let gate = over_half_broken();
    let runs = [
        rated(Rating::Flawless),
        rated(Rating::Broken),
        unreviewed(),
        unloaded(),
    ];
    let counts = tally(&runs, 6, &gate);
    assert_eq!(counts.completed, 4);
    assert_eq!(counts.judged, 3);
    assert_eq!(counts.unjudged, 1);
    assert_eq!(counts.passing, 1);
    assert_eq!(counts.pending, 2);
    assert_eq!(counts.required, 3.0);
}

#[test]
fn required_runs_rounds_a_fractional_bar_up_to_whole_runs() {
    // 2.5 runs means three; an exact 3.0 must not be inflated to four.
    let gate = over_half_broken();
    assert_eq!(tally(&[], 5, &gate).required_runs(), 3);
    assert_eq!(tally(&[], 6, &gate).required_runs(), 3);
    assert_eq!(tally(&[], 0, &gate).required_runs(), 0);
}

#[test]
fn a_stored_gate_written_before_the_later_flags_existed_keeps_their_defaults() {
    // The two flags carry serde defaults so an older row deserializes to the
    // documented behaviour rather than failing or silently early-stopping.
    let gate: Gate =
        serde_json::from_str(r#"{"floor":"scuffed","threshold":{"kind":"count","runs":1}}"#)
            .expect("a gate without the later flags should deserialize");
    assert_eq!(gate, Gate::default());
    assert!(gate.unloaded_counts_as_broken);
    assert!(!gate.early_stop);
}

#[test]
fn a_gate_round_trips_through_its_wire_form() {
    let gate = over_half_broken();
    let json = serde_json::to_string(&gate).expect("a gate should serialize");
    assert_eq!(
        serde_json::from_str::<Gate>(&json).expect("a gate should deserialize"),
        gate
    );
    // The threshold is tagged, so the console can tell the two shapes apart.
    assert!(json.contains(r#""kind":"fraction""#), "{json}");
}
