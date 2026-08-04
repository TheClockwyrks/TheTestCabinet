//! Tests for [`KnowledgeModules`] — the per-agent registry of loaded code and queued on-use
//! scripts.

use test_cabinet_core::gg::GgProgramLanguage;

use super::*;

/// The [program language](ProgramLanguage) these tests load code in: **TypeScript**, named
/// explicitly because every module they load is TypeScript source and every export list they assert
/// on is what TypeScript's own module preparation reads out of it.
fn ts() -> &'static dyn ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::TypeScript)
}

/// A registry with `csv-tools` loaded, as most of these start.
fn with_csv_tools() -> (KnowledgeModules, Loaded) {
    let mut modules = KnowledgeModules::new();
    let loaded = modules
        .load(
            ts(),
            KnowledgeOrigin::Skill,
            "csv-tools",
            Some("export function parse(text: string) { return text.split(\",\"); }\n"),
            None,
        )
        .expect("a valid module loads");
    (modules, loaded)
}

#[test]
fn a_loaded_module_is_bound_at_a_camel_cased_key() {
    let (modules, loaded) = with_csv_tools();
    assert_eq!(loaded.key.as_deref(), Some("csvTools"));
    assert_eq!(loaded.exports, vec!["parse".to_string()]);
    let bound = modules.code_modules();
    assert_eq!(bound.len(), 1);
    assert_eq!(bound[0].name, "csvTools");
    assert!(bound[0].source.contains("return { parse };"));
}

#[test]
fn the_note_states_the_binding_path_and_what_it_exports() {
    let (_, loaded) = with_csv_tools();
    let note = loaded
        .note(KnowledgeOrigin::Skill)
        .expect("a loaded module produces a note");
    // The model must never have to guess where its code went.
    assert!(note.contains("lib.csvTools"), "{note}");
    assert!(note.contains("parse"), "{note}");
    assert!(note.contains("skill"), "{note}");
}

#[test]
fn a_prose_skill_produces_no_note_at_all() {
    let mut modules = KnowledgeModules::new();
    let loaded = modules
        .load(ts(), KnowledgeOrigin::Skill, "prose", None, None)
        .expect("a skill with no code loads");
    assert!(loaded.is_empty());
    assert_eq!(loaded.note(KnowledgeOrigin::Skill), None);
    assert!(modules.code_modules().is_empty());
}

#[test]
fn two_names_that_camel_case_alike_both_keep_their_code() {
    let (mut modules, first) = with_csv_tools();
    let second = modules
        .load(
            ts(),
            KnowledgeOrigin::Memory,
            "csv_tools",
            Some("export const n = 1;\n"),
            None,
        )
        .expect("the second module loads");
    assert_eq!(first.key.as_deref(), Some("csvTools"));
    assert_eq!(second.key.as_deref(), Some("csvTools2"));
    assert_eq!(modules.code_modules().len(), 2);
}

#[test]
fn reloading_the_same_thing_reuses_its_key_and_replaces_its_source() {
    let (mut modules, first) = with_csv_tools();
    let again = modules
        .load(
            ts(),
            KnowledgeOrigin::Skill,
            "csv-tools",
            Some("export function parse() { return []; }\nexport const VERSION = 2;\n"),
            None,
        )
        .expect("a revised module loads");
    assert_eq!(again.key, first.key);
    assert_eq!(modules.code_modules().len(), 1);
    assert!(again.exports.contains(&"VERSION".to_string()));
}

#[test]
fn an_on_use_script_is_queued_once_per_agent() {
    let mut modules = KnowledgeModules::new();
    let first = modules
        .load(
            ts(),
            KnowledgeOrigin::Skill,
            "guide",
            None,
            Some("view.openText(\"guide\", \"hello\");\n"),
        )
        .expect("an on-use script loads");
    assert!(first.on_use);
    assert_eq!(modules.take_pending().len(), 1);

    // Read again: the script has already run for this agent, so nothing is queued.
    let again = modules
        .load(
            ts(),
            KnowledgeOrigin::Skill,
            "guide",
            None,
            Some("view.openText(\"guide\", \"hello\");\n"),
        )
        .expect("a repeat read loads");
    assert!(!again.on_use);
    assert!(modules.take_pending().is_empty());
}

