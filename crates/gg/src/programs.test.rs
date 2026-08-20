//! Tests for the [program library](super): what it keeps, what retention drops, what a miss says,
//! and how a profile's `keep` param resolves.

use serde_json::json;
use test_cabinet_core::gg::{GgAgentConfig, GgCapabilityConfig};

use crate::validate::{LaunchDefect, LaunchReport};

use super::*;

/// The library `profile` resolves to, asserting gg honoured its retention exactly as written.
fn library(profile: &GgAgentConfig) -> ProgramLibrary {
    let mut report = LaunchReport::collecting();
    let library = resolve_program_library(profile, &mut report);
    let defects = report.into_defects();
    assert!(defects.is_empty(), "unexpected refusals: {defects:?}");
    library
}

/// Everything `read` reports, for the cases whose subject is the refusal.
fn reported(read: impl FnOnce(&mut LaunchReport)) -> Vec<LaunchDefect> {
    let mut report = LaunchReport::collecting();
    read(&mut report);
    report.into_defects()
}

/// An agent profile enabling the library with **exactly** `params` — written verbatim rather than
/// merged over what the authoring catalog writes, because what most of these cases are about is a
/// params block with a hole in it.
fn profile(params: serde_json::Value) -> GgAgentConfig {
    let mut capability = GgCapabilityConfig::enabled(CAPABILITY_PROGRAM_LIBRARY);
    capability.params = params;
    GgAgentConfig {
        capabilities: vec![capability],
        ..GgAgentConfig::root()
    }
}

#[test]
fn a_disabled_library_keeps_nothing_and_can_be_asked_for_nothing() {
    let mut library = ProgramLibrary::disabled();
    library.record(1, "harness.finish('x')", true, None);

    assert!(!library.is_enabled());
    assert!(library.summaries().is_empty());
    // The object is not bound for such an agent, so this is a defensive path rather than one a
    // program can reach — but it must still refuse rather than invent a program.
    assert!(library.source(None).is_err());
}

#[test]
fn the_most_recent_program_is_what_get_returns_with_no_turn() {
    let mut library = ProgramLibrary::enabled(None);
    library.record(1, "first", true, None);
    library.record(2, "second", true, None);

    assert_eq!(library.source(None).unwrap(), "second");
    assert_eq!(library.source(Some(1)).unwrap(), "first");
}

#[test]
fn recording_the_same_turn_twice_replaces_rather_than_accrues() {
    // The shape this models is a chained turn: gg runs the hand-over trampoline and then the
    // program it handed over, and the turn records once — with the program that did the work.
    let mut library = ProgramLibrary::enabled(None);
    library.record(7, "programs.rerun(patched)", true, None);
    library.record(7, "the patched program", true, None);

    assert_eq!(library.summaries().len(), 1);
    assert_eq!(library.source(Some(7)).unwrap(), "the patched program");
}

#[test]
fn retention_drops_the_oldest_and_a_miss_names_what_is_held() {
    let mut library = ProgramLibrary::enabled(Some(2));
    library.record(1, "one", true, None);
    library.record(2, "two", true, None);
    library.record(3, "three", true, None);

    let turns: Vec<u64> = library
        .summaries()
        .into_iter()
        .map(|summary| summary.turn)
        .collect();
    assert_eq!(turns, vec![2, 3]);

    let refusal = library.source(Some(1)).unwrap_err();
    assert_eq!(refusal.failure, ToolFailure::NotFound);
    // Naming the turns that *are* held is the whole point of the message: without it the model
    // spends a second turn discovering the same thing.
    assert!(refusal.message.contains("2, 3"), "{}", refusal.message);
}

#[test]
fn an_empty_library_says_there_is_nothing_to_fetch() {
    let library = ProgramLibrary::enabled(None);
    let refusal = library.source(None).unwrap_err();

    assert!(
        refusal.message.contains("no program has been kept yet"),
        "{}",
        refusal.message
    );
}

#[test]
fn a_summary_describes_the_shape_and_the_failure_but_never_the_source() {
    let mut library = ProgramLibrary::enabled(None);
    library.record(
        4,
        "const x = 1;\nfs.readFile(x);",
        false,
        Some("`read_file` failed (invalid-argument): path must be a string".to_string()),
    );

    let summary = library.summaries().pop().unwrap();
    assert_eq!(summary.turn, 4);
    assert_eq!(summary.lines, 2);
    assert_eq!(summary.chars, 28);
    assert!(!summary.ok);
    assert!(summary.error.unwrap().contains("read_file"));
}

#[test]
fn a_failed_program_is_still_kept_because_fixing_it_is_the_point() {
    let mut library = ProgramLibrary::enabled(None);
    library.record(
        1,
        "cosnt x = 1;",
        false,
        Some("did not compile".to_string()),
    );

    assert_eq!(library.source(None).unwrap(), "cosnt x = 1;");
}

