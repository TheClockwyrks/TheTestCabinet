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
    let silent = read(None, "");
    let case = Case {
        shape: Shape::FailureValue,
        program: "",
        names: &[],
        located: Located::Nowhere,
        answered: Answered::AtRuntime,
        recorded: None,
    };
    let why = satisfies(&silent, &case).expect_err("an empty body satisfies nothing");
    assert!(
        why.contains("recorded as a success"),
        "the reason names what makes it bad: {why}"
    );

    // Fatal is worse than empty and is reported as its own thing: the failure was gg's, the run is
    // over, and no arm may answer a program fault with it.
    let fatal = Read {
        model: ModelFacing {
            fatal: true,
            ..silent.model
        },
        attached: None,
    };
    let why = satisfies(&fatal, &case).expect_err("a fatal fault satisfies nothing");
    assert!(why.contains("ended the run"), "{why}");
}

/// A cell states whether its program ran, and a cell that changes state fails.
///
/// The check that separates a runtime failure from a compiler's refusal to express one. Both
/// satisfy every other assertion here — a refusal names the fault in the compiler's own words and
/// carries its own line — so without this the twenty-four cells that pass would read as
/// twenty-four real runs when five of them never reached one.
#[test]
fn a_cell_declares_whether_its_program_ran() {
    let refused = read(
        Some(GgContextSource::CompilerError),
        "program.ts(4,1): error TS2591: Cannot find name 'process'.",
    );
    let case = Case {
        shape: Shape::Abort,
        program: "",
        names: &["Cannot find name 'process'"],
        located: Located::Nowhere,
        answered: Answered::ByRefusingToCompile,
        recorded: Some(TurnErrorType::TranspileCompile),
    };
    assert!(satisfies(&refused, &case).is_ok());

    // The same message under a cell that claims a run: what the arm did changed, and the row has
    // not moved with it.
    let claims_a_run = Case {
        answered: Answered::AtRuntime,
        ..case
    };
    let why = satisfies(&refused, &claims_a_run).expect_err("a refusal is not a run");
    assert!(why.contains("its runtime reported the fault"), "{why}");

    // And in the other direction: an arm that starts running a shape it used to refuse.
    let ran = read(
        Some(GgContextSource::RuntimeError),
        "Cannot find name 'process'",
    );
    let why = satisfies(&ran, &case).expect_err("a run is not a refusal");
    assert!(why.contains("the compiler refused the program"), "{why}");
}

/// A [`Read`] built from a band and a body, for the assertions that drive no arm.
fn read(source: Option<GgContextSource>, body: &str) -> Read {
    Read {
        model: ModelFacing {
            source,
            body: body.to_string(),
            error: None,
            fatal: false,
        },
        attached: None,
    }
}

/// A located shape must carry the model's own coordinates, and an unlocated one must carry none.
#[test]
fn the_location_is_checked_in_both_directions() {
    let located = Read {
        attached: Some("line 7, column 13".to_string()),
        ..read(
            Some(GgContextSource::RuntimeError),
            "IndexError: list index out of range\n    at line 7, column 13",
        )
    };
    let right = Case {
        shape: Shape::NativeFault,
        program: "",
        names: &["IndexError"],
        located: Located::At("line 7, column 13"),
        answered: Answered::AtRuntime,
        recorded: Some(TurnErrorType::ProgramThrow),
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
    let doubled = Read {
        attached: Some("line 1445, column 9".to_string()),
        ..read(
            Some(GgContextSource::RuntimeError),
            "Error: java.lang.IndexOutOfBoundsException\n    at program.java:5\n    at line 1445, \
             column 9",
        )
    };
    let case = Case {
        shape: Shape::NativeFault,
        program: "",
        names: &["java.lang.IndexOutOfBoundsException"],
        located: Located::At("program.java:5"),
        answered: Answered::AtRuntime,
        recorded: Some(TurnErrorType::SandboxTrap),
    };
    let why = satisfies(&doubled, &case).expect_err("a second location satisfies nothing");
    assert!(why.contains("a second location"), "{why}");

    // A guest that indents a stack frame the way gg indents its own location line attaches nothing,
    // because the gate reads the outcome's field rather than the rendered text.
    let framed = read(
        Some(GgContextSource::RuntimeError),
        "IndexError: list index out of range\n    at Program.Deeper (int)",
    );
    let nothing_attached = Case {
        located: Located::Nowhere,
        names: &["IndexError"],
        ..case
    };
    assert!(satisfies(&framed, &nothing_attached).is_ok());
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
