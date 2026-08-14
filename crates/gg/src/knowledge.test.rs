//! Tests for [`KnowledgeModules`] — the per-agent registry of loaded code and queued on-use
//! scripts.

use test_cabinet_core::gg::GgProgramLanguage;

use super::*;
use crate::sandbox::fixture;

/// The [program language](ProgramLanguage) these tests load code in: **TypeScript**, named
/// explicitly because every module they load is TypeScript source and every export list they assert
/// on is what TypeScript's own module preparation reads out of it.
fn ts() -> &'static dyn ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::TypeScript)
}

/// The one arm whose API objects are modules, for the note that is written in its syntax.
fn rust() -> &'static dyn ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::Rust)
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
        .note(KnowledgeOrigin::Skill, ts())
        .expect("a loaded module produces a note");
    // The model must never have to guess where its code went.
    assert!(note.contains("lib.csvTools"), "{note}");
    assert!(note.contains("parse"), "{note}");
    assert!(note.contains("skill"), "{note}");
}

/// **The binding path is written in the reader's own syntax.**
///
/// The note is the only place a model is told where its code went, and it is quoted rather than
/// inferred precisely so the model cannot get it wrong. On an arm whose API objects are **modules**
/// that means `lib::csv_tools::<name>`: `lib.csvTools.<name>` is not a path Rust will accept, so a
/// note written with the other arms' separator would be a binding the model has not been given.
#[test]
fn the_note_writes_the_binding_path_in_the_readers_own_syntax() {
    let (_, loaded) = with_csv_tools();
    let note = loaded
        .note(KnowledgeOrigin::Skill, rust())
        .expect("a loaded module produces a note");
    assert!(note.contains("lib::csvTools::<name>"), "{note}");
}

#[test]
fn a_prose_skill_produces_no_note_at_all() {
    let mut modules = KnowledgeModules::new();
    let loaded = modules
        .load(ts(), KnowledgeOrigin::Skill, "prose", None, None)
        .expect("a skill with no code loads");
    assert!(loaded.is_empty());
    assert_eq!(loaded.note(KnowledgeOrigin::Skill, ts()), None);
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

/// A language that **compiles**, without a real toolchain on the path: the fixture, whose
/// [`prepare_compiles`](ProgramLanguage::prepare_compiles) answers `true` and whose prepare step is
/// a few string tests. TypeScript answers `true` too and would serve, at the cost of running `tsc`
/// inside a test about what a *load* is charged.
fn compiling() -> &'static dyn ProgramLanguage {
    crate::sandbox::fixture_languages()
        .next()
        .expect("there is a fixture language")
}

/// **A code half a load prepared is charged to the run, both halves of it.**
///
/// The cost is real for a compiled arm — a skill's module is compiled again on every agent that
/// reads it — and it is spent inside a membrane call, where the sandbox has already taken its own
/// reading. If it were not accumulated here, nothing else would ever record it and it would be
/// absorbed into the turn's response time, which is the exact hole
/// [`SandboxOutcome::compile`](crate::sandbox::SandboxOutcome::compile) exists to close.
#[test]
fn what_a_load_spent_compiling_is_charged_to_the_agent() {
    let mut modules = KnowledgeModules::new();
    modules
        .load(
            compiling(),
            KnowledgeOrigin::Skill,
            "csv-tools",
            Some("def parse(text)\n"),
            Some("view.open_text(\"hello\", \"there\")\n"),
        )
        .expect("both halves prepare");
    assert!(
        modules.take_compile().is_some(),
        "preparing a module and an on-use script is time the run spent compiling"
    );
    assert_eq!(
        modules.take_compile(),
        None,
        "the figure is drained, not repeated: charging the next program for this load would move \
         the cost onto a program that did not cause it"
    );
}

/// **A load whose compiler rejected the code is still charged.**
///
/// The path that would otherwise report nothing: a compiler that spent its time refusing a module
/// spent it, and the error return is what makes it the reading nothing else could take.
#[test]
fn a_load_that_failed_to_compile_still_reports_what_it_spent() {
    let mut modules = KnowledgeModules::new();
    modules
        .load(
            compiling(),
            KnowledgeOrigin::Skill,
            "broken",
            Some("def parse(text) ?? nope\n"),
            None,
        )
        .expect_err("the fixture language has no `??`");
    assert!(modules.take_compile().is_some());
}

/// A language whose prepare step is free reports **nothing**, not a zero: `None` and `Some(0)` are
/// different claims, and only the first is true of a language that compiles nothing.
///
/// Its subject is the fixture built to say so, because every registered language now compiles —
/// TypeScript type-checks the code it prepares, so a load in it is charged like any other compile.
#[test]
fn a_load_in_a_language_that_does_not_compile_reports_nothing() {
    let mut modules = KnowledgeModules::new();
    modules
        .load(
            crate::sandbox::fixture::a_language_that_does_not_compile(),
            KnowledgeOrigin::Skill,
            "csv-tools",
            Some("def parse(text)\n"),
            None,
        )
        .expect("a valid module loads");
    assert_eq!(modules.take_compile(), None);
}

