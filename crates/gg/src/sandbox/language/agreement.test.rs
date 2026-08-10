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
/// about *Swift's committed catalogue* and not about whichever language happens to be gg's default.
///
/// It is Swift because the comparative half of this gate reads the five-part identity a
/// [`V1`](crate::sandbox::SchemaVersion::V1) catalogue files an entry under, and runs over the v1
/// arms alone (see [`is_v1`](super::is_v1)). Swift is the one arm still written that way, so it is
/// the one arm the comparison can be made *against*; a reference cut from a converted arm would make
/// every row below assert nothing. It was TypeScript until TypeScript was converted, and it moves
/// again — to nothing, because the split goes with it — when the gate is re-founded on the
/// normalized model.
fn reference_arm() -> &'static dyn ProgramLanguage {
    language(GgProgramLanguage::Swift)
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
/// The headline assertion. Most of what it proves is each language's catalogue against gg's own
/// vocabularies — the tool bijection, the ending calls, the ending roles, the gates, the spellings
/// and the type closure — which holds per language and needs no second one.
///
/// The comparative half runs over the registry too, and what that is worth has changed with the
/// registry. It was written when the registry held **one pair** — TypeScript and JavaScript, whose
/// catalogues are one set of declarations reflected twice and could hardly disagree — and the
/// [fixture](super::super::fixture) was what made the comparison mean anything at all. Today it
/// compares **eleven** catalogues written by hand in eleven languages and reflected by nine
/// different documentation tools, which is the comparison this gate was built for rather than a
/// stand-in for it. The fixture stays because it is the half that can be made to *fail*: a
/// registered arm that agrees proves the arms agree, and only a deliberately damaged surface proves
/// the gate would have said so if they did not.
#[test]
fn every_registered_language_describes_one_capability_surface() {
    let found = disagreements(&registered());
    assert!(
        found.is_empty(),
        "the registered languages do not describe one capability surface:{}",
        report(&found)
    );
}

