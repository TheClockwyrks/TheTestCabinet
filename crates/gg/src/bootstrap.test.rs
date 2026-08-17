//! Tests for the **synthesized opening turn** — the program gg writes on an agent's behalf and
//! actually runs.
//!
//! Five properties, and each of them is a way the bootstrap could be present and useless:
//!
//! 1. **It runs.** On every registered arm, the program gg generates prepares, executes, and leaves
//!    a listing of every granted module and a documentation view of every bootstrap call in the
//!    window — asserted from the window itself rather than from what the generator claims.
//! 2. **It is the arm's own program, and it is what ran.** The assistant message beside those views
//!    is the source that was executed, in that arm's syntax, so a model copying its own transcript
//!    copies something that works.
//! 3. **A failure of it is gg's**, and it refuses the run rather than opening a model on a window
//!    that never got its surface.
//! 4. **It is not a turn**: nothing here begins one, counts one, or times one.
//! 5. **It is this agent's surface**, not some other agent's: two grants on one arm open on two
//!    different function lists, which is the property the prepared-program cache could silently
//!    break.
//!
//! # Why the per-arm run is eleven tests rather than one loop
//!
//! Because running one is genuinely expensive — each arm compiles its guest component, and a
//! compiled arm additionally starts a real `rustc`/`swiftc`/`clang++`/JVM — and `cargo nextest`
//! bounds each **test** rather than each assertion. Eleven tests are eleven processes with eleven
//! independent budgets; one loop would be a single test carrying the sum of them, which is the shape
//! this suite has repeatedly measured being terminated for doing exactly what it says.

use std::sync::Arc;

use super::*;
use crate::context::{ContextItem, ContextModel, HeuristicTokenEstimator};
use crate::docs::{DocViewTypes, DocsRuntime};
use crate::ending::EndingRole;
use crate::sandbox::{
    OperationId, SandboxError, SandboxLimits, all_languages, capability_operations,
    gating_capabilities, operation,
};
use test_cabinet_core::gg::{GgContextSource, GgProgramLanguage};

/// A window in [code mode](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) — the only mode the
/// bootstrap fires in, since the tool-calling arm has no program to synthesize.
fn code_model() -> ContextModel {
    ContextModel::new(
        Arc::new(HeuristicTokenEstimator::new()),
        Some(1_000_000),
        true,
    )
}

/// An agent granted **everything**, which is the ordinary case and the one that must work: the whole
/// module surface to list, and both bootstrap calls bound.
fn grant() -> (Vec<String>, Vec<OperationId>) {
    let capabilities = gating_capabilities();
    let operations = capability_operations(capabilities.iter().copied());
    (
        capabilities.into_iter().map(str::to_string).collect(),
        operations,
    )
}

/// That grant as the bootstrap takes it, under the defaults a run resolves when nothing is
/// configured.
fn agent<'a>(capabilities: &'a [String], operations: &'a [OperationId]) -> BootstrapAgent<'a> {
    BootstrapAgent {
        capabilities,
        operations,
        role: EndingRole::Standard,
        limits: SandboxLimits::default(),
        doc_view_types: DocViewTypes::default(),
    }
}

/// The selectors of the search band, in window order — one per module the program listed.
fn search_keys(ctx: &ContextModel) -> Vec<String> {
    labels(ctx, GgContextSource::SearchResults)
}

/// The keys of the documentation band, in window order.
fn docview_keys(ctx: &ContextModel) -> Vec<String> {
    labels(ctx, GgContextSource::DocsView)
}

