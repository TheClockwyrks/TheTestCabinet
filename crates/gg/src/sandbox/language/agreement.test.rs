//! The [agreement gate](super) run in both directions: over the languages gg really registers, and
//! over deliberately damaged surfaces that must not be allowed through.
//!
//! The second half is what makes the first half worth having. A gate that has only ever been
//! observed to pass is indistinguishable from a gate that cannot fail, and the failure this one is
//! supposed to prevent — an A/B study whose two arms offer different capabilities — is silent by
//! nature: both arms run, both produce sessions, and the difference in the numbers is attributed to
//! the language. So every check the gate makes is exercised here against a catalogue that breaks it.

use serde_json::{Value, json};
use test_cabinet_core::gg::GgProgramLanguage;

use super::super::fixture::{a_language_whose_catalogue, fixture_language};
use super::*;
use crate::sandbox::language::{all_languages, language};

/// The language every comparison is made against — named explicitly, because these assertions are
/// about *TypeScript's committed catalogue* and not about whichever language happens to be gg's
/// default.
fn typescript() -> &'static dyn ProgramLanguage {
    language(GgProgramLanguage::TypeScript)
}

/// Every registered language, as the gate takes them.
fn registered() -> Vec<&'static dyn ProgramLanguage> {
    all_languages().collect()
}

/// Render a gate result for a failure message: one complaint per line, or nothing.
fn report(found: &[Disagreement]) -> String {
    found
        .iter()
        .map(|disagreement| format!("\n  - {disagreement}"))
        .collect()
}

// ---------------------------------------------------------------------------------------------
// The gate, over what gg really ships
// ---------------------------------------------------------------------------------------------

/// **Every registered language describes one capability surface.**
///
/// The headline assertion, and — with one language registered — a restatement of gg's own
/// vocabularies as a property of that language's catalogue: the tool bijection, the ending calls,
/// the ending roles, the gates, the spellings and the type closure. See the module documentation for
/// what remains true, and what goes dormant, while only one language is registered.
#[test]
fn every_registered_language_describes_one_capability_surface() {
    let found = disagreements(&registered());
    assert!(
        found.is_empty(),
        "the registered languages do not describe one capability surface:{}",
        report(&found)
    );
}

/// **Every registered language's committed component binds exactly the tools gg offers.**
///
/// Two gates in one test, both against the committed `.wasm` rather than against a source file.
/// Instantiating proves the artifact imports exactly what the membrane provides — a WIT change with
/// no rebuild fails here — and asking the guest which tools it binds proves the artifact is not
/// merely *loadable* but current.
///
/// It lives with the agreement gate rather than beside the sandbox's execution tests because it is
/// the same assertion as the catalogue's tool bijection, one layer down: the catalogue says what a
/// language *documents*, the component says what it *binds*, and a language whose two halves
/// disagreed would offer a study an arm that documents one surface and runs another.
///
/// One blind spot, worth stating so nobody over-trusts the instantiation half: the guest imports the
/// eight tool families, `session`, `docs`, `views` and `feedback`. It never imports `types` or
/// `turns`, so instantiation cannot notice a change to those — only the tool-name check below, and
/// the Rust compiler, can.
#[test]
fn every_registered_language_binds_exactly_the_tools_gg_offers() {
    let mut expected: Vec<String> = crate::sandbox::signatures::sandbox_tool_names()
        .into_iter()
        .map(str::to_string)
        .collect();
    expected.sort();

    for language in registered() {
        let mut bound = crate::sandbox::component_bound_tools(language)
            .expect("the committed guest instantiates and reports its tools");
        bound.sort();
        assert_eq!(
            bound,
            expected,
            "{}: the committed component and gg's tool vocabulary have drifted apart — rebuild \
             the guest with `packages/gg-sandbox/build.sh`",
            language.display_name()
        );
    }
}

/// **Every registered language's catalogue says it is that language's.**
///
/// Provenance, and the one check that cannot be stated for an unregistered surface: the field is the
/// wire enum, and a language with no wire id has no value to put in it. It is what stops a catalogue
/// committed — or regenerated — under the wrong stem from reaching a model as a system prompt
/// describing a sandbox nobody has.
#[test]
fn every_registered_language_names_itself_in_its_catalogue() {
    for language in registered() {
        assert_eq!(
            language.catalogue().language,
            language.id(),
            "{}'s catalogue was generated for another language",
            language.display_name()
        );
    }
}

// ---------------------------------------------------------------------------------------------
// The gate, over a second surface
// ---------------------------------------------------------------------------------------------

