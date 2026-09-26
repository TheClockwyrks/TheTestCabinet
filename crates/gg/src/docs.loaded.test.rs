//! Tests for [the documentation a loaded code module contributes](super::LoadedDocs).

use test_cabinet_core::gg::GgProgramLanguage;

use super::*;
use crate::sandbox::{ModuleExport, ModuleExportKind, language};

/// The arm these are written against: one that reaches a code module through a line a program
/// writes, so both states of the *how you reach this* sentence are exercised by the same fixture.
fn ts() -> &'static dyn ProgramLanguage {
    language(GgProgramLanguage::TypeScript)
}

/// One export, with as much of a declaration as the assertion needs.
fn export(
    name: &str,
    kind: ModuleExportKind,
    declaration: &str,
    doc: Option<&str>,
) -> ModuleExport {
    ModuleExport {
        name: name.to_string(),
        kind,
        declaration: declaration.to_string(),
        doc: doc.map(str::to_string),
        returns: Vec::new(),
        parameters: Vec::new(),
    }
}

/// A registry holding one two-function module, as a use of the `csv-tools` skill would leave it.
fn csv_tools() -> LoadedDocs {
    let loaded = LoadedDocs::new();
    loaded.register(
        ts(),
        "csvTools",
        "skill",
        "csv-tools",
        &[
            export(
                "parse",
                ModuleExportKind::Function,
                "export function parse(text: string): Row[]",
                Some("Split a CSV into rows.\nA quoted field may span lines."),
            ),
            export(
                "Row",
                ModuleExportKind::Type,
                "export type Row = Record<string, string>",
                None,
            ),
            export(
                "DELIMITER",
                ModuleExportKind::Value,
                "export const DELIMITER = \",\"",
                None,
            ),
        ],
    );
    loaded
}

/// **A registry nobody has written to describes nothing** — which is the whole of what makes a
/// documentation view belong to the instance that loaded the module.
///
/// A fork, a succession and a persistence restore each open on one of these, so every lookup they
/// could make about a module the *previous* instance used has to come back empty here.
#[test]
fn an_instance_that_has_loaded_nothing_answers_about_nothing() {
    let empty = LoadedDocs::new();
    assert_eq!(empty.body("csvTools"), None);
    assert_eq!(empty.body("csvTools.parse"), None);
    assert_eq!(empty.key_of("parse"), None);
    assert!(empty.candidates().is_empty());
}

/// **A use puts the module on the surface, and one entry per declaration beside it.**
#[test]
fn a_module_and_each_of_its_declarations_becomes_an_entry() {
    let keys = csv_tools().read(|entries| {
        entries
            .iter()
            .map(|entry| (entry.key.clone(), entry.kind))
            .collect::<Vec<_>>()
    });
    assert_eq!(
        keys,
        vec![
            ("csvTools".to_string(), DocKind::Module),
            ("csvTools.parse".to_string(), DocKind::Function),
            ("csvTools.Row".to_string(), DocKind::Type),
            // The surface has three kinds and a module has four kinds of declaration: a constant is
            // filed with the things a program writes rather than calls, because the one distinction
            // a `kind: "function"` filter must keep exact is *callable*.
            ("csvTools.DELIMITER".to_string(), DocKind::Type),
        ]
    );
}

/// **An export is keyed the way its arm spells a member**, so the key a model reads in a hit is a
/// key it could have assembled itself.
#[test]
fn an_export_is_keyed_the_way_the_arm_spells_a_member() {
    assert_eq!(member_key(ts(), "csvTools", "parse"), "csvTools.parse");
    assert_eq!(
        member_key(language(GgProgramLanguage::Rust), "csvTools", "parse"),
        "csvTools::parse"
    );
}

/// **A declaration's view carries the declaration, the prose above it, and the line a program writes
/// to reach it** — the three things a model needs before it can call it, and on the same terms an
/// SDK function's view states them.
#[test]
fn a_declarations_view_carries_its_declaration_its_prose_and_how_to_reach_it() {
    let body = csv_tools()
        .body("csvTools.parse")
        .expect("a used module's function is documented");
    assert!(
        body.starts_with("export function parse(text: string): Row[]"),
        "the author's own declaration opens it: {body}"
    );
    assert!(
        body.contains("Split a CSV into rows.") && body.contains("A quoted field may span lines."),
        "the whole comment, not its first line: {body}"
    );
    assert!(
        body.contains("import * as csvTools from \"lib:csvTools\";"),
        "the line that makes the spelling resolve: {body}"
    );
    assert!(
        body.contains("`csvTools.parse`"),
        "and the spelling itself, which is the one thing no search can answer: {body}"
    );
}

/// **The module's own view lists what it offers**, so a model that found the module can choose
/// which declaration to open without a second search.
#[test]
fn the_modules_view_names_what_it_offers() {
    let body = csv_tools()
        .body("csvTools")
        .expect("a used module is documented under its key");
    assert!(
        body.contains("The code the skill `csv-tools` carries."),
        "it says where the code came from: {body}"
    );
    assert!(body.contains("csvTools.<name>"), "{body}");
    for name in ["parse", "Row", "DELIMITER"] {
        assert!(body.contains(name), "{name} is listed: {body}");
    }
}

