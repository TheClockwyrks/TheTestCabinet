//! Tests for the [program library](super): what it keeps, what retention drops, what a miss says,
//! and how a profile's `keep` param resolves.

use serde_json::json;
use test_cabinet_core::gg::{GgAgentConfig, GgCapabilityConfig};

use super::*;

/// An agent profile enabling the library with `params`.
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
        refusal.message.contains("has not run one yet"),
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
    let resolved = resolve_program_library(&GgAgentConfig::root());

    assert!(!resolved.library.is_enabled());
    assert!(resolved.unknown_params.is_empty());
}

#[test]
fn a_disabled_capability_configures_nothing() {
    let resolved = resolve_program_library(&GgAgentConfig {
        capabilities: vec![GgCapabilityConfig::disabled(CAPABILITY_PROGRAM_LIBRARY)],
        ..GgAgentConfig::root()
    });

    assert!(!resolved.library.is_enabled());
}

#[test]
fn keep_defaults_and_zero_means_unlimited() {
    assert_eq!(
        resolve_program_library(&profile(json!({}))).library.keep,
        Some(DEFAULT_KEEP)
    );
    assert_eq!(
        resolve_program_library(&profile(json!({ "keep": 3 })))
            .library
            .keep,
        Some(3)
    );
    assert_eq!(
        resolve_program_library(&profile(json!({ "keep": 0 })))
            .library
            .keep,
        None
    );
}

#[test]
fn an_unreadable_keep_is_reported_and_changes_nothing() {
    // Silently reverting to the default would run one arm of a study under another arm's name,
    // which is exactly what the report exists to prevent.
    let resolved = resolve_program_library(&profile(json!({ "keep": "5" })));

    assert_eq!(resolved.library.keep, Some(DEFAULT_KEEP));
    assert_eq!(resolved.unknown_params, vec![PARAM_KEEP.to_string()]);
}

#[test]
fn the_launch_summary_names_every_agent_that_keeps_programs() {
    let mut keeper = profile(json!({ "keep": 5 }));
    keeper.name = "Implementer".to_string();
    let mut unlimited = profile(json!({ "keep": 0 }));
    unlimited.name = "Reviewer".to_string();
    let mut plain = GgAgentConfig::root();
    plain.name = "Planner".to_string();

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
