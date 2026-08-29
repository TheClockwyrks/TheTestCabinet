//! Tests for **`gg selfcheck`** — the arm selection and the report.
//!
//! # What is tested here, and what is not
//!
//! Driving an arm costs a real compiler and a real guest: the eleven together are minutes of wall
//! clock and about 2 GB of peak resident memory, and the whole point of the subcommand is that the
//! answer depends on the *environment*, which a test cannot pin. Running it here would therefore be
//! slow and would prove the wrong thing — a green test on this machine is exactly the reassurance
//! that let the C# arm ship broken.
//!
//! So the subcommand's own gate is the subcommand, run in the image, and what these tests hold are
//! the parts that decide **what gets driven and what an operator is told**, each of which can be
//! wrong in a way the image gate would not catch:
//!
//! 1. **The set is the registry's.** Every [`GgProgramLanguage::ALL`] member is driven when nothing
//!    is named, in registration order — so a twelfth arm cannot be silently skipped by a gate that
//!    kept its own list.
//! 2. **Selection is exact.** Named arms narrow the set, keep registration order however the flags
//!    were written, and fold a repeat; an unknown id is refused by name rather than quietly
//!    checking nothing and exiting zero.
//! 3. **A failure is reported whole.** The report carries the failing arm's entire sentence,
//!    however many lines it runs to, and says which step it stopped in and — where the seam typed
//!    it — whose failure it was.
//! 4. **A pass is legible.** The line carries the arm, its verdict, both timings and what the
//!    program placed.
//! 5. **The exit code is failure exactly when an arm failed**, which is the whole of what the image
//!    build reads.

use super::*;

/// A passing check, with timings that render distinguishably.
fn passed(language: GgProgramLanguage, placed: usize) -> ArmCheck {
    ArmCheck {
        language,
        warm: Duration::from_millis(3_400),
        bootstrap: Some(Duration::from_millis(1_200)),
        outcome: Ok(placed),
    }
}

/// A check that failed in the bootstrap round trip, carrying `detail` as the seam handed it over.
fn failed(language: GgProgramLanguage, detail: &str) -> ArmCheck {
    ArmCheck {
        language,
        warm: Duration::from_millis(900),
        bootstrap: Some(Duration::from_millis(4_100)),
        outcome: Err(Failure {
            phase: Phase::Bootstrap,
            attribution: None,
            detail: detail.to_string(),
        }),
    }
}

/// The whole failure sentence the reported C# run died on, in the shape this subcommand exists to
/// surface: several lines, the last of them a compiler's stderr tail.
const CSHARP_SENTENCE: &str = "gg's C# bootstrap program did not prepare: the program's compiler \
                               could not finish: `csc` exited on signal 6 (SIGABRT)\nstderr: \
                               Process terminated. Couldn't find a valid ICU package installed on \
                               the system.\n   at \
                               System.Globalization.GlobalizationMode.GetGlobalizationInvariantMode()";

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/// Naming nothing drives **every registered arm**, in registration order.
///
/// Asserted against [`GgProgramLanguage::ALL`] rather than against a list written here, which is the
/// property: `all_languages` is derived from that constant, so an arm added to the enum arrives in
/// this gate without anybody editing it — and this test would fail if selection ever grew a list of
/// its own.
#[test]
fn every_registered_arm_is_driven_when_none_is_named() {
    let selected = select(&[]).expect("naming no arm selects every arm");
    let ids: Vec<GgProgramLanguage> = selected.iter().map(|arm| arm.id()).collect();
    assert_eq!(
        ids,
        GgProgramLanguage::ALL.to_vec(),
        "the checked set is `GgProgramLanguage::ALL`, in registration order"
    );
}

/// The eleven arms are all there — a count beside the identity above, so a registry that somehow
/// shrank to one entry that happened to match would still fail.
#[test]
fn the_selected_set_is_the_whole_registry() {
    assert_eq!(
        select(&[]).expect("naming no arm selects every arm").len(),
        GgProgramLanguage::COUNT
    );
}

/// `--language` narrows the set to exactly what was named.
#[test]
fn named_arms_narrow_the_set() {
    let selected = select(&["rust".to_string(), "typescript".to_string()])
        .expect("two registered ids select two arms");
    let ids: Vec<GgProgramLanguage> = selected.iter().map(|arm| arm.id()).collect();
    assert_eq!(
        ids,
        vec![GgProgramLanguage::TypeScript, GgProgramLanguage::Rust],
        "the arms come back in registration order, not in the order the flags were written"
    );
}

