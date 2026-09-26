//! Tests for the [program library](super): what it keeps under which ids, what retention drops,
//! what a miss says, how ids are minted and re-rolled, how a library crosses a succession, and how
//! a profile's `keep` and `idLength` params resolve.

use std::sync::{Arc, Mutex};

use serde_json::json;
use test_cabinet_core::gg::{GgAgentConfig, GgCapabilityConfig};

use crate::validate::{LaunchDefect, LaunchReport};

use super::*;

/// A minter that hands out `ids` in order and then repeats the last one forever — the shape a
/// collision test needs, with nothing random and nothing slept on.
struct Scripted {
    ids: Mutex<Vec<String>>,
    lengths: Mutex<Vec<usize>>,
}

impl Scripted {
    fn new(ids: &[&str]) -> Arc<Self> {
        Arc::new(Self {
            ids: Mutex::new(ids.iter().rev().map(|id| id.to_string()).collect()),
            lengths: Mutex::new(Vec::new()),
        })
    }

    /// Every length the library asked this minter for, in order.
    fn lengths(&self) -> Vec<usize> {
        self.lengths.lock().unwrap().clone()
    }
}

impl ProgramIdMinter for Scripted {
    fn mint(&self, length: usize) -> String {
        self.lengths.lock().unwrap().push(length);
        let mut ids = self.ids.lock().unwrap();
        match ids.len() {
            0 => panic!("the scripted minter was asked for more ids than it was given"),
            1 => ids[0].clone(),
            _ => ids.pop().unwrap(),
        }
    }
}

/// A live library keeping every program, minting from `ids` in order.
fn scripted(keep: Option<usize>, ids: &[&str]) -> ProgramLibrary {
    ProgramLibrary::enabled(keep, 4).with_minter(Scripted::new(ids))
}

/// Mint one id, asserting the library had one to give.
fn issue(library: &mut ProgramLibrary) -> String {
    library
        .issue_id()
        .expect("the re-roll bound is not reached")
        .expect("an enabled library issues an id")
}

/// The library `profile` resolves to, asserting gg honoured its params exactly as written.
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

/// The ids the library holds, oldest first.
fn held(library: &ProgramLibrary) -> Vec<String> {
    library
        .summaries()
        .into_iter()
        .map(|summary| summary.id)
        .collect()
}

// ---------------------------------------------------------------------------------------------
// What is kept
// ---------------------------------------------------------------------------------------------

#[test]
fn a_disabled_library_issues_nothing_keeps_nothing_and_can_be_asked_for_nothing() {
    let mut library = ProgramLibrary::disabled();
    assert_eq!(
        library.issue_id(),
        Ok(None),
        "an agent without the capability has no id length to mint at"
    );
    library.record("k3p9", 1, "harness.finish('x')", true, None);

    assert!(!library.is_enabled());
    assert!(library.summaries().is_empty());
    // The object is not bound for such an agent, so this is a defensive path rather than one a
    // program can reach — but it must still refuse rather than invent a program.
    assert!(library.source("k3p9").is_err());
}

/// **Several submissions in one turn are several entries**, each under its own id, all fetchable,
/// listed in the order they ran.
#[test]
fn several_submissions_in_one_turn_get_distinct_ids_and_are_all_fetchable() {
    let mut library = scripted(None, &["aaaa", "bbbb", "cccc"]);
    let first = issue(&mut library);
    let second = issue(&mut library);
    let third = issue(&mut library);
    assert_eq!(
        [&first, &second, &third],
        ["aaaa", "bbbb", "cccc"],
        "one fresh id per acknowledged submission"
    );
    library.record(&first, 7, "one", true, None);
    library.record(&second, 7, "two", false, Some("threw".to_string()));
    library.record(&third, 7, "three", true, None);

    assert_eq!(held(&library), ["aaaa", "bbbb", "cccc"]);
    assert_eq!(library.source("aaaa").unwrap(), "one");
    assert_eq!(library.source("bbbb").unwrap(), "two");
    assert_eq!(library.source("cccc").unwrap(), "three");
    let turns: Vec<u64> = library.summaries().iter().map(|s| s.turn).collect();
    assert_eq!(
        turns,
        [7, 7, 7],
        "the turn is kept beside each, for orientation"
    );
}

/// **A rerun keeps the submission's id and replaces its source.** The shape this models is a
/// chained submission: gg runs the hand-over trampoline and then the program it handed over, and
/// the submission records once — under its id, with the program that did the work.
#[test]
fn recording_the_same_id_twice_replaces_rather_than_accrues() {
    let mut library = scripted(None, &["k3p9"]);
    let id = issue(&mut library);
    library.record(&id, 7, "programs.rerun(patched)", true, None);
    library.record(&id, 7, "the patched program", true, None);

    assert_eq!(library.summaries().len(), 1);
    assert_eq!(library.source("k3p9").unwrap(), "the patched program");
}

