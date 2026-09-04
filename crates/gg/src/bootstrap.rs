//! The **synthesized opening turn** a [code-mode](crate::context::ContextModel::code_mode) agent's
//! session starts with: one program, written by gg in the agent's own language and actually run,
//! that lists the modules the agent's [opening turn](GgOpeningTurn) configuration names and opens
//! the documentation of the functions it names — plus the views those calls placed.
//!
//! # Why anything is seeded at all
//!
//! Because the [prompt](crate::prompts) names no function. It says what each capability is and which
//! [module](crate::prompts::ModuleView) it lives in, and stops — so a model's first act has to be to
//! *find* a call, and the calls that find one are themselves calls it has not been told. Left alone
//! that is a fixed point: an agent that cannot look anything up cannot look up how to look things
//! up. The bootstrap breaks it, and it is the only thing that does.
//!
//! # Why a program that runs, rather than a paragraph or a pretence
//!
//! A paragraph in the prompt naming the two calls would break the rule the prompt exists under: a
//! sentence a model reads lives in a template, and the one template gg now renders is
//! **language-agnostic** — it cannot spell a call, because the spelling is the arm's. The mechanism
//! gg already ships for this — the same one [autoload](crate::agent) and
//! [persistence](crate::persistence::restore_file_views) use — puts a **reply the agent could have
//! sent** into its own transcript, and a model reads its own transcript as the example of what a
//! well-formed turn looks like.
//!
//! What is new is that the reply is not a pretence. The program is [prepared](prepared_program) and
//! [run](crate::sandbox::run_prepared_program) exactly as a model's own program is, against this
//! agent's real scope, and the views beside it are the ones **its own calls placed**. Two things
//! follow, and both are the point: the first program in the window provably compiles and runs in
//! that arm's language, and gg cannot tell a model it opened something it did not.
//!
//! # What it carries: the agent's own two lists
//!
//! **gg decides neither list.** What a window opens on is per-agent configuration —
//! [`GgAgentConfig::opening_turn`](test_cabinet_core::gg::GgAgentConfig::opening_turn) — and the
//! bootstrap reads it and nothing else. The `modules` are gg's cross-arm module ids, searched
//! **together in one search** — a directory listing, ordered alphabetically by key — and left
//! as one listing view keyed by the paths [`module_paths`](crate::agent::module_paths) publishes
//! into the prompt, in the order written; the `functions` are
//! operation ids, each opened as a documentation view in the order written. The two lists are
//! independent: a function's documentation is opened whether or not its module is listed. The only
//! defaults gg holds are the ones a *fresh* profile is authored with
//! ([`DEFAULT_OPENING_MODULES`](test_cabinet_core::gg::DEFAULT_OPENING_MODULES),
//! [`DEFAULT_OPENING_FUNCTIONS`](test_cabinet_core::gg::DEFAULT_OPENING_FUNCTIONS)), and those are
//! read by the console seeding a document, never by this module.
//!
//! **Held is the whole test.** A function is held exactly when [`DocsRuntime::bound`] says so for
//! this agent — the same predicate every other reader of "may this agent call X" asks — and a module
//! is held when at least one of its functions is. An entry in the right vocabulary that this agent
//! does not hold is **dropped**, one [`warn`](Dropped) line each, because one shared document
//! naming a call only some of the profiles it describes enable is the ordinary way a sweep is
//! written; an entry in no vocabulary at all, or a function held by role or placement rather than by
//! configuration, refused the launch before this ran (`check_opening_turn` in [`crate::agent`]).
//! Duplicates are opened once, silently. Nothing is required: a document may leave both lists
//! empty, and an agent whose two lists come out empty after dropping is seeded **no program at all**
//! ([`Bootstrap::Empty`]) — that is an operator's choice, not a defect.
//!
//! # Where it sits, and why it survives
//!
//! It is seeded once, on a fresh window, immediately after the build prompt and before every other
//! opening step — the opening hooks' notes, the autoloaded specifications and a persistent agent's
//! restored desk all land after it. Three reasons, in order:
//!
//! 1. **The transcript reads in the order the work happened.** The first thing in the window after
//!    the task is the agent equipping itself to read documentation; everything the run pre-loads
//!    comes after, as material it then has the vocabulary to work with.
//! 2. **The documentation band is append-only** ([`open_docview`](crate::context::ContextModel::open_docview)),
//!    so whatever is opened first stays first for the life of the session. Seeding here puts these
//!    at the head of that band, where they are part of the prefix a provider caches rather than
//!    something that shifts every other documentation view down.
//! 3. **A persistent agent's restore is idempotent against it.** [`restore_docviews`](crate::persistence::restore_docviews)
//!    re-opens the keys the last instance held, and a re-open of an open key under the page already
//!    there is a no-op — so running the bootstrap first means the restored set folds into it rather
//!    than duplicating it.
//!
//! **The documentation views** survive the two boundaries the way every documentation view
//! does, and for the same reason: a docview's body is a pure function of its key, so a
//! [compaction](crate::compaction) re-derives it ([`restore_docviews`](crate::compaction::restore_docviews))
//! and [persistence](crate::persistence) records the key alone.
//!
//! **The module listings do not, and neither does the program.** Both are ordinary
//! [ephemeral](crate::context::Retention::Ephemeral) history — a listing is a
//! [search view](crate::context::ContextModel::open_search_view), and nothing re-derives the search
//! band across a compaction — so a compacted window keeps the docviews and loses the surface they
//! were opened beside. That is deliberate on both counts, and it is the same argument twice. This
//! turn's job is to get an agent from a prompt that names no function to a model that can find one,
//! and it has done that job by the time a window is full: the model has written a hundred better
//! programs than gg's, and has opened documentation views of the calls it actually uses. The ones
//! that survive are the ones it needs to find any of the rest again, and to show itself what it
//! finds — which is what makes losing the listings a cost rather than a trap.
//!
//! A **carried** window — an `exec` successor or a `fork` that kept its history — is not re-seeded,
//! on the same terms as every other opening step: it already holds these views, and pushing a second
//! copy of the program into the middle of a live thread would read as the agent having repeated
//! itself.
//!
//! # A failure here is gg's, and it refuses the run
//!
//! Everything in here is fallible, and every failure is internal. gg wrote the program, gg granted
//! the scope it runs under and gg implements every call it makes, so a program that does not
//! prepare, a sandbox that will not run it, a call it makes that is refused, a call it makes that
//! this api does not implement, or a run that placed no views at all is a **defect in gg** — not a
//! thinner opening turn to carry on from. Each is an `Err` out of [`seed_bootstrap`], which the
//! [loop](crate::agent) routes into `setup_broke`: the operator is told, the run's
//! [fault latch](crate::fault) is raised, and the run ends as an internal error rather than a model
//! failure. A window whose model was never handed its surface would produce a tree indistinguishable
//! from one whose model had it and ignored it.
//!
//! # It is not a turn
//!
//! It runs before the loop, so it consumes no turn index — and it takes none of the accounting a
//! turn takes. There is no model call here, so there is no usage, no cost and no reply to record:
//! nothing here begins a turn, records one, times one, files the program in the
//! [library](crate::programs), touches the [loop guard](crate::loopguard), or emits a
//! `TurnStarted`/`TurnOutcome`/`TurnTiming`/`CodeExecution` event. The program's calls are gg's
//! own, which is also why [`BootstrapApi`] brackets none of them onto the API-call telemetry: an
//! agent's surface record must report what the *model* reached for.

