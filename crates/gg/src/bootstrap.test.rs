//! Tests for the **synthesized opening turn** — the program gg writes on an agent's behalf, from
//! the agent's own [`GgOpeningTurn`] configuration, and actually runs.
//!
//! Six properties, and each of them is a way the bootstrap could be present and useless:
//!
//! 1. **It runs.** On every registered arm, the program gg generates for the opening turn a fresh
//!    profile is seeded with prepares, executes, and leaves one listing of the listed modules and a
//!    documentation view of every listed function in the window — asserted from the window itself
//!    rather than from what the generator claims.
//! 2. **It is the arm's own program, and it is what ran.** The `submit_program` call beside those
//!    views carries the source that was executed, in that arm's syntax, so a model copying its own
//!    transcript copies something that works.
//! 3. **A failure of it is gg's**, and it refuses the run rather than opening a model on a window
//!    that never got its surface.
//! 4. **It is not a turn**: nothing here begins one, counts one, or times one.
//! 5. **It is this agent's surface**, not some other agent's: two grants on one arm open on two
//!    different function lists, which is the property the prepared-program cache could silently
//!    break.
//! 6. **It is this agent's configuration**, read as written: the two lists are independent, kept
//!    in the order written, opened once each, dropped with a warning where the agent does not hold
//!    an entry, refused at launch where gg has no vocabulary for one, and an empty pair seeds
//!    nothing at all.
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
    Binding, DELEGATION_TRANSITION_STATE, DOCS_SEARCH, FILES_READ_FILE, OperationId,
    SESSION_FINISH, SandboxError, SandboxLimits, VIEWS_OPEN_DOCS_VIEW, VIEWS_OPEN_FILE,
    VIEWS_OPEN_TEXT, all_languages, capability_operations, catalogue_functions, family_of_module,
    gating_capabilities, operation,
};
use test_cabinet_core::gg::{
    CAPABILITY_PROJECT_MANAGEMENT, CAPABILITY_READ_FILE, DEFAULT_OPENING_FUNCTIONS,
    DEFAULT_OPENING_MODULES, GgAgentConfig, GgCapabilitySet, GgContextSource, GgOpeningTurn,
    GgProgramLanguage,
};

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
/// module surface to list, and every default function bound.
fn grant() -> (Vec<String>, Vec<OperationId>) {
    let capabilities = gating_capabilities();
    let operations = capability_operations(capabilities.iter().copied());
    (
        capabilities.into_iter().map(str::to_string).collect(),
        operations,
    )
}

/// The opening turn a fresh profile is seeded with — what every test here reads unless it is about
/// a different one.
fn seeded() -> GgOpeningTurn {
    GgOpeningTurn::seeded()
}

/// An opening turn written out, for the tests about configuration.
fn opening(modules: &[&str], functions: &[&str]) -> GgOpeningTurn {
    GgOpeningTurn {
        modules: modules.iter().map(|id| id.to_string()).collect(),
        functions: functions.iter().map(|id| id.to_string()).collect(),
    }
}

/// That grant as the bootstrap takes it, under the defaults a run resolves when nothing is
/// configured.
fn agent<'a>(
    opening: &'a GgOpeningTurn,
    capabilities: &'a [String],
    operations: &'a [OperationId],
) -> BootstrapAgent<'a> {
    BootstrapAgent {
        opening_turn: opening,
        capabilities,
        operations,
        role: EndingRole::Standard,
        limits: SandboxLimits::AMPLE,
        doc_view_types: DocViewTypes::RETURN_AND_ERRORS,
    }
}

/// How many of the [default functions](DEFAULT_OPENING_FUNCTIONS) `language`'s catalogue carries at
/// all — what a fully-granted agent on that arm opens, and the most any agent on it can. A call an
/// arm has not yet spelled is simply not opened, and the capability gate is what names that arm.
fn catalogued_calls(language: &'static dyn crate::sandbox::ProgramLanguage) -> usize {
    let functions = catalogue_functions(language);
    DEFAULT_OPENING_FUNCTIONS
        .iter()
        .filter(|id| {
            crate::sandbox::operation_by_id(id).is_some_and(|operation| {
                bootstrap_function(&functions, operation.id, |_| true).is_some()
            })
        })
        .count()
}

