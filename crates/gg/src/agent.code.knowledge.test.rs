//! Tests for **what using a code skill or memory does to the window**: the documentation views
//! [a use opens](open_loaded_docviews), and the instance those views belong to.
//!
//! The claim under all of them is one sentence from the design: *using a code skill opens
//! documentation, not a message*. So these assert on the window rather than on a reply — there is no
//! reply left to assert on — and on the three boundaries where a window outlives the thing it
//! describes.

use std::sync::Arc;

use test_cabinet_core::gg::GgProgramLanguage;

use super::*;
use crate::context::HeuristicTokenEstimator;
use crate::docs::LoadedDocs;
use crate::ending::EndingRole;
use crate::knowledge::{KnowledgeModules, KnowledgeOrigin};
use crate::sandbox::{capability_operations, gating_capabilities, language};

/// A module carrying two callable declarations and one that is not callable, which is what makes
/// "one view per function" an assertion rather than a count.
const CSV_TOOLS: &str = "\
/** Split a CSV into rows. */
export function parse(text: string): string[] { return text.split(\",\"); }
export function widen(row: string[]): string { return row.join(\" | \"); }
export const DELIMITER = \",\";
";

/// A code-mode window, as an agent running programs holds one.
fn window() -> ContextModel {
    ContextModel::new(
        Arc::new(HeuristicTokenEstimator::new()),
        Some(100_000),
        true,
    )
}

/// A documentation runtime for an agent granted everything, reading `loaded`.
fn docs(loaded: LoadedDocs) -> DocsRuntime {
    let capabilities = gating_capabilities();
    let operations = capability_operations(capabilities.iter().copied());
    DocsRuntime::new(
        capabilities.into_iter().map(str::to_string).collect(),
        EndingRole::Standard,
        &operations,
        GgProgramLanguage::TypeScript,
    )
    .reading(loaded)
}

/// One agent that has used the `csv-tools` skill: its loaded code, and the runtime that answers
/// lookups about it.
fn used_csv_tools() -> (KnowledgeModules, DocsRuntime) {
    let mut knowledge = KnowledgeModules::new();
    knowledge
        .load(
            language(GgProgramLanguage::TypeScript),
            KnowledgeOrigin::Skill,
            "csv-tools",
            Some(CSV_TOOLS),
            None,
        )
        .expect("a valid module loads");
    let runtime = docs(knowledge.documentation());
    (knowledge, runtime)
}

/// The keys of the documentation views open in `context`, in window order.
fn open(context: &ContextModel) -> Vec<String> {
    context
        .open_docviews()
        .into_iter()
        .map(|view| view.key)
        .collect()
}

/// **A use opens one documentation view per declaration a program can call, and says nothing.**
///
/// The constant is registered and searchable and is *not* opened: a use spends the window on what
/// the model came for, which is the calls. And the module's own entry is not opened either — it
/// lists the declarations whose pages are already open, so opening it would be a summary of the
/// three items beneath it.
#[test]
fn a_use_opens_one_view_per_declared_function() {
    let (_knowledge, docs) = used_csv_tools();
    let mut context = window();

    open_loaded_docviews(
        &mut context,
        &docs,
        DocViewTypes::RETURN_AND_ERRORS,
        "csvTools",
    );

    assert_eq!(open(&context), ["csvTools.parse", "csvTools.widen"]);
    let body = context
        .open_docviews()
        .into_iter()
        .find(|view| view.key == "csvTools.parse")
        .map(|view| view.body)
        .expect("the function's view is in the window");
    assert!(
        body.contains("export function parse(text: string): string[]"),
        "it carries the author's declaration: {body}"
    );
    assert!(
        body.contains("Split a CSV into rows."),
        "and the prose above it: {body}"
    );
    assert!(
        body.contains("import * as csvTools from \"lib:csvTools\";")
            && body.contains("`csvTools.parse`"),
        "and the line a program writes to reach it: {body}"
    );
}

/// **Using the same skill again opens nothing new.**
///
/// A use is an execution the agent asked for and every use re-runs the on-use script, so a repeat is
/// a real event — but a documentation view is keyed, and placing a key that is open is a no-op that
/// moves nothing and re-emits nothing. That is what makes using a skill again the cheap recovery
/// after a fork that it is described as, rather than a second copy of the manual.
#[test]
fn a_repeat_use_opens_nothing_new() {
    let (_knowledge, docs) = used_csv_tools();
    let mut context = window();

    open_loaded_docviews(
        &mut context,
        &docs,
        DocViewTypes::RETURN_AND_ERRORS,
        "csvTools",
    );
    let first = open(&context);
    open_loaded_docviews(
        &mut context,
        &docs,
        DocViewTypes::RETURN_AND_ERRORS,
        "csvTools",
    );

    assert_eq!(open(&context), first);
}

/// **A view a use opened is an ordinary documentation view, so the agent can take it back out.**
///
/// This is how a code skill pays for itself: what it puts in the window is a handful of closable
/// pages, and an agent that has read the manual and finished with it reclaims the space. A view gg
/// opened on the model's behalf must be no different from one the model opened itself, or the
/// closing capability would have a hole in it exactly where the pages the model did not ask for sit.
#[test]
fn a_view_a_use_opened_is_closable() {
    let (_knowledge, docs) = used_csv_tools();
    let mut context = window();
    open_loaded_docviews(
        &mut context,
        &docs,
        DocViewTypes::RETURN_AND_ERRORS,
        "csvTools",
    );

    let closed = context.close_docviews(Some("csvTools.parse"));

    assert_eq!(closed.reclaimed.items, 1);
    assert_eq!(open(&context), ["csvTools.widen"]);
}

/// **An instance that has loaded nothing holds none of these views**, through either path that
/// re-derives one.
///
/// A [fork](crate::agent::transitions), a succession and a
/// [persistence](crate::persistence) restore all start with nothing loaded, because code is not a
/// [module](crate::modules) and nothing transfers it. So a window that names `csvTools.parse` is a
/// window describing a module the agent holding it cannot call, and both re-derivations drop it:
/// the compaction one because the boundary is where a copied window stops claiming to describe it,
/// and the restore one because the desk it came from belonged to a different instance.
///
/// Asserted against the same window and keys an agent that *did* load the module produced, so the
/// test cannot pass by describing a view that was never there.
#[test]
fn an_instance_with_nothing_loaded_re_derives_no_view_of_a_loaded_module() {
    let (_knowledge, loader) = used_csv_tools();
    let mut context = window();
    open_loaded_docviews(
        &mut context,
        &loader,
        DocViewTypes::RETURN_AND_ERRORS,
        "csvTools",
    );
    let keys = open(&context);
    assert_eq!(keys.len(), 2, "the loading instance holds both pages");

    // A new instance of the same profile, in the same language, granted the same things — and with
    // nothing loaded.
    let fresh = docs(LoadedDocs::new());

    assert!(
        crate::compaction::restore_docviews(&context, &fresh).is_empty(),
        "a compaction boundary carries none of them across"
    );
    let mut opened = window();
    assert_eq!(
        crate::persistence::restore_docviews(&mut opened, &keys, &fresh),
        0,
        "and a restored desk re-opens none of them"
    );
    assert!(opened.open_docviews().is_empty());
}

/// **A copied window stops claiming to describe a module its agent never used**, at the boundary
/// where the copy is handed over.
///
/// The two re-derivations above are the compaction and the persistence ones, and neither of them
/// happens when a [fork](crate::agent::transitions) hands a child its forker's whole conversation or
/// a history-keeping succession hands a successor the thread it was holding. Those windows are
/// *copies*, verbatim, documentation band and all — so the arriving instance runs the same
/// re-derivation over them before its first turn, and the pages it cannot render go.
///
/// The SDK page in the same window stays, which is what makes this a statement about loaded code
/// rather than about a copy losing its manual.
#[test]
fn a_carried_window_drops_the_views_of_a_module_the_arriving_instance_has_not_loaded() {
    let (_knowledge, loader) = used_csv_tools();
    let mut context = window();
    open_loaded_docviews(
        &mut context,
        &loader,
        DocViewTypes::RETURN_AND_ERRORS,
        "csvTools",
    );
    let sdk = loader
        .docview_key("readFile")
        .expect("an agent granted everything binds it");
    let body = loader.read_any(&sdk).expect("and it renders");
    context.open_docview(sdk.clone(), body);
    assert_eq!(open(&context).len(), 3);

    // The copy: the same conversation, in the hands of an instance that has loaded nothing.
    let arriving = docs(LoadedDocs::new());
    let dropped = crate::agent::transitions::drop_unrenderable_docviews(&mut context, &arriving);

    assert_eq!(dropped, 2, "both pages of the module the copy never loaded");
    assert_eq!(open(&context), [sdk]);
}

/// **The same window's SDK views do come back**, which is what makes the test above a statement
/// about loaded modules rather than about re-derivation failing wholesale.
#[test]
fn an_instance_with_nothing_loaded_still_re_derives_the_sdk_views() {
    let fresh = docs(LoadedDocs::new());
    let mut context = window();
    let key = fresh
        .docview_key("readFile")
        .expect("an agent granted everything binds it");
    let body = fresh.read_any(&key).expect("and it renders");
    context.open_docview(key.clone(), body);

    assert_eq!(
        crate::compaction::restore_docviews(&context, &fresh)
            .into_iter()
            .map(|view| view.key)
            .collect::<Vec<_>>(),
        vec![key]
    );
}

/// **The instance that loaded the module keeps its views across both re-derivations** — which is
/// the claim the whole design rests on and the control that makes its negative meaningful.
///
/// A view a use opened "survives a compaction because a docview is re-derived from its key" is the
/// reason gg stopped appending a sentence to the reply. That is only true if the registry outlives
/// the boundary: loaded code is not context, a compaction has nothing to do with it, and the same
/// runtime therefore still renders the same key on the far side. Asserted through both paths a key
/// is re-derived by, because a drop on either would take the manual away from an agent that can
/// still call every line of it.
#[test]
fn the_instance_that_loaded_the_module_keeps_its_views_across_a_boundary() {
    let (_knowledge, docs) = used_csv_tools();
    let mut context = window();
    open_loaded_docviews(
        &mut context,
        &docs,
        DocViewTypes::RETURN_AND_ERRORS,
        "csvTools",
    );
    let keys = open(&context);

    let carried: Vec<String> = crate::compaction::restore_docviews(&context, &docs)
        .into_iter()
        .map(|view| view.key)
        .collect();
    assert_eq!(carried, keys, "a compaction carries both pages across");

    let mut reopened = window();
    assert_eq!(
        crate::persistence::restore_docviews(&mut reopened, &keys, &docs),
        2,
        "and a restore of the same instance re-opens both"
    );
    assert_eq!(open(&reopened), keys);
}

/// **A revised module's documentation replaces what its key had, through the load and not only
/// through the registry.**
///
/// A memory's code is the model's to rewrite and a skill is re-read on every use, so the same key is
/// registered again with a different set of declarations. A use of the revision must open the views
/// of what it now offers — and a view left standing for a declaration the module dropped would
/// document a call that no longer compiles, which is the one failure a documentation surface must
/// not produce.
#[test]
fn a_revised_module_documents_what_it_now_offers() {
    let (mut knowledge, docs) = used_csv_tools();
    let mut context = window();
    open_loaded_docviews(
        &mut context,
        &docs,
        DocViewTypes::RETURN_AND_ERRORS,
        "csvTools",
    );
    assert_eq!(open(&context), ["csvTools.parse", "csvTools.widen"]);

    knowledge
        .load(
            language(GgProgramLanguage::TypeScript),
            KnowledgeOrigin::Skill,
            "csv-tools",
            Some("export function parseStrict(text: string): string[] { return [text]; }\n"),
            None,
        )
        .expect("the revision loads");

    assert_eq!(
        docs.use_views("csvTools", DocViewTypes::RETURN_AND_ERRORS),
        ["csvTools.parseStrict"],
        "a use of the revision opens what it now offers"
    );
    assert_eq!(
        docs.read_any("csvTools.parse"),
        None,
        "and the declaration it dropped documents nothing"
    );
}

/// **A use of a revised module replaces the page the window was holding for a declaration whose
/// code changed.**
///
/// This is the half a registry alone cannot deliver. A model that rewrote a memory's code and used
/// it again would otherwise keep reading the signature it replaced, because the key it is filed
/// under did not change — and it would go on reading it for the life of the session, since nothing
/// but a close removes a documentation view.
///
/// The declaration the revision left alone is the control: its page is byte-identical, so it does
/// not move and leaves nothing behind. A revision costs the prompt prefix from the page it changed
/// and nothing else.
#[test]
fn a_use_of_a_revised_module_replaces_the_page_it_changed() {
    let (mut knowledge, docs) = used_csv_tools();
    let mut context = window();
    context.begin_turn(1);
    open_loaded_docviews(
        &mut context,
        &docs,
        DocViewTypes::RETURN_AND_ERRORS,
        "csvTools",
    );
    let widen_at = context
        .items()
        .iter()
        .position(|item| item.label() == Some("csvTools.widen"))
        .expect("the second declaration's page is in the window");

    knowledge
        .load(
            language(GgProgramLanguage::TypeScript),
            KnowledgeOrigin::Skill,
            "csv-tools",
            Some(
                "\
/** Split a CSV into rows. */
export function parse(text: string, strict: boolean): string[] { return text.split(\",\"); }
export function widen(row: string[]): string { return row.join(\" | \"); }
export const DELIMITER = \",\";
",
            ),
            None,
        )
        .expect("the revision loads");

    context.begin_turn(2);
    open_loaded_docviews(
        &mut context,
        &docs,
        DocViewTypes::RETURN_AND_ERRORS,
        "csvTools",
    );

    assert_eq!(open(&context), ["csvTools.widen", "csvTools.parse"]);
    let revised = context
        .open_docviews()
        .into_iter()
        .find(|view| view.key == "csvTools.parse")
        .map(|view| view.body)
        .expect("the revised declaration is still open under its own key");
    assert!(
        revised.contains("export function parse(text: string, strict: boolean): string[]"),
        "the page carries the declaration the module now offers: {revised}"
    );
    assert_eq!(
        context
            .items()
            .iter()
            .position(|item| item.label() == Some("csvTools.widen")),
        Some(widen_at),
        "the declaration the revision left alone did not move"
    );
    assert_eq!(
        context
            .items()
            .iter()
            .filter(|item| item.source() == test_cabinet_core::gg::GgContextSource::History)
            .count(),
        1,
        "and exactly one page was retired: the one whose text changed"
    );
}

/// **A skill that is only code pins nothing.** Its body is empty, and an empty message is one a
/// provider refuses — so the turn a code-only skill was used on would end on a rejected request.
/// What such a skill puts in the window is the documentation views its module opened.
#[test]
fn a_code_only_skill_pins_no_message() {
    let mut context = window();
    let mut skills = crate::skills::SkillsRuntime::new(Arc::new(
        crate::skills::SkillLibrary::empty().with_builtins(vec![
            crate::skills::parse_skill("---\nname: csv-tools\ndescription: parsing.\n---\n")
                .expect("the fixture skill parses"),
        ]),
    ));
    let call = ToolCall {
        id: "call-1".to_string(),
        name: SKILLS_READ_SKILL.to_string(),
        arguments: serde_json::json!({ "name": "csv-tools" }),
    };
    let outcome = ToolOutcome::ok(String::new(), "read skill `csv-tools`");
    let emitter = Emitter::with_sink(None, Box::new(crate::telemetry::CollectingSink::new()));
    pin_read_skill(&mut context, &mut skills, &call, &outcome, &emitter);

    assert!(
        !context
            .items()
            .iter()
            .any(|item| item.source() == GgContextSource::Skill),
        "a skill with no body puts no message in the window"
    );
    assert_eq!(
        skills.read_count(),
        1,
        "it is still recorded as used, so a second use does not pin one either"
    );
}