use std::collections::BTreeMap;
use std::fmt;
use std::hash::{Hash, Hasher};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use test_cabinet_core::gg::{GgCallFailure, GgOpeningTurn, GgProgramLanguage};

use crate::board::IssueStatus;
use crate::context::{ContextModel, DocviewOpen, SEARCH_RESULTS_VIEW, TurnRange, ViewKind};
use crate::discovery::CallDiscovery;
use crate::docs::{DocQuery, DocViewTypes, DocsRuntime};
use crate::ending::EndingRole;
use crate::memories::MemoryCode;
use crate::programs::{ProgramRefusal, ProgramSummary};
use crate::sandbox::signatures::CatalogueFunction;
use crate::sandbox::{
    ApiIdentity, DocSearchQuery, DocSearchResult, FILES_TREE, OperationApi, OperationId,
    PreparedProgram, ProgramLanguage, ProgramScope, RunEnding, SandboxLimits, SandboxOutcome,
    SandboxViewOpened, ViewOpenOutcome, ViewRefusal, catalogue_functions, catalogue_modules,
    operation_by_id, operation_of,
};
use crate::tasks::TaskStatus;
use crate::tools::{ToolContext, ToolFailure, ToolOutcome, TreeTool};

/// The deterministic id of the bootstrap's synthesized `submit_program` call — a shape the turn
/// loop never mints, so the opening turn cannot collide with a real call's id.
const BOOTSTRAP_CALL_ID: &str = "bootstrap-program";

/// Everything about **this agent** the bootstrap program has to run as: what its window should open
/// on, what it was granted, what its programs run under, and what an `openDocsView` of a function
/// opens beside it.
///
/// One value rather than six parameters because it is one thing — *the agent gg is standing up* —
/// and because every field of it is read straight off what the loop already resolved for this
/// instance. Nothing here is re-derived from the profile: a second reading would be a second answer,
/// and a bootstrap running under a wider grant than the membrane will service is a program gg wrote
/// and gg then refuses.
pub(crate) struct BootstrapAgent<'a> {
    /// The two lists and the tree this agent's window opens on, exactly as its profile wrote them.
    pub opening_turn: &'a GgOpeningTurn,
    /// Where this agent's calls are rooted, as the loop already resolved it — the workspace the
    /// opening tree is walked from.
    pub tool_ctx: &'a ToolContext,
    /// The gg capability ids this agent holds, as the loop resolved them.
    pub capabilities: &'a [String],
    /// The operations its allowlist names within those capabilities.
    pub operations: &'a [OperationId],
    /// Which ending calls it may declare. The bootstrap program declares none — but the scope it
    /// runs under is the agent's own, so what the membrane would accept is the agent's own too.
    pub role: EndingRole,
    /// The execution timeout and memory ceiling one of this agent's programs runs under.
    pub limits: SandboxLimits,
    /// Which SDK types an [`open_docs_view`](OperationApi::open_docs_view) places beside the function it
    /// was asked for, this agent's resolved [`DocViewTypes`] — read here for the same reason the
    /// loop's own api reads it, since these are the views the model will open the session holding.
    pub doc_view_types: DocViewTypes,
}