/// A repeated id is one arm, not two: the flag names a set.
#[test]
fn a_repeated_arm_is_checked_once() {
    let selected =
        select(&["csharp".to_string(), "csharp".to_string()]).expect("a repeat is not an error");
    let ids: Vec<GgProgramLanguage> = selected.iter().map(|arm| arm.id()).collect();
    assert_eq!(ids, vec![GgProgramLanguage::CSharp]);
}

/// An id gg does not know is **refused**, by name, with the registered arms listed.
///
/// The alternative — skipping it — exits zero having checked nothing, which is the one answer a gate
/// must never give wrongly.
#[test]
fn an_unknown_arm_is_refused_by_name() {
    let Err(refusal) = select(&["cobol".to_string()]) else {
        panic!("`cobol` is not one of gg's program languages, so it is refused");
    };
    assert!(
        refusal.contains("`cobol`"),
        "the refusal names the id it did not know: {refusal}"
    );
    for id in registered_ids() {
        assert!(
            refusal.contains(id),
            "the refusal lists `{id}` among the registered arms: {refusal}"
        );
    }
}

/// A known arm named beside an unknown one still refuses: a typo in one of four flags must not
/// quietly check three.
#[test]
fn one_unknown_arm_refuses_the_whole_selection() {
    assert!(select(&["rust".to_string(), "brainfuck".to_string()]).is_err());
}

