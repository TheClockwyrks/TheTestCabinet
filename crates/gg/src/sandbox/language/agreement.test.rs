//! The [capability gate](super) run in both directions: over what gg really ships, and over
//! deliberately damaged surfaces and deliberately damaged **operations tables** that must not be
//! allowed through.
//!
//! The second half is what makes the first half worth having, and it is the whole reason this stage
//! exists. A coverage gate written slightly too loosely still passes on eleven green arms and stops
//! catching the thing it was written for, and the failure it exists to prevent is silent by nature:
//! an A/B study whose two arms offer different capabilities still runs, still produces sessions, and
//! still hands back numbers that get attributed to the language. So every rule the gate makes is
//! exercised here against something that breaks it, and every one of those has been watched failing.
//!
//! Two kinds of subject, because the gate has two halves:
//!
//! * **A damaged catalogue**, built by reshaping a real arm's and then breaking a row of it —
//!   that is [`a_language_whose_catalogue`], and it exercises coverage, aliases, takes-input and
//!   spellings.
//! * **A damaged operations table**, built by copying [`OPERATIONS`] and editing a row — that is
//!   [`a_table_where`], and it exercises the gating rules, which are otherwise assertions about a
//!   `const` that nothing could ever be observed rejecting.

use serde_json::{Value, json};
use test_cabinet_core::gg::{CAPABILITY_PROGRAM_LIBRARY, GgProgramLanguage};

use super::super::fixture::{a_language_whose_catalogue, fixture_language};
use super::*;
use crate::sandbox::language::{SurfaceCall, all_languages};
use crate::sandbox::operations::FAMILY_FILESYSTEM;

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

/// Whether any complaint says `expected`.
fn said(found: &[Disagreement], expected: &str) -> bool {
    found
        .iter()
        .any(|disagreement| disagreement.detail.contains(expected))
}

// ---------------------------------------------------------------------------------------------
// The gate, over what gg really ships
// ---------------------------------------------------------------------------------------------

/// **Every registered language lets a model do the same things, under the same conditions.**
///
/// The headline assertion, and after the re-founding it is entirely per-arm: gg's own
/// [operations table](OPERATIONS) is checked once, and then each of the eleven arms is held to it
/// alone. Nothing is compared between arms, so this says the same thing whether one language is
/// registered or twenty.
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
/// It lives with the capability gate because it is the same assertion as the table's own tool
/// bijection, one layer down: the table says what gg *gates*, the catalogue says what a language
/// *documents*, and the component says what it *binds*. A language whose halves disagreed would
/// offer a study an arm that documents one surface and runs another.
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
        // An interpreted arm is asked about its prebuilt component; a compiled one has none to
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
/// written — or embedded — under the wrong stem from reaching a model as a system prompt describing
/// a sandbox nobody has, which is a live possibility rather than a hypothetical: eleven reflectors
/// write eleven stems into the one directory the build hands them.
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
// The gate, over a surface in another shape
// ---------------------------------------------------------------------------------------------