/// One entry of an agent's [opening turn](GgOpeningTurn) that was **dropped** at seed time: in gg's
/// vocabulary, but not held by this agent, so the program was written without it.
///
/// Carried back to the loop rather than logged here because the bootstrap holds no emitter — it is
/// not a turn and records nothing itself — and the loop is where every other line about how a
/// window was opened is written. [`Display`](fmt::Display) is the `warn` line, and it names the
/// entry and the reason, because an operator reading a run whose window lacks a module they listed
/// needs to be told which document line went unhonoured and why that is not a refusal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Dropped {
    /// A module id this agent holds no function of on this arm.
    Module(String),
    /// An operation id this agent does not hold, or that this arm does not catalogue.
    Function(String),
    /// A workspace tree this agent's opening turn asked for and this agent may not walk.
    Tree,
}

impl fmt::Display for Dropped {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Module(id) => write!(
                f,
                "`{id}` is listed in this agent's opening turn but the agent holds no function of \
                 it, so it is not listed"
            ),
            Self::Function(id) => write!(
                f,
                "`{id}` is listed in this agent's opening turn but the agent does not hold it, so \
                 its documentation is not opened"
            ),
            Self::Tree => write!(
                f,
                "this agent's opening turn asks for a workspace tree but the agent does not hold \
                 `files.tree`, so no tree is opened"
            ),
        }
    }
}

/// What [`seed_bootstrap`] did to the window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Bootstrap {
    /// The window is not in code mode, so there was no program to put in its mouth. Nothing was
    /// resolved and nothing was placed.
    NotCodeMode,
    /// Both of the agent's lists were empty once the entries it does not hold were dropped, so no
    /// program was seeded: the window opens on the build prompt alone. An operator's choice, and
    /// `Ok` — but the dropped entries are still reported, since a window that was *meant* to open on
    /// something is the case this most needs to be legible in.
    Empty { dropped: Vec<Dropped> },
    /// The program ran and placed `placed` views — the one search view covering the listed modules,
    /// where any were, plus one documentation view per opened function and its types. Never `0`: a
    /// program that ran and placed nothing is an [`Err`] out of [`seed_bootstrap`], because a model
    /// whose opening turn shows a program beside an empty window has been taught that opening a
    /// view sometimes silently does nothing, which is the one lesson this turn must not carry.
    Seeded {
        placed: usize,
        dropped: Vec<Dropped>,
    },
}

impl Bootstrap {
    /// The entries dropped on the way to whatever was seeded, for the loop's `warn` lines.
    pub(crate) fn dropped(&self) -> &[Dropped] {
        match self {
            Self::NotCodeMode => &[],
            Self::Empty { dropped } | Self::Seeded { dropped, .. } => dropped,
        }
    }
}

/// An agent's [opening turn](GgOpeningTurn) resolved against what it actually holds on its arm:
/// the module **paths** the program searches, the documentation **keys** it opens, and the entries
/// it was written without.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedOpeningTurn {
    /// The paths of the listed modules this agent holds, in the order the profile listed them —
    /// spelled as the prompt spells them, because a listing keyed by an id the model never saw would
    /// be a view it could not match to anything.
    pub modules: Vec<String>,
    /// This arm's fully-qualified name for each listed function the agent holds, in the order the
    /// profile listed them, each once.
    pub keys: Vec<String>,
    /// The depth the program walks the workspace to, where this agent asked for a tree and holds
    /// the call to walk one.
    pub tree: Option<u32>,
    /// Every entry in gg's vocabulary that this agent does not hold, in document order.
    pub dropped: Vec<Dropped>,
}

impl ResolvedOpeningTurn {
    /// Whether there is nothing left to seed.
    pub(crate) fn is_empty(&self) -> bool {
        self.modules.is_empty() && self.keys.is_empty() && self.tree.is_none()
    }
}

