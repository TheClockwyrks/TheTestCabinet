//! **The table's own gate** — the assertions about [`KNOWN_HOLES`] that no single arm's run can
//! make, because each of those runs sees one arm and this file sees all of them.
//!
//! The rows themselves are checked where they are earned, inside [`gate`]: an arm's run pins what
//! its held cells say and fails the moment one of them starts telling the truth. What is left over
//! is the shape of the table, and it is worth holding because a table nobody can trust is worse
//! than no table: a duplicated row means one of the two is dead, and a row naming a shape the arm
//! never drives is a hole that has stopped being measured.

use super::*;

/// No cell is recorded twice.
///
/// A duplicate row is a row that never fires — [`gate`] takes the first match — so the second is a
/// claim about an arm that nothing checks. It is exactly the state a hand-maintained table drifts
/// into, and it is invisible from inside any one arm's run.
#[test]
fn every_recorded_hole_names_a_cell_once() {
    let mut seen: Vec<(GgProgramLanguage, Shape)> = Vec::new();
    for hole in KNOWN_HOLES {
        let cell = (hole.arm, hole.shape);
        assert!(
            !seen.contains(&cell),
            "{} {} is recorded twice; the second row is never read",
            hole.arm,
            hole.shape.label()
        );
        seen.push(cell);
    }
}

/// Every row names an arm that is actually registered.
///
/// A row for an arm gg no longer has is a hole that cannot be closed and cannot be measured, and it
/// would quietly outlive the arm it describes.
#[test]
fn every_recorded_hole_names_a_registered_arm() {
    for hole in KNOWN_HOLES {
        assert!(
            GgProgramLanguage::ALL.contains(&hole.arm),
            "{} is recorded as holding {} and is not a registered arm",
            hole.arm,
            hole.shape.label()
        );
    }
}

/// A body that says nothing fails, whatever the turn was recorded as.
///
/// The requirement's literal floor, and the check most likely to be weakened by accident: a gate
/// that only looked for tokens would pass an empty body for a case with an empty `names`.
#[test]
fn a_silent_turn_never_satisfies_the_gate() {
    let silent = ModelFacing {
        source: None,
        body: String::new(),
        error: None,
        fatal: false,
    };
    let case = Case {
        shape: Shape::FailureValue,
        program: "",
        names: &[],
        located: Located::Nowhere,
    };
    let why = satisfies(&silent, &case).expect_err("an empty body satisfies nothing");
    assert!(
        why.contains("recorded as a success"),
        "the reason names what makes it bad: {why}"
    );

    // Fatal is worse than empty and is reported as its own thing: the failure was gg's, the run is
    // over, and no arm may answer a program fault with it.
    let fatal = ModelFacing {
        source: None,
        body: String::new(),
        error: None,
        fatal: true,
    };
    let why = satisfies(&fatal, &case).expect_err("a fatal fault satisfies nothing");
    assert!(why.contains("ended the run"), "{why}");
}

/// A located shape must carry the model's own coordinates, and an unlocated one must carry none.
#[test]
fn the_location_is_checked_in_both_directions() {
    let located = ModelFacing {
        source: Some(test_cabinet_core::gg::GgContextSource::RuntimeError),
        body: "IndexError: list index out of range\n    at line 7, column 13".to_string(),
        error: None,
        fatal: false,
    };
    let right = Case {
        shape: Shape::NativeFault,
        program: "",
        names: &["IndexError"],
        located: Located::At("line 7, column 13"),
    };
    assert!(satisfies(&located, &right).is_ok());

    // The off-by-N this gate exists to catch: a location that looks right and is not.
    let wrong = Case {
        located: Located::At("line 3, column 13"),
        ..right
    };
    let why = satisfies(&located, &wrong).expect_err("a wrong line satisfies nothing");
    assert!(why.contains("where the model wrote it"), "{why}");

    // And a cell recorded as unlocated fails the moment a location shows up, so nobody ships a
    // bogus one under a row that says there is none.
    let nowhere = Case {
        located: Located::Nowhere,
        ..right
    };
    let why = satisfies(&located, &nowhere).expect_err("an unexpected location satisfies nothing");
    assert!(why.contains("no location"), "{why}");

    // The Java shape: the model's own line inside the message, and a SECOND location appended out
    // of a file it did not write. The message alone would pass; the appended one is what the model
    // reads last, so it is the one held to the same standard.
    let doubled = ModelFacing {
        source: Some(test_cabinet_core::gg::GgContextSource::RuntimeError),
        body: "Error: java.lang.IndexOutOfBoundsException\n    at program.java:5\n    at line \
               1445, column 9"
            .to_string(),
        error: None,
        fatal: false,
    };
    let case = Case {
        shape: Shape::NativeFault,
        program: "",
        names: &["java.lang.IndexOutOfBoundsException"],
        located: Located::At("program.java:5"),
    };
    let why = satisfies(&doubled, &case).expect_err("a second location satisfies nothing");
    assert!(why.contains("a second location"), "{why}");
}

/// **Every registered arm is held to G8**, and the check is over the tree rather than over a list
/// somebody keeps.
///
/// It cannot be asked of the runs themselves: each arm's gate is its own `#[test]` and therefore
/// its own process under `cargo nextest`, so no arm's run can see whether another one happened. An
/// arm that simply never called [`gate`] would show up as eleven passing tests and one arm nobody
/// measured — which is the failure mode this whole module exists to prevent, arriving through the
/// back door.
///
/// So this reads the arm's own substrate test file, whose name is the arm's own id, and insists it
/// calls the gate. A twelfth arm registered without one fails here, by name, on the day it is
/// registered.
#[test]
fn every_registered_arm_is_held_to_the_gate() {
    let here = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/sandbox/language");
    for arm in GgProgramLanguage::ALL {
        let substrate = here.join(format!("{arm}.substrate.test.rs"));
        let source = std::fs::read_to_string(&substrate).unwrap_or_else(|failure| {
            panic!(
                "{arm} has no substrate test file at {}: {failure}",
                substrate.display()
            )
        });
        assert!(
            source.contains("g8::gate("),
            "{arm}'s substrate tests never drive gate G8; every registered arm answers all five \
             failure shapes"
        );
    }
}