/// **Two languages that differ only in spelling agree.**
///
/// The [fixture](super::super::fixture) is TypeScript's own surface with every name re-spelled in
/// snake_case and nothing else touched — the shape a real second arm takes. That the gate passes it
/// is the assertion that the gate compares *identity*: a gate that compared names would reject this,
/// and a study could never have two arms at all.
///
/// The second half of the test is what keeps the first from being vacuous. If the fixture's
/// spellings had silently stopped differing, "the gate accepts differing spellings" would be a
/// sentence about nothing.
#[test]
fn a_second_language_that_only_respells_agrees() {
    let fixture = fixture_language();
    let found = disagreements(&[typescript(), fixture]);
    assert!(
        found.is_empty(),
        "a re-spelling of the same surface was rejected:{}",
        report(&found)
    );

    assert_eq!(
        identities(typescript()),
        identities(fixture),
        "the fixture is meant to be the same surface"
    );

    let theirs: Vec<&str> = typescript()
        .catalogue()
        .tools
        .iter()
        .map(|entry| entry.name.as_str())
        .collect();
    let ours: Vec<&str> = fixture
        .catalogue()
        .tools
        .iter()
        .map(|entry| entry.name.as_str())
        .collect();
    assert_ne!(
        theirs, ours,
        "the fixture must actually spell things differently, or this test asserts nothing"
    );
    assert!(
        ours.contains(&"read_file") && theirs.contains(&"readFile"),
        "the two arms spell the same identity differently"
    );
}

/// **Each way a catalogue can disagree is caught, and named.**
///
/// One row per check the gate makes. The expectation is a fragment of the complaint rather than the
/// count of them, because a single damaged entry legitimately produces several — a missing tool is
/// both an incomplete bijection and an identity the other arm has — and pinning the count would make
/// the test brittle without making it stricter.
///
/// **This is the test that answers "what would fail if a second language's SDK disagreed with
/// TypeScript's".** Each row is one such disagreement, in the shape a real SDK would produce it.
#[test]
fn a_second_language_that_disagrees_is_caught() {
    /// One row: what the damage is called, the edit that inflicts it on a copy of TypeScript's
    /// catalogue, and a fragment the gate's complaint must contain.
    type Case = (&'static str, Box<dyn FnOnce(&mut Value)>, &'static str);

    let cases: Vec<Case> = vec![
        (
            "a tool the SDK never bound",
            Box::new(|document: &mut Value| {
                document["tools"]
                    .as_array_mut()
                    .expect("tools is an array")
                    .retain(|entry| entry["tool"] != json!("edit_file"));
            }),
            "the gg tool `edit_file` is not catalogued",
        ),
        (
            "a tool the SDK invented",
            Box::new(|document: &mut Value| {
                let mut invented = document["tools"][0].clone();
                invented["tool"] = json!("read_the_room");
                invented["name"] = json!("read_the_room");
                document["tools"]
                    .as_array_mut()
                    .expect("tools is an array")
                    .push(invented);
            }),
            "`read_the_room` is catalogued as a gg tool, and is not one",
        ),
        (
            "an object renamed",
            Box::new(|document: &mut Value| {
                for section in ["tools", "helpers"] {
                    for entry in document[section].as_array_mut().expect("an array") {
                        if entry["object"] == json!("fs") {
                            entry["object"] = json!("filesystem");
                        }
                    }
                }
            }),
            "under `fs`",
        ),
        (
            "a view gated on a tool the other arm does not gate it on",
            Box::new(|document: &mut Value| {
                for entry in document["views"].as_array_mut().expect("an array") {
                    if entry["key"] == json!("open_text") {
                        entry["requires"] = json!("read_file");
                    }
                }
            }),
            "offers `view.open_text [views, gated on read_file]`",
        ),
        (
            "a view function the other arm does not have",
            Box::new(|document: &mut Value| {
                let mut invented = document["views"][0].clone();
                invented["key"] = json!("open_url");
                invented["name"] = json!("open_url");
                invented["signature"] = json!("open_url(url: str)");
                document["views"]
                    .as_array_mut()
                    .expect("an array")
                    .push(invented);
            }),
            "offers `view.open_url",
        ),
        (
            "an ending bound to a role gg does not have",
            Box::new(|document: &mut Value| {
                for entry in document["session"].as_array_mut().expect("an array") {
                    if entry["key"] == json!("finish") {
                        entry["ending"] = json!("root");
                    }
                }
            }),
            "which is not one of",
        ),
        (
            "an ending gg does not offer",
            Box::new(|document: &mut Value| {
                for entry in document["session"].as_array_mut().expect("an array") {
                    if entry["key"] == json!("request_changes") {
                        entry["key"] = json!("reject");
                    }
                }
            }),
            "`reject` is catalogued as an ending call, and gg has no such ending",
        ),
        (
            "a gate that names no gg tool",
            Box::new(|document: &mut Value| {
                for entry in document["helpers"].as_array_mut().expect("an array") {
                    entry["requires"] = json!("read_files");
                }
            }),
            "`read_files` gates a function and is not a gg tool",
        ),
        (
            "two functions on one object spelled the same",
            Box::new(|document: &mut Value| {
                let entry = &mut document["helpers"].as_array_mut().expect("an array")[0];
                entry["name"] = json!("read_file");
                entry["signature"] = json!("read_file(path: str) -> str");
            }),
            "two functions on `fs` are both spelled `read_file`",
        ),
        (
            "a signature that does not start with the name a program calls",
            Box::new(|document: &mut Value| {
                document["tools"][0]["signature"] = json!("run(command: str)");
            }),
            "signature does not start with the name a program calls",
        ),
        (
            "a type mentioned and never declared",
            Box::new(|document: &mut Value| {
                document["tools"][0]["types"] = json!(["NoSuchType"]);
            }),
            "`NoSuchType` is referenced by a signature and never declared",
        ),
        (
            "an entry with no documentation",
            Box::new(|document: &mut Value| {
                document["tools"][0]["doc"] = json!("");
            }),
            "has no documentation",
        ),
        (
            "a program-library function the other arm does not have",
            Box::new(|document: &mut Value| {
                document["programs"]
                    .as_array_mut()
                    .expect("an array")
                    .truncate(1);
            }),
            "does not offer `programs.",
        ),
    ];

    for (name, edit, expected) in cases {
        let damaged = a_language_whose_catalogue(edit);
        let found = disagreements(&[typescript(), damaged]);
        assert!(
            found
                .iter()
                .any(|disagreement| disagreement.detail.contains(expected)),
            "{name}: the gate did not complain that `{expected}`. It said:{}",
            report(&found)
        );
    }
}