/// **Every registered language's component binds exactly the tools gg offers.**
///
/// Two gates in one test, both against the `.wasm` rather than against a source file. Instantiating
/// proves the artifact imports exactly what the membrane provides — a WIT change with no rebuild
/// fails here — and asking the guest which tools it binds proves the artifact is not merely
/// *loadable* but current.
///
/// It lives with the agreement gate rather than beside the sandbox's execution tests because it is
/// the same assertion as the catalogue's tool bijection, one layer down: the catalogue says what a
/// language *documents*, the component says what it *binds*, and a language whose two halves
/// disagreed would offer a study an arm that documents one surface and runs another.
///
/// For a [compiled arm](super::super::PreparedProgram::component) the artifact asked is one this
/// test **compiled seconds ago**, out of the one whole program the seam guarantees every language
/// can write. That is stronger evidence rather than weaker: a stale artifact is not a failure mode
/// an arm of that shape has, so what the check catches instead is the SDK's own binding table
/// falling out of step with the functions beside it.
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
        // An interpreted arm is asked about its committed component; a compiled one has none to
        // ask, so it is given a program to compile — `open_docs_views_statement` is the one whole
        // program every language is required to be able to write, and a sibling gate already
        // asserts each can prepare what it generated.
        let artifact = language.compiles_component().then(|| {
            crate::sandbox::prepare_program(language, &language.open_docs_views_statement(&[]), &[])
                .expect("a compiled arm compiles the program its own seam generated")
                .component
                .expect("a compiled arm hands back the component it compiled")
        });
        let mut bound = crate::sandbox::component_bound_tools(language, artifact)
            .expect("the guest instantiates and reports its tools");
        bound.sort();
        assert_eq!(
            bound,
            expected,
            "{}: the component and gg's tool vocabulary have drifted apart — rebuild the guest \
             with `packages/gg-sandbox/build.sh`",
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
/// The [fixture](super::super::fixture) is the reference arm's own surface with every name re-spelled in
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
    let found = disagreements(&[reference_arm(), fixture]);
    assert!(
        found.is_empty(),
        "a re-spelling of the same surface was rejected:{}",
        report(&found)
    );

    assert_eq!(
        identities(reference_arm()),
        identities(fixture),
        "the fixture is meant to be the same surface"
    );

    let theirs: Vec<&str> = reference_arm()
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
/// **This is the test that answers "what would fail if a second language's SDK disagreed with the
/// reference arm's".** Each row is one such disagreement, in the shape a real SDK would produce it.
#[test]
fn a_second_language_that_disagrees_is_caught() {
    /// One row: what the damage is called, the edit that inflicts it on a copy of the reference arm's
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
                invented["signatures"] = json!([{
                    "signature": "open_url(url: str)",
                    "parameters": [{
                        "name": "url",
                        "type": "str",
                        "optional": false,
                        "kind": "positional",
                        "default": null,
                        "doc": "Where to look.",
                        "fields": [],
                    }],
                }]);
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
                entry["signatures"][0]["signature"] = json!("read_file(path: str) -> str");
            }),
            "two functions on `fs` are both spelled `read_file`",
        ),
        (
            "a signature that does not start with the name a program calls",
            Box::new(|document: &mut Value| {
                document["tools"][0]["signatures"][0]["signature"] = json!("run(command: str)");
            }),
            "signature does not start with the name a program calls",
        ),
        (
            "a function offered in no shape at all",
            Box::new(|document: &mut Value| {
                document["tools"][0]["signatures"] = json!([]);
            }),
            "has no signature",
        ),
        (
            "an OVERLOAD whose second shape is misspelled",
            Box::new(|document: &mut Value| {
                let mut overload = document["tools"][0]["signatures"][0].clone();
                overload["signature"] = json!("run(command: str)");
                document["tools"][0]["signatures"]
                    .as_array_mut()
                    .expect("an array")
                    .push(overload);
            }),
            "signature does not start with the name a program calls",
        ),
        (
            "an argument with no description",
            Box::new(|document: &mut Value| {
                document["tools"][0]["signatures"][0]["parameters"][0]["doc"] = json!("");
            }),
            "`system.shell`'s `command` has no documentation",
        ),
        (
            "a signature whose arguments are documented nowhere",
            Box::new(|document: &mut Value| {
                document["tools"][0]["signatures"][0]["parameters"] = json!([]);
            }),
            "`system.shell` takes arguments and documents none",
        ),
        (
            "a whole catalogue that documents no argument anywhere",
            Box::new(|document: &mut Value| {
                // What a reflector for a language with no per-argument doc slot emits if nobody
                // makes it carry one — and, crucially, one whose signatures have no brackets to
                // look inside, so the internal check cannot see it and only the comparison can.
                for section in ["session", "views", "programs", "tools", "helpers"] {
                    for entry in document[section].as_array_mut().expect("an array") {
                        let name = entry["name"].as_str().expect("a name").to_string();
                        for signature in entry["signatures"].as_array_mut().expect("an array") {
                            signature["signature"] = json!(format!("{name} :: Effect Unit"));
                            signature["parameters"] = json!([]);
                        }
                    }
                }
            }),
            "documents no arguments for `fs.read_file`, where Swift documents some",
        ),
        (
            "a FIELD of a structured argument with no description",
            Box::new(|document: &mut Value| {
                for entry in document["tools"].as_array_mut().expect("an array") {
                    if entry["tool"] == json!("read_file") {
                        // The reference arm spells its read window as two flat optional arguments
                        // rather than as one record, so the structured shape this row is about is
                        // built before it is damaged. That is the shape an arm passing a record
                        // emits, and the rule is that a field of one is documented like any other
                        // argument — which is a claim about the field, not about whose idiom
                        // produced it.
                        entry["signatures"][0]["parameters"][1]["fields"] = json!([{
                            "name": "limit",
                            "type": "Int",
                            "optional": true,
                            "kind": "keyword",
                            "default": null,
                            "doc": "",
                            "fields": [],
                        }]);
                    }
                }
            }),
            "`limit` has no documentation",
        ),
        (
            "an argument the signature does not name",
            Box::new(|document: &mut Value| {
                document["tools"][0]["signatures"][0]["parameters"][0]["name"] =
                    json!("commandLine");
            }),
            "documents an argument `commandLine` its signature does not name",
        ),
        (
            "a type with no description",
            Box::new(|document: &mut Value| {
                document["types"][0]["doc"] = json!("");
            }),
            "the type `AgentStatus` has no documentation",
        ),
        (
            "a type member with no description",
            Box::new(|document: &mut Value| {
                for entry in document["types"].as_array_mut().expect("an array") {
                    if entry["name"] == json!("DirEntry") {
                        entry["members"][1]["doc"] = json!("");
                    }
                }
            }),
            "`DirEntry.kind` has no documentation",
        ),
        (
            "an API object with no description",
            Box::new(|document: &mut Value| {
                document["objects"][0]["doc"] = json!("");
            }),
            "the API object `fs` has no description",
        ),
        (
            "an API object nothing describes",
            Box::new(|document: &mut Value| {
                document["objects"]
                    .as_array_mut()
                    .expect("an array")
                    .retain(|entry| entry["object"] != json!("fs"));
            }),
            "functions hang off `fs` and nothing describes it",
        ),
        (
            "an API object described and never given",
            Box::new(|document: &mut Value| {
                document["objects"]
                    .as_array_mut()
                    .expect("an array")
                    .push(json!({ "object": "network", "doc": "reach the internet" }));
            }),
            "the API object `network` is described and no function hangs off it",
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
            "`system.shell` has no documentation",
        ),
        (
            "the meta function the SDK never declared",
            Box::new(|document: &mut Value| {
                document["meta"]
                    .as_array_mut()
                    .expect("meta is an array")
                    .clear();
            }),
            "the meta function `list` is not catalogued",
        ),
        (
            "a meta function gg does not bind",
            Box::new(|document: &mut Value| {
                let mut invented = document["meta"][0].clone();
                invented["key"] = json!("enumerate");
                invented["name"] = json!("enumerate");
                invented["signatures"][0]["signature"] = json!("enumerate() -> [FunctionSummary]");
                document["meta"]
                    .as_array_mut()
                    .expect("meta is an array")
                    .push(invented);
            }),
            "`enumerate` is catalogued as a meta function, and gg binds no such function",
        ),
        (
            "a meta function with no description",
            Box::new(|document: &mut Value| {
                document["meta"][0]["doc"] = json!("");
            }),
            "`list` has no documentation",
        ),
        (
            "a meta function spelled as a function some object already binds",
            Box::new(|document: &mut Value| {
                document["meta"][0]["name"] = json!("current");
                document["meta"][0]["signatures"][0]["signature"] =
                    json!("current() -> [FunctionSummary]");
            }),
            "`view.current` is spelled exactly as the meta function bound on every object",
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
        let found = disagreements(&[reference_arm(), damaged]);
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
            for shape in entry["signatures"].as_array_mut().expect("an array") {
                let signature = shape["signature"]
                    .as_str()
                    .expect("a signature")
                    .to_string();
                shape["signature"] = json!(format!("gg_{signature}"));
            }
            entry["name"] = json!(name);
            entry["doc"] = json!("Documented entirely differently, in another language's voice.");
        }
        for entry in document["objects"].as_array_mut().expect("an array") {
            entry["doc"] = json!("Introduced in another language's voice entirely.");
        }
        for entry in document["types"].as_array_mut().expect("an array") {
            entry["doc"] = json!("Explained differently.");
            for member in entry["members"].as_array_mut().expect("an array") {
                member["doc"] = json!("Explained differently.");
            }
        }
    });
    let found = disagreements(&[reference_arm(), respelled]);
    assert!(
        found.is_empty(),
        "a re-spelling was reported as a difference in capability:{}",
        report(&found)
    );
}