/// Resolve `opening` for the agent `docs` answers for: which of its modules and functions this
/// agent holds, by the names this arm files them under.
///
/// **The fully-qualified name** is the key the catalogue advertises, the key search files a hit
/// under, and the only spelling that two modules each offering a `close` could not both claim. A
/// function is resolved by the **operation** its entry names rather than by an arm's spelling,
/// because the operation id is gg's own identity for a call and a spelling is one of eleven; the
/// held test is [`DocsRuntime::bound`], the one implementation of "may this agent call X".
///
/// A module is held when the prompt names it — [`module_paths`](crate::agent::module_paths) is the
/// very list the prompt publishes, so the listing the window opens on cannot name a module the
/// prompt did not, or miss one it did — and the catalogue is what joins gg's id to that arm's path,
/// which is where every other cross-arm join in gg is made. A module id on no catalogue module of
/// this arm, or whose path the prompt does not carry, is dropped on the same terms as a function.
///
/// Entries in no vocabulary at all cannot reach here from a launched profile (`check_opening_turn`
/// refused them); one that does anyway is dropped like the rest rather than taking the run down,
/// because this runs on every window and a refusal belongs to the launch.
pub(crate) fn resolve_opening_turn(
    docs: &DocsRuntime,
    opening: &GgOpeningTurn,
    capabilities: &[String],
    operations: &[OperationId],
    role: EndingRole,
) -> ResolvedOpeningTurn {
    let language = docs.language();
    let held_paths = crate::agent::module_paths(capabilities, operations, role, language.id());
    let catalogue = catalogue_modules(language);
    let mut dropped = Vec::new();

    let mut modules: Vec<String> = Vec::new();
    for id in &opening.modules {
        let path = catalogue
            .iter()
            .find(|module| module.id == id)
            .map(|module| module.path.to_string())
            .filter(|path| held_paths.contains(path));
        match path {
            Some(path) if modules.contains(&path) => {}
            Some(path) => modules.push(path),
            None => dropped.push(Dropped::Module(id.clone())),
        }
    }

    let functions = catalogue_functions(language);
    let mut keys: Vec<String> = Vec::new();
    for id in &opening.functions {
        let key = operation_by_id(id).and_then(|operation| {
            bootstrap_function(&functions, operation.id, |function| docs.bound(function))
                .map(|function| function.fqn.to_string())
        });
        match key {
            Some(key) if keys.contains(&key) => {}
            Some(key) => keys.push(key),
            None => dropped.push(Dropped::Function(id.clone())),
        }
    }

    // The tree is held on exactly the terms a listed function is: `DocsRuntime::bound`, asked about
    // the entry this arm catalogues for `files.tree`.
    let tree = match opening.tree.include {
        false => None,
        true => match bootstrap_function(&functions, FILES_TREE, |function| docs.bound(function)) {
            Some(_) => Some(opening.tree.depth),
            None => {
                dropped.push(Dropped::Tree);
                None
            }
        },
    };

    ResolvedOpeningTurn {
        modules,
        keys,
        tree,
        dropped,
    }
}

/// Seed `context` with the bootstrap turn: the program gg wrote on this agent's behalf from its
/// [opening turn](GgOpeningTurn), run, and the views its own calls placed.
///
/// Returns what happened ([`Bootstrap`]) — including the entries dropped for not being held, so the
/// loop can say so — or the sentence naming the gg defect that stopped it.
///
/// # Why the window and the documentation runtime are moved through
///
/// The program's calls act on the live window from a `spawn_blocking` thread, so the window and the
/// runtime that answers its lookups travel **by value** into [`BootstrapApi`] and are handed back
/// when it returns — exactly as a [code turn](crate::agent) moves them into its own api. `context`
/// is [vacated](ContextModel::take) and the runtime is replaced by an empty one for the duration;
/// nothing reads either in the meantime, and on the one path they cannot come back — the blocking
/// task itself failed — the run ends without reading them again.
pub(crate) async fn seed_bootstrap(
    context: &mut ContextModel,
    docs: &mut DocsRuntime,
    programs: &mut crate::programs::ProgramLibrary,
    agent: BootstrapAgent<'_>,
) -> Result<Bootstrap, String> {
    if !context.code_mode() {
        return Ok(Bootstrap::NotCodeMode);
    }
    let language = docs.language();
    let resolved = resolve_opening_turn(
        docs,
        agent.opening_turn,
        agent.capabilities,
        agent.operations,
        agent.role,
    );
    if resolved.is_empty() {
        return Ok(Bootstrap::Empty {
            dropped: resolved.dropped,
        });
    }
    let source = language.bootstrap_program(
        &resolved
            .modules
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        &resolved.keys.iter().map(String::as_str).collect::<Vec<_>>(),
        resolved.tree,
    );

    // Pushed **before** the program runs, so the window reads in the order the work happened: the
    // submission, its acknowledgement, and then what the program's own calls placed. The turn is
    // shaped exactly as the model's own must be — a `submit_program` call answered by a `tool`
    // result — so the first example of its own output a model reads is one in the protocol's
    // shape.
    //
    // Acknowledged the way the model's own submissions are: with the id the program library issued
    // it, under which it is kept — as one of gg's opening programs, on turn 0 — once it has run. A
    // library the agent does not keep issues nothing, and the acknowledgement is the fixed word.
    let id = programs.issue_id().map_err(|exhausted| exhausted.message)?;
    context.push_assistant(
        None,
        vec![crate::completion::synthesized_submission(
            BOOTSTRAP_CALL_ID,
            &source,
        )],
    );
    context.push_tool_result(
        test_cabinet_core::gg::GgContextSource::ToolOutput,
        BOOTSTRAP_CALL_ID,
        crate::completion::submit_program_ack(id.as_deref()),
    );

    // Owned copies of the grant: nothing borrowed from the caller survives the move onto the
    // blocking thread.
    let capabilities = agent.capabilities.to_vec();
    let operations = agent.operations.to_vec();
    let ending = RunEnding::Role(agent.role);
    let limits = agent.limits;
    let api = BootstrapApi {
        tool_ctx: agent.tool_ctx.clone(),
        context: context.take(),
        docs: std::mem::replace(
            docs,
            DocsRuntime::new(Vec::new(), agent.role, &[], language.id()),
        ),
        doc_view_types: agent.doc_view_types,
        unimplemented: Vec::new(),
    };

    // The program's text stays with the caller too: it is what the library records once it has run.
    let program = source.clone();
    let ran = tokio::task::spawn_blocking(move || match prepared_program(language, &program) {
        Err(detail) => (Err(detail), api),
        Ok(prepared) => {
            let (outcome, api) = crate::sandbox::run_prepared_program(
                language,
                prepared,
                ProgramScope {
                    capabilities: &capabilities,
                    operations: &operations,
                    // The bootstrap binds no `lib`: it calls gg's own surface and nothing else, and
                    // a code module here would be a skill's code compiled into a program the model
                    // never wrote.
                    modules: &[],
                    ending,
                },
                limits,
                // No deadline. This is the run standing itself up rather than a turn spending its
                // budget, and the program's own execution timeout already bounds it.
                None,
                api,
            );
            (Ok(outcome), api)
        }
    })
    .await;

    let (outcome, api) = match ran {
        Ok(ran) => ran,
        // The blocking task itself failed, so the window and the runtime are gone with it. The
        // caller ends the run here and never reads either again.
        Err(error) => return Err(format!("gg's bootstrap program could not be run: {error}")),
    };
    // Handed back before the verdict is read, so the window holding the program gg pushed is the
    // window the caller ends the run over — a failure here is reported *about* an agent whose
    // opening context is intact enough to read.
    *context = api.context;
    *docs = api.docs;
    let placed = placed_views(outcome?, &api.unimplemented, language)?;
    if let Some(id) = &id {
        programs.record(id, 0, &source, true, None);
    }
    Ok(Bootstrap::Seeded {
        placed,
        dropped: resolved.dropped,
    })
}