/// This arm's key for one call, whatever the agent holds.
fn key_of(id: GgProgramLanguage, call: OperationId) -> String {
    let language = crate::sandbox::language(id);
    bootstrap_function(&catalogue_functions(language), call, |_| true)
        .unwrap_or_else(|| panic!("{} catalogues `{call}`", language.display_name()))
        .fqn
        .to_string()
}

/// This arm's path for one gg module id.
fn path_of(id: GgProgramLanguage, module: &str) -> String {
    crate::sandbox::catalogue_modules(crate::sandbox::language(id))
        .into_iter()
        .find(|view| view.id == module)
        .unwrap_or_else(|| panic!("{id:?} catalogues the `{module}` module"))
        .path
        .to_string()
}

/// The selectors of the search band, in window order.
///
/// The opening turn makes **one** search naming every module it lists, so this is one entry keyed by
/// the joined module list — not one per module. The joined key is what keeps that listing out of the
/// way of the model's own searching: a model's search is keyed by the constant
/// [`SEARCH_RESULTS_VIEW`](crate::context::SEARCH_RESULTS_VIEW) and replaces itself, while the
/// opening listing is superseded only by a re-listing of exactly those modules.
fn search_keys(ctx: &ContextModel) -> Vec<String> {
    labels(ctx, GgContextSource::SearchResults)
}

/// **The module paths the opening program lists**, for an agent granted `capabilities`/`operations`
/// on `id` under the default opening turn — the prompt's own order, narrowed to the
/// [default modules](DEFAULT_OPENING_MODULES).
///
/// Derived here from the two things that decide it, rather than restated: the paths the prompt
/// publishes ([`module_paths`](crate::agent::module_paths)), and the ids the default opening turn
/// lists. A copy of the answer would go on passing after a module was added to either list, which is
/// precisely the drift the window is supposed to be a projection of.
fn listed_modules(
    id: GgProgramLanguage,
    capabilities: &[String],
    operations: &[OperationId],
) -> Vec<String> {
    let opened: Vec<&str> = crate::sandbox::catalogue_modules(crate::sandbox::language(id))
        .into_iter()
        .filter(|module| DEFAULT_OPENING_MODULES.contains(&module.id))
        .map(|module| module.path)
        .collect();
    crate::agent::module_paths(capabilities, operations, EndingRole::Standard, id)
        .into_iter()
        .filter(|path| opened.contains(&path.as_str()))
        .collect()
}