/// **Spelling alone is never a disagreement.**
///
/// The negative control for the row of teeth above. A gate that caught everything would be
/// indistinguishable from one that caught the right things, and it would be worse than useless: it
/// would make a second language impossible to register, which is the only thing this whole seam is
/// for. So a name, a signature and a documentation paragraph are each rewritten as far as the schema
/// allows, and the gate must stay silent.
#[test]
fn a_difference_in_spelling_alone_is_never_a_disagreement() {
    let respelled = a_language_whose_catalogue(|document| {
        for entry in document["tools"].as_array_mut().expect("an array") {
            let name = format!("gg_{}", entry["name"].as_str().expect("a name"));
            let signature = entry["signature"]
                .as_str()
                .expect("a signature")
                .to_string();
            entry["signature"] = json!(format!("gg_{signature}"));
            entry["name"] = json!(name);
            entry["doc"] = json!("Documented entirely differently, in another language's voice.");
        }
    });
    let found = disagreements(&[typescript(), respelled]);
    assert!(
        found.is_empty(),
        "a re-spelling was reported as a difference in capability:{}",
        report(&found)
    );
}

/// **A surface that agrees with the reference arm agrees with it whichever arm is first.**
///
/// The relation the gate reports is symmetric even though its phrasing is not, and a study may
/// register its arms in any order.
#[test]
fn the_order_of_the_arms_does_not_decide_the_verdict() {
    let fixture = fixture_language();
    assert!(disagreements(&[typescript(), fixture]).is_empty());
    assert!(disagreements(&[fixture, typescript()]).is_empty());

    let damaged = a_language_whose_catalogue(|document| {
        document["views"]
            .as_array_mut()
            .expect("an array")
            .truncate(2);
    });
    assert!(!disagreements(&[typescript(), damaged]).is_empty());
    assert!(!disagreements(&[damaged, typescript()]).is_empty());
}

/// **The gate reads a catalogue, not a component**: it can be run over a surface that has no guest
/// at all, which is what lets a second SDK be checked before anyone builds its component.
#[test]
fn the_gate_needs_no_guest() {
    let fixture = fixture_language();
    assert!(
        !fixture.guest_component().is_empty(),
        "the fixture's stub stands where a component would be"
    );
    assert!(disagreements(&[fixture]).is_empty());
}