/// **A surface that offers the same capabilities in a different SHAPE agrees.**
///
/// This is the assertion the whole re-founding turns on, and the one the retired gate could not have
/// made: the [fixture](super::super::fixture) offers every operation gg has, and offers them
/// *differently* — its modules are named differently, one operation is filed under a module gg has
/// no word for, two are methods on the types they operate on rather than free functions, one is
/// bound twice, and every name is spelled another way. The old gate compared a five-part identity
/// tuple to a reference arm's and would have rejected every one of those. A gate that rejected them
/// would make an idiomatic SDK impossible to register, which is the failure that matters more than
/// any it prevents.
///
/// The second half of the test is what stops the first from being vacuous. If the reshape had
/// silently stopped reshaping — if a later edit made the fixture a copy of the arm it is cut from —
/// "the gate accepts another shape" would be a sentence about nothing.
#[test]
fn a_surface_that_offers_the_same_capabilities_in_another_shape_agrees() {
    let fixture = fixture_language();
    let found = disagreements(&[fixture]);
    assert!(
        found.is_empty(),
        "a surface offering gg's capabilities in its own shape was rejected:{}",
        report(&found)
    );

    let functions = crate::sandbox::catalogue_functions(fixture);
    let binding = |operation: &str| {
        functions
            .iter()
            .find(|function| function.operation == Some(operation) && function.alias_of.is_none())
            .unwrap_or_else(|| panic!("the fixture binds `{operation}`"))
    };

    // Re-spelled, so a gate that had quietly keyed coverage on gg's own words would fail.
    assert_eq!(binding("files.read_file").name, "read_file");
    // A method on the type it operates on, where the arm it was cut from has a free function —
    // and one whose **receiver is the argument**: gg says closing a view takes input, and this
    // binding documents no parameter because the view it closes is the thing it hangs off. That is
    // the idiomatic shape in every language with methods, so a gate that read only the parameter
    // list would forbid an arm from choosing it and force a free function to stand beside every
    // parameterised operation forever.
    let close = binding("views.close");
    assert_eq!(close.kind, crate::sandbox::signatures::EntryKind::Method);
    assert_eq!(close.receiver, Some("OpenView"));
    assert!(
        close
            .signatures
            .iter()
            .all(|shape| shape.parameters.is_empty()),
        "the fixture's canonical `views.close` takes its argument from its receiver"
    );
    assert!(
        crate::sandbox::operations::operation_by_id("views.close")
            .expect("gg has `views.close`")
            .takes_input,
        "and gg says the operation takes input, which is what makes the shape worth exercising"
    );

    // The reshape does not collide with itself. It is cut from a real arm's catalogue, reflected
    // afresh on every build and therefore changing under it, and the change it is most likely to
    // meet is the source arm growing exactly one of
    // the shapes this produces — a member alias on `OpenView`. Asserted here so that such a change
    // fails with a sentence about the reshape rather than four gate failures naming the fixture.
    let mut shapes: Vec<(&str, Option<&str>, &str)> = functions
        .iter()
        .map(|function| (function.object, function.receiver, function.name))
        .collect();
    let spellings = shapes.len();
    shapes.sort_unstable();
    shapes.dedup();
    assert_eq!(
        shapes.len(),
        spellings,
        "the reshape produced two entries with one `(module, receiver, name)`"
    );
    // Filed under a module gg has no word for, which is the arm's business and not gg's.
    assert_eq!(binding("board.wait_for_issue").object, "waiting");
    // And a different *number* of functions from the operations it covers, which is what an alias
    // is: one operation, two ways in, and coverage counting the canonical one.
    let aliases: Vec<&str> = functions
        .iter()
        .filter_map(|function| function.alias_of)
        .collect();
    assert_eq!(aliases, vec!["views.close"]);
    assert_eq!(
        functions.len(),
        OPERATIONS.len() + 1,
        "the fixture binds every operation once, and one of them twice"
    );
}

/// **A difference in spelling alone is never a disagreement.**
///
/// The negative control for the rows of teeth below. A gate that caught everything would be
/// indistinguishable from one that caught the right things, and it would be worse than useless: it
/// would make a second language impossible to register, which is the only thing this whole seam is
/// for. So a name, a signature and a description are each rewritten as far as the schema allows, and
/// the gate must stay silent.
#[test]
fn a_difference_in_spelling_alone_is_never_a_disagreement() {
    let respelled = a_language_whose_catalogue(|document| {
        for entry in document["functions"].as_array_mut().expect("an array") {
            let name = format!("gg_{}", entry["name"].as_str().expect("a name"));
            for shape in entry["signatures"].as_array_mut().expect("an array") {
                let signature = shape["signature"]
                    .as_str()
                    .expect("a signature")
                    .to_string();
                shape["signature"] = json!(format!("gg_{signature}"));
            }
            let fqn = entry["fqn"].as_str().expect("a name").to_string();
            let (module, _) = fqn.rsplit_once('.').expect("a name is module-qualified");
            entry["fqn"] = json!(format!("{module}.{name}"));
            entry["name"] = json!(name);
            entry["brief"] = json!("Documented entirely differently, in another language's voice.");
        }
        for entry in document["types"].as_array_mut().expect("an array") {
            entry["brief"] = json!("Explained differently.");
            for member in entry["members"].as_array_mut().expect("an array") {
                member["brief"] = json!("Explained differently.");
            }
        }
    });
    let found = disagreements(&[respelled]);
    assert!(
        found.is_empty(),
        "a re-spelling was reported as a difference in capability:{}",
        report(&found)
    );
}

