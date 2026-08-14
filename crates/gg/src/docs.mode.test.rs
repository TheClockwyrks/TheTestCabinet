//! Tests for the [documentation-view type mode](DocViewTypes) — how it is resolved from an agent's
//! own configuration, and which types each of its three arms selects.
//!
//! The mode is the thing the whole transitive rule exists to be *measurable* about, so both halves
//! are asserted: a typo must not silently pick an arm the study did not ask for, and the three arms
//! must actually differ in what they open on a real arm's catalogue.

use serde_json::json;
use test_cabinet_core::gg::{
    CAPABILITY_LIST_DIR, CAPABILITY_PROJECT_MANAGEMENT, CAPABILITY_READ_FILE,
    CAPABILITY_RESPONSES_AS_CODE, GgCapabilityConfig, GgProgramLanguage,
};

use super::*;
use crate::ending::EndingRole;
use crate::sandbox::{capability_operations, gating_capabilities};
use crate::validate::{LaunchDefect, LaunchReport};

/// The mode `profile` resolves to, asserting gg honoured its configuration exactly as written.
fn mode_of(profile: &GgAgentConfig) -> DocViewTypes {
    let mut report = LaunchReport::collecting();
    let mode = resolve_doc_view_types(profile, &mut report);
    let defects = report.into_defects();
    assert!(defects.is_empty(), "unexpected refusals: {defects:?}");
    mode
}

/// Everything resolving `profile` reports, for the cases whose subject is the refusal.
fn reported(profile: &GgAgentConfig) -> (DocViewTypes, Vec<LaunchDefect>) {
    let mut report = LaunchReport::collecting();
    let mode = resolve_doc_view_types(profile, &mut report);
    (mode, report.into_defects())
}

/// An agent whose responses-as-code capability is on and carries `params`.
fn set_with(params: serde_json::Value) -> GgAgentConfig {
    GgAgentConfig {
        capabilities: vec![GgCapabilityConfig {
            params,
            ..GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE)
        }],
        ..GgAgentConfig::root()
    }
}

/// The string a documentation view of the type spelled `name` is **opened by** on this arm — its
/// fully-qualified name where the arm's catalogue resolves one, and the bare spelling where it does
/// not.
///
/// `types_to_open` answers in keys rather than in the spelling a signature writes, and on an arm
/// reshaped into capability modules those are two different strings. Resolved out of the catalogue
/// so that nothing here is a second copy of how this arm spells its module paths.
fn opened_as(name: &str) -> String {
    crate::sandbox::type_declaration(
        crate::sandbox::language(GgProgramLanguage::TypeScript),
        name,
    )
    .map(|declared| declared.key().to_string())
    .unwrap_or_else(|| name.to_string())
}

/// A runtime over the TypeScript catalogue with the calls these assertions need bound.
fn runtime() -> DocsRuntime {
    granting(&[
        CAPABILITY_READ_FILE,
        CAPABILITY_PROJECT_MANAGEMENT,
        CAPABILITY_LIST_DIR,
    ])
}

/// A runtime for an agent holding `capabilities` and granted every operation they offer.
fn granting(capabilities: &[&str]) -> DocsRuntime {
    on(capabilities, GgProgramLanguage::TypeScript)
}