#[test]
fn an_absent_capability_resolves_to_no_library() {
    assert!(!library(&GgAgentConfig::root()).is_enabled());
}

#[test]
fn a_disabled_capability_configures_nothing() {
    assert!(
        !library(&GgAgentConfig {
            capabilities: vec![GgCapabilityConfig::disabled(CAPABILITY_PROGRAM_LIBRARY)],
            ..GgAgentConfig::root()
        })
        .is_enabled()
    );
}

/// A written retention is honoured, and `0` is the widest one rather than the narrowest.
#[test]
fn a_written_keep_is_honoured_and_zero_means_every_program() {
    assert_eq!(library(&profile(json!({ "keep": 3 }))).keep, Some(3));
    assert_eq!(
        library(&profile(json!({ "keep": 0 }))).keep,
        KEEP_EVERY_PROGRAM
    );
    // An integral float names the same retention — JSON has no integer type, and refusing `3.0`
    // would be a usability failure rather than a fallback fix.
    assert_eq!(library(&profile(json!({ "keep": 3.0 }))).keep, Some(3));
}

/// **An enabled library with no `keep` refuses the launch.** `0` already means *keep the whole
/// session*, so an absence cannot be read as one without gg picking between two opposite
/// statements — and a study that held twenty programs where its record said it held every one is
/// the wrong-arm failure the refusal exists to prevent.
#[test]
fn an_absent_keep_is_refused() {
    for params in [json!({}), json!({ "keep": null })] {
        let defects = reported(|report| {
            resolve_program_library(&profile(params.clone()), report);
        });
        assert_eq!(defects.len(), 1, "{params} -> {defects:?}");
        assert_eq!(defects[0].locus, "program-library.params.keep");
        assert_eq!(defects[0].found, "", "an absence has no value as written");
    }
}

/// …and the library it hands back is the named placeholder, not a retention of gg's choosing.
#[test]
fn a_refused_keep_resolves_to_the_placeholder() {
    let mut report = LaunchReport::collecting();
    let library = resolve_program_library(&profile(json!({})), &mut report);
    assert!(!report.is_empty(), "the launch must already be refused");
    assert_eq!(library.keep, KEEP_LAUNCH_REFUSED);
    assert_ne!(
        library.keep, KEEP_EVERY_PROGRAM,
        "a refusal must not read as the widest setting an operator can ask for"
    );
}

/// **A disabled capability is short of nothing.** It builds no library, and an absent `keep` on one
/// is not a hole: there is no retention for a switched-off capability to have stated.
#[test]
fn a_disabled_capability_without_a_keep_is_not_refused() {
    let defects = reported(|report| {
        check_launch(
            &GgAgentConfig {
                capabilities: vec![GgCapabilityConfig {
                    params: json!({}),
                    ..GgCapabilityConfig::disabled(CAPABILITY_PROGRAM_LIBRARY)
                }],
                ..GgAgentConfig::root()
            },
            report,
        );
    });
    assert!(defects.is_empty(), "{defects:?}");
}

#[test]
fn an_unreadable_keep_is_refused() {
    // Reading a retention of gg's own choosing past it would run one arm of a study under another
    // arm's name, which is exactly what the refusal exists to prevent.
    let defects = reported(|report| {
        resolve_program_library(&profile(json!({ "keep": "5" })), report);
    });

    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(defects[0].locus, "program-library.params.keep");
}

/// The retention a **disabled** capability *writes* is judged too. It has no library to build, so
/// the resolver never reads it — the launch check does, because a switched-off capability still
/// records the retention the off arm would have kept.
#[test]
fn a_disabled_capabilitys_retention_is_judged_at_launch() {
    let defects = reported(|report| {
        check_launch(
            &GgAgentConfig {
                capabilities: vec![GgCapabilityConfig {
                    enabled: false,
                    params: json!({ "keep": "5" }),
                    ..GgCapabilityConfig::enabled(CAPABILITY_PROGRAM_LIBRARY)
                }],
                ..GgAgentConfig::root()
            },
            report,
        );
    });

    assert_eq!(defects.len(), 1, "{defects:?}");
}

#[test]
fn the_launch_summary_names_every_agent_that_keeps_programs() {
    let mut keeper = profile(json!({ "keep": 5 }));
    keeper.id = "Implementer".to_string();
    let mut unlimited = profile(json!({ "keep": 0 }));
    unlimited.id = "Reviewer".to_string();
    let mut plain = GgAgentConfig::root();
    plain.id = "Planner".to_string();

    let summary = launch_summary(&[keeper, unlimited, plain]).unwrap();

    assert!(
        summary.contains("`Implementer` keeps its 5 most recent"),
        "{summary}"
    );
    assert!(summary.contains("`Reviewer` keeps every one"), "{summary}");
    assert!(!summary.contains("Planner"), "{summary}");
}

#[test]
fn no_agent_keeping_programs_says_nothing_at_all() {
    assert!(launch_summary(&[GgAgentConfig::root()]).is_none());
}