/// **A language that writes its signatures in ML notation is read correctly, in both directions.**
///
/// The notation an arm writes its signatures in is spelling, and an ML type —
/// `readFile :: String -> Effect FileRead` — carries its argument list as a chain of top-level
/// arrows rather than between brackets. Two things follow, and the gate has to get both right or a
/// Haskell-family arm is unregisterable: an argument the type cannot name must not be demanded of
/// it, and a signature that *does* take arguments and documents none must still be caught. The
/// second is the half that would otherwise go silent, because the bracket rule reads
/// `Effect (Array OpenView)` as an argument list and `String -> Effect Unit` as none — wrong in both
/// directions.
#[test]
fn a_language_that_writes_ml_signatures_is_read_by_its_own_notation() {
    let ml = a_language_whose_catalogue(|document| {
        for entry in document["functions"].as_array_mut().expect("an array") {
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
                shape["signature"] = json!(format!("{called} :: {}Effect Answer", arrows.concat()));
            }
        }
    });
    let found = disagreements(&[ml]);
    assert!(
        found.is_empty(),
        "a language whose signatures name no arguments was rejected:{}",
        report(&found)
    );

    // And the check it is exempt from is exempt for a reason rather than by accident: an ML
    // signature that takes an argument and documents none is still caught.
    let silent = a_language_whose_catalogue(|document| {
        entry(document, "files.read_file")["signatures"] = json!([{
            "signature": "read_file :: String -> Effect FileRead",
            "parameters": [],
        }]);
    });
    let found = disagreements(&[silent]);
    assert!(
        said(&found, "takes arguments and documents none"),
        "an ML signature that takes an argument and documents none must be caught:{}",
        report(&found)
    );

    // The other direction: a nullary ML signature whose type merely *mentions* brackets is not read
    // as taking anything, which is what made `current :: Effect (Array OpenView)` fail.
    let nullary = a_language_whose_catalogue(|document| {
        entry(document, "views.current")["signatures"] = json!([{
            "signature": "current :: Effect (Array OpenView)",
            "parameters": [],
        }]);
    });
    let found = disagreements(&[nullary]);
    assert!(
        found.is_empty(),
        "a nullary ML signature was read as taking an argument:{}",
        report(&found)
    );
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

/// **The order the arms are given in decides nothing**, because there is no reference arm left for
/// an order to promote one to.
#[test]
fn the_order_of_the_arms_does_not_decide_the_verdict() {
    let fixture = fixture_language();
    let typescript = crate::sandbox::language(GgProgramLanguage::TypeScript);
    assert!(disagreements(&[typescript, fixture]).is_empty());
    assert!(disagreements(&[fixture, typescript]).is_empty());

    let damaged = a_language_whose_catalogue(|document| {
        document["functions"]
            .as_array_mut()
            .expect("an array")
            .truncate(2);
    });
    assert!(!disagreements(&[typescript, damaged]).is_empty());
    assert!(!disagreements(&[damaged, typescript]).is_empty());
}

// ---------------------------------------------------------------------------------------------
// Teeth: a damaged catalogue
// ---------------------------------------------------------------------------------------------

/// The entry binding `operation` canonically, found by the operation rather than by an index, so
/// that a reflector re-ordering its output cannot silently move a row of damage onto another call.
fn entry<'a>(document: &'a mut Value, operation: &str) -> &'a mut Value {
    document["functions"]
        .as_array_mut()
        .expect("a catalogue files every call in `functions`")
        .iter_mut()
        .find(|entry| entry["operation"] == json!(operation) && entry["aliasOf"].is_null())
        .unwrap_or_else(|| panic!("the fixture binds `{operation}`"))
}