/// **A declaration with no comment is briefed by its own declaration**, because a brief is the only
/// thing a search result shows and a paraphrase gg invented would say less than the line itself.
#[test]
fn an_undocumented_declaration_is_briefed_by_its_declaration() {
    let brief = csv_tools().read(|entries| {
        entries
            .iter()
            .find(|entry| entry.name == "Row")
            .map(|entry| entry.brief.clone())
            .expect("the type was registered")
    });
    assert_eq!(brief, "export type Row = Record<string, string>");
}

/// **A documented declaration's brief is its first line, and the rest is detail** — the same split
/// the SDK half makes, so one query ranks both sources on the same evidence.
#[test]
fn a_documented_declarations_brief_is_its_first_line() {
    let (brief, detail) = csv_tools().read(|entries| {
        let entry = entries
            .iter()
            .find(|entry| entry.name == "parse")
            .expect("the function was registered");
        (entry.brief.clone(), entry.detail_folded.clone())
    });
    assert_eq!(brief, "Split a CSV into rows.");
    assert_eq!(detail, "a quoted field may span lines.");
}

/// **Both names an entry answers to reach one page**, and the key is the canonical one.
///
/// A model reads `csvTools.parse` in a search hit and types `parse` at a call site; a surface that
/// filed those as two views would charge the window twice for one page.
#[test]
fn an_entry_answers_to_its_key_and_to_its_bare_name() {
    let loaded = csv_tools();
    assert_eq!(
        loaded.key_of("csvTools.parse").as_deref(),
        Some("csvTools.parse")
    );
    assert_eq!(loaded.key_of("parse").as_deref(), Some("csvTools.parse"));
    assert_eq!(loaded.body("parse"), loaded.body("csvTools.parse"));
}

/// **Using a revised module replaces its documentation rather than adding to it.**
///
/// A memory's code is the model's to rewrite and a skill is re-read on every use, so the same key
/// can be registered again with a different set of declarations. An entry left standing for one the
/// module no longer carries would document a call that no longer compiles.
#[test]
fn a_second_registration_replaces_what_the_key_had() {
    let loaded = csv_tools();
    loaded.register(
        ts(),
        "csvTools",
        "skill",
        "csv-tools",
        &[export(
            "parseStrict",
            ModuleExportKind::Function,
            "export function parseStrict(text: string): Row[]",
            None,
        )],
    );
    assert_eq!(loaded.body("csvTools.parse"), None);
    assert!(loaded.body("csvTools.parseStrict").is_some());
    assert_eq!(
        loaded.read(|entries| entries.len()),
        2,
        "the module and its one remaining declaration"
    );
}

/// **A second module joins the first**, since two skills used in one session are two modules.
#[test]
fn a_second_module_leaves_the_first_standing() {
    let loaded = csv_tools();
    loaded.register(
        ts(),
        "jsonTools",
        "memory",
        "json_tools",
        &[export(
            "read",
            ModuleExportKind::Function,
            "export function read(text: string): unknown",
            None,
        )],
    );
    assert!(loaded.body("csvTools.parse").is_some());
    assert!(loaded.body("jsonTools.read").is_some());
}

/// **A module that exports nothing says so**, rather than rendering a heading with a list missing
/// under it.
#[test]
fn a_module_that_exports_nothing_says_so() {
    let loaded = LoadedDocs::new();
    loaded.register(ts(), "silent", "skill", "silent", &[]);
    let body = loaded.body("silent").expect("the module is still an entry");
    assert!(body.contains("It exports nothing."), "{body}");
}

/// **An arm whose module is in scope already says that instead of quoting a line** — the second
/// state of the sentence every documentation view carries.
#[test]
fn an_arm_with_no_import_line_says_the_module_is_in_scope() {
    let loaded = LoadedDocs::new();
    let rust = language(GgProgramLanguage::Rust);
    assert!(
        rust.lib_import("csvTools").is_none(),
        "this arm reaches a code module without a line of its own"
    );
    loaded.register(
        rust,
        "csvTools",
        "skill",
        "csv-tools",
        &[export(
            "parse",
            ModuleExportKind::Function,
            "pub fn parse(text: &str) -> Vec<Row>",
            None,
        )],
    );
    let body = loaded.body("csvTools::parse").expect("it is documented");
    assert!(body.contains("in scope already"), "{body}");
    assert!(body.contains("`csvTools::parse`"), "{body}");
}

/// **A handle is not a copy.** The knowledge registry writes and the documentation runtime reads,
/// and they must be looking at one set of entries — a module used mid-turn is searchable on that
/// turn, and a reader holding a snapshot would answer about the surface as it stood before.
#[test]
fn a_cloned_handle_sees_what_the_original_registers() {
    let owner = LoadedDocs::new();
    let reader = owner.clone();
    assert_eq!(reader.body("csvTools"), None);
    owner.register(
        ts(),
        "csvTools",
        "skill",
        "csv-tools",
        &[export(
            "parse",
            ModuleExportKind::Function,
            "export function parse(): void",
            None,
        )],
    );
    assert!(
        reader.body("csvTools.parse").is_some(),
        "the reader is looking at the registry the writer wrote to"
    );
}