fn labels(ctx: &ContextModel, source: GgContextSource) -> Vec<String> {
    ctx.items()
        .iter()
        .filter(|item| item.source() == source)
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

/// Run the bootstrap for one arm against a fresh window granted everything, and hand back what it
/// left behind.
async fn seed(id: GgProgramLanguage) -> (ContextModel, Result<usize, String>) {
    let (capabilities, operations) = grant();
    seed_granted(id, &capabilities, &operations).await
}

/// The same, for an agent granted `capabilities`/`operations` rather than the whole surface.
async fn seed_granted(
    id: GgProgramLanguage,
    capabilities: &[String],
    operations: &[OperationId],
) -> (ContextModel, Result<usize, String>) {
    let mut ctx = code_model();
    let mut docs = DocsRuntime::new(capabilities.to_vec(), EndingRole::Standard, operations, id);
    let placed = seed_bootstrap(&mut ctx, &mut docs, agent(capabilities, operations)).await;
    (ctx, placed)
}

/// **The whole property, per arm: the program runs, and the window it leaves is the agent's whole
/// surface.**
///
/// Every assertion reads the *window*, not the generator. A program that compiled and did nothing,
/// one that listed nine of eleven modules, and one whose calls were all refused would each satisfy
/// "gg generated a program" and none of them would leave an agent able to find a function.
macro_rules! bootstrap_runs {
    ($($name:ident: $id:expr,)*) => {
        $(
            #[tokio::test]
            async fn $name() {
                let language = crate::sandbox::language($id);
                let arm = language.display_name();
                let (capabilities, operations) = grant();
                let modules = crate::agent::module_paths(
                    &capabilities,
                    &operations,
                    EndingRole::Standard,
                    $id,
                );
                let (ctx, placed) = seed($id).await;
                let placed = placed.unwrap_or_else(|detail| panic!("{arm}: {detail}"));

                assert_eq!(
                    search_keys(&ctx),
                    modules,
                    "{arm}: one listing per granted module, keyed by the path the prompt shows"
                );
                let docviews = docview_keys(&ctx);
                let docs = DocsRuntime::new(
                    capabilities.clone(),
                    EndingRole::Standard,
                    &operations,
                    $id,
                );
                for key in bootstrap_keys(&docs) {
                    assert!(
                        docviews.contains(&key),
                        "{arm}: the program did not open `{key}`, so the model was handed no way \
                         to read a brief in full: {docviews:?}"
                    );
                }
                assert_eq!(
                    placed,
                    search_keys(&ctx).len() + docviews.len(),
                    "{arm}: what was reported placed is what is in the window"
                );

                let programs = programs(&ctx);
                assert_eq!(
                    programs.len(),
                    1,
                    "{arm}: the bootstrap is one turn, not one per call"
                );
                let bootstrap = bootstrap_keys(&docs);
                assert_eq!(
                    programs[0],
                    language.bootstrap_program(
                        &modules.iter().map(String::as_str).collect::<Vec<_>>(),
                        &bootstrap.iter().map(String::as_str).collect::<Vec<_>>(),
                    ),
                    "{arm}: the window holds the source that ran, which is what a model copies"
                );
            }
        )*
    };
}

bootstrap_runs! {
    the_typescript_bootstrap_runs_and_places_its_views: GgProgramLanguage::TypeScript,
    the_javascript_bootstrap_runs_and_places_its_views: GgProgramLanguage::JavaScript,
    the_python_bootstrap_runs_and_places_its_views: GgProgramLanguage::Python,
    the_ruby_bootstrap_runs_and_places_its_views: GgProgramLanguage::Ruby,
    the_purescript_bootstrap_runs_and_places_its_views: GgProgramLanguage::PureScript,
    the_java_bootstrap_runs_and_places_its_views: GgProgramLanguage::Java,
    the_kotlin_bootstrap_runs_and_places_its_views: GgProgramLanguage::Kotlin,
    the_rust_bootstrap_runs_and_places_its_views: GgProgramLanguage::Rust,
    the_swift_bootstrap_runs_and_places_its_views: GgProgramLanguage::Swift,
    the_cpp_bootstrap_runs_and_places_its_views: GgProgramLanguage::Cpp,
    the_csharp_bootstrap_runs_and_places_its_views: GgProgramLanguage::CSharp,
}

/// **Every registered arm writes a program that names every module and every bootstrap key.**
///
/// The cheap half of the gate above, over the whole registry rather than one arm at a time: it
/// starts no compiler, so an arm whose generator drops a module is named here in milliseconds
/// rather than after that arm's own run has been waited for.
#[test]
fn every_language_writes_a_program_naming_every_module_and_key() {
    let (capabilities, operations) = grant();
    for language in all_languages() {
        let arm = language.display_name();
        let id = language.id();
        let docs = DocsRuntime::new(capabilities.clone(), EndingRole::Standard, &operations, id);
        let modules =
            crate::agent::module_paths(&capabilities, &operations, EndingRole::Standard, id);
        let keys = bootstrap_keys(&docs);
        assert_eq!(
            keys.len(),
            BOOTSTRAP_CALLS.len(),
            "{arm}: an arm that does not catalogue a bootstrap call leaves a model with no way to \
             reach its own surface. What it does catalogue: {keys:?}"
        );
        let source = language.bootstrap_program(
            &modules.iter().map(String::as_str).collect::<Vec<_>>(),
            &keys.iter().map(String::as_str).collect::<Vec<_>>(),
        );
        for named in modules.iter().chain(keys.iter()) {
            assert!(
                source.contains(named),
                "{arm}: the generated program does not name `{named}`:\n{source}"
            );
        }
    }
}

/// **A tool-calling window is never seeded**, because there is no program to put in its mouth.
#[tokio::test]
async fn a_tool_calling_window_is_not_seeded() {
    let (capabilities, operations) = grant();
    let mut ctx = ContextModel::new(
        Arc::new(HeuristicTokenEstimator::new()),
        Some(100_000),
        false,
    );
    let mut docs = DocsRuntime::new(
        capabilities.clone(),
        EndingRole::Standard,
        &operations,
        GgProgramLanguage::TypeScript,
    );
    assert_eq!(
        seed_bootstrap(&mut ctx, &mut docs, agent(&capabilities, &operations)).await,
        Ok(0)
    );
    assert!(ctx.items().is_empty());
}

/// **The bootstrap consumes no turn.**
///
/// It runs before the loop, so there is no turn index for it to spend — and everything a turn
/// accounts for follows from that. What a test can read off the window is the turn each item was
/// pushed on: a bootstrap that had begun one would leave its program and its views on turn 1, and
/// the model's own first reply would then be the second turn of a session it had not yet spoken in.
///
/// The rest of the property is structural rather than assertable here, and is written down where it
/// is enforced: [`seed_bootstrap`] is handed no emitter, no
/// [library](crate::programs::ProgramLibrary), no timer and no loop guard, so there is nothing in
/// scope for it to record a turn, a usage figure or a `CodeExecution` event with.
#[tokio::test]
async fn the_bootstrap_consumes_no_turn() {
    let (mut ctx, placed) = seed(GgProgramLanguage::TypeScript).await;
    let placed = placed.expect("the bootstrap runs");
    let seeded = ctx.items().len();

    // The loop's first turn, opened after the seeding exactly as `drive` opens it. Asserting
    // against a window that never began one at all is what makes the bare `turn() == 0` check
    // vacuous: a bootstrap that had called `begin_turn(1)` itself would leave its items on turn 1
    // and the model's first reply on turn 1 as well, and nothing would be able to tell the two
    // apart. Opening the turn *here* is what separates them.
    ctx.begin_turn(1);
    ctx.push_assistant(Some("the model's own first reply".to_string()), Vec::new());

    let (bootstrap, model) = ctx.items().split_at(seeded);
    assert!(
        bootstrap.iter().all(|item| item.turn() == 0),
        "the bootstrap's {placed} view(s) and its program sit before the first turn, not on it: \
         {:?}",
        bootstrap.iter().map(ContextItem::turn).collect::<Vec<_>>()
    );
    assert!(
        model.iter().all(|item| item.turn() == 1),
        "and the model's first reply is the first turn, so the run's turn 1 is the first thing \
         the model said: {:?}",
        model.iter().map(ContextItem::turn).collect::<Vec<_>>()
    );
}

/// **A bootstrap that cannot be run refuses the run**, rather than opening the model on a program
/// with nothing beside it.
///
/// Driven through the sandbox's own [fault seam](crate::sandbox::force_next_program_fault), which is
/// how the failures gg's machinery would have to be broken to produce are exercised anywhere in this
/// crate. What the caller does with the `Err` is the loop's `setup_broke`: the operator is told, the
/// fault latch is raised, and the run ends as an internal error.
#[tokio::test]
async fn a_bootstrap_that_cannot_run_fails_the_run() {
    crate::sandbox::force_next_program_fault(SandboxError::Engine("no engine".to_string()));
    let (ctx, placed) = seed(GgProgramLanguage::TypeScript).await;
    let detail = placed.expect_err("a sandbox that will not run gg's own program is gg's defect");
    assert!(
        detail.contains("did not run") && detail.contains("no engine"),
        "the operator is told what failed: {detail}"
    );
    assert!(
        search_keys(&ctx).is_empty() && docview_keys(&ctx).is_empty(),
        "and nothing was placed, which is the state the run is refused over"
    );
}

/// **Seeding a window twice leaves the documentation band exactly as it was.**
///
/// This is what makes the bootstrap safe as the *first* opening step. A persistent agent's
/// [restore](crate::persistence::restore_docviews) re-opens the keys its last instance held, and one
/// of them is normally a bootstrap key; the restore folds into what is already open because opening
/// a key that is open is a no-op. The search band is the deliberate other half: each module's
/// listing supersedes its own, so a second run leaves one listing per module rather than two.
#[tokio::test]
async fn seeding_twice_re_places_no_documentation_and_no_second_listing() {
    let (capabilities, operations) = grant();
    let id = GgProgramLanguage::TypeScript;
    let mut ctx = code_model();
    let mut docs = DocsRuntime::new(capabilities.clone(), EndingRole::Standard, &operations, id);
    seed_bootstrap(&mut ctx, &mut docs, agent(&capabilities, &operations))
        .await
        .expect("the first seeding runs");
    let docviews = docview_keys(&ctx);
    let listings = search_keys(&ctx);

    let placed = seed_bootstrap(&mut ctx, &mut docs, agent(&capabilities, &operations))
        .await
        .expect("and so does the second");

    assert_eq!(
        docview_keys(&ctx),
        docviews,
        "a documentation view that is open is not re-placed, moved or re-emitted"
    );
    assert_eq!(
        search_keys(&ctx),
        listings,
        "and each module's listing replaced its own rather than piling up beside it"
    );
    assert_eq!(
        placed,
        listings.len(),
        "so what the second run placed is the listings alone"
    );
}

/// Every search view's body, joined — the listing text a model actually reads on turn one.
fn listings(ctx: &ContextModel) -> String {
    ctx.items()
        .iter()
        .filter(|item| item.source() == GgContextSource::SearchResults)
        .filter_map(|item| item.message().content.clone())
        .collect::<Vec<_>>()
        .join("\n")
}

/// The fully-qualified names an agent granted `capabilities`/`operations` binds on `id` — the
/// function list its opening window is supposed to be a listing of.
fn bound_names(
    id: GgProgramLanguage,
    capabilities: &[String],
    operations: &[OperationId],
) -> Vec<String> {
    let docs = DocsRuntime::new(capabilities.to_vec(), EndingRole::Standard, operations, id);
    catalogue_functions(crate::sandbox::language(id))
        .iter()
        .filter(|function| function.alias_of.is_none() && docs.bound(function))
        .map(|function| function.fqn.to_string())
        .collect()
}

/// **Two agents on one arm, granted differently, open on different function lists.**
///
/// The opening turn is generated from the grant, so a narrower agent must open on a narrower
/// surface — and this is the property [the prepared-program cache](super::PREPARED) is most able to
/// break. That cache is keyed by `(language, source hash)` and is consulted by every agent in the
/// run, so an arm whose generated source did not vary with the module list, or a key that collapsed
/// two sources into one, would hand the second agent the first one's artifact: a restricted agent
/// would open its session reading a listing of calls it does not hold and cannot make.
///
/// The wide agent is seeded **first** so the narrow one runs against a warm cache, which is the
/// order that fails if the key is wrong. Both assertions are needed: that the narrow window omits
/// every name the narrow agent does not bind, and that the wide window carries them — the first
/// alone is satisfied by a bootstrap that listed nothing at all.
#[tokio::test]
async fn two_grants_on_one_arm_open_on_different_function_lists() {
    let id = GgProgramLanguage::TypeScript;
    let (wide_capabilities, wide_operations) = grant();
    // One capability rather than all of them. The two calls the bootstrap itself makes are bound by
    // where an instance stands rather than by a capability, so even this agent boots.
    let narrow_capabilities = vec![
        wide_capabilities
            .first()
            .expect("gg has at least one gating capability")
            .clone(),
    ];
    let narrow_operations = capability_operations(narrow_capabilities.iter().map(String::as_str));

    let wide = bound_names(id, &wide_capabilities, &wide_operations);
    let narrow = bound_names(id, &narrow_capabilities, &narrow_operations);
    let withheld: Vec<&String> = wide.iter().filter(|name| !narrow.contains(name)).collect();
    assert!(
        !withheld.is_empty(),
        "the two grants bind the same functions, so this test would pass on a bootstrap that \
         ignored the grant entirely"
    );

    let (wide_ctx, placed) = seed_granted(id, &wide_capabilities, &wide_operations).await;
    placed.expect("the fully-granted agent's bootstrap runs");
    let (narrow_ctx, placed) = seed_granted(id, &narrow_capabilities, &narrow_operations).await;
    placed.expect("and so does the restricted agent's, against a warm cache");

    let wide_listings = listings(&wide_ctx);
    let narrow_listings = listings(&narrow_ctx);
    for name in withheld {
        assert!(
            wide_listings.contains(name.as_str()),
            "the fully-granted agent's opening window does not list `{name}`, which it binds"
        );
        assert!(
            !narrow_listings.contains(name.as_str()),
            "the restricted agent opened on `{name}`, which it does not bind — its window is \
             another agent's"
        );
    }
    assert_ne!(
        programs(&wide_ctx),
        programs(&narrow_ctx),
        "two grants that list different modules are two different programs"
    );
}

/// **Every bootstrap call is one gg has an operation for.**
///
/// The list is written by hand, and an [`OperationId`] naming a row the table does not carry would
/// be a key [`bootstrap_keys`] can never resolve — which now refuses the run rather than quietly
/// shrinking the opening turn to whatever was left.
#[test]
fn every_bootstrap_call_is_an_operation_gg_has() {
    for call in BOOTSTRAP_CALLS {
        assert!(
            operation(*call).is_some(),
            "the bootstrap opens `{call}`, which gg has no operation for"
        );
    }
}
