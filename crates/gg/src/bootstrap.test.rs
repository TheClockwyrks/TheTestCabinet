//! Tests for the **synthesized opening turn**.
//!
//! Three things are asserted, and each of them is a way the bootstrap could be present and useless:
//! that it puts a real program and real documentation into the window on every registered arm; that
//! the program it writes is the arm's own syntax and names exactly the keys the views arrived under,
//! so a model copying it copies something that works; and that running it twice adds nothing, which
//! is what makes it safe beside a persistent agent's restore.
//!
//! The documentation search has an operation and is in [`BOOTSTRAP_CALLS`], so the first test above
//! is what fails on an arm that does not catalogue it.

use std::sync::Arc;

use super::*;
use crate::context::{ContextModel, HeuristicTokenEstimator};
use crate::ending::EndingRole;
use crate::sandbox::{OPERATIONS, all_languages};
use test_cabinet_core::gg::{GgContextSource, GgProgramLanguage};
use test_cabinet_core::gg_query::GG_CAPABILITY_CATALOG;

/// A window in [code mode](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) — the only mode the
/// bootstrap fires in, since the tool-calling arm has no program to synthesize.
fn code_model() -> ContextModel {
    ContextModel::new(
        Arc::new(HeuristicTokenEstimator::new()),
        Some(100_000),
        true,
    )
}

/// A documentation runtime for an agent granted **everything**, which is the ordinary case and the
/// one that must work; the bootstrap calls are ungated, so nothing here turns on the grant.
fn docs(language: GgProgramLanguage) -> DocsRuntime {
    DocsRuntime::new(
        crate::tools::ALL_TOOL_NAMES
            .iter()
            .map(|tool| tool.to_string())
            .collect(),
        EndingRole::Standard,
        GG_CAPABILITY_CATALOG,
        language,
    )
}

/// The keys of the documentation band, in window order.
fn docview_keys(ctx: &ContextModel) -> Vec<String> {
    ctx.items()
        .iter()
        .filter(|item| item.source() == GgContextSource::DocsView)
        .filter_map(|item| item.label().map(str::to_string))
        .collect()
}

/// The assistant turns in the window, in order.
fn programs(ctx: &ContextModel) -> Vec<String> {
    ctx.items()
        .iter()
        .filter(|item| item.source() == GgContextSource::Assistant)
        .filter_map(|item| item.message().content.clone())
        .collect()
}

/// **Every registered arm opens the bootstrap documentation, keyed by the name it advertises.**
///
/// The end-to-end assertion: a code agent's window opens holding the documentation of the calls
/// discovery is made of, on all eleven arms, without anything per-arm being written down anywhere.
#[test]
fn every_language_opens_the_bootstrap_documentation() {
    for language in all_languages() {
        let name = language.display_name();
        let docs = docs(language.id());
        let mut ctx = code_model();
        let placed = seed_bootstrap(&mut ctx, &docs);

        let expected = bootstrap_keys(&docs);
        assert_eq!(
            expected.len(),
            BOOTSTRAP_CALLS.len(),
            "{name}: an arm that does not catalogue a bootstrap call leaves a model with no way \
             to reach its own surface. What it does catalogue: {expected:?}"
        );
        assert_eq!(placed, expected.len(), "{name}: every key was placed");
        assert_eq!(
            docview_keys(&ctx),
            expected,
            "{name}: the band opens with exactly the bootstrap keys, in order"
        );
        for key in &expected {
            assert!(
                docs.read_any(key).is_some(),
                "{name}: `{key}` renders no documentation, so the view gg opened is empty"
            );
        }
    }
}

/// **The synthesized turn is a program in the agent's own language, naming exactly the views beside
/// it.**
///
/// The model reads its own transcript as the example of what a well-formed turn looks like, so this
/// is the whole reason the bootstrap is a program rather than a paragraph: what it teaches on turn
/// one has to be *its* syntax and *its* keys. A statement in another arm's syntax would teach the
/// wrong protocol before the model has written a line.
#[test]
fn the_bootstrap_turn_is_a_program_that_names_the_views_it_opened() {
    for language in all_languages() {
        let name = language.display_name();
        let docs = docs(language.id());
        let mut ctx = code_model();
        seed_bootstrap(&mut ctx, &docs);

        let programs = programs(&ctx);
        assert_eq!(
            programs.len(),
            1,
            "{name}: the bootstrap is one turn, not one per view"
        );
        let program = &programs[0];
        let bootstrap = bootstrap_keys(&docs);
        let keys: Vec<&str> = bootstrap.iter().map(String::as_str).collect();
        assert_eq!(
            *program,
            language.open_docs_views_statement(&keys),
            "{name}: the program is the one this arm writes for opening documentation views, not \
             one assembled here"
        );
        for key in &keys {
            assert!(
                program.contains(key),
                "{name}: the program does not name `{key}`, so a model copying it would not \
                 reproduce the view beside it:\n{program}"
            );
        }
    }
}

/// **Seeding twice adds nothing** — no second program, no second view.
///
/// This is what makes the bootstrap safe as the *first* opening step. A persistent agent's
/// [restore](crate::persistence::restore_docviews) re-opens the keys its last instance held, and one
/// of them is normally a bootstrap key; the restore folds into what is already open because opening
/// a key that is open is a no-op. The same property is what keeps a second call here from putting a
/// duplicated reply in a model's mouth.
#[test]
fn seeding_a_window_that_already_holds_the_bootstrap_adds_nothing() {
    for language in all_languages() {
        let name = language.display_name();
        let docs = docs(language.id());
        let mut ctx = code_model();
        seed_bootstrap(&mut ctx, &docs);
        let first = ctx.items().len();

        assert_eq!(
            seed_bootstrap(&mut ctx, &docs),
            0,
            "{name}: a second seeding places nothing"
        );
        assert_eq!(
            ctx.items().len(),
            first,
            "{name}: and pushes no program either — a synthesized reply whose views never \
             arrived teaches the model that opening one sometimes does nothing"
        );
    }
}

/// **A tool-calling window is never seeded**, because there is no program to put in its mouth.
#[test]
fn a_tool_calling_window_is_not_seeded() {
    let mut ctx = ContextModel::new(
        Arc::new(HeuristicTokenEstimator::new()),
        Some(100_000),
        false,
    );
    assert_eq!(seed_bootstrap(&mut ctx, &docs(GgProgramLanguage::Rust)), 0);
    assert!(ctx.items().is_empty());
}

/// **Every bootstrap call is one gg has an operation for.**
///
/// The list is written by hand, and a [`SurfaceCall`] naming a pair no row carries would be seeded
/// as a key [`bootstrap_keys`] can never resolve — so the bootstrap would quietly shrink to whatever
/// was left, which is the failure the whole turn exists to prevent.
#[test]
fn every_bootstrap_call_is_an_operation_gg_has() {
    for call in BOOTSTRAP_CALLS {
        assert!(
            OPERATIONS.iter().any(|operation| {
                operation.call.object == call.object && operation.call.key == call.key
            }),
            "the bootstrap opens `{}.{}`, which gg has no operation for",
            call.object,
            call.key
        );
    }
}