/// Drop the entry binding `operation` canonically.
fn drop_entry(document: &mut Value, operation: &str) {
    document["functions"]
        .as_array_mut()
        .expect("an array")
        .retain(|entry| entry["operation"] != json!(operation) || !entry["aliasOf"].is_null());
}

/// Add `entry` to a catalogue.
fn push(document: &mut Value, entry: Value) {
    document["functions"]
        .as_array_mut()
        .expect("an array")
        .push(entry);
}

/// **Each way an arm can fail to cover gg's capabilities is caught, and named.**
///
/// One row per rule the per-arm half makes, each in the shape a real SDK's reflector would emit it.
/// The expectation is a fragment of the complaint rather than a count of them, because one damaged
/// entry legitimately produces several — an operation bound under a mistyped id is both an
/// unresolvable entry and a missing operation — and pinning the count would make the test brittle
/// without making it stricter.
///
/// **This is the test that answers "what would fail if an arm's SDK quietly stopped offering
/// something".**
#[test]
fn a_catalogue_that_does_not_cover_gg_s_capabilities_is_caught() {
    /// One row: what the damage is called, the edit that inflicts it on a reshaped catalogue, and a
    /// fragment the gate's complaint must contain.
    type Case = (&'static str, Box<dyn FnOnce(&mut Value)>, &'static str);

    let cases: Vec<Case> = vec![
        (
            "an operation the SDK stopped binding",
            Box::new(|document: &mut Value| drop_entry(document, "files.edit_file")),
            "gg offers `files.edit_file` and this arm binds it nowhere",
        ),
        (
            "an operation bound twice, with neither binding calling itself the alias",
            Box::new(|document: &mut Value| {
                let mut second = entry(document, "files.list_dir").clone();
                second["name"] = json!("enumerate");
                second["fqn"] = json!("workspace.enumerate");
                second["signatures"][0]["signature"] = json!("enumerate(path: string): DirEntry[]");
                push(document, second);
            }),
            "binds `files.list_dir` 2 times over",
        ),
        (
            "an operation gg does not have",
            Box::new(|document: &mut Value| {
                entry(document, "shell.shell")["operation"] = json!("shell.exec");
            }),
            "binds the operation `shell.exec`, which gg does not have",
        ),
        (
            "an alias of an operation gg does not have",
            Box::new(|document: &mut Value| {
                for entry in document["functions"].as_array_mut().expect("an array") {
                    if entry["aliasOf"] == json!("views.close") {
                        entry["aliasOf"] = json!("views.shut");
                    }
                }
            }),
            "is an alias of `views.shut`, which gg does not have",
        ),
        (
            "an alias standing where the binding it doubles should be",
            Box::new(|document: &mut Value| drop_entry(document, "views.close")),
            "is an alias of `views.close`, which this arm binds nowhere",
        ),
        (
            "a call the arm says takes an argument where gg says it takes none",
            Box::new(|document: &mut Value| {
                let current = entry(document, "views.current");
                current["signatures"] = json!([{
                    "signature": "current(limit: number): OpenView[]",
                    "parameters": [{
                        "name": "limit",
                        "type": "number",
                        "optional": false,
                        "kind": "positional",
                        "default": null,
                        "doc": "How many to hand back.",
                        "fields": [],
                    }],
                }]);
            }),
            "where gg says the operation takes nothing",
        ),
        (
            "a call the arm says takes nothing where gg says it takes input",
            Box::new(|document: &mut Value| {
                let read = entry(document, "files.read_file");
                read["signatures"] = json!([{ "signature": "read_file", "parameters": [] }]);
            }),
            "where gg says the operation takes input",
        ),
        (
            "two functions one module binds under one name",
            Box::new(|document: &mut Value| {
                let mut shadowing = entry(document, "files.list_dir").clone();
                shadowing["aliasOf"] = json!("files.list_dir");
                shadowing["name"] = json!("read_file");
                shadowing["fqn"] = json!("workspace.read_file");
                shadowing["signatures"][0]["signature"] = json!("read_file(path: string)");
                push(document, shadowing);
            }),
            "two functions on `workspace` are both spelled `read_file`",
        ),
        (
            "an entry offered in no callable shape at all",
            Box::new(|document: &mut Value| {
                entry(document, "files.read_file")["signatures"] = json!([]);
            }),
            "`workspace.read_file` has no signature",
        ),
        (
            // The condition every arm holds so that the static SDKs' one accepted consequence is
            // safe: a program may compile a call search would never show it, and what stops that
            // being a trap is that such a call cannot look like a local helper. An arm offering a
            // bare `read_file` would put the two in the same shape.
            "a function offered under a bare name, reachable through nothing",
            Box::new(|document: &mut Value| {
                entry(document, "files.read_file")["fqn"] = json!("read_file");
            }),
            "is offered under a bare name",
        ),
        (
            "a signature that does not start with the name a program calls",
            Box::new(|document: &mut Value| {
                entry(document, "files.read_file")["signatures"][0]["signature"] =
                    json!("function read_file(path: string): FileRead");
            }),
            "does not start with the name a program calls",
        ),
        (
            "an argument list documented nowhere",
            Box::new(|document: &mut Value| {
                entry(document, "files.read_file")["signatures"][0]["parameters"] = json!([]);
            }),
            "`workspace.read_file` takes arguments and documents none",
        ),
        (
            "an argument with no description",
            Box::new(|document: &mut Value| {
                entry(document, "files.read_file")["signatures"][0]["parameters"][0]["doc"] =
                    json!("");
            }),
            "`workspace.read_file`'s `path` has no documentation",
        ),
        (
            "a FIELD of a structured argument with no description",
            Box::new(|document: &mut Value| {
                entry(document, "files.read_file")["signatures"][0]["parameters"][1]["fields"][0]
                    ["doc"] = json!("");
            }),
            "`workspace.read_file`'s `offset` has no documentation",
        ),
        (
            "an argument the signature does not name",
            Box::new(|document: &mut Value| {
                entry(document, "files.read_file")["signatures"][0]["parameters"][0]["name"] =
                    json!("filePath");
            }),
            "documents an argument `filePath` its signature does not name",
        ),
        (
            "a whole catalogue written in the schema this gate no longer reads",
            Box::new(|document: &mut Value| {
                *document = serde_json::from_str(crate::sandbox::signatures::fixture::V1)
                    .expect("the doc model's v1 fixture is valid JSON");
            }),
            "emits a catalogue in schema 1",
        ),
    ];

    // Every row is inflicted before anything is asserted, so that weakening the gate shows *which*
    // rules stopped biting rather than only the first of them.
    let mut missed: Vec<String> = Vec::new();
    for (name, edit, expected) in cases {
        let damaged = a_language_whose_catalogue(edit);
        let found = disagreements(&[damaged]);
        // Filed against the arm, not against gg: a catalogue's failure is the arm's, and a
        // complaint nobody can attribute is a complaint nobody can act on.
        let caught = found.iter().any(|disagreement| {
            disagreement.subject == damaged.display_name() && disagreement.detail.contains(expected)
        });
        if !caught {
            missed.push(format!(
                "\n\n{name}: this arm was never told `{expected}`. It was told:{}",
                report(&found)
            ));
        }
    }
    assert!(
        missed.is_empty(),
        "the gate let damaged catalogues through:{}",
        missed.concat()
    );
}