#[test]
fn retention_drops_the_oldest_and_a_miss_names_what_is_held_with_its_turn() {
    let mut library = scripted(Some(2), &["aaaa", "bbbb", "cccc"]);
    for (turn, source) in [(1, "one"), (2, "two"), (3, "three")] {
        let id = issue(&mut library);
        library.record(&id, turn, source, true, None);
    }

    assert_eq!(held(&library), ["bbbb", "cccc"]);

    let refusal = library.source("aaaa").unwrap_err();
    assert_eq!(refusal.failure, ToolFailure::NotFound);
    // Naming what *is* held is the whole point of the message: without it the model spends a
    // second turn discovering the same thing.
    assert!(
        refusal.message.contains("`aaaa`") && refusal.message.contains("ids held"),
        "{}",
        refusal.message
    );
    assert!(
        refusal.message.contains("`bbbb` (turn 2), `cccc` (turn 3)"),
        "{}",
        refusal.message
    );
}

#[test]
fn an_unknown_id_is_not_found_and_an_empty_library_says_nothing_has_been_kept() {
    let library = ProgramLibrary::enabled(None, 4);
    let refusal = library.source("zzzz").unwrap_err();

    assert_eq!(refusal.failure, ToolFailure::NotFound);
    assert!(
        refusal
            .message
            .contains("no program is kept under the id `zzzz`")
            && refusal.message.contains("no program has been kept yet"),
        "{}",
        refusal.message
    );
}

#[test]
fn a_summary_describes_the_shape_and_the_failure_but_never_the_source() {
    let mut library = scripted(None, &["k3p9"]);
    let id = issue(&mut library);
    library.record(
        &id,
        4,
        "const x = 1;\nfs.readFile(x);",
        false,
        Some("`read_file` failed (invalid-argument): path must be a string".to_string()),
    );

    let summary = library.summaries().pop().unwrap();
    assert_eq!(summary.id, "k3p9");
    assert_eq!(summary.turn, 4);
    assert_eq!(summary.lines, 2);
    assert_eq!(summary.chars, 28);
    assert!(!summary.ok);
    assert!(summary.error.unwrap().contains("read_file"));
}

#[test]
fn a_failed_program_is_still_kept_because_fixing_it_is_the_point() {
    let mut library = scripted(None, &["k3p9"]);
    let id = issue(&mut library);
    library.record(
        &id,
        1,
        "cosnt x = 1;",
        false,
        Some("did not compile".to_string()),
    );

    assert_eq!(library.source("k3p9").unwrap(), "cosnt x = 1;");
}

// ---------------------------------------------------------------------------------------------
// Minting
// ---------------------------------------------------------------------------------------------

#[test]
fn the_real_minter_issues_ids_of_the_configured_length_that_are_never_the_same() {
    let mut library = ProgramLibrary::enabled(None, 6);
    let mut seen = std::collections::BTreeSet::new();
    for _ in 0..64 {
        let id = issue(&mut library);
        assert_eq!(id.chars().count(), 6, "{id}");
        assert!(seen.insert(id), "an id was issued twice");
    }
}

#[test]
fn the_minter_is_asked_for_the_configured_length() {
    let minter = Scripted::new(&["ab"]);
    let mut library = ProgramLibrary::enabled(None, 2).with_minter(Arc::clone(&minter));
    issue(&mut library);
    assert_eq!(minter.lengths(), [2]);
}

/// **An id is never re-issued, even after its program was dropped.** The retention bounds what is
/// held; the issued set is what a fresh id is checked against, so a fetch of a dropped program is
/// `not-found` rather than a different program answering to its name.
#[test]
fn a_collision_is_re_rolled_even_against_an_id_whose_program_retention_dropped() {
    // Minted in order: `aaaa`, `bbbb`, then `aaaa` again (a collision with a dropped program's id),
    // then `cccc`.
    let mut library = scripted(Some(1), &["aaaa", "bbbb", "aaaa", "cccc"]);
    let first = issue(&mut library);
    library.record(&first, 1, "one", true, None);
    let second = issue(&mut library);
    library.record(&second, 2, "two", true, None);
    assert_eq!(held(&library), ["bbbb"], "retention dropped `aaaa`");

    let third = issue(&mut library);
    assert_eq!(
        third, "cccc",
        "`aaaa` was re-rolled: it was issued once already"
    );
}

