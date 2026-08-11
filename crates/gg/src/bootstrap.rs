//! The **synthesized opening turn** a [code-mode](crate::context::ContextModel::code_mode) agent's
//! session starts with: one program that opens the documentation of the calls discovery itself is
//! made of, and the views that program produced.
//!
//! # Why anything is seeded at all
//!
//! Because the [prompt](crate::prompts) names no function. It says what each capability is and which
//! [module](crate::prompts::ModuleView) it lives in, and stops — so a model's first act has to be to
//! *find* a call, and the calls that find one are themselves calls it has not been told. Left alone
//! that is a fixed point: an agent that cannot look anything up cannot look up how to look things
//! up. The bootstrap breaks it, and it is the only thing that does.
//!
//! # Why a program rather than a paragraph
//!
//! A paragraph in the prompt naming the two calls would break the rule the prompt exists under, and
//! it would teach worse. The mechanism gg already ships for this — the same one
//! [autoload](crate::agent) and [persistence](crate::persistence::restore_file_views) use — puts a
//! **reply the agent could have sent** into its own transcript, and a model reads its own transcript
//! as the example of what a well-formed turn looks like. So the calls arrive as *source in the
//! agent's own language*, which it can copy, rather than as prose about source it would have to
//! translate. The program is not written here either: every arm already implements
//! [`open_docs_views_statement`](crate::sandbox::ProgramLanguage::open_docs_views_statement), which
//! writes a whole program of exactly this shape in that language's own syntax, and generating a
//! twelfth thing beside it would be a second answer to a question the seam already answers.
//!
//! # What it carries, and what it deliberately does not
//!
//! **Only the bootstrap calls** — [`BOOTSTRAP_CALLS`]. It does *not* carry one call per granted
//! capability. That was proposed and rejected: seeding a call per capability would put the whole
//! immediate function surface back in front of the model on turn one, under a different heading,
//! and the point of the design is that an agent that decides to use tasks goes and finds the task
//! calls. That round trip is the thing being measured, not an overhead to be optimized away.
//!
//! # Where it sits, and why it survives
//!
//! It is seeded once, on a fresh window, immediately after the build prompt and before every other
//! opening step — the capability seedings, the opening hooks' notes, the autoloaded specifications
//! and a persistent agent's restored desk all land after it. Three reasons, in order:
//!
//! 1. **The transcript reads in the order the work happened.** The first thing in the window after
//!    the task is the agent equipping itself to read documentation; everything the run pre-loads
//!    comes after, as material it then has the vocabulary to work with.
//! 2. **The documentation band is append-only** ([`open_docview`](crate::context::ContextModel::open_docview)),
//!    so whatever is opened first stays first for the life of the session. Seeding here puts these
//!    two at the head of that band, where they are part of the prefix a provider caches rather than
//!    something that shifts every other documentation view down.
//! 3. **A persistent agent's restore is idempotent against it.** [`restore_docviews`](crate::persistence::restore_docviews)
//!    re-opens the keys the last instance held, and a re-open of an open key is a no-op — so running
//!    the bootstrap first means the restored set folds into it rather than duplicating it.
//!
//! It survives the two boundaries the same way every documentation view does, and for the same
//! reason: a docview's body is a pure function of its key, so a [compaction](crate::compaction)
//! re-derives it and [persistence](crate::persistence) records the key alone. What does *not*
//! survive a compaction is the synthesized program itself, which is ordinary
//! [ephemeral](crate::context::Retention::Ephemeral) history — and that is right. Its job is to be
//! the model's first example of its own output; by the time a window is full the model has written
//! a hundred better ones, while the documentation it opened is still the thing being read.
//!
//! A **carried** window — an `exec` successor or a `fork` that kept its history — is not re-seeded,
//! on the same terms as every other opening step: it already holds these views, and pushing a second
//! copy of the program into the middle of a live thread would read as the agent having repeated
//! itself.

use crate::context::ContextModel;
use crate::docs::DocsRuntime;
use crate::sandbox::{
    DOCS_SEARCH, SurfaceCall, VIEW_OPEN_DOCS_VIEW, catalogue_functions, operation_of,
};