/// **A language that offers the same capability in a different SHAPE agrees.**
///
/// This is the assertion the `signatures` array exists for, and the one nothing else makes. An
/// optional argument is a Java overload pair, a Kotlin default and a TypeScript `?`; a structured
/// argument is a Python set of keyword arguments; and an argument's *name* is whatever reads best in
/// the language it is written in. All of that is spelling — so a catalogue that
///
/// * splits `fs.readFile`'s optional argument into **two signatures**, one taking the window and one
///   not, the way an overloading language must;
/// * renames every argument, the way a language with its own naming convention would; and
/// * passes them **by name** with a stated default, the way Python and Kotlin do
///
/// must agree with the reference arm's exactly, because it offers the same functions on the same objects
/// under the same gates. A gate that rejected this would make an overloading language impossible to
/// register, which is the failure that matters more than any it prevents.
#[test]
fn a_language_that_offers_the_same_capability_in_another_shape_agrees() {
    let idiomatic = a_language_whose_catalogue(|document| {
        for entry in document["tools"].as_array_mut().expect("an array") {
            let called = entry["name"].as_str().expect("a name").to_string();
            // The overload group: the same function, offered in two shapes, exactly as a language
            // without optional parameters has to offer it.
            if entry["tool"] == json!("read_file") {
                let full = entry["signatures"][0].clone();
                entry["signatures"] = json!([
                    {
                        "signature": format!("{called}(path: String): FileRead"),
                        "parameters": [full["parameters"][0].clone()],
                    },
                    full,
                ]);
            }
            // Renamed, passed by name, with a default stated in the signature — three idioms
            // Swift has no way to express, and none of them a difference in capability.
            // Only the argument list is rewritten: the head is the function's own name, which is
            // the one part of a signature the gate does read.
            for shape in entry["signatures"].as_array_mut().expect("an array") {
                let signature = shape["signature"]
                    .as_str()
                    .expect("a signature")
                    .to_string();
                let (head, mut arguments) = signature
                    .split_once('(')
                    .map(|(head, rest)| (head.to_string(), rest.to_string()))
                    .expect("a signature has an argument list");
                for parameter in shape["parameters"].as_array_mut().expect("an array") {
                    let name = parameter["name"].as_str().expect("a name").to_string();
                    let renamed = format!("the_{name}");
                    arguments = arguments.replace(&name, &renamed);
                    parameter["name"] = json!(renamed);
                    parameter["kind"] = json!("keyword");
                    parameter["default"] = json!("None");
                }
                shape["signature"] = json!(format!("{head}({arguments}"));
            }
        }
    });

    let found = disagreements(&[reference_arm(), idiomatic]);
    assert!(
        found.is_empty(),
        "a language offering the same capabilities in its own shape was rejected:{}",
        report(&found)
    );

    // And the divergence is real, not a no-op the gate never saw.
    let read_file = idiomatic
        .catalogue()
        .tools
        .iter()
        .find(|entry| entry.tool == "read_file")
        .expect("read_file is catalogued");
    assert_eq!(
        read_file.signatures.len(),
        2,
        "the overload group must actually carry two shapes"
    );
    assert_eq!(
        read_file.signatures[0].parameters.len(),
        1,
        "the shape without the window takes the path alone"
    );
    // How many arguments the window itself is — one record, or a pair of flat optionals — is the
    // spelling this whole test says an arm is free to choose, so what is asserted is that the second
    // shape takes more than the first rather than a count that would pin one arm's idiom.
    assert!(
        read_file.signatures[1].parameters.len() > 1,
        "the shape with the window takes the window's arguments too"
    );
}