/// The **fixture** arm the seam's own tests are written against is not selectable, because the
/// registry it is selected from does not carry it. Nothing an operator can type reaches a language
/// no run could be configured with.
#[test]
fn the_fixture_arm_is_not_selectable() {
    assert!(select(&["fixture".to_string()]).is_err());
    assert!(
        !registered_ids().contains(&"fixture"),
        "the registered ids are the ones a run could name"
    );
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/// A passing arm's line carries the arm, the verdict, both timings and what its program placed.
#[test]
fn a_passing_arm_renders_its_timings_and_what_it_placed() {
    let line = render_arm(&passed(GgProgramLanguage::TypeScript, 14));
    assert!(
        line.starts_with("typescript"),
        "the arm is named first: {line}"
    );
    assert!(line.contains(" ok "), "the verdict is legible: {line}");
    assert!(
        line.contains("warm   3.4s"),
        "the warm-up cost is there: {line}"
    );
    assert!(
        line.contains("bootstrap   1.2s"),
        "the round trip's cost is there: {line}"
    );
    assert!(
        line.contains("14 view(s)"),
        "what it placed is there: {line}"
    );
    assert_eq!(line.lines().count(), 1, "a passing arm is one line: {line}");
}

/// A failing arm carries its **whole** sentence, every line of it, indented beneath the line that
/// named the arm — because the part an operator needs is the compiler's own tail, which is the last
/// line of it.
#[test]
fn a_failing_arm_renders_its_whole_sentence() {
    let rendered = render_arm(&failed(GgProgramLanguage::CSharp, CSHARP_SENTENCE));
    assert!(
        rendered.starts_with("csharp"),
        "the arm is named first: {rendered}"
    );
    assert!(
        rendered.contains("FAILED"),
        "the verdict is scannable: {rendered}"
    );
    assert!(
        rendered.contains("bootstrap failed"),
        "the step it stopped in is named: {rendered}"
    );
    for sentence in CSHARP_SENTENCE.lines() {
        assert!(
            rendered.contains(&format!("{DETAIL_INDENT}{sentence}")),
            "every line of the failure is carried, indented: {rendered}"
        );
    }
    assert_eq!(
        rendered.lines().count(),
        1 + CSHARP_SENTENCE.lines().count(),
        "the line, then the whole report beneath it: {rendered}"
    );
}

/// Nothing in the report shortens a failure, however long it is. The sentence this exists for
/// carries a compiler's stderr tail, and a truncation would drop the end of it, which is the part
/// that names the missing library.
#[test]
fn a_failure_is_never_shortened() {
    let long = "x".repeat(20_000);
    let rendered = render_arm(&failed(GgProgramLanguage::Swift, &long));
    assert!(
        rendered.contains(&long),
        "a 20 000-character report survives whole"
    );
}

/// A failure the seam typed says **whose** it was; one it reported as prose does not claim to.
#[test]
fn a_typed_failure_names_its_owner() {
    let mut check = failed(GgProgramLanguage::Cpp, "the toolchain is not installed");
    check.outcome = Err(Failure {
        phase: Phase::WarmUp,
        attribution: Some(Attribution::Image),
        detail: "the toolchain is not installed".to_string(),
    });
    check.bootstrap = None;
    let rendered = render_arm(&check);
    assert!(
        rendered.contains("warm-up failed, the image's"),
        "the step and the owner are both named: {rendered}"
    );
    assert!(
        rendered.contains("bootstrap      -"),
        "a round trip that was never reached claims no measurement: {rendered}"
    );

    let prose = render_arm(&failed(GgProgramLanguage::CSharp, "something went wrong"));
    assert!(
        !prose.contains("the image's") && !prose.contains("gg's own"),
        "an untyped failure claims no owner: {prose}"
    );
}

/// The two owners a typed failure is split into come off the [`SandboxError`] predicates, not off a
/// second reading of its variants.
#[test]
fn a_toolchain_defect_is_the_images_and_the_rest_is_ggs() {
    assert_eq!(
        Attribution::of(&SandboxError::Toolchain("csc did not start".to_string())),
        Attribution::Image
    );
    assert_eq!(
        Attribution::of(&SandboxError::Compile(
            "the component is corrupt".to_string()
        )),
        Attribution::Harness
    );
    assert_eq!(
        Attribution::of(&SandboxError::Lowering("gg's own SDK".to_string())),
        Attribution::Harness
    );
}

/// The summary names every failing arm, so one CI log says which arms to fix rather than which arm
/// to fix first.
#[test]
fn the_summary_names_every_failing_arm() {
    let report = Report {
        checks: vec![
            passed(GgProgramLanguage::TypeScript, 14),
            failed(GgProgramLanguage::Swift, "swiftc did not finish"),
            failed(GgProgramLanguage::CSharp, CSHARP_SENTENCE),
        ],
    };
    let summary = render_summary(&report);
    assert!(summary.contains("3 arm(s) checked"), "{summary}");
    assert!(summary.contains("2 failed: swift, csharp"), "{summary}");
}

/// A clean report says so, and says what it cost.
#[test]
fn a_clean_summary_says_every_arm_passed() {
    let report = Report {
        checks: vec![
            passed(GgProgramLanguage::TypeScript, 14),
            passed(GgProgramLanguage::Rust, 12),
        ],
    };
    let summary = render_summary(&report);
    assert!(summary.contains("2 arm(s) checked"), "{summary}");
    assert!(summary.contains("all passed"), "{summary}");
    assert!(
        summary.contains("9.2s"),
        "the summary carries what the set cost: {summary}"
    );
}

/// Over a minute the elapsed figure reads in minutes and seconds — the shape an eleven-arm run
/// actually has.
#[test]
fn a_long_run_reads_in_minutes() {
    assert_eq!(duration(Duration::from_secs(124)), "2m04s");
    assert_eq!(duration(Duration::from_millis(4_060)), "4.1s");
}

// ---------------------------------------------------------------------------
// The exit code
// ---------------------------------------------------------------------------

/// Success **only** when every driven arm passed.
#[test]
fn the_exit_code_is_success_only_when_every_arm_passed() {
    let clean = Report {
        checks: vec![
            passed(GgProgramLanguage::TypeScript, 14),
            passed(GgProgramLanguage::Rust, 12),
        ],
    };
    assert!(clean.failed().is_empty());
    assert_eq!(
        format!("{:?}", clean.exit_code()),
        format!("{:?}", ExitCode::SUCCESS)
    );

    let broken = Report {
        checks: vec![
            passed(GgProgramLanguage::TypeScript, 14),
            failed(GgProgramLanguage::CSharp, CSHARP_SENTENCE),
        ],
    };
    assert_eq!(broken.failed(), vec!["csharp"]);
    assert_eq!(
        format!("{:?}", broken.exit_code()),
        format!("{:?}", ExitCode::FAILURE)
    );
}

/// One broken arm among ten sound ones still fails the gate: the exit code is an `any`, never a
/// majority.
#[test]
fn one_broken_arm_fails_the_whole_gate() {
    let mut checks: Vec<ArmCheck> = GgProgramLanguage::ALL
        .iter()
        .map(|language| passed(*language, 12))
        .collect();
    checks[GgProgramLanguage::CSharp.ordinal()] =
        failed(GgProgramLanguage::CSharp, CSHARP_SENTENCE);
    let report = Report { checks };
    assert_eq!(report.failed(), vec!["csharp"]);
    assert_eq!(
        format!("{:?}", report.exit_code()),
        format!("{:?}", ExitCode::FAILURE)
    );
}