// ---------------------------------------------------------------------------------------------
// Teeth: a damaged operations table
// ---------------------------------------------------------------------------------------------

/// gg's own table with `edit` applied to a copy of it.
///
/// Leaked, because the gate takes a `&'static [Operation]` — the same trade the fixture catalogues
/// make. A test binary that runs a handful of these leaks a handful of tables and then exits.
fn a_table_where(edit: impl FnOnce(&mut Vec<Operation>)) -> &'static [Operation] {
    let mut rows = OPERATIONS.to_vec();
    edit(&mut rows);
    Box::leak(rows.into_boxed_slice())
}

/// The row `id` names, so a damage is aimed by gg's own name for an operation rather than by an
/// index another edit could move.
fn row<'a>(rows: &'a mut [Operation], id: &str) -> &'a mut Operation {
    rows.iter_mut()
        .find(|operation| operation.id.to_string() == id)
        .unwrap_or_else(|| panic!("gg has an operation `{id}`"))
}

/// **Each way gg can gate an operation wrongly is caught, and named.**
///
/// The gating rules read the table and nothing else, so on a green tree they are assertions about a
/// `const` that no test could ever watch reject anything — which is exactly the shape of check that
/// quietly stops working. Handing the gate a table with one row damaged is what makes each of them a
/// rule rather than a hope.
///
/// The subject of every complaint here is [`GG`] rather than an arm, and that is the point: a gate
/// is stated once and read by all eleven, so a wrong row mis-gates all eleven at once.
#[test]
fn a_gating_rule_gg_gets_wrong_is_caught() {
    /// One row: what the damage is called, the edit that inflicts it on a copy of gg's table, and a
    /// fragment the gate's complaint must contain.
    type Case = (
        &'static str,
        Box<dyn FnOnce(&mut Vec<Operation>)>,
        &'static str,
    );

    let cases: Vec<Case> = vec![
        (
            "a view of a file bound to every program, gate and all",
            Box::new(|rows: &mut Vec<Operation>| {
                row(rows, "views.open_file").binding = Binding::Always;
            }),
            "the view `views.open_file` is bound by Always",
        ),
        (
            "a view bound to a tool that does not read the workspace",
            Box::new(|rows: &mut Vec<Operation>| {
                row(rows, "views.open_text").binding = Binding::Tool("write_file");
            }),
            "the view `views.open_text` is bound by Tool(\"write_file\")",
        ),
        (
            "an operation gated on something that is not a gg tool",
            Box::new(|rows: &mut Vec<Operation>| {
                row(rows, "shell.shell").binding = Binding::Tool("bash");
            }),
            "`shell.shell` is bound by `bash`, which is not a gg tool",
        ),
        (
            "two operations that swapped the tools they are named after",
            Box::new(|rows: &mut Vec<Operation>| {
                // The fault the set bijection cannot see: both tools still buy an operation, both
                // operations still name a real tool, and every arm would document and bind
                // `remove_task` to a run that enabled only `add_task`.
                row(rows, "tasks.add_task").binding = Binding::Tool("remove_task");
                row(rows, "tasks.remove_task").binding = Binding::Tool("add_task");
            }),
            "`tasks.add_task` is gg's own name for the tool `add_task` and is bought by \
             Tool(\"remove_task\")",
        ),
        (
            "an operation named after a tool and handed to every program",
            Box::new(|rows: &mut Vec<Operation>| {
                row(rows, "files.list_dir").binding = Binding::Always;
            }),
            "`files.list_dir` is gg's own name for the tool `list_dir` and is bought by Always",
        ),
        (
            "a gg tool that buys nothing at all",
            Box::new(|rows: &mut Vec<Operation>| {
                rows.retain(|operation| operation.id.to_string() != "shell.shell");
            }),
            "the gg tool `shell` buys no operation",
        ),
        (
            "an ending offered to a role gg does not offer it to",
            Box::new(|rows: &mut Vec<Operation>| {
                row(rows, "session.approve").binding = Binding::Ending(EndingRole::Standard);
            }),
            "`approve` is bound as a `standard` ending",
        ),
        (
            "a capability buying an operation outside the family gg paired it with",
            Box::new(|rows: &mut Vec<Operation>| {
                row(rows, "files.read_file").binding =
                    Binding::Capability(CAPABILITY_PROGRAM_LIBRARY);
            }),
            "`files.read_file` is filed under `gg-filesystem` and is bought by `program-library`, \
             which buys the `gg-programs` family",
        ),
        (
            "a program-library call bought by something other than the capability",
            Box::new(|rows: &mut Vec<Operation>| {
                row(rows, "programs.get").binding = Binding::Always;
            }),
            "`programs.get` belongs to the program library and is bound by Always",
        ),
        (
            "a capability gg does not have",
            Box::new(|rows: &mut Vec<Operation>| {
                row(rows, "programs.rerun").binding = Binding::Capability("time-travel");
            }),
            "`programs.rerun` is bought by `time-travel`, which is not a gg capability",
        ),
        (
            "a capability paired with a family it then buys nothing in",
            Box::new(|rows: &mut Vec<Operation>| {
                // Both of `docview-close`'s rows re-gated, leaving the pairing behind: the sort of
                // waiver a later edit appends to without re-deriving whether it should exist.
                row(rows, "docs.close").binding = Binding::Always;
                row(rows, "docs.close_all").binding = Binding::Always;
            }),
            "the capability `docview-close` is paired with the `gg-docs` family and buys nothing \
             in it",
        ),
        (
            "the documentation search bought by a capability",
            Box::new(|rows: &mut Vec<Operation>| {
                // The gravest gate gg could get wrong: a run able to withhold the search could
                // withhold an agent's knowledge of its own capabilities, in all eleven arms at once.
                row(rows, "docs.search").binding = Binding::Capability(CAPABILITY_DOCVIEW_CLOSE);
            }),
            "the documentation call `docs.search` is bound by Capability(\"docview-close\") where \
             gg binds it by Always",
        ),
        (
            "a documentation close handed to every program",
            Box::new(|rows: &mut Vec<Operation>| {
                row(rows, "docs.close").binding = Binding::Always;
            }),
            "the documentation call `docs.close` is bound by Always where gg binds it by \
             Capability(\"docview-close\")",
        ),
        (
            "one operation written down twice",
            Box::new(|rows: &mut Vec<Operation>| {
                let duplicate = *row(rows, "files.read_file");
                rows.push(duplicate);
            }),
            "the operation `files.read_file` is written down twice",
        ),
        (
            "an operation filed under a family the skills library does not ship",
            Box::new(|rows: &mut Vec<Operation>| {
                row(rows, "shell.shell").family = "gg-telepathy";
            }),
            "is filed under the family `gg-telepathy`, which the skills library does not ship",
        ),
        (
            "an exemption with no reason written for it",
            Box::new(|rows: &mut Vec<Operation>| {
                row(rows, "files.list_dir").applies =
                    Applicability::UniversalExcept(&[(GgProgramLanguage::Ruby, "   ")]);
            }),
            "`files.list_dir` is excused on `ruby` with no reason",
        ),
        (
            "an exemption that excuses nobody",
            Box::new(|rows: &mut Vec<Operation>| {
                row(rows, "files.list_dir").applies = Applicability::UniversalExcept(&[]);
            }),
            "`files.list_dir` excuses nobody",
        ),
        (
            "one arm excused twice for one operation",
            Box::new(|rows: &mut Vec<Operation>| {
                row(rows, "files.list_dir").applies = Applicability::UniversalExcept(&[
                    (GgProgramLanguage::Ruby, "the first reason"),
                    (GgProgramLanguage::Ruby, "and a second one"),
                ]);
            }),
            "`files.list_dir` excuses `ruby` twice",
        ),
    ];

    // Accumulated rather than asserted row by row, for the reason the catalogue rows are: a rule
    // that stops biting should show as itself and not as whichever row happens to run first.
    let mut missed: Vec<String> = Vec::new();
    for (name, edit, expected) in cases {
        let found = disagreements_against(a_table_where(edit), &[]);
        // A gating fault is gg's, not an arm's — there is no arm in this call to blame.
        let caught = found.iter().any(|disagreement| {
            disagreement.subject == GG && disagreement.detail.contains(expected)
        });
        if !caught {
            missed.push(format!(
                "\n\n{name}: gg was never told `{expected}`. It was told:{}",
                report(&found)
            ));
        }
    }
    assert!(
        missed.is_empty(),
        "the gate let damaged operations tables through:{}",
        missed.concat()
    );
}