/// **A language that writes its signatures in ML notation is read correctly, in both directions.**
///
/// The notation an arm writes its signatures in is spelling, and an ML type — `readFile :: String ->
/// Effect FileRead` — carries its argument list as a chain of top-level arrows rather than between
/// brackets. Two things follow, and the gate has to get both right or a Haskell-family arm is
/// unregisterable: an argument the type cannot name must not be demanded of it, and a signature that
/// *does* take arguments and documents none must still be caught. The second is the half that would
/// otherwise go silent, because the bracket rule reads `Effect (Array FunctionSummary)` as an
/// argument list and `String -> Effect Unit` as none — wrong in both directions.
#[test]
fn a_language_that_writes_ml_signatures_is_read_by_its_own_notation() {
    let ml = a_language_whose_catalogue(|document| {
        for section in ["meta", "session", "views", "programs", "tools", "helpers"] {
            for entry in document[section].as_array_mut().expect("an array") {
                let called = entry["name"].as_str().expect("a name").to_string();
                for shape in entry["signatures"].as_array_mut().expect("an array") {
                    // A type with no argument names in it at all: one arrow per parameter, and the
                    // parameter names left only in the documentation, which is where a language with
                    // this notation has to keep them.
                    let arrows: Vec<String> = shape["parameters"]
                        .as_array()
                        .expect("an array")
                        .iter()
                        .map(|parameter| {
                            format!("{} -> ", parameter["type"].as_str().unwrap_or("Unknown"))
                        })
                        .collect();
                    shape["signature"] =
                        json!(format!("{called} :: {}Effect Answer", arrows.concat()));
                }
            }
        }
    });
    let found = disagreements(&[reference_arm(), ml]);
    assert!(
        found.is_empty(),
        "a language whose signatures name no arguments was rejected:{}",
        report(&found)
    );

    // And the check it is exempt from is exempt for a reason rather than by accident: an ML
    // signature that takes an argument and documents none is still caught, and so is a field of a
    // structured argument the type does not name.
    let silent = a_language_whose_catalogue(|document| {
        for entry in document["tools"].as_array_mut().expect("an array") {
            if entry["tool"] != json!("read_file") {
                continue;
            }
            entry["signatures"] = json!([{
                "signature": "read_file :: String -> Effect FileRead",
                "parameters": [],
            }]);
        }
    });
    let found = disagreements(&[reference_arm(), silent]);
    assert!(
        found.iter().any(|disagreement| disagreement
            .detail
            .contains("takes arguments and documents none")),
        "an ML signature that takes an argument and documents none must be caught:{}",
        report(&found)
    );

    // The other direction: a nullary ML signature whose type merely *mentions* brackets is not read
    // as taking anything, which is what made `list :: Effect (Array FunctionSummary)` fail.
    let nullary = a_language_whose_catalogue(|document| {
        for entry in document["meta"].as_array_mut().expect("an array") {
            entry["signatures"] = json!([{
                "signature": "list :: Effect (Array FunctionSummary)",
                "parameters": [],
            }]);
        }
    });
    let found = disagreements(&[reference_arm(), nullary]);
    assert!(
        found.is_empty(),
        "a nullary ML signature was read as taking an argument:{}",
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
    assert!(disagreements(&[reference_arm(), fixture]).is_empty());
    assert!(disagreements(&[fixture, reference_arm()]).is_empty());

    let damaged = a_language_whose_catalogue(|document| {
        document["views"]
            .as_array_mut()
            .expect("an array")
            .truncate(2);
    });
    assert!(!disagreements(&[reference_arm(), damaged]).is_empty());
    assert!(!disagreements(&[damaged, reference_arm()]).is_empty());
}

/// **The gate reads a catalogue, not a component**: it can be run over a surface that has no guest
/// at all, which is what lets a second SDK be checked before anyone builds its component.
#[test]
fn the_gate_needs_no_guest() {
    let fixture = fixture_language();
    assert!(
        fixture
            .guest_component()
            .is_some_and(|bytes| !bytes.is_empty()),
        "the fixture's stub stands where a component would be"
    );
    assert!(disagreements(&[fixture]).is_empty());
}