#[test]
fn a_thing_used_without_a_script_does_not_run_one_added_later() {
    // A memory the model updates to carry an on-use script has already been used; running it then
    // would be running it at a moment the "once, when it first comes into use" rule does not name.
    let mut modules = KnowledgeModules::new();
    modules
        .load(ts(), KnowledgeOrigin::Memory, "notes", None, None)
        .expect("a plain memory loads");
    let later = modules
        .load(
            ts(),
            KnowledgeOrigin::Memory,
            "notes",
            None,
            Some("view.openText(\"notes\", \"hi\");\n"),
        )
        .expect("the revised memory loads");
    assert!(!later.on_use);
    assert!(modules.take_pending().is_empty());
}

#[test]
fn an_on_use_script_is_given_its_own_module_and_nothing_else() {
    let (mut modules, _) = with_csv_tools();
    modules
        .load(
            ts(),
            KnowledgeOrigin::Skill,
            "guide",
            Some("export const n = 1;\n"),
            Some("view.openText(\"guide\", String(lib.guide.n));\n"),
        )
        .expect("a code skill with a script loads");
    let pending = modules.take_pending();
    assert_eq!(pending.len(), 1);
    let module = pending[0].module.as_ref().expect("its own module is bound");
    assert_eq!(module.name, "guide");
    // Not `csvTools`: what a script can see must not depend on what the agent happened to read
    // before it.
    assert!(module.source.contains("return { n };"));
}

#[test]
fn taking_the_pending_queue_empties_it() {
    let mut modules = KnowledgeModules::new();
    modules
        .load(ts(), KnowledgeOrigin::Skill, "guide", None, Some("1;\n"))
        .expect("loads");
    assert_eq!(modules.take_pending().len(), 1);
    assert!(modules.take_pending().is_empty());
}

#[test]
fn uncompilable_code_is_refused_and_names_the_half_that_failed() {
    let mut modules = KnowledgeModules::new();
    let error = modules
        .load(
            ts(),
            KnowledgeOrigin::Memory,
            "broken",
            Some("export const x = ;\n"),
            None,
        )
        .expect_err("a syntax error is refused");
    let message = format!("{error}");
    assert!(message.contains("`code`"), "{message}");
    assert!(message.contains("memory `broken`"), "{message}");
    // And nothing is bound: a module that cannot compile is not half-loaded.
    assert!(modules.code_modules().is_empty());
}

#[test]
fn an_uncompilable_on_use_script_is_refused_by_its_own_name() {
    let mut modules = KnowledgeModules::new();
    let error = modules
        .load(
            ts(),
            KnowledgeOrigin::Skill,
            "broken",
            None,
            Some("const x = ;\n"),
        )
        .expect_err("a syntax error is refused");
    assert!(format!("{error}").contains("`onUse`"), "{error}");
}

#[test]
fn keys_are_always_valid_identifiers() {
    for (name, expected) in [
        ("csv-tools", "csvTools"),
        ("my_helpers.v2", "myHelpersV2"),
        ("9lives", "_9lives"),
        ("---", "module"),
    ] {
        let mut modules = KnowledgeModules::new();
        let loaded = modules
            .load(
                ts(),
                KnowledgeOrigin::Skill,
                name,
                Some("export const n = 1;\n"),
                None,
            )
            .expect("loads");
        assert_eq!(loaded.key.as_deref(), Some(expected), "for `{name}`");
    }
}

#[test]
fn modules_are_handed_over_in_a_stable_order() {
    let mut modules = KnowledgeModules::new();
    for name in ["zeta", "alpha", "mid"] {
        modules
            .load(
                ts(),
                KnowledgeOrigin::Skill,
                name,
                Some("export const n = 1;\n"),
                None,
            )
            .expect("loads");
    }
    let keys: Vec<String> = modules
        .code_modules()
        .into_iter()
        .map(|module| module.name)
        .collect();
    // Key order, not read order: the guest evaluates the list in order, and a set that reordered
    // itself between turns would make a program's behaviour depend on nothing the model can see.
    assert_eq!(keys, vec!["alpha", "mid", "zeta"]);
}