/// What the bootstrap's run amounts to: the number of views it placed, or the sentence naming the
/// gg defect that stopped it.
///
/// Every arm of this is a failure of **gg's own machinery**, which is why none of them is fed back
/// to anybody: the program is gg's, the scope is the one gg resolved for this agent, and the api
/// under it is [`BootstrapApi`]. See the [module docs](self#a-failure-here-is-ggs-and-it-refuses-the-run).
fn placed_views(
    outcome: SandboxOutcome,
    unimplemented: &[&'static str],
    language: &'static dyn ProgramLanguage,
) -> Result<usize, String> {
    let arm = language.display_name();
    if let Err(error) = &outcome.result {
        return Err(format!("gg's {arm} bootstrap program did not run: {error}"));
    }
    if let Ok(result) = &outcome.result
        && let Some(error) = &result.error
    {
        return Err(format!(
            "gg's {arm} bootstrap program failed while it ran: {}",
            error.message
        ));
    }
    if let Some(refusal) = outcome.refusals.first() {
        return Err(format!(
            "gg's {arm} bootstrap program called `{}`, which this agent's grant refuses: {}",
            refusal.name, refusal.message
        ));
    }
    if let Some(refusal) = outcome.view_refusals.first() {
        return Err(format!(
            "gg's {arm} bootstrap program was refused a view it asked for: {refusal}"
        ));
    }
    if let Some(call) = unimplemented.first() {
        return Err(format!(
            "gg's {arm} bootstrap program called `{call}`, which the bootstrap api does not \
             implement"
        ));
    }
    if outcome.views_opened.is_empty() {
        return Err(format!(
            "gg's {arm} bootstrap program ran and placed no views, so this agent would open on a \
             program with nothing beside it"
        ));
    }
    Ok(outcome.views_opened.len())
}

/// The catalogue entry an arm binds `call` under — its canonical spelling, never an alias — where
/// `held` says the agent may call it, or `None` where the arm does not catalogue it or the agent
/// does not hold it.
pub(crate) fn bootstrap_function(
    functions: &[CatalogueFunction],
    call: OperationId,
    held: impl Fn(&CatalogueFunction) -> bool,
) -> Option<&CatalogueFunction> {
    functions.iter().find(|function| {
        function.alias_of.is_none()
            && operation_of(function).is_some_and(|operation| operation.id == call)
            && held(function)
    })
}

// ---------------------------------------------------------------------------
// The prepared-program cache
// ---------------------------------------------------------------------------

/// Every bootstrap program this process has already prepared, by `(language, source hash)`.
///
/// # Why a cache here, and why this is not the cross-program caching that is forbidden
///
/// A compiled arm invokes a **real toolchain** per preparation — seconds of `swiftc`, `rustc` or a
/// warm JVM — and a run with a dozen agents on one arm would otherwise pay a dozen identical
/// compiles before any of them took a turn. The bootstrap program is the one program in gg whose
/// source is a pure function of `(language, module set, docview keys)`, so those preparations are
/// identical by construction rather than by luck.
///
/// Keying on the **source** is what keeps this from being the cross-program caching
/// [`PreparedProgram::component`]'s doc comment correctly forbids: two different programs never
/// share an entry, because two different sources never hash to one key. What is reused is one
/// program's own artifact, for a second agent that would have compiled the same bytes.
///
/// Consulted by nothing but the bootstrap. A model's program is different every turn, so a cache in
/// front of *that* preparation would be a map that only ever grows.
static PREPARED: LazyLock<Mutex<BTreeMap<(GgProgramLanguage, u64), PreparedProgram>>> =
    LazyLock::new(Mutex::default);

/// `source` prepared for `language`'s guest, from [the cache](PREPARED) when this process has
/// already prepared it.
///
/// The lock is never held across the preparation itself: a miss releases it, compiles, and inserts.
/// Two agents starting at once may therefore both compile the first one, which costs one duplicated
/// compile and avoids every other agent in the run queueing behind one lock for the length of a
/// `swiftc` invocation.
fn prepared_program(
    language: &'static dyn ProgramLanguage,
    source: &str,
) -> Result<PreparedProgram, String> {
    let key = (language.id(), source_hash(source));
    if let Some(prepared) = PREPARED
        .lock()
        .expect("the bootstrap program cache holds no lock across a panic")
        .get(&key)
    {
        return Ok(prepared.clone());
    }
    // A compile workspace of its own, dropped with this call. gg's own bootstrap component belongs
    // to no agent — it is compiled once per process and cached here for every agent that needs it —
    // so compiling it in some agent's tree would put one agent's ground under another's program.
    let workspace = crate::sandbox::AgentWorkspace::new();
    let prepared =
        crate::sandbox::prepare_program(language, source, &[], &workspace).map_err(|failure| {
            format!(
                "gg's {} bootstrap program did not prepare: {failure}",
                language.display_name()
            )
        })?;
    PREPARED
        .lock()
        .expect("the bootstrap program cache holds no lock across a panic")
        .insert(key, prepared.clone());
    Ok(prepared)
}

/// The hash a prepared program is filed under. The default hasher, because the key is a cache key
/// and not a fingerprint anything trusts: a collision would have to be between two sources gg itself
/// generated for one language.
fn source_hash(source: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    source.hash(&mut hasher);
    hasher.finish()
}

// ---------------------------------------------------------------------------
// The api the bootstrap program runs against
// ---------------------------------------------------------------------------

/// The [`OperationApi`] the bootstrap program's calls reach: this agent's window and its documentation
/// runtime, and nothing else.
///
/// Two methods do real work — the search that lists a module and the open that places a
/// documentation view — because those are the only two calls gg's own program makes. Everything else
/// on the trait is [refused](Refusal) and **recorded**: gg authored the program, so a call arriving
/// at one of those bodies is not a model doing something unexpected, it is gg's program having
/// drifted from gg's api, and [`seed_bootstrap`] ends the run over it.
///
/// It holds the window and the runtime **by value** and hands them back, which is what the
/// [`Send + 'static`](OperationApi) bound on the trait requires: the sandbox runs on a blocking thread,
/// so nothing borrowed from the loop could cross into it.
struct BootstrapApi {
    /// Where this agent's calls are rooted. The one call the program makes that touches the disk —
    /// the workspace tree — is rooted here, so gg's own program walks exactly the tree the agent's
    /// own program would.
    tool_ctx: ToolContext,
    /// The agent's window. Every view this program opens lands in it directly.
    context: ContextModel,
    /// The agent's documentation runtime, which answers exactly what its own lookups will answer —
    /// so the listing it opens with is the surface it actually holds.
    docs: DocsRuntime,
    /// Which SDK types an [`open_docs_view`](OperationApi::open_docs_view) places beside a function.
    doc_view_types: DocViewTypes,
    /// The api methods this program reached that gg never wrote a call to. Empty on every healthy
    /// run; anything in it fails the run.
    unimplemented: Vec<&'static str>,
}

impl BootstrapApi {
    /// Record that `call` was reached and answer it with the class of refusal its return type has.
    ///
    /// The recording is the point. The refusal value exists only because the method has to return
    /// something — the run is over as soon as [`seed_bootstrap`] reads the list.
    fn refuse<T: Refusal>(&mut self, call: &'static str) -> T {
        self.unimplemented.push(call);
        T::refused(call)
    }
}

/// How one return type of the [`OperationApi`] surface says *the bootstrap api does not implement this*.
///
/// It exists so the forty-odd unreachable methods can be generated rather than hand-written. Every
/// implementation is a refusal in that type's own vocabulary: a classified failure where the type
/// carries one, an empty list where it carries none.
trait Refusal {
    /// The refusal for `call`, which is the api method's own name.
    fn refused(call: &str) -> Self;
}

/// What a refused call says. It reaches no model — the run ends before the next turn — so it is
/// written for the operator reading the log line that ends the run.
fn refusal_message(call: &str) -> String {
    format!("gg's bootstrap api does not implement `{call}`")
}

impl Refusal for ToolOutcome {
    fn refused(call: &str) -> Self {
        ToolOutcome::failed(ToolFailure::Refused, refusal_message(call))
    }
}

impl<T> Refusal for Result<T, ViewRefusal> {
    fn refused(call: &str) -> Self {
        Err(ViewRefusal {
            failure: ToolFailure::Refused,
            message: refusal_message(call),
        })
    }
}

impl Refusal for Result<String, ProgramRefusal> {
    fn refused(call: &str) -> Self {
        Err(ProgramRefusal {
            failure: ToolFailure::Refused,
            message: refusal_message(call),
        })
    }
}

impl<T> Refusal for Vec<T> {
    fn refused(_call: &str) -> Self {
        Vec::new()
    }
}

impl Refusal for ViewOpenOutcome {
    fn refused(call: &str) -> Self {
        ViewOpenOutcome {
            outcome: ToolOutcome::refused(call),
            opened: None,
        }
    }
}

/// Generate the body of every [`OperationApi`] method the bootstrap program never calls.
///
/// One line per method rather than forty hand-written bodies that would all say the same thing —
/// and, more usefully, a shape that makes an api method added to the trait a compile error here
/// until somebody decides which of the two lists it belongs on.
macro_rules! unimplemented_calls {
    ($($name:ident($($arg:ident: $ty:ty),* $(,)?) -> $ret:ty;)*) => {
        $(
            #[allow(clippy::too_many_arguments)]
            fn $name(&mut self $(, $arg: $ty)*) -> $ret {
                $(let _ = $arg;)*
                self.refuse(stringify!($name))
            }
        )*
    };
}

impl OperationApi for BootstrapApi {
    /// A no-op, on both halves of the bracket. This is gg standing the agent up, not the agent
    /// making a call, and an [`ApiCall`](test_cabinet_core::gg::GgTelemetryKind::ApiCall) recorded
    /// here would put two searches and an open into a model's own surface record before it had taken
    /// a turn — which is exactly the figure a comparison of two configurations reads.
    fn begin_api_call(&mut self, _call: ApiIdentity<'_>) {}

    /// The closing half of the same no-op. See [`begin_api_call`](Self::begin_api_call).
    fn end_api_call(&mut self, _call: ApiIdentity<'_>, _failure: Option<GgCallFailure>) {}

    /// Nothing here can be a [discovery](crate::discovery) violation, on the same ground the bracket
    /// above it records nothing: **gg wrote this program**. There is no model whose reading is in
    /// question, and the whole purpose of the two calls it makes is to put the documentation of
    /// discovery itself into a window that opens with none — which is necessarily done with nothing
    /// open.
    fn call_discovery(&mut self, _call: ApiIdentity<'_>) -> CallDiscovery {
        CallDiscovery::NotApplicable
    }

    /// Search the documentation surface and leave the page in the window as a search view **keyed by
    /// the modules it listed**.
    ///
    /// The selector is what keeps the opening listing out of the way of the model's own searching. A
    /// model's own search names a mutable intent and is keyed by [`SEARCH_RESULTS_VIEW`], so the
    /// next one replaces it; the bootstrap's listing is the surface the session opens holding, and
    /// keying it by the modules it lists means only a re-listing of exactly those supersedes it. See
    /// [`ContextModel::open_search_view`].
    ///
    /// The rendering is the loop's own, so what an agent reads in its opening window is byte for
    /// byte what it will read after its own first search.
    fn search_docs(&mut self, query: DocSearchQuery) -> Result<DocSearchResult, ViewRefusal> {
        let page = self.docs.search(DocQuery {
            query: &query.query,
            modules: &query.modules,
            declared_type: query.declared_type.as_deref(),
            kind: query.kind.as_deref(),
            offset: query.offset,
            limit: query.limit,
        })?;
        // The modules gg's own program named. The program makes this call only when its agent's
        // opening turn listed a module it holds, so the filter is never empty here; the constant is
        // what a search with no module filter means everywhere else in gg, so it is what an
        // unfiltered one would land under here too.
        let selector = match query.modules.is_empty() {
            true => SEARCH_RESULTS_VIEW.to_string(),
            false => query.modules.join(", "),
        };
        let opened = self.context.open_search_view(
            selector.clone(),
            crate::agent::code::render_search_results(&query, &page),
        );
        Ok(DocSearchResult {
            page,
            opened: SandboxViewOpened {
                kind: ViewKind::Search,
                selector,
                tokens: opened.tokens as u64,
                superseded: opened.superseded,
            },
        })
    }

    /// Open the documentation view for `name`, plus the SDK types this agent's
    /// [type flags](DocViewTypes) select — the loop's own algorithm, on the loop's own terms.
    ///
    /// It mirrors [`LoopOperationApi::open_docs_view`](crate::agent) deliberately rather than doing
    /// something simpler: these are the views the session opens holding, and a model that closed one
    /// and re-opened it must get back what it started with. One call, one level, and a key already
    /// open is a total no-op.
    ///
    /// A name that resolves to nothing is a [refusal](ViewRefusal) here as it is there — but it is
    /// also a gg defect, since [`resolve_opening_turn`] resolved every key gg's program names against
    /// this same runtime, so it is recorded like an unimplemented call and ends the run.
    fn open_docs_view(&mut self, name: String) -> Result<Vec<SandboxViewOpened>, ViewRefusal> {
        let Some((key, read)) = self
            .docs
            .docview_key(&name)
            .and_then(|key| Some((key.clone(), self.docs.read_any(&key)?)))
        else {
            return Err(ViewRefusal {
                failure: ToolFailure::NotFound,
                message: format!(
                    "gg's bootstrap program asked for the documentation of `{name}`, which this \
                     agent does not bind"
                ),
            });
        };
        // Under the resolved key and through the one renderer every documentation view is placed
        // through, so the opening turn opens exactly the pages an agent's own lookup would.
        let types = self.docs.types_to_open(&key, self.doc_view_types);
        let mut opened = Vec::new();
        if let DocviewOpen::Placed { tokens, superseded } =
            self.context.open_docview(key.clone(), read)
        {
            opened.push(SandboxViewOpened {
                kind: ViewKind::Docs,
                selector: key,
                tokens: tokens as u64,
                superseded,
            });
        }
        for referenced in types {
            let Some(body) = self.docs.read_any(&referenced) else {
                continue;
            };
            if let DocviewOpen::Placed { tokens, superseded } =
                self.context.open_docview(referenced.clone(), body)
            {
                opened.push(SandboxViewOpened {
                    kind: ViewKind::Docs,
                    selector: referenced,
                    tokens: tokens as u64,
                    superseded,
                });
            }
        }
        Ok(opened)
    }

    /// Walk the workspace — the third of the three calls gg's own program makes, and the only one
    /// that touches the disk.
    ///
    /// The tool's own implementation, rooted at the context the loop resolved for this agent, so the
    /// tree the window opens on is byte for byte the tree the agent's own `files.tree` would render.
    fn tree(&mut self, path: Option<String>, depth: Option<u32>) -> ToolOutcome {
        TreeTool.tree(&self.tool_ctx, path, depth)
    }

    /// Put the workspace tree in the window as a text view, under the label gg's program wrote.
    ///
    /// The loop's own [push](ContextModel::open_text_view) rather than a private one: a view the
    /// session opens holding must be the same kind of thing, under the same selector rules, as one
    /// the model's own program opens, or closing it would behave differently from closing any other.
    fn open_text_view(
        &mut self,
        label: String,
        body: String,
    ) -> Result<SandboxViewOpened, ViewRefusal> {
        let opened = self.context.open_text_view(label.clone(), body);
        Ok(SandboxViewOpened {
            kind: ViewKind::Text,
            selector: label,
            tokens: opened.tokens as u64,
            superseded: opened.superseded,
        })
    }

    unimplemented_calls! {
        shell(command: String, timeout: Duration) -> ToolOutcome;
        read_file(path: String, offset: Option<usize>, limit: Option<usize>) -> ToolOutcome;
        write_file(path: String, contents: String) -> ToolOutcome;
        edit_file(path: String, old_string: String, new_string: String) -> ToolOutcome;
        list_dir(path: Option<String>) -> ToolOutcome;
        search(query: String, path: Option<String>, limit: Option<u32>) -> ToolOutcome;
        read_skill(name: String) -> ToolOutcome;
        write_memory(
            name: String,
            description: String,
            body: String,
            code: MemoryCode,
        ) -> ToolOutcome;
        update_memory(
            name: String,
            description: String,
            body: String,
            code: MemoryCode,
        ) -> ToolOutcome;
        create_memory(
            name: String,
            description: String,
            contents: String,
            code: MemoryCode,
        ) -> ToolOutcome;
        read_memory(name: String) -> ToolOutcome;
        edit_memory(name: String, search: String, replace: String) -> ToolOutcome;
        search_memories(keywords: Vec<String>) -> ToolOutcome;
        delete_memory(name: String) -> ToolOutcome;
        add_task(
            id: String,
            title: String,
            description: Option<String>,
            blocked_by: Vec<String>,
        ) -> ToolOutcome;
        update_task(
            id: String,
            title: Option<String>,
            description: Option<String>,
            status: Option<TaskStatus>,
        ) -> ToolOutcome;
        set_blocked_by(id: String, blocked_by: Vec<String>) -> ToolOutcome;
        complete_task(id: String) -> ToolOutcome;
        remove_task(id: String) -> ToolOutcome;
        create_epic(prefix: String, title: String, description: String) -> ToolOutcome;
        create_issue(
            title: String,
            description: Option<String>,
            in_scope: String,
            out_of_scope: String,
            completion_criteria: String,
            blocked_by: Vec<String>,
            epic_id: Option<String>,
            agent: String,
            reviewers: Vec<String>,
        ) -> ToolOutcome;
        update_issue(
            id: String,
            title: Option<String>,
            description: Option<String>,
            in_scope: Option<String>,
            out_of_scope: Option<String>,
            completion_criteria: Option<String>,
            status: Option<IssueStatus>,
            epic_id: Option<String>,
        ) -> ToolOutcome;
        set_issue_blocked_by(id: String, blocked_by: Vec<String>) -> ToolOutcome;
        remove_epic(id: String) -> ToolOutcome;
        remove_issue(id: String) -> ToolOutcome;
        wait_for_issue(id: String) -> ToolOutcome;
        evict_file_view(path: Option<String>) -> ToolOutcome;
        archive_thread(ranges: Vec<TurnRange>) -> ToolOutcome;
        search_archive(query: String) -> ToolOutcome;
        compact(summary: String, files: Vec<String>) -> ToolOutcome;
        transition_state(state: String, note: Option<String>) -> ToolOutcome;
        exec(agent: String, prompt: Option<String>) -> ToolOutcome;
        fork(prompt: String) -> ToolOutcome;
        spawn_subagent(
            agent: String,
            prompt: Option<String>,
            issue_id: Option<String>,
        ) -> ToolOutcome;
        wait_for_subagents(ids: Option<Vec<String>>) -> ToolOutcome;
        send_message(agent_id: String, message: String) -> ToolOutcome;
        close_docviews(key: Option<String>) -> Result<u32, ViewRefusal>;
        open_file_view(
            path: String,
            offset: Option<usize>,
            limit: Option<usize>,
            max_line_chars: Option<usize>,
        ) -> ViewOpenOutcome;
        close_view(selector: String) -> Result<u32, ViewRefusal>;
        program_history() -> Vec<ProgramSummary>;
        program_source(id: &str) -> Result<String, ProgramRefusal>;
    }
}

#[cfg(test)]
#[path = "bootstrap.test.rs"]
mod tests;