/// **A load in a language that compiles is charged.** TypeScript type-checks a code skill's module
/// exactly as it type-checks a program, so the reading is there to be taken.
#[test]
fn a_load_in_typescript_reports_what_checking_the_module_cost() {
    let (mut modules, _) = with_csv_tools();
    assert!(modules.take_compile().is_some_and(|spent| !spent.is_zero()));
}

// ---------------------------------------------------------------------------------------------
// Whose failure a load's failure was
// ---------------------------------------------------------------------------------------------

/// The error a load of `source` produced.
fn refused_load(source: &str) -> KnowledgeError {
    KnowledgeModules::new()
        .load(
            compiling(),
            KnowledgeOrigin::Skill,
            "csv-tools",
            Some(source),
            None,
        )
        .expect_err("this source does not prepare")
}

/// **A source the language read and rejected reaches the model as the language's own diagnostic**,
/// and has nothing to say to the operator.
///
/// The half that was always right, pinned so the other half's split cannot be made by taking this
/// one away: the author can only fix a located diagnostic if it is handed over located.
#[test]
fn a_rejected_module_hands_the_model_the_diagnostic() {
    let error = refused_load(&format!("def parse(text)\n  x = {}\n", fixture::MISTYPED));

    assert!(error.is_authors_source());
    let told = error.to_string();
    assert!(told.contains("did not compile"), "{told}");
    assert!(
        told.contains(fixture::MISTYPED),
        "the diagnostic is the whole of what the author can act on: {told}"
    );
    assert_eq!(
        error.operator_detail(),
        None,
        "the model already has all of it; a second copy on the operator's stream says nothing new"
    );
}

/// **A compiler that could not finish tells the model nothing about its source, and tells the
/// operator everything.**
///
/// The misattribution this split exists to prevent, on the seam's *other* consumer: a skill read or
/// a memory write whose compiler crashed must not come back reading like "your code is wrong". The
/// model is told the module was not compiled and that nothing about it was rejected; the crash
/// detail — which is real, and which only the person who can fix the image can use — goes to the
/// operator instead of to nobody.
#[test]
fn a_crashed_compiler_is_the_operators_problem_not_the_authors() {
    let error = refused_load(&format!("def parse(text)\n  {}\n", fixture::NO_COMPILER));

    assert!(!error.is_authors_source());
    let told = error.to_string();
    assert!(
        told.contains("was not compiled") && told.contains("Nothing about it was rejected"),
        "the model must be told its source was never judged: {told}"
    );
    assert!(
        !told.contains("SIGSEGV"),
        "the compiler's crash detail is not the author's to read: {told}"
    );

    let operator = error
        .operator_detail()
        .expect("a crash the model is not shown must reach somebody");
    assert!(
        operator.contains("SIGSEGV") && operator.contains("csv-tools"),
        "the operator gets the detail, and which load produced it: {operator}"
    );
}

/// **A module gg accepted and then could not prepare is not the author's either.**
///
/// The third arm of the prepare seam, and the one this predicate is easiest to get wrong on: unlike
/// a crashed compiler it *has* a diagnostic, and a diagnostic looks like something the author should
/// be shown. It is not — it is a bug report about gg, written about a source this language read and
/// accepted. Counting it as the author's would hand the model gg's internals under a heading that
/// says its code was rejected, on a load where nothing of its code was rejected at all.
#[test]
fn a_module_gg_could_not_lower_is_not_the_authors_source() {
    let error = refused_load(&format!("def parse(text)\n  {}\n", fixture::UNLOWERABLE));

    assert!(!error.is_authors_source());
    let told = error.to_string();
    assert!(
        told.contains("was not compiled") && told.contains("Nothing about it was rejected"),
        "the model must be told its source was never judged: {told}"
    );
    assert!(
        !told.contains("lowering pass"),
        "gg's own diagnostic is not the author's to read, and least of all under a heading that \
         says their code failed: {told}"
    );

    let operator = error
        .operator_detail()
        .expect("a bug report about gg must reach somebody");
    assert!(
        operator.contains("lowering pass") && operator.contains("csv-tools"),
        "the operator gets the detail, and which load produced it: {operator}"
    );
}

/// Both halves of a load carry the split, not just the module half.
///
/// An on-use script is prepared by the same step through the same seam, and it is the half that is
/// easier to leave behind: it fails after the module has already succeeded.
#[test]
fn an_on_use_script_whose_compiler_crashed_is_reported_the_same_way() {
    let error = KnowledgeModules::new()
        .load(
            compiling(),
            KnowledgeOrigin::Memory,
            "the-plan",
            Some("def parse(text)\n"),
            Some(format!("{}\n", fixture::NO_COMPILER).as_str()),
        )
        .expect_err("the on-use half does not prepare");

    assert!(!error.is_authors_source());
    assert_eq!(error.half, "onUse");
    let operator = error.operator_detail().expect("the operator is told");
    assert!(
        operator.contains("onUse") && operator.contains("memory"),
        "{operator}"
    );
}