/// [`granting`], answering in `language`.
fn on(capabilities: &[&str], language: GgProgramLanguage) -> DocsRuntime {
    let operations = capability_operations(capabilities.iter().copied());
    DocsRuntime::new(
        capabilities.iter().map(|id| id.to_string()).collect(),
        EndingRole::Standard,
        &operations,
        language,
    )
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/// A capability that says nothing about it opens the return position — the default, and the arm the
/// design argues for rather than the arm that happens to be cheapest to implement.
#[test]
fn absent_doc_view_types_is_return_only() {
    for params in [json!({}), json!({ "docViewTypes": null })] {
        assert_eq!(
            mode_of(&set_with(params.clone())),
            DocViewTypes::ReturnOnly,
            "{params}"
        );
    }
    assert_eq!(mode_of(&GgAgentConfig::root()), DocViewTypes::ReturnOnly);
}

/// Each named mode resolves to its variant, and each round-trips through its own id — the string a
/// replay reads to tell one arm of the comparison from another.
#[test]
fn each_named_mode_resolves_and_round_trips_through_its_id() {
    for (spelling, mode) in [
        ("off", DocViewTypes::Off),
        ("return", DocViewTypes::ReturnOnly),
        ("return-and-parameters", DocViewTypes::ReturnAndParameters),
    ] {
        let resolved = mode_of(&set_with(json!({ "docViewTypes": spelling })));
        assert_eq!(resolved, mode, "{spelling}");
        assert_eq!(mode.id(), spelling);
    }
}

/// A value naming no mode gg knows **refuses the launch**, never guessed at: a mode is a lever a
/// study slices on, and the [agent surface](crate::telemetry) records the *resolved* mode, so a typo
/// read as the default would leave a run whose every record says it ran the arm it did not.
#[test]
fn an_unknown_doc_view_types_value_is_refused() {
    for unreadable in [json!("returns"), json!(true), json!(2), json!([])] {
        let (mode, defects) = reported(&set_with(json!({ "docViewTypes": unreadable.clone() })));
        assert_eq!(mode, DocViewTypes::ReturnOnly, "the resolver stays total");
        assert_eq!(defects.len(), 1, "{unreadable} -> {defects:?}");
        assert_eq!(
            defects[0].locus, "responses-as-code.params.docViewTypes",
            "{unreadable}"
        );
        assert_eq!(defects[0].known, DocViewTypes::ALL, "{unreadable}");
    }
}

/// A mode written with stray whitespace around it is the mode it names. gg reads the vocabulary
/// literally in every other respect — `"returns"` is refused — but a value's surrounding
/// whitespace is not part of what an operator wrote.
#[test]
fn surrounding_whitespace_does_not_hide_a_mode() {
    assert_eq!(
        mode_of(&set_with(json!({ "docViewTypes": " off " }))),
        DocViewTypes::Off
    );
}

/// **A disabled capability's param is still read.** It changes nothing about the run — an agent that
/// writes no programs opens no documentation views — and it is read anyway, on the rule the whole
/// params table follows: a disabled capability records the configuration the arm would have used, so
/// the on and off arms of one comparison stay symmetric, and a typo skipped because a switch
/// happened to be off is a typo that surfaces on the launch where it is flipped.
#[test]
fn a_disabled_capabilitys_doc_view_types_is_still_read() {
    let set = GgAgentConfig {
        capabilities: vec![GgCapabilityConfig {
            params: json!({ "docViewTypes": "off" }),
            ..GgCapabilityConfig::disabled(CAPABILITY_RESPONSES_AS_CODE)
        }],
        ..GgAgentConfig::root()
    };
    assert_eq!(mode_of(&set), DocViewTypes::Off);
}

/// …and a value it cannot read is refused, rather than waiting for the launch that flips the switch.
#[test]
fn a_disabled_capabilitys_unreadable_doc_view_types_is_refused() {
    let set = GgAgentConfig {
        capabilities: vec![GgCapabilityConfig {
            params: json!({ "docViewTypes": "returns" }),
            ..GgCapabilityConfig::disabled(CAPABILITY_RESPONSES_AS_CODE)
        }],
        ..GgAgentConfig::root()
    };
    let mut report = LaunchReport::collecting();
    resolve_doc_view_types(&set, &mut report);
    let defects = report.into_defects();
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(defects[0].locus, "responses-as-code.params.docViewTypes");
}

// ---------------------------------------------------------------------------
// What each arm selects
// ---------------------------------------------------------------------------

/// **`Off` opens nothing**, whatever the signature mentions. The model reads the type names in the
/// signature and asks for one when it wants it.
#[test]
fn off_opens_no_types() {
    let docs = runtime();
    assert!(docs.types_to_open("readFile", DocViewTypes::Off).is_empty());
    assert!(
        docs.types_to_open("updateIssue", DocViewTypes::Off)
            .is_empty()
    );
}

/// **A type reached only through what a function hands back is opened by every arm that opens
/// anything**, because it is in the return position by either reading.
#[test]
fn a_returned_type_is_opened_by_both_type_modes() {
    let docs = runtime();
    assert_eq!(
        docs.types_to_open("readFile", DocViewTypes::ReturnOnly),
        vec![opened_as("FileRead")]
    );
    assert_eq!(
        docs.types_to_open("readFile", DocViewTypes::ReturnAndParameters),
        vec![opened_as("FileRead")]
    );
}

/// **The two arms differ exactly where an argument names a type.**
///
/// `updateIssue` takes a patch whose `status` field is an `IssueStatus`, and hands back nothing that
/// mentions it — so `ReturnOnly` leaves it closed and `ReturnAndParameters` opens it. This is the
/// distinction the knob exists to measure, asserted against a real arm's catalogue rather than
/// against a fixture that could be made to say anything.
#[test]
fn only_the_wider_arm_opens_a_type_an_argument_names() {
    let docs = runtime();
    assert!(
        docs.types_to_open("updateIssue", DocViewTypes::ReturnOnly)
            .is_empty(),
        "`IssueStatus` is named by the patch argument, so it is not in the return position"
    );
    assert_eq!(
        docs.types_to_open("updateIssue", DocViewTypes::ReturnAndParameters),
        vec![opened_as("IssueStatus")]
    );
}

/// **A type is not a function, so it opens nothing** — which is what makes the rule one level deep
/// by construction rather than by a counter. A key that names no bound function selects nothing at
/// all, whatever the mode.
#[test]
fn a_type_key_opens_no_further_types() {
    let docs = runtime();
    for mode in [DocViewTypes::ReturnOnly, DocViewTypes::ReturnAndParameters] {
        assert!(
            docs.types_to_open("FileRead", mode).is_empty(),
            "a type docview never opens a second type docview"
        );
        assert!(docs.types_to_open("neverBound", mode).is_empty());
    }
}

/// **A function this agent's scope does not bind selects nothing**, so a withheld call cannot leak
/// the shape of what it would have returned.
#[test]
fn a_withheld_function_selects_no_types() {
    let docs = granting(&[CAPABILITY_PROJECT_MANAGEMENT]);
    assert!(
        docs.types_to_open("readFile", DocViewTypes::ReturnAndParameters)
            .is_empty()
    );
}

/// Every registered arm can be asked, and every name it answers with is a type that arm really
/// declares — so a transitive open never names a key its own `read_type` would then miss.
#[test]
fn every_arm_selects_only_types_it_declares() {
    for language in crate::sandbox::all_languages() {
        let docs = on(&gating_capabilities(), language.id());
        for function in crate::sandbox::catalogue_functions(language) {
            for referenced in docs.types_to_open(function.name, DocViewTypes::ReturnAndParameters) {
                assert!(
                    docs.read_type(referenced).is_some(),
                    "{}: `{}` would open `{referenced}`, which the arm does not declare",
                    language.display_name(),
                    function.name,
                );
            }
        }
    }
}

/// **Depth exactly one, on every arm**: every type a function's open places is one the function's
/// own signature writes down.
///
/// This is the gate on the rule, and it is the one that was missing. The catalogue's `types` field
/// is *transitively closed* — it exists so a consumer can declare every type a surface can reach —
/// so reading it raw opens a type's fields' types and a returned enum's variants, which is depth two
/// and beyond. It went unnoticed because the two ECMAScript arms' closures are nearly flat, while on
/// the compiled arms they are three to five times the depth-one set: `read_file` on Rust opened
/// `ToolErrorCode`, `TextFile` and `ImageFile`, none of which
/// `read_file(path: &str, options: ReadOptions) -> Result<FileRead, ToolError>` names.
///
/// The haystack is rebuilt here from the catalogue rather than taken from the helper under test, so
/// this asserts the *rule* rather than the implementation of it.
#[test]
fn every_arm_opens_only_types_its_own_signature_names() {
    for language in crate::sandbox::all_languages() {
        let docs = on(&gating_capabilities(), language.id());
        for function in crate::sandbox::catalogue_functions(language) {
            // Everything this function writes down: each shape's rendered signature, and each
            // documented parameter's declared type. A parameter's inline *fields* are deliberately
            // absent — a field's type is the second level.
            let written: Vec<&str> = function
                .signatures
                .iter()
                .flat_map(|entry| {
                    std::iter::once(entry.signature.as_str()).chain(
                        entry
                            .parameters
                            .iter()
                            .map(|parameter| parameter.r#type.as_str()),
                    )
                })
                .collect();
            for referenced in docs.types_to_open(function.name, DocViewTypes::ReturnAndParameters) {
                // The key a documentation view is opened by is module-qualified; a signature
                // writes the type under whatever qualification the program's own scope needs,
                // which is usually shorter. The last segment is the one thing both spellings
                // always share, and it is enough for the property being asserted: a type reached
                // at depth two is not written into this function's signature under any
                // qualification at all.
                let named = referenced
                    .rsplit(|character: char| !(character.is_alphanumeric() || character == '_'))
                    .next()
                    .unwrap_or(referenced);
                assert!(
                    written.iter().any(|text| mentions(text, named)),
                    "{}: opening `{}` would place `{referenced}`, which no shape of it names — \
                     that is depth two, and the rule is depth one.\nWhat it writes: {written:?}",
                    language.display_name(),
                    function.name,
                );
            }
        }
    }
}

/// **The two type modes really do differ, on every arm** — at least one function whose arguments name
/// a type its return position does not.
///
/// The knob is only worth running an A/B on if its arms are distinguishable, and the transitively
/// closed reading collapsed them: with a function's *whole* type closure opened either way, `fs`'s
/// argument records were already in the set that `ReturnOnly` was supposed to withhold, so on Swift
/// both modes answered `readFile` with the identical five names. Asserted per arm because a single
/// arm losing the distinction is exactly the failure this catches, and it would be invisible in a
/// total.
#[test]
fn both_type_modes_are_distinguishable_on_every_arm() {
    for language in crate::sandbox::all_languages() {
        let docs = on(&gating_capabilities(), language.id());
        let widened = crate::sandbox::catalogue_functions(language)
            .into_iter()
            .filter(|function| {
                let narrow = docs.types_to_open(function.name, DocViewTypes::ReturnOnly);
                let wide = docs.types_to_open(function.name, DocViewTypes::ReturnAndParameters);
                wide.len() > narrow.len()
            })
            .count();
        assert!(
            widened > 0,
            "{}: no function opens more under `return-and-parameters` than under `return`, so the \
             two arms of the knob are indistinguishable on this arm",
            language.display_name()
        );
    }
}

// ---------------------------------------------------------------------------
// Telling an argument type from a returned one
// ---------------------------------------------------------------------------

/// The split is on whole identifiers, never substrings: a bare `contains` would read `FileRead` out
/// of `FileReadOptions` and quietly reclassify a returned type as an argument one.
#[test]
fn a_type_name_matches_only_as_a_whole_identifier() {
    assert!(mentions("FileRead", "FileRead"));
    assert!(mentions("Vec<DirEntry>", "DirEntry"));
    assert!(mentions("{ status?: IssueStatus; }", "IssueStatus"));
    assert!(mentions("option<file-read>", "file-read"));

    assert!(!mentions("FileReadOptions", "FileRead"));
    assert!(!mentions("MyFileRead", "FileRead"));
    assert!(!mentions("read_file", "read"));
    assert!(!mentions("string", "FileRead"));
}