/// **Exhausting the re-roll bound is a fault, not a loop and not a fallback.**
#[test]
fn exhausting_the_re_roll_bound_is_an_error_after_exactly_the_bounded_attempts() {
    // One id, forever.
    let minter = Scripted::new(&["aaaa"]);
    let mut library = ProgramLibrary::enabled(None, 4).with_minter(Arc::clone(&minter));
    assert_eq!(issue(&mut library), "aaaa");

    let exhausted = library.issue_id().unwrap_err();
    assert_eq!(
        minter.lengths().len(),
        1 + ID_ATTEMPTS,
        "the successful mint, then exactly the bound's worth of attempts"
    );
    assert!(
        exhausted
            .message
            .contains("could not mint a fresh program id")
            && exhausted.message.contains("gg defect"),
        "{}",
        exhausted.message
    );
    // The library is still coherent: what it held, it holds.
    assert_eq!(library.issued.len(), 1);
}

// ---------------------------------------------------------------------------------------------
// Across a succession
// ---------------------------------------------------------------------------------------------

/// **A fork clones the library**: the copy fetches what was written before the fork, and neither
/// side re-issues an id the other holds — while what each issues *after* the fork is its own.
#[test]
fn a_fork_clones_the_entries_and_the_issued_ids_and_the_copies_then_diverge() {
    let mut forker = scripted(None, &["aaaa", "bbbb", "cccc"]);
    let before = issue(&mut forker);
    forker.record(&before, 1, "before the fork", true, None);

    let mut copy = forker.clone();
    assert_eq!(
        copy.source("aaaa").unwrap(),
        "before the fork",
        "the copy fetches the program written before the fork"
    );

    let forkers = issue(&mut forker);
    copy.record(&forkers, 2, "the copy's own program", true, None);
    assert!(
        forker.source(&forkers).is_err(),
        "what the copy records after the fork is the copy's alone"
    );
    assert!(
        copy.issued.contains("aaaa"),
        "the copy carries the forker's issued set, so `aaaa` is never re-issued by it"
    );
}

/// **An exec moves the library**: the successor adopts the entries and the issued ids, under its
/// own retention.
#[test]
fn a_successor_adopts_what_was_carried_under_its_own_retention_and_never_re_issues_an_id() {
    let mut predecessor = scripted(None, &["aaaa", "bbbb", "cccc"]);
    for (turn, source) in [(1, "one"), (2, "two"), (3, "three")] {
        let id = issue(&mut predecessor);
        predecessor.record(&id, turn, source, true, None);
    }

    // The successor's profile keeps two, and mints `aaaa` first — an id its predecessor issued —
    // then `dddd`.
    let mut successor = scripted(Some(2), &["aaaa", "dddd"]);
    successor.adopt(predecessor);

    assert_eq!(
        held(&successor),
        ["bbbb", "cccc"],
        "the carried entries, truncated to the successor's own `keep`"
    );
    assert_eq!(successor.source("cccc").unwrap(), "three");
    assert_eq!(
        issue(&mut successor),
        "dddd",
        "`aaaa` was its predecessor's, and is re-rolled"
    );
}

#[test]
fn a_successor_whose_profile_disables_the_capability_keeps_nothing() {
    let mut predecessor = scripted(None, &["aaaa"]);
    let id = issue(&mut predecessor);
    predecessor.record(&id, 1, "one", true, None);

    let mut successor = ProgramLibrary::disabled();
    successor.adopt(predecessor);

    assert!(!successor.is_enabled());
    assert!(successor.summaries().is_empty());
    assert_eq!(successor.issue_id(), Ok(None));
}

// ---------------------------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------------------------

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
    assert_eq!(
        library(&profile(json!({ "keep": 3, "idLength": 4 }))).keep(),
        Some(3)
    );
    assert_eq!(
        library(&profile(json!({ "keep": 0, "idLength": 4 }))).keep(),
        KEEP_EVERY_PROGRAM
    );
    // An integral float names the same retention — JSON has no integer type, and refusing `3.0`
    // would be a usability failure rather than a fallback fix.
    assert_eq!(
        library(&profile(json!({ "keep": 3.0, "idLength": 4 }))).keep(),
        Some(3)
    );
}

/// The default catalog's id length is accepted, and a written one across the range is honoured.
#[test]
fn a_written_id_length_in_range_is_honoured() {
    assert_eq!(
        library(&profile(json!({ "keep": 3, "idLength": 4 }))).id_length(),
        4
    );
    assert_eq!(
        library(&profile(json!({ "keep": 3, "idLength": 2 }))).id_length(),
        2
    );
    assert_eq!(
        library(&profile(json!({ "keep": 3, "idLength": 32 }))).id_length(),
        32
    );
    assert_eq!(
        library(&GgAgentConfig {
            capabilities: vec![GgCapabilityConfig::enabled(CAPABILITY_PROGRAM_LIBRARY)],
            ..GgAgentConfig::root()
        })
        .id_length(),
        4,
        "the authoring catalog seeds `idLength: 4`"
    );
}