/// **gg's own table passes its own gating rules** — the negative control for the row above.
///
/// Without it, eighteen rows that all complain would be indistinguishable from a rule that
/// complains about everything.
#[test]
fn gg_s_own_operations_table_is_not_a_disagreement() {
    let found = disagreements_against(OPERATIONS, &[]);
    assert!(
        found.is_empty(),
        "gg's own operations table fails its own gating rules:{}",
        report(&found)
    );
}

// ---------------------------------------------------------------------------------------------
// Teeth: the propagation rule
// ---------------------------------------------------------------------------------------------

/// The helper an SDK added and gg wrote down — one operation no arm binds, in the shape a new helper
/// arrives in.
///
/// It is a second read on the filesystem family, gated on the tool the reads it wraps are gated on,
/// so nothing else in the table changes: [`gating`](super::gating) stays silent about it and the
/// only thing under test is whether every arm is required to follow.
const HELPER: Operation = Operation {
    id: OperationId {
        namespace: "files",
        key: "read_file_twice",
    },
    family: FAMILY_FILESYSTEM,
    call: SurfaceCall {
        object: "fs",
        key: "read_file_twice",
    },
    binding: Binding::Tool("read_file"),
    takes_input: true,
    applies: Applicability::Universal,
};

/// **A helper added to one SDK goes red on every other one, by name.**
///
/// This is D11's propagation rule, and it is the whole reason [`Applicability`] exists. A helper
/// written into one arm's SDK is written into gg's table, and every arm that has not followed fails
/// with the operation named — which is what turns "add it everywhere it applies" from an intention
/// into a step nobody can skip.
#[test]
fn a_helper_gg_offers_and_an_arm_does_not_bind_fails_that_arm_by_name() {
    let table = a_table_where(|rows| rows.push(HELPER));
    for language in registered() {
        let found = disagreements_against(table, &[language]);
        assert!(
            said(
                &found,
                "gg offers `files.read_file_twice` and this arm binds it nowhere"
            ),
            "{}: an operation this arm does not bind passed:{}",
            language.display_name(),
            report(&found)
        );
    }
}

