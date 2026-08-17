//! Tests for the [documentation-view type flags](DocViewTypes) — how they are resolved from an
//! agent's own configuration, and which types each of the three selects.
//!
//! The flags are the thing the whole transitive rule exists to be *measurable* about, so both halves
//! are asserted: a typo must not silently leave a flag at a default the study did not ask for, and
//! the three must actually differ in what they open on a real arm's catalogue.

use serde_json::json;
use test_cabinet_core::gg::{
    CAPABILITY_LIST_DIR, CAPABILITY_PROJECT_MANAGEMENT, CAPABILITY_READ_FILE,
    CAPABILITY_RESPONSES_AS_CODE, GgCapabilityConfig, GgProgramLanguage,
};

use super::*;
use crate::ending::EndingRole;
use crate::sandbox::{capability_operations, gating_capabilities};
use crate::validate::{LaunchDefect, LaunchReport};

/// The flags `profile` resolves to, asserting gg honoured its configuration exactly as written.
fn types_of(profile: &GgAgentConfig) -> DocViewTypes {
    let mut report = LaunchReport::collecting();
    let types = resolve_doc_view_types(profile, &mut report);
    let defects = report.into_defects();
    assert!(defects.is_empty(), "unexpected refusals: {defects:?}");
    types
}

/// Everything resolving `profile` reports, for the cases whose subject is the refusal.
fn reported(profile: &GgAgentConfig) -> (DocViewTypes, Vec<LaunchDefect>) {
    let mut report = LaunchReport::collecting();
    let types = resolve_doc_view_types(profile, &mut report);
    (types, report.into_defects())
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

/// The configuration with exactly `flags` on, built through the same setter the resolver uses.
fn only(flags: &[DocViewType]) -> DocViewTypes {
    let mut types = DocViewTypes::OFF;
    for flag in flags {
        types.set(*flag, true);
    }
    types
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

/// A capability that says nothing about it takes **the defaults** — `return` and `errors` on,
/// `parameters` off. Four spellings say nothing: an absent key, a null, an explicit `true`, and an
/// object that toggles nothing.
#[test]
fn absent_doc_view_types_takes_the_defaults() {
    let defaults = only(&[DocViewType::Return, DocViewType::Errors]);
    for params in [
        json!({}),
        json!({ "docViewTypes": null }),
        json!({ "docViewTypes": true }),
        json!({ "docViewTypes": {} }),
    ] {
        assert_eq!(types_of(&set_with(params.clone())), defaults, "{params}");
    }
    assert_eq!(types_of(&GgAgentConfig::root()), defaults);
    assert_eq!(DocViewTypes::default(), defaults);
}

/// **`false` is the master switch**: every flag off, whatever the defaults say.
#[test]
fn the_master_switch_withholds_every_type() {
    let resolved = types_of(&set_with(json!({ "docViewTypes": false })));
    assert_eq!(resolved, DocViewTypes::OFF);
    for flag in DocViewType::ALL {
        assert!(!resolved.enabled(flag), "{}", flag.id());
    }
}

/// **Each flag is toggled on its own**, and the two directions travel through one arm of the
/// resolver: `false` withholds a default-on type and `true` adds the default-off one.
#[test]
fn each_flag_is_toggled_independently() {
    assert_eq!(
        types_of(&set_with(json!({ "docViewTypes": { "parameters": true } }))),
        only(&[
            DocViewType::Return,
            DocViewType::Parameters,
            DocViewType::Errors
        ]),
    );
    assert_eq!(
        types_of(&set_with(json!({ "docViewTypes": { "return": false } }))),
        only(&[DocViewType::Errors]),
    );
    assert_eq!(
        types_of(&set_with(json!({ "docViewTypes": { "errors": false } }))),
        only(&[DocViewType::Return]),
    );
    assert_eq!(
        types_of(&set_with(
            json!({ "docViewTypes": { "return": false, "errors": false, "parameters": true } })
        )),
        only(&[DocViewType::Parameters]),
    );
}

/// **Every configuration has one telemetry id**, and it is the enabled flags joined with `+` in the
/// fixed order — with `none` standing for the configuration an empty string would otherwise record,
/// which no reader could tell from a run that recorded nothing.
#[test]
fn every_configuration_has_its_own_id() {
    let [r, p, e] = DocViewType::ALL;
    for (flags, id) in [
        (vec![], "none"),
        (vec![r], "return"),
        (vec![p], "parameters"),
        (vec![e], "errors"),
        (vec![r, p], "return+parameters"),
        (vec![r, e], "return+errors"),
        (vec![p, e], "parameters+errors"),
        (vec![r, p, e], "return+parameters+errors"),
    ] {
        assert_eq!(only(&flags).id(), id, "{flags:?}");
    }
    // The order is the flags' own, never the order an operator wrote them in.
    assert_eq!(
        types_of(&set_with(
            json!({ "docViewTypes": { "errors": true, "parameters": true, "return": true } })
        ))
        .id(),
        "return+parameters+errors"
    );
    assert_eq!(DocViewTypes::default().id(), "return+errors");
}

/// A key naming no flag gg knows **refuses the launch**, never guessed at: the flags are levers a
/// study slices on, and the [agent surface](crate::telemetry) records the *resolved* set, so a typo
/// read as the default would leave a run whose every record says it ran the arm it did not.
#[test]
fn an_unknown_doc_view_types_key_is_refused() {
    let (types, defects) = reported(&set_with(json!({ "docViewTypes": { "returns": true } })));
    assert_eq!(
        types,
        DocViewTypes::default(),
        "the resolver stays total, and the unknown key changed nothing"
    );
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(
        defects[0].locus,
        "responses-as-code.params.docViewTypes.returns"
    );
    assert_eq!(
        defects[0].known,
        DocViewType::ALL.map(DocViewType::id),
        "a refusal offers back the three keys"
    );
}

/// A known key carrying something that is not a toggle is refused too: reading `0` as `false` would
/// be gg deciding what an operator meant.
#[test]
fn a_non_boolean_toggle_is_refused() {
    for unreadable in [json!(0), json!("off"), json!(null), json!([])] {
        let (types, defects) = reported(&set_with(
            json!({ "docViewTypes": { "return": unreadable.clone() } }),
        ));
        assert_eq!(types, DocViewTypes::default(), "{unreadable}");
        assert_eq!(defects.len(), 1, "{unreadable} -> {defects:?}");
        assert_eq!(
            defects[0].locus, "responses-as-code.params.docViewTypes.return",
            "{unreadable}"
        );
    }
}

/// A value that is no set of toggles at all is refused against the param itself.
#[test]
fn a_value_that_names_no_set_of_toggles_is_refused() {
    for unreadable in [json!("return"), json!("off"), json!(2), json!([])] {
        let (types, defects) = reported(&set_with(json!({ "docViewTypes": unreadable.clone() })));
        assert_eq!(types, DocViewTypes::default(), "the resolver stays total");
        assert_eq!(defects.len(), 1, "{unreadable} -> {defects:?}");
        assert_eq!(
            defects[0].locus, "responses-as-code.params.docViewTypes",
            "{unreadable}"
        );
        assert_eq!(
            defects[0].known,
            DocViewType::ALL.map(DocViewType::id),
            "{unreadable}"
        );
    }
}

/// A key written with stray whitespace around it is the key it names. gg reads the vocabulary
/// literally in every other respect — `"returns"` is refused — but a key's surrounding whitespace is
/// not part of what an operator wrote.
#[test]
fn surrounding_whitespace_does_not_hide_a_flag() {
    assert_eq!(
        types_of(&set_with(json!({ "docViewTypes": { " errors ": false } }))),
        only(&[DocViewType::Return])
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
            params: json!({ "docViewTypes": false }),
            ..GgCapabilityConfig::disabled(CAPABILITY_RESPONSES_AS_CODE)
        }],
        ..GgAgentConfig::root()
    };
    assert_eq!(types_of(&set), DocViewTypes::OFF);
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
// What each flag selects
// ---------------------------------------------------------------------------

/// **Every flag off opens nothing**, whatever the signature mentions and whatever the comment
/// declares. The model reads the type names in the signature and asks for one when it wants it.
#[test]
fn every_flag_off_opens_no_types() {
    let docs = runtime();
    assert!(docs.types_to_open("readFile", DocViewTypes::OFF).is_empty());
    assert!(
        docs.types_to_open("updateIssue", DocViewTypes::OFF)
            .is_empty()
    );
}

/// **A type reached only through what a function hands back is placed by `return`**, and by any
/// configuration that has `return` on — it is in the return position by either reading.
#[test]
fn a_returned_type_is_placed_by_the_return_flag() {
    let docs = runtime();
    assert_eq!(
        docs.types_to_open("readFile", only(&[DocViewType::Return])),
        vec![opened_as("FileRead")]
    );
    assert_eq!(
        docs.types_to_open(
            "readFile",
            only(&[DocViewType::Return, DocViewType::Parameters])
        ),
        vec![opened_as("FileRead")]
    );
    assert!(
        !docs
            .types_to_open("readFile", only(&[DocViewType::Parameters]))
            .contains(&opened_as("FileRead").as_str()),
        "`FileRead` is what `readFile` hands back, so the `parameters` flag does not place it"
    );
}

/// **`parameters` is the flag that opens a type an argument names, and `return` is not.**
///
/// `updateIssue` takes a patch whose `status` field is an `IssueStatus`, and hands back nothing that
/// mentions it. This is the distinction the knob exists to measure, asserted against a real arm's
/// catalogue rather than against a fixture that could be made to say anything.
#[test]
fn only_the_parameters_flag_opens_a_type_an_argument_names() {
    let docs = runtime();
    assert!(
        !docs
            .types_to_open("updateIssue", only(&[DocViewType::Return]))
            .contains(&opened_as("IssueStatus").as_str()),
        "`IssueStatus` is named by the patch argument, so it is not in the return position"
    );
    assert_eq!(
        docs.types_to_open("updateIssue", only(&[DocViewType::Parameters])),
        vec![opened_as("IssueStatus")]
    );
}

/// **`errors` places what the comment declares, and neither of the other two does.**
///
/// The failure a call declares is written in a documentation comment rather than in a signature, so
/// it is the one of the three sources that is not a narrowing of what the signature names — which is
/// exactly why the flag exists and why `readFile`'s `ApiError` was reachable by no configuration
/// before it.
#[test]
fn only_the_errors_flag_opens_a_declared_failure() {
    let docs = runtime();
    let declared: Vec<String> = crate::sandbox::catalogue_functions(crate::sandbox::language(
        GgProgramLanguage::TypeScript,
    ))
    .into_iter()
    .find(|function| function.name == "readFile")
    .expect("the TypeScript arm catalogues `readFile`")
    .throws
    .iter()
    .map(|thrown| thrown.fqn().to_string())
    .collect();
    assert!(
        !declared.is_empty(),
        "`readFile`'s own comment declares the failure it raises"
    );

    assert_eq!(
        docs.types_to_open("readFile", only(&[DocViewType::Errors])),
        declared
    );
    for withheld in [
        only(&[DocViewType::Return]),
        only(&[DocViewType::Parameters]),
        only(&[DocViewType::Return, DocViewType::Parameters]),
    ] {
        for placed in docs.types_to_open("readFile", withheld) {
            assert!(
                !declared.iter().any(|failure| failure == placed),
                "{}: `{placed}` is a declared failure, which only the `errors` flag places",
                withheld.id()
            );
        }
    }
}

/// **The three flags union**, and a type more than one of them selects is placed once.
#[test]
fn the_flags_union_and_place_a_shared_type_once() {
    let docs = runtime();
    let all = only(&[
        DocViewType::Return,
        DocViewType::Parameters,
        DocViewType::Errors,
    ]);
    let placed = docs.types_to_open("readFile", all);
    for flag in DocViewType::ALL {
        for one in docs.types_to_open("readFile", DocViewTypes::only(flag)) {
            assert!(
                placed.contains(&one),
                "`{one}` is placed by `{}` alone and not by every flag together",
                flag.id()
            );
        }
    }
    let mut deduplicated = placed.clone();
    deduplicated.sort_unstable();
    deduplicated.dedup();
    assert_eq!(deduplicated.len(), placed.len(), "{placed:?}");
}

/// **A type is not a function, so it opens nothing** — which is what makes the rule one level deep
/// by construction rather than by a counter. A key that names no bound function selects nothing at
/// all, whatever the flags.
#[test]
fn a_type_key_opens_no_further_types() {
    let docs = runtime();
    for flag in DocViewType::ALL {
        let types = DocViewTypes::only(flag);
        assert!(
            docs.types_to_open("FileRead", types).is_empty(),
            "a type docview never opens a second type docview, under `{}`",
            flag.id()
        );
        assert!(docs.types_to_open("neverBound", types).is_empty());
    }
}

/// **A function this agent's scope does not bind selects nothing**, so a withheld call cannot leak
/// the shape of what it would have returned or of how it fails.
#[test]
fn a_withheld_function_selects_no_types() {
    let docs = granting(&[CAPABILITY_PROJECT_MANAGEMENT]);
    assert!(
        docs.types_to_open(
            "readFile",
            only(&[
                DocViewType::Return,
                DocViewType::Parameters,
                DocViewType::Errors
            ])
        )
        .is_empty()
    );
}

/// Every registered arm can be asked, and every name it answers with is a type that arm really
/// declares — so an open never names a key its own `read_type` would then miss. Asserted with every
/// flag on, since a name that resolves to nothing is as bad in the `errors` column as in the others.
#[test]
fn every_arm_selects_only_types_it_declares() {
    let all = only(&[
        DocViewType::Return,
        DocViewType::Parameters,
        DocViewType::Errors,
    ]);
    for language in crate::sandbox::all_languages() {
        let docs = on(&gating_capabilities(), language.id());
        for function in crate::sandbox::catalogue_functions(language) {
            for referenced in docs.types_to_open(function.name, all) {
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

/// **Depth exactly one, on every arm**: every type the `return` and `parameters` flags place is one
/// the function's own signature writes down.
///
/// This is the gate on the rule. The catalogue's `types` field is *transitively closed* — it exists
/// so a consumer can declare every type a surface can reach — so reading it raw opens a type's
/// fields' types and a returned enum's variants, which is depth two and beyond. It went unnoticed
/// because the two ECMAScript arms' closures are nearly flat, while on the compiled arms they are
/// three to five times the depth-one set: `read_file` on Rust opened `ApiErrorCode`, `TextFile` and
/// `ImageFile`, none of which
/// `read_file(path: &str, options: ReadOptions) -> Result<FileRead, ApiError>` names.
///
/// **`errors` is deliberately off here**, and the property is only true with it off: a declared
/// failure is written in a documentation comment and a signature need not mention it at all, so the
/// `errors` flag places names this test's haystack does not contain — by design. What holds that
/// column honest is the name rule (`sandbox/signatures.fqn.rs`), which walks `throws` beside
/// `returns`, and `every_arm_selects_only_types_it_declares` above.
///
/// The haystack is rebuilt here from the catalogue rather than taken from the helper under test, so
/// this asserts the *rule* rather than the implementation of it.
#[test]
fn every_arm_opens_only_types_its_own_signature_names() {
    let signature_flags = only(&[DocViewType::Return, DocViewType::Parameters]);
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
            for referenced in docs.types_to_open(function.name, signature_flags) {
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

/// **`return` and `parameters` really do differ, on every arm** — at least one function whose
/// arguments name a type its return position does not.
///
/// A flag is only worth running an A/B on if turning it on is distinguishable from leaving it off,
/// and the transitively closed reading collapsed these two: with a function's *whole* type closure
/// opened either way, `fs`'s argument records were already in the set the narrower reading was
/// supposed to withhold, so on Swift both answered `readFile` with the identical five names.
/// Asserted per arm because a single arm losing the distinction is exactly the failure this catches,
/// and it would be invisible in a total.
#[test]
fn the_return_and_parameters_flags_are_distinguishable_on_every_arm() {
    for language in crate::sandbox::all_languages() {
        let docs = on(&gating_capabilities(), language.id());
        let widened = crate::sandbox::catalogue_functions(language)
            .into_iter()
            .filter(|function| {
                let returned =
                    docs.types_to_open(function.name, DocViewTypes::only(DocViewType::Return));
                docs.types_to_open(function.name, DocViewTypes::only(DocViewType::Parameters))
                    .into_iter()
                    .any(|named| !returned.contains(&named))
            })
            .count();
        assert!(
            widened > 0,
            "{}: no function's arguments name a type its return position does not, so the \
             `parameters` flag is indistinguishable from leaving it off on this arm",
            language.display_name()
        );
    }
}

/// **`errors` places something on every arm** — the flag's whole point, and the property that would
/// silently disappear if a reflector stopped reading its language's tag for declaring a failure.
///
/// The catalogue half of that is
/// `every_arm_states_the_failures_its_documentation_declares` (`sandbox/signatures.test.rs`); this
/// is the runtime half, which additionally proves the declared name is one a view can be opened by
/// through the same lookup a run uses.
#[test]
fn the_errors_flag_places_a_failure_on_every_arm() {
    for language in crate::sandbox::all_languages() {
        let docs = on(&gating_capabilities(), language.id());
        let placing = crate::sandbox::catalogue_functions(language)
            .into_iter()
            .filter(|function| {
                !docs
                    .types_to_open(function.name, DocViewTypes::only(DocViewType::Errors))
                    .is_empty()
            })
            .count();
        assert!(
            placing > 0,
            "{}: not one call places a declared failure under the `errors` flag, so the flag is \
             indistinguishable from leaving it off on this arm",
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