/// The selector the opening listing is keyed by: the modules it named, joined the way
/// [`BootstrapApi::search_docs`](super::BootstrapApi) joins them.
fn listing_key(modules: &[String]) -> String {
    modules.join(", ")
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

/// The programs the window's assistant turns submitted, in order — each read out of its turn's
/// `submit_program` call, which is where a code-mode transcript carries a program.
fn programs(ctx: &ContextModel) -> Vec<String> {
    ctx.items()
        .iter()
        .filter(|item| item.source() == GgContextSource::Assistant)
        .flat_map(|item| item.message().tool_calls.iter())
        .filter_map(|call| {
            call.arguments
                .get("program")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
        .collect()
}

/// What a bootstrap that must have seeded something placed, and what it dropped on the way.
fn seeded_views(bootstrap: Bootstrap) -> (usize, Vec<Dropped>) {
    match bootstrap {
        Bootstrap::Seeded { placed, dropped } => (placed, dropped),
        other => panic!("the bootstrap seeded no program: {other:?}"),
    }
}

/// Run the bootstrap for one arm against a fresh window granted everything, under the default
/// opening turn, and hand back what it left behind.
async fn seed(id: GgProgramLanguage) -> (ContextModel, Result<Bootstrap, String>) {
    let (capabilities, operations) = grant();
    seed_granted(id, &seeded(), &capabilities, &operations).await
}

/// The same, for an agent granted `capabilities`/`operations` rather than the whole surface, and
/// opening on `opening`.
async fn seed_granted(
    id: GgProgramLanguage,
    opening: &GgOpeningTurn,
    capabilities: &[String],
    operations: &[OperationId],
) -> (ContextModel, Result<Bootstrap, String>) {
    let mut ctx = code_model();
    let mut docs = DocsRuntime::new(capabilities.to_vec(), EndingRole::Standard, operations, id);
    let placed = seed_bootstrap(
        &mut ctx,
        &mut docs,
        &mut crate::programs::ProgramLibrary::disabled(),
        agent(opening, capabilities, operations),
    )
    .await;
    (ctx, placed)
}

/// **The whole property, per arm: the program runs, and the window it leaves is the surface the
/// default opening turn promises.**
///
/// Every assertion reads the *window*, not the generator. A program that compiled and did nothing,
/// one that listed one of the two default modules, and one whose calls were all refused would each
/// satisfy "gg generated a program" and none of them would leave an agent able to find a function.
///
/// The listing is **one** view rather than one per module, keyed by the modules it named joined
/// together. That is the assertion the previous shape cannot pass by accident: a program that had
/// gone on searching module by module would leave two views under two keys, and one that named the
/// modules and never searched would leave none.
macro_rules! bootstrap_runs {
    ($($name:ident: $id:expr,)*) => {
        $(
            #[tokio::test]
            async fn $name() {
                let language = crate::sandbox::language($id);
                let arm = language.display_name();
                let (capabilities, operations) = grant();
                let modules = listed_modules($id, &capabilities, &operations);
                assert_eq!(
                    modules.len(),
                    DEFAULT_OPENING_MODULES.len(),
                    "{arm}: an agent granted everything holds every module the default opening \
                     turn lists, so anything less than all of them is this arm's catalogue \
                     disagreeing with gg: {modules:?}"
                );
                let (ctx, placed) = seed($id).await;
                let (placed, dropped) =
                    seeded_views(placed.unwrap_or_else(|detail| panic!("{arm}: {detail}")));
                assert!(
                    dropped.is_empty(),
                    "{arm}: a fully-granted agent holds every default entry, so nothing is \
                     dropped: {dropped:?}"
                );

                assert_eq!(
                    search_keys(&ctx),
                    vec![listing_key(&modules)],
                    "{arm}: one listing covering the listed modules together, keyed by the paths \
                     the prompt shows"
                );
                let docviews = docview_keys(&ctx);
                let docs = DocsRuntime::new(
                    capabilities.clone(),
                    EndingRole::Standard,
                    &operations,
                    $id,
                );
                let resolved = resolve_opening_turn(
                    &docs,
                    &seeded(),
                    &capabilities,
                    &operations,
                    EndingRole::Standard,
                );
                assert_eq!(
                    resolved.keys.len(),
                    catalogued_calls(language),
                    "{arm}: a fully-granted agent opens every default function its arm catalogues"
                );
                for key in &resolved.keys {
                    assert!(
                        docviews.contains(key),
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
                assert_eq!(
                    programs[0],
                    language.bootstrap_program(
                        &modules.iter().map(String::as_str).collect::<Vec<_>>(),
                        &resolved.keys.iter().map(String::as_str).collect::<Vec<_>>(),
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

/// **Every registered arm writes a program that names every module the default opening turn lists
/// and every default key.**
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
        let resolved = resolve_opening_turn(
            &docs,
            &seeded(),
            &capabilities,
            &operations,
            EndingRole::Standard,
        );
        assert_eq!(
            resolved.modules,
            listed_modules(id, &capabilities, &operations),
            "{arm}: the modules the seed resolves are the prompt's paths for the default ids"
        );
        assert_eq!(
            resolved.modules.len(),
            DEFAULT_OPENING_MODULES.len(),
            "{arm}: gg's default opens on {DEFAULT_OPENING_MODULES:?} and this arm's catalogue \
             offers a fully-granted agent {:?}, so the sweep below would check nothing about the \
             missing one",
            resolved.modules
        );
        assert_eq!(
            resolved.keys.len(),
            catalogued_calls(language),
            "{arm}: an arm that does not catalogue a default function leaves a model with no way \
             to reach its own surface. What it does catalogue: {:?}",
            resolved.keys
        );
        assert!(
            resolved.dropped.is_empty(),
            "{arm}: a fully-granted agent drops nothing: {:?}",
            resolved.dropped
        );
        let source = language.bootstrap_program(
            &resolved
                .modules
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            &resolved.keys.iter().map(String::as_str).collect::<Vec<_>>(),
        );
        for named in resolved.modules.iter().chain(resolved.keys.iter()) {
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
        seed_bootstrap(
            &mut ctx,
            &mut docs,
            &mut crate::programs::ProgramLibrary::disabled(),
            agent(&seeded(), &capabilities, &operations)
        )
        .await,
        Ok(Bootstrap::NotCodeMode)
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
    let (placed, _) = seeded_views(placed.expect("the bootstrap runs"));
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
/// a key that is open is a no-op. The search band is the deliberate other half: the listing is keyed
/// by the modules it covers, so a re-listing of exactly those supersedes it and a second run leaves
/// one listing rather than two.
#[tokio::test]
async fn seeding_twice_re_places_no_documentation_and_no_second_listing() {
    let (capabilities, operations) = grant();
    let opening = seeded();
    let id = GgProgramLanguage::TypeScript;
    let mut ctx = code_model();
    let mut docs = DocsRuntime::new(capabilities.clone(), EndingRole::Standard, &operations, id);
    seed_bootstrap(
        &mut ctx,
        &mut docs,
        &mut crate::programs::ProgramLibrary::disabled(),
        agent(&opening, &capabilities, &operations),
    )
    .await
    .expect("the first seeding runs");
    let docviews = docview_keys(&ctx);
    let listings = search_keys(&ctx);

    let (placed, _) = seeded_views(
        seed_bootstrap(
            &mut ctx,
            &mut docs,
            &mut crate::programs::ProgramLibrary::disabled(),
            agent(&opening, &capabilities, &operations),
        )
        .await
        .expect("and so does the second"),
    );

    assert_eq!(
        docview_keys(&ctx),
        docviews,
        "a documentation view that is open is not re-placed, moved or re-emitted"
    );
    assert_eq!(
        search_keys(&ctx),
        listings,
        "and the listing replaced itself rather than piling up beside itself"
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

/// The fully-qualified names an agent granted `capabilities`/`operations` binds on `id` **in the
/// modules the default opening turn lists** — the function list its opening window is supposed to
/// be a listing of.
///
/// Narrowed to the [default modules](DEFAULT_OPENING_MODULES) rather than taken over the whole
/// grant, because the window is: the opening listing covers those modules and no others, so a name
/// bound in `board` is absent from a fully-granted agent's opening window for a reason that has
/// nothing to do with its grant. Left unnarrowed, the assertion *the wide window lists everything
/// the wide agent binds* would be false by design rather than by defect.
fn listed_names(
    id: GgProgramLanguage,
    capabilities: &[String],
    operations: &[OperationId],
) -> Vec<String> {
    let docs = DocsRuntime::new(capabilities.to_vec(), EndingRole::Standard, operations, id);
    catalogue_functions(crate::sandbox::language(id))
        .iter()
        .filter(|function| function.alias_of.is_none() && docs.bound(function))
        .filter(|function| {
            crate::sandbox::operation_of(function)
                .is_some_and(|resolved| DEFAULT_OPENING_MODULES.contains(&resolved.id.namespace))
        })
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
/// The two grants are chosen so that the difference between them falls **inside** the modules the
/// default opening turn lists, which is the only place a difference can show: an agent that holds
/// every capability and one that holds `read_file` alone both open on `files`, and one of them opens
/// on `shell` and on the rest of `files` as well. A narrow grant picked from outside those two
/// modules would differ in nothing the window shows, and the test would be asserting about a listing
/// neither agent was ever given.
///
/// The wide agent is seeded **first** so the narrow one runs against a warm cache, which is the
/// order that fails if the key is wrong. Both assertions are needed: that the narrow window omits
/// every name the narrow agent does not bind, and that the wide window carries them — the first
/// alone is satisfied by a bootstrap that listed nothing at all.
#[tokio::test]
async fn two_grants_on_one_arm_open_on_different_function_lists() {
    let id = GgProgramLanguage::TypeScript;
    let opening = seeded();
    let (wide_capabilities, wide_operations) = grant();
    // The narrowest grant that still opens on one of the two default modules. The two calls the
    // bootstrap itself makes are bound by where an instance stands rather than by a capability, so
    // even this agent boots.
    let narrow_capabilities = vec![CAPABILITY_READ_FILE.to_string()];
    let narrow_operations = capability_operations(narrow_capabilities.iter().map(String::as_str));

    let wide = listed_names(id, &wide_capabilities, &wide_operations);
    let narrow = listed_names(id, &narrow_capabilities, &narrow_operations);
    let withheld: Vec<&String> = wide.iter().filter(|name| !narrow.contains(name)).collect();
    assert!(
        !withheld.is_empty(),
        "the two grants list the same functions, so this test would pass on a bootstrap that \
         ignored the grant entirely"
    );
    assert!(
        !narrow.is_empty(),
        "the restricted agent lists nothing at all, so the window it opened on says nothing about \
         whose surface it is"
    );

    let (wide_ctx, placed) = seed_granted(id, &opening, &wide_capabilities, &wide_operations).await;
    placed.expect("the fully-granted agent's bootstrap runs");
    let (narrow_ctx, placed) =
        seed_granted(id, &opening, &narrow_capabilities, &narrow_operations).await;
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

/// **An agent holding neither default module opens on the discovery calls and no listing at all —
/// and the two modules are reported dropped, by name.**
///
/// The one place the opening turn could fail loudly rather than quietly. A search carrying neither
/// a query nor a filter is `invalid-argument` — *you asked for nothing* and *nothing matched* are
/// different answers — so an arm whose generator emitted the search anyway, with an empty module
/// list, would not merely open on an empty listing: the refusal would come back through
/// [`BootstrapApi`](super::BootstrapApi) and fail the whole run before the model had said a word.
///
/// So the assertion is that the search is **left out**, not that it answered emptily: no search view
/// in the window, and the documentation views still placed beside it. The grant is
/// [project management](CAPABILITY_PROJECT_MANAGEMENT), which buys a real module (`board`) and
/// neither of the two the default lists — a genuinely equipped agent that this turn has nothing to
/// list for, rather than an agent granted nothing. The drop is a warning and not a refusal because
/// this is the shared-document case: one configuration naming `shell` describes both the agent that
/// holds it and the one that does not.
#[tokio::test]
async fn an_agent_holding_no_listed_module_places_no_listing_and_reports_the_drop() {
    let id = GgProgramLanguage::TypeScript;
    let capabilities = vec![CAPABILITY_PROJECT_MANAGEMENT.to_string()];
    let operations = capability_operations(capabilities.iter().map(String::as_str));
    assert!(
        listed_modules(id, &capabilities, &operations).is_empty(),
        "this grant holds one of the default modules after all, so the case below is not the one \
         this test is about"
    );

    let (ctx, placed) = seed_granted(id, &seeded(), &capabilities, &operations).await;
    let (placed, dropped) = seeded_views(placed.expect(
        "an agent with nothing to list still boots: the opening turn drops the search rather than \
         making one gg would refuse",
    ));
    assert!(
        search_keys(&ctx).is_empty(),
        "there was nothing to list, so nothing was listed: {:?}",
        search_keys(&ctx)
    );
    let docviews = docview_keys(&ctx);
    assert!(
        !docviews.is_empty(),
        "and the discovery calls are still opened, which is the whole of what is left"
    );
    assert_eq!(
        placed,
        docviews.len(),
        "what was reported placed is what is in the window"
    );
    for module in DEFAULT_OPENING_MODULES {
        let drop = Dropped::Module(module.to_string());
        assert!(
            dropped.contains(&drop),
            "`{module}` was listed and not held, so it is reported dropped: {dropped:?}"
        );
        let line = drop.to_string();
        assert!(
            line.contains(&format!("`{module}`")) && line.contains("holds no function of it"),
            "the warning names the entry and the reason: {line}"
        );
    }
}

/// **A view-opening call bought by a capability is opened where the agent holds it and dropped,
/// with a warning, where it does not** — while the calls bound to every program are opened for both.
///
/// The opening turn documents *this* agent's surface: an agent without `read-file` has no
/// `views.openFile` to read about, and a documentation view of a call the agent cannot make would
/// teach it a call gg then refuses.
#[tokio::test]
async fn a_capability_bought_view_call_is_seeded_only_where_held() {
    let id = GgProgramLanguage::TypeScript;
    let opening = seeded();
    let open_file = key_of(id, VIEWS_OPEN_FILE);
    let open_text = key_of(id, VIEWS_OPEN_TEXT);
    let open_docs = key_of(id, VIEWS_OPEN_DOCS_VIEW);

    let reading = vec![CAPABILITY_READ_FILE.to_string()];
    let reading_ops = capability_operations(reading.iter().map(String::as_str));
    let (with, placed) = seed_granted(id, &opening, &reading, &reading_ops).await;
    let (_, dropped) = seeded_views(placed.expect("an agent holding read-file boots"));
    assert!(
        !dropped.contains(&Dropped::Function(VIEWS_OPEN_FILE.to_string())),
        "the read-file agent holds the file view: {dropped:?}"
    );
    let with = docview_keys(&with);
    for key in [&open_file, &open_text, &open_docs] {
        assert!(
            with.contains(key),
            "read-file agent did not open `{key}`: {with:?}"
        );
    }

    let board = vec![CAPABILITY_PROJECT_MANAGEMENT.to_string()];
    let board_ops = capability_operations(board.iter().map(String::as_str));
    let (without, placed) = seed_granted(id, &opening, &board, &board_ops).await;
    let (_, dropped) = seeded_views(placed.expect("an agent without read-file boots"));
    let drop = Dropped::Function(VIEWS_OPEN_FILE.to_string());
    assert!(
        dropped.contains(&drop),
        "the file view is listed and not held, so it is reported dropped: {dropped:?}"
    );
    let line = drop.to_string();
    assert!(
        line.contains(&format!("`{VIEWS_OPEN_FILE}`")) && line.contains("does not hold it"),
        "the warning names the entry and the reason: {line}"
    );
    let without = docview_keys(&without);
    assert!(
        !without.contains(&open_file),
        "an agent without read-file was handed the documentation of a call it cannot make: \
         {without:?}"
    );
    for key in [&open_text, &open_docs] {
        assert!(
            without.contains(key),
            "the view calls bound to every program are opened regardless: {without:?}"
        );
    }
}

/// **A function's documentation is opened without its module being listed.**
///
/// The two lists are independent. A profile that wants a model to open holding the full signature
/// of one file call, and no directory of the module it lives in, writes exactly that — and the
/// window it gets holds the documentation view and no search view.
#[tokio::test]
async fn a_function_is_opened_without_its_module_listed() {
    let id = GgProgramLanguage::TypeScript;
    let (capabilities, operations) = grant();
    let opening = opening(&[], &[&FILES_READ_FILE.to_string()]);
    let (ctx, placed) = seed_granted(id, &opening, &capabilities, &operations).await;
    let (placed, dropped) = seeded_views(placed.expect("one documentation view is a program"));
    assert!(dropped.is_empty(), "{dropped:?}");
    assert!(
        search_keys(&ctx).is_empty(),
        "no module was listed, so nothing was searched: {:?}",
        search_keys(&ctx)
    );
    let docviews = docview_keys(&ctx);
    assert_eq!(
        docviews.first(),
        Some(&key_of(id, FILES_READ_FILE)),
        "the listed function's own view leads the documentation band: {docviews:?}"
    );
    assert_eq!(placed, docviews.len());
    assert_eq!(
        programs(&ctx),
        vec![crate::sandbox::language(id).bootstrap_program(&[], &[&key_of(id, FILES_READ_FILE)])],
        "the program opens the one function and searches nothing"
    );
}

/// **A module is listed without any of its functions being opened.** The other half of the same
/// independence: a listing alone leaves one search view and no documentation view.
#[tokio::test]
async fn a_module_is_listed_without_any_function_opened() {
    let id = GgProgramLanguage::TypeScript;
    let (capabilities, operations) = grant();
    let opening = opening(&["files"], &[]);
    let (ctx, placed) = seed_granted(id, &opening, &capabilities, &operations).await;
    let (placed, dropped) = seeded_views(placed.expect("one listing is a program"));
    assert!(dropped.is_empty(), "{dropped:?}");
    assert_eq!(search_keys(&ctx), vec![path_of(id, "files")]);
    assert!(
        docview_keys(&ctx).is_empty(),
        "no function was listed, so none was opened: {:?}",
        docview_keys(&ctx)
    );
    assert_eq!(placed, 1);
}

/// **Both lists empty seeds nothing at all** — no program, no acknowledgement, no view — and that is
/// `Ok`: an operator who wants a model to open on the build prompt alone has said so.
#[tokio::test]
async fn an_empty_opening_turn_seeds_no_program() {
    let (capabilities, operations) = grant();
    let (ctx, placed) = seed_granted(
        GgProgramLanguage::TypeScript,
        &opening(&[], &[]),
        &capabilities,
        &operations,
    )
    .await;
    assert_eq!(
        placed,
        Ok(Bootstrap::Empty {
            dropped: Vec::new()
        })
    );
    assert!(
        ctx.items().is_empty(),
        "an empty opening turn leaves the window exactly as it found it: {:?}",
        ctx.items().len()
    );
}

/// **Two lists that come out empty after dropping seed nothing either** — and still report every
/// entry they dropped, because a window that was *meant* to open on something is the case an
/// operator most needs to be told about.
#[tokio::test]
async fn an_opening_turn_emptied_by_dropping_seeds_nothing_and_reports_every_drop() {
    let capabilities = vec![CAPABILITY_READ_FILE.to_string()];
    let operations = capability_operations(capabilities.iter().map(String::as_str));
    let (ctx, placed) = seed_granted(
        GgProgramLanguage::TypeScript,
        &opening(&["board", "shell"], &["board.create_issue"]),
        &capabilities,
        &operations,
    )
    .await;
    assert_eq!(
        placed,
        Ok(Bootstrap::Empty {
            dropped: vec![
                Dropped::Module("board".to_string()),
                Dropped::Module("shell".to_string()),
                Dropped::Function("board.create_issue".to_string()),
            ]
        }),
        "every entry is dropped, in document order, modules first"
    );
    assert!(ctx.items().is_empty());
}

/// **Duplicates are opened once, silently**: a module listed twice is searched once and a function
/// named twice is opened once, and neither is a drop.
#[tokio::test]
async fn duplicate_entries_are_opened_once() {
    let id = GgProgramLanguage::TypeScript;
    let (capabilities, operations) = grant();
    let twice = opening(
        &["files", "files"],
        &[&DOCS_SEARCH.to_string(), &DOCS_SEARCH.to_string()],
    );
    let once = opening(&["files"], &[&DOCS_SEARCH.to_string()]);
    let (ctx, placed) = seed_granted(id, &twice, &capabilities, &operations).await;
    let (_, dropped) = seeded_views(placed.expect("the doubled opening turn runs"));
    assert!(dropped.is_empty(), "a duplicate is not a drop: {dropped:?}");
    assert_eq!(search_keys(&ctx), vec![path_of(id, "files")]);
    assert_eq!(
        docview_keys(&ctx)
            .iter()
            .filter(|key| **key == key_of(id, DOCS_SEARCH))
            .count(),
        1
    );
    let (single, placed) = seed_granted(id, &once, &capabilities, &operations).await;
    placed.expect("the single opening turn runs");
    assert_eq!(
        programs(&ctx),
        programs(&single),
        "the doubled document and the single one are one program"
    );
}

/// **Order is the document's.** The modules are searched together in the order written — the
/// listing's key is the paths in that order — and the functions are opened in the order written.
#[tokio::test]
async fn entries_are_taken_in_the_order_written() {
    let id = GgProgramLanguage::TypeScript;
    let (capabilities, operations) = grant();
    let reversed = opening(
        &["shell", "files"],
        &[&VIEWS_OPEN_TEXT.to_string(), &DOCS_SEARCH.to_string()],
    );
    let (ctx, placed) = seed_granted(id, &reversed, &capabilities, &operations).await;
    seeded_views(placed.expect("the reordered opening turn runs"));
    assert_eq!(
        search_keys(&ctx),
        vec![format!(
            "{}, {}",
            path_of(id, "shell"),
            path_of(id, "files")
        )],
        "one listing, keyed by the paths in the order the profile wrote the ids"
    );
    let docviews = docview_keys(&ctx);
    let open_text = docviews
        .iter()
        .position(|key| *key == key_of(id, VIEWS_OPEN_TEXT))
        .expect("the text view's documentation is open");
    let search = docviews
        .iter()
        .position(|key| *key == key_of(id, DOCS_SEARCH))
        .expect("the search's documentation is open");
    assert!(
        open_text < search,
        "the functions are opened in the order written: {docviews:?}"
    );
}

/// **The default opening turn is in gg's vocabulary**, and every function on it is one a
/// configuration can promise: bound by a capability or by every program, never by role or placement.
///
/// The list is written by hand in `core`, and a module id no operation is namespaced on, or an
/// operation id gg has no row for, would be a default every fresh profile refused the launch over.
#[test]
fn the_default_opening_turn_is_in_ggs_vocabulary() {
    for module in DEFAULT_OPENING_MODULES {
        assert!(
            family_of_module(module).is_some(),
            "the default lists `{module}`, which no gg operation is namespaced on"
        );
    }
    for id in DEFAULT_OPENING_FUNCTIONS {
        let row = crate::sandbox::operation_by_id(id)
            .unwrap_or_else(|| panic!("the default opens `{id}`, which gg has no operation for"));
        assert!(
            matches!(row.binding, Binding::Capability(_) | Binding::Always),
            "the default opens `{id}`, which is held by role or placement rather than configuration"
        );
        assert!(operation(row.id).is_some());
    }
    assert_eq!(GgAgentConfig::root().opening_turn, GgOpeningTurn::seeded());
    crate::validate::validate_capability_set(&GgCapabilitySet::minimal("mock/primary"))
        .expect("a fresh profile's opening turn launches");
}

/// The launch defects a set whose root opens on `opening` is refused over, by locus.
fn refused(opening: GgOpeningTurn) -> Vec<(String, String)> {
    let mut set = GgCapabilitySet::minimal("mock/primary");
    set.agents[0].opening_turn = opening;
    match crate::validate::validate_capability_set(&set) {
        Ok(()) => Vec::new(),
        Err(defects) => defects
            .into_iter()
            .map(|defect| (defect.locus, defect.message))
            .collect(),
    }
}

/// **An entry gg has no vocabulary for refuses the launch**, at its own locus, with the other
/// surface's spelling named where that is what was written — on exactly the allowlists' terms.
#[test]
fn an_entry_outside_ggs_vocabulary_refuses_the_launch() {
    let defects = refused(opening(
        &["files", "fs", "files.read_file"],
        &["docs.search", "read_file", "files", "files.raed_file"],
    ));
    let loci: Vec<&str> = defects.iter().map(|(locus, _)| locus.as_str()).collect();
    assert_eq!(
        loci,
        vec![
            "openingTurn.modules[1]",
            "openingTurn.modules[2]",
            "openingTurn.functions[1]",
            "openingTurn.functions[2]",
            "openingTurn.functions[3]",
        ],
        "every bad entry is named once, at its index, and the good ones are not: {defects:?}"
    );
    let message = |locus: &str| -> &str {
        &defects
            .iter()
            .find(|(at, _)| at == locus)
            .expect("reported")
            .1
    };
    assert!(message("openingTurn.modules[1]").contains("is not a gg module"));
    assert!(
        message("openingTurn.modules[2]").contains("operation id"),
        "an operation id in the module list is pointed at the function list: {}",
        message("openingTurn.modules[2]")
    );
    assert!(
        message("openingTurn.functions[1]").contains("tool name"),
        "a tool name is named as one: {}",
        message("openingTurn.functions[1]")
    );
    assert!(
        message("openingTurn.functions[2]").contains("module id"),
        "a module id in the function list is pointed at the module list: {}",
        message("openingTurn.functions[2]")
    );
    assert!(message("openingTurn.functions[3]").contains("is not a gg operation"));
}

/// **A function held by role or placement refuses the launch**: an ending call is the dispatched
/// role's, the machine transition is the machine's, and no profile can promise its window opens on
/// either.
#[test]
fn a_function_held_by_role_or_placement_refuses_the_launch() {
    let defects = refused(opening(
        &[],
        &[
            &SESSION_FINISH.to_string(),
            &DELEGATION_TRANSITION_STATE.to_string(),
        ],
    ));
    assert_eq!(defects.len(), 2, "{defects:?}");
    assert_eq!(defects[0].0, "openingTurn.functions[0]");
    assert!(
        defects[0].1.contains("held by the role"),
        "{}",
        defects[0].1
    );
    assert_eq!(defects[1].0, "openingTurn.functions[1]");
    assert!(
        defects[1].1.contains("held by the machine"),
        "{}",
        defects[1].1
    );
}

/// **An entry this agent does not hold is not a refusal.** A module none of whose functions the
/// profile's capabilities buy, and a function its capabilities do not offer, both launch — the
/// shared-document case — and are dropped at seed time instead.
#[test]
fn an_entry_the_agent_does_not_hold_launches() {
    assert!(
        refused(opening(&["board", "memories"], &["board.create_issue"])).is_empty(),
        "a real module and a real operation the minimal profile does not hold launch"
    );
}