/// **And an arm that is excused, with a reason, does not.**
///
/// The other half of the rule, and the half that makes it usable: "applicable" is a judgement — a
/// helper wrapping a `Result`-returning read is idiomatic in Rust and pointless in a throwing
/// language — so an arm must be able to be let off. What the design insists on is that the letting
/// off is written **beside the operation, in gg**, with a reason, rather than being implicit in the
/// package that omits it, where the only evidence would be an absence.
#[test]
fn an_arm_excused_from_a_helper_with_a_reason_is_no_disagreement() {
    let excused: Vec<(GgProgramLanguage, &'static str)> = GgProgramLanguage::ALL
        .iter()
        .map(|language| {
            (
                *language,
                "this arm's read already hands back a value a second read cannot improve on",
            )
        })
        .collect();
    let table = a_table_where(|rows| {
        rows.push(Operation {
            applies: Applicability::UniversalExcept(Box::leak(excused.into_boxed_slice())),
            ..HELPER
        });
    });
    let found = disagreements_against(table, &registered());
    assert!(
        found.is_empty(),
        "every arm was excused from a helper, with a reason, and the gate complained anyway:{}",
        report(&found)
    );
}

/// **An exemption naming an arm that does bind the operation is dead, and fails.**
///
/// A dead exemption is how a list of two becomes a blanket waiver: nothing about an obsolete row
/// stops working, so it survives every edit until somebody reads it, and by then it excuses an arm
/// nobody meant to excuse. The converse check is what stops that, and it names the arm and the
/// operation.
#[test]
fn a_dead_exemption_is_caught() {
    let table = a_table_where(|rows| {
        row(rows, "files.edit_file").applies = Applicability::UniversalExcept(&[(
            GgProgramLanguage::TypeScript,
            "this arm had no edit call when the exemption was written",
        )]);
    });
    let typescript = crate::sandbox::language(GgProgramLanguage::TypeScript);
    let found = disagreements_against(table, &[typescript]);
    assert!(
        said(&found, "the exemption is dead"),
        "an exemption naming an arm that binds the operation must be caught:{}",
        report(&found)
    );
    assert!(
        said(&found, "`files.edit_file` is excused here"),
        "the complaint names the operation:{}",
        report(&found)
    );

    // And the surface with no wire id is never the arm an exemption names, because an exemption
    // names a `GgProgramLanguage` and the fixture deliberately has none.
    let found = disagreements_against(table, &[fixture_language()]);
    assert!(
        found.is_empty(),
        "a surface with no wire id was matched against an exemption:{}",
        report(&found)
    );
}