/// **The calls the bootstrap opens the documentation of** — the ones discovery is made of, and
/// nothing else.
///
/// Both halves of the loop the [prompt](crate::prompts) describes, in the order it describes them:
/// a model searches for what it needs and then opens a documentation view of what it found. Seeding
/// them in that order means the transcript's first turn reads as the loop rather than as two
/// unrelated calls, and the model's own example of a well-formed turn is the one it will spend the
/// session repeating.
///
/// Searching was withheld from this list for as long as no arm's SDK published it: gg cannot open a
/// documentation view of a name that is in no catalogue, so a run would have seeded a key that
/// rendered nothing. It is here because the call now has a row in gg's own
/// [operations table](crate::sandbox::operation_of) — until each arm follows, an arm that does not
/// catalogue it is skipped by [`bootstrap_keys`] and fails the capability gate by name.
pub(crate) const BOOTSTRAP_CALLS: &[SurfaceCall] = &[DOCS_SEARCH, VIEW_OPEN_DOCS_VIEW];

/// Seed `context` with the bootstrap turn: one program that opens the
/// [bootstrap calls](BOOTSTRAP_CALLS)' documentation, then those views.
///
/// Returns how many documentation views were placed, for the run's log — `0` when this agent's arm
/// catalogues none of the bootstrap calls, or when they were all open already (which is what a
/// second call on one window is). A window that got no views gets no program either: a synthesized
/// reply whose views never arrived would teach the model that opening one sometimes silently does
/// nothing, which is the one lesson this turn must not carry.
///
/// Nothing here is fallible. A key that renders no documentation is skipped rather than failing the
/// agent, on the rule every seeding step follows: an opening turn that is thinner than intended
/// costs the model a lookup, and a run that refuses to start costs it everything.
pub(crate) fn seed_bootstrap(context: &mut ContextModel, docs: &DocsRuntime) -> usize {
    if !context.code_mode() {
        return 0;
    }
    // Rendered before anything is pushed, for the reason autoload reads its files before writing its
    // program: the program must name exactly the views that arrived.
    let opened: Vec<(String, String)> = bootstrap_keys(docs)
        .into_iter()
        .filter(|key| !context.docview_is_open(key))
        .filter_map(|key| docs.read_any(&key).map(|body| (key, body)))
        .collect();
    if opened.is_empty() {
        return 0;
    }
    let names: Vec<&str> = opened.iter().map(|(key, _)| key.as_str()).collect();
    context.push_assistant(
        Some(docs.language().open_docs_views_statement(&names)),
        Vec::new(),
    );
    let placed = opened.len();
    for (key, body) in opened {
        context.open_docview(key, body);
    }
    placed
}

/// This arm's model-facing keys for the [bootstrap calls](BOOTSTRAP_CALLS), in that order.
///
/// The **fully-qualified name** where the arm emits one, which is the key its catalogue advertises,
/// the key search files a hit under, and the only one of the two spellings that two modules each
/// offering a `close` could not both claim. The bare name is the fallback, and is all a
/// [`V1`](crate::sandbox::SchemaVersion::V1) catalogue has.
///
/// Resolved by the **operation** each entry names rather than by the grouping it was filed under,
/// because gg's `(object, key)` pair is identity and an arm whose surface is capability modules
/// carries neither half of it. A call this arm does not catalogue yields nothing and is skipped: gg
/// cannot open a view of a name that is in no catalogue, and guessing one would seed the model a key
/// that resolves to nothing.
fn bootstrap_keys(docs: &DocsRuntime) -> Vec<String> {
    let functions = catalogue_functions(docs.language());
    BOOTSTRAP_CALLS
        .iter()
        .filter_map(|call| {
            functions
                .iter()
                .find(|function| {
                    function.alias_of.is_none()
                        && docs.bound(function)
                        && operation_of(function).is_some_and(|operation| {
                            operation.call.object == call.object && operation.call.key == call.key
                        })
                })
                .map(|function| function.fqn.unwrap_or(function.name).to_string())
        })
        .collect()
}

#[cfg(test)]
#[path = "bootstrap.test.rs"]
mod tests;