/// **An enabled library with no `keep` refuses the launch.** `0` already means *keep the whole
/// session*, so an absence cannot be read as one without gg picking between two opposite
/// statements — and a study that held twenty programs where its record said it held every one is
/// the wrong-arm failure the refusal exists to prevent.
#[test]
fn an_absent_keep_is_refused() {
    for params in [
        json!({ "idLength": 4 }),
        json!({ "keep": null, "idLength": 4 }),
    ] {
        let defects = reported(|report| {
            resolve_program_library(&profile(params.clone()), report);
        });
        assert_eq!(defects.len(), 1, "{params} -> {defects:?}");
        assert_eq!(defects[0].locus, "program-library.params.keep");
        assert_eq!(defects[0].found, "", "an absence has no value as written");
    }
}

/// **An enabled library with no `idLength`, an unreadable one, or one outside `2..=32` refuses
/// the launch**, so a study's ids are never a different shape than its configuration says.
#[test]
fn an_absent_unreadable_or_out_of_range_id_length_is_refused() {
    for (params, found) in [
        (json!({ "keep": 3 }), ""),
        (json!({ "keep": 3, "idLength": null }), ""),
        (json!({ "keep": 3, "idLength": "4" }), "\"4\""),
        (json!({ "keep": 3, "idLength": 1 }), "1"),
        (json!({ "keep": 3, "idLength": 33 }), "33"),
    ] {
        let defects = reported(|report| {
            resolve_program_library(&profile(params.clone()), report);
        });
        assert_eq!(defects.len(), 1, "{params} -> {defects:?}");
        assert_eq!(
            defects[0].locus, "program-library.params.idLength",
            "{params}"
        );
        assert_eq!(defects[0].found, found, "{params}");
    }
}

/// …and the library it hands back is the named placeholder, not a retention of gg's choosing.
#[test]
fn a_refused_keep_resolves_to_the_placeholder() {
    let mut report = LaunchReport::collecting();
    let library = resolve_program_library(&profile(json!({ "idLength": 4 })), &mut report);
    assert!(!report.is_empty(), "the launch must already be refused");
    assert_eq!(library.keep(), KEEP_LAUNCH_REFUSED);
    assert_ne!(
        library.keep(),
        KEEP_EVERY_PROGRAM,
        "a refusal must not read as the widest setting an operator can ask for"
    );
}

/// **A disabled capability is short of nothing.** It builds no library, and an absent `keep` or
/// `idLength` on one is not a hole: there is nothing for a switched-off capability to have stated.
#[test]
fn a_disabled_capability_without_params_is_not_refused() {
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
        resolve_program_library(&profile(json!({ "keep": "5", "idLength": 4 })), report);
    });

    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(defects[0].locus, "program-library.params.keep");
}

/// The params a **disabled** capability *writes* are judged too. It has no library to build, so
/// the resolver never reads them — the launch check does, because a switched-off capability still
/// records the configuration the off arm would have kept.
#[test]
fn a_disabled_capabilitys_params_are_judged_at_launch() {
    for params in [
        json!({ "keep": "5", "idLength": 4 }),
        json!({ "keep": 5, "idLength": 40 }),
    ] {
        let defects = reported(|report| {
            check_launch(
                &GgAgentConfig {
                    capabilities: vec![GgCapabilityConfig {
                        enabled: false,
                        params: params.clone(),
                        ..GgCapabilityConfig::enabled(CAPABILITY_PROGRAM_LIBRARY)
                    }],
                    ..GgAgentConfig::root()
                },
                report,
            );
        });
        assert_eq!(defects.len(), 1, "{params} -> {defects:?}");
    }
}

#[test]
fn the_launch_summary_names_every_agent_that_keeps_programs_and_its_id_length() {
    let mut keeper = profile(json!({ "keep": 5, "idLength": 4 }));
    keeper.slug = "Implementer".to_string();
    let mut unlimited = profile(json!({ "keep": 0, "idLength": 8 }));
    unlimited.slug = "Reviewer".to_string();
    let mut plain = GgAgentConfig::root();
    plain.slug = "Planner".to_string();

    let summary = launch_summary(&[keeper, unlimited, plain]).unwrap();

    assert!(
        summary.contains("`Implementer` keeps its 5 most recent under 4-character ids"),
        "{summary}"
    );
    assert!(
        summary.contains("`Reviewer` keeps every one under 8-character ids"),
        "{summary}"
    );
    assert!(!summary.contains("Planner"), "{summary}");
}

#[test]
fn no_agent_keeping_programs_says_nothing_at_all() {
    assert!(launch_summary(&[GgAgentConfig::root()]).is_none());
}
