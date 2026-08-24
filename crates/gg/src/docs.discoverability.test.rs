//! **The discoverability gate**: for every capability an agent is granted, the words a model would
//! reach for find it something it may actually call.
//!
//! # Why this is a first-class gate rather than a nicety
//!
//! A capability whose calls a model cannot find is, from outside, indistinguishable from a
//! capability the run withheld. gg's prompt names no functions, so nothing guarantees a granted
//! call can be found except **search** — which makes search quality load-bearing for whether a
//! capability is usable at all.
//!
//! This gate verifies that discovery end to end: through each arm's real catalogue, the real
//! ranking and the real permission filter. It needs no per-language call spellings, so it runs
//! identically on all eleven arms and needs no maintenance when an SDK is reshaped.
//!
//! **When it goes red, the answer is to fix the wording of an SDK's brief, or the ranking. It is
//! never to weaken the assertion or to soften a keyword into one that happens to hit.** The keywords
//! below are the words a model reaches for when it *wants* a capability — not function names, not
//! any arm's spellings — and choosing them to fit the catalogue would invert the whole test.
//!
//! # What is asserted, per capability, per registered language
//!
//! * **Positive.** An agent granted exactly that capability searches each keyword and finds at least
//!   one of the capability's own operations, and every hit it is credited with is one the agent's
//!   scope actually binds.
//! * **Negative.** An agent granted nothing finds none of them — which is what proves the positive
//!   came through the permission filter rather than past it.
//! * **Rank.** An agent granted *everything*, asking at the page size a model is answered with by
//!   default, finds one of them **on the first page**. The positive above cannot fail for a ranking
//!   regression — a lone-capability agent's whole surface fits on one page whatever the order — so
//!   this is the assertion that holds the ordering itself.
//! * **Completeness.** Every capability that grants a model-facing operation has a row here. This is
//!   the forcing function: a capability added to gg with calls behind it fails this file until
//!   somebody writes down the words a model would look for it by.

use super::*;
use crate::ending::EndingRole;
use crate::sandbox::{
    OperationId, all_languages, capability_operations, catalogue_functions, gating_capabilities,
    instance_operations,
};
use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_COMPACTION, CAPABILITY_DOCVIEW_CLOSE,
    CAPABILITY_EDIT_FILE, CAPABILITY_EXEC, CAPABILITY_FORK, CAPABILITY_LIST_DIR,
    CAPABILITY_MEMORIES, CAPABILITY_PROGRAM_LIBRARY, CAPABILITY_PROJECT_MANAGEMENT,
    CAPABILITY_READ_FILE, CAPABILITY_SEARCH, CAPABILITY_SHELL, CAPABILITY_SKILLS,
    CAPABILITY_SUBAGENTS, CAPABILITY_TASKS, CAPABILITY_WRITE_FILE,
};

/// **The natural words a model reaches for when it wants a capability.**
///
/// Not function names, not any arm's spellings, and not words chosen because they happen to match
/// what an SDK wrote — which is why this table needed no edit when a catalogue was regenerated and
/// will need none when the SDKs are reshaped.
const CAPABILITY_KEYWORDS: &[(&str, &[&str])] = &[
    (CAPABILITY_SHELL, &["shell", "command"]),
    (CAPABILITY_READ_FILE, &["read", "file"]),
    (CAPABILITY_WRITE_FILE, &["write", "file"]),
    (CAPABILITY_EDIT_FILE, &["edit", "replace"]),
    (CAPABILITY_LIST_DIR, &["directory", "list"]),
    (CAPABILITY_SEARCH, &["search", "grep", "pattern"]),
    (CAPABILITY_SKILLS, &["skill"]),
    (CAPABILITY_MEMORIES, &["memory", "durable"]),
    (CAPABILITY_TASKS, &["task", "blocked"]),
    (CAPABILITY_PROJECT_MANAGEMENT, &["issue", "epic", "board"]),
    (CAPABILITY_SUBAGENTS, &["subagent", "delegate", "spawn"]),
    (CAPABILITY_PROGRAM_LIBRARY, &["program", "rerun", "history"]),
    (CAPABILITY_DOCVIEW_CLOSE, &["close", "documentation"]),
    (
        CAPABILITY_AGENT_MANAGED_CONTEXT,
        &["archive", "evict", "context"],
    ),
    (CAPABILITY_COMPACTION, &["compact", "summar"]),
    (CAPABILITY_EXEC, &["take over", "different agent"]),
    (CAPABILITY_FORK, &["fork", "copy", "parallel"]),
];

/// The natural words for the one operation **no capability buys** — the transition an agent holds
/// because of where it stands in a machine.
///
/// Kept apart from [`CAPABILITY_KEYWORDS`] rather than folded into it under the
/// [`fsm`](test_cabinet_core::gg::CAPABILITY_FSM) capability, because that capability is declared on
/// the *shell* driving a machine and never on the agent running a state: a row filed under it would
/// build a grant no real agent has and assert discoverability against a surface nobody is offered.
/// The assertion itself is the same one, and [`the_positional_call_is_findable_by_its_natural_words`]
/// makes it.
const POSITIONAL_KEYWORDS: &[&str] = &["state", "transition"];

/// The names `language` spells `capability`'s operations under — the keys a hit must carry to count
/// as having found that capability.
///
/// The operations themselves come off the [table](crate::sandbox::OPERATIONS) rather than from a
/// list here: a
/// capability's grant *is* the rows bound to it, so a second statement of which those are would be
/// a copy of the very thing this gate is checking the discoverability of. Operations bound to an
/// ending role or to everybody belong to no capability, and so are nothing a capability can make
/// undiscoverable.
fn spellings(
    language: &'static dyn crate::sandbox::ProgramLanguage,
    capability: &str,
) -> Vec<&'static str> {
    spellings_of(language, &capability_operations([capability]))
}

/// The names `language` spells `operations` under — [`spellings`] over a stated set rather than over
/// a capability's, for the one grant a capability cannot express.
fn spellings_of(
    language: &'static dyn crate::sandbox::ProgramLanguage,
    operations: &[OperationId],
) -> Vec<&'static str> {
    catalogue_functions(language)
        .into_iter()
        .filter(|function| {
            // Matched on the operation each entry resolves to rather than on the grouping it was
            // filed under: an operation id is gg's own identity, and an arm carries neither half of
            // it — it groups by module and names the operation.
            crate::sandbox::operation_of(function)
                .is_some_and(|resolved| operations.contains(&resolved.id))
        })
        // The key a hit is filed under, which is the fully-qualified name where the arm emits one.
        .map(|function| function.fqn)
        .collect()
}

/// A runtime for an agent granted **exactly** `capability` and nothing else — the capability on,
/// and every operation it offers in the allowlist.
fn granted(
    language: &'static dyn crate::sandbox::ProgramLanguage,
    capability: &str,
) -> DocsRuntime {
    DocsRuntime::new(
        vec![capability.to_string()],
        EndingRole::Standard,
        &capability_operations([capability]),
        language.id(),
    )
}

/// A runtime for an agent granted **everything** — every capability that gates a call, and every
/// operation those capabilities offer.
///
/// The counterpart of [`granted`], and the one where **rank** is a real question. A lone-capability
/// agent's whole visible surface is six to twelve functions, so a page of
/// [`MAX_SEARCH_LIMIT`] holds every match there could be and *found it at all* and *found it near
/// the top* are the same assertion. Against the full surface — forty-odd functions and twenty-odd
/// types — they are not.
fn fully_granted(language: &'static dyn crate::sandbox::ProgramLanguage) -> DocsRuntime {
    let capabilities = gating_capabilities();
    // Joined to the operations a *position* buys, which no capability can be switched on to reach:
    // an agent holding everything gg can be configured to grant still stands somewhere, and a
    // maximal surface that omitted the transition would rank against a page no run produces.
    let mut operations = capability_operations(capabilities.iter().copied());
    operations.extend(instance_operations());
    DocsRuntime::new(
        capabilities.into_iter().map(str::to_string).collect(),
        EndingRole::Standard,
        &operations,
        language.id(),
    )
}

/// **Every capability's calls are on the FIRST page**, for an agent that holds the whole surface and
/// asks at the page size a model actually gets.
///
/// This is the half of the gate that exercises **ranking** rather than membership.
/// [`a_granted_capability_is_findable_by_its_natural_words`] deliberately grants one capability at a
/// time — that is what makes its negative twin meaningful — but the consequence is that it asks a
/// hundred-hit page of a surface that can never exceed a dozen entries, so no ordering it produces
/// can fail it. A real agent holds many capabilities at once and gets
/// [`DEFAULT_SEARCH_LIMIT`] hits unless it says otherwise, so a reshape that buried a capability's
/// calls under twenty better-scoring ones would be invisible to that test and fatal in a run.
///
/// It asserts the same thing from the other end and needs no separate keyword table: the words are
/// [`CAPABILITY_KEYWORDS`]'s, and when this goes red the answer is the same one — fix the arm's
/// prose or the ranking, never the keyword.
#[test]
fn a_capability_is_on_the_first_page_of_a_fully_granted_agent() {
    for language in all_languages() {
        let name = language.display_name();
        let docs = fully_granted(language);
        for (capability, keywords) in CAPABILITY_KEYWORDS {
            let expected = spellings(language, capability);
            for keyword in *keywords {
                // No `limit`: the default page is what a model that says nothing is answered with,
                // and it is the number this assertion is about.
                let found = docs
                    .search(DocQuery {
                        query: keyword,
                        ..DocQuery::default()
                    })
                    .unwrap_or_else(|refusal| {
                        panic!(
                            "{name}: `{keyword}` is not a usable query: {}",
                            refusal.message
                        )
                    });
                let hits: Vec<&str> = found.hits.iter().map(|hit| hit.key.as_str()).collect();
                assert!(
                    hits.iter().any(|key| expected.contains(key)),
                    "{name}: an agent holding everything searched `{keyword}` and none of \
                     {expected:?} was on the first page of {} ({} matched in all). Fix the wording \
                     of that arm's briefs, or the ranking — never this keyword.\nThe page: {hits:?}",
                    DEFAULT_SEARCH_LIMIT,
                    found.total,
                );
            }
        }
    }
}

/// **Every capability a model is granted can be found by the words it would look for it by**, on
/// every registered language.
#[test]
fn a_granted_capability_is_findable_by_its_natural_words() {
    for language in all_languages() {
        let name = language.display_name();
        for (capability, keywords) in CAPABILITY_KEYWORDS {
            let expected = spellings(language, capability);
            assert!(
                !expected.is_empty(),
                "{name}: `{capability}` grants no catalogued function, so this row is dead"
            );
            let docs = granted(language, capability);
            for keyword in *keywords {
                let found = docs
                    .search(DocQuery {
                        query: keyword,
                        limit: Some(MAX_SEARCH_LIMIT),
                        ..DocQuery::default()
                    })
                    .unwrap_or_else(|refusal| {
                        panic!(
                            "{name}: `{keyword}` is not a usable query: {}",
                            refusal.message
                        )
                    });
                let hits: Vec<&str> = found.hits.iter().map(|hit| hit.key.as_str()).collect();
                assert!(
                    hits.iter().any(|key| expected.contains(key)),
                    "{name}: an agent granted `{capability}` searching `{keyword}` found none of \
                     {expected:?}. Fix the wording of that arm's briefs, or the ranking — never \
                     this keyword.\nWhat it did find: {hits:?}"
                );
                // Everything a search offers is something this agent may call. Asserted here as
                // well as in the search tests, because the credit above would be worthless if the
                // list it was drawn from were not this agent's.
                let bound: Vec<&str> = catalogue_functions(language)
                    .into_iter()
                    .filter(|function| docs.bound(function))
                    .map(|function| function.fqn)
                    .collect();
                for hit in found
                    .hits
                    .iter()
                    .filter(|hit| hit.kind == DocKind::Function)
                {
                    assert!(
                        bound.contains(&hit.key.as_str()),
                        "{name}: searching `{keyword}` offered `{}`, which this agent cannot call",
                        hit.key
                    );
                }
            }
        }
    }
}

/// **A withheld capability is not findable** — the half that proves the positive came through the
/// permission filter rather than past it.
#[test]
fn a_withheld_capability_is_not_findable_by_the_same_words() {
    for language in all_languages() {
        let name = language.display_name();
        // An agent granted nothing at all: no tools, no capabilities, the ordinary ending role.
        let docs = DocsRuntime::new(Vec::new(), EndingRole::Standard, &[], language.id());
        for (capability, keywords) in CAPABILITY_KEYWORDS {
            let withheld = spellings(language, capability);
            for keyword in *keywords {
                let found = docs
                    .search(DocQuery {
                        query: keyword,
                        limit: Some(MAX_SEARCH_LIMIT),
                        ..DocQuery::default()
                    })
                    .expect("a usable query");
                for hit in &found.hits {
                    assert!(
                        !withheld.contains(&hit.key.as_str()),
                        "{name}: an agent without `{capability}` searching `{keyword}` was offered \
                         `{}`",
                        hit.key
                    );
                }
            }
        }
    }
}

/// **The positional call is findable by the words a model would look for it by**, and is offered to
/// nobody who does not hold it.
///
/// The same assertion [`a_granted_capability_is_findable_by_its_natural_words`] makes, over the one
/// grant that is not a capability's: an agent standing in a machine state holds
/// `delegation.transition_state` and nothing on its own profile says so, so the grant is built from
/// [`instance_operations`] rather than from a capability id. Both halves are here — an agent that
/// holds it finds it, an agent that does not is never offered it — because between them they are
/// what proves the hit came through the permission filter rather than past it.
#[test]
fn the_positional_call_is_findable_by_its_natural_words() {
    for language in all_languages() {
        let name = language.display_name();
        let expected = spellings_of(language, &instance_operations());
        assert!(
            !expected.is_empty(),
            "{name}: no catalogued function names a positional operation, so this test is dead"
        );
        let standing = DocsRuntime::new(
            Vec::new(),
            EndingRole::Standard,
            &instance_operations(),
            language.id(),
        );
        let elsewhere = DocsRuntime::new(Vec::new(), EndingRole::Standard, &[], language.id());
        for keyword in POSITIONAL_KEYWORDS {
            let query = |docs: &DocsRuntime| {
                docs.search(DocQuery {
                    query: keyword,
                    limit: Some(MAX_SEARCH_LIMIT),
                    ..DocQuery::default()
                })
                .expect("a usable query")
            };
            let hits: Vec<String> = query(&standing)
                .hits
                .into_iter()
                .map(|hit| hit.key)
                .collect();
            assert!(
                hits.iter().any(|key| expected.contains(&key.as_str())),
                "{name}: an agent standing in a machine searched `{keyword}` and found none of \
                 {expected:?}. Fix the wording of that arm's briefs, or the ranking — never this \
                 keyword.\nWhat it did find: {hits:?}"
            );
            for hit in query(&elsewhere).hits {
                assert!(
                    !expected.contains(&hit.key.as_str()),
                    "{name}: an agent outside a machine searching `{keyword}` was offered `{}`",
                    hit.key
                );
            }
        }
    }
}

/// **Every capability with a model-facing call has a row here.**
///
/// The forcing function. A capability added to gg with functions behind it makes this fail until the
/// words a model would look for it by are written down — which is the only thing standing between a
/// new capability and one that exists, is granted, and is never found.
///
/// The subjects are the capabilities that [gate an operation](gating_capabilities) rather than gg's
/// whole catalogue: a capability with no row in the table has nothing to discover, so there is
/// nothing about it to be undiscoverable, and demanding keywords for it would be demanding words for
/// a surface that does not exist. [`docview-close`](test_cabinet_core::gg::CAPABILITY_DOCVIEW_CLOSE)
/// was the live example for as long as the two calls it buys were gated inline at the membrane and
/// in no row of the table — which is exactly the shape of gap this file exists to make impossible,
/// and it escaped this test only because a capability that grants nothing grants nothing to find.
/// Enrolling those calls is what made this test demand its row.
#[test]
fn every_capability_with_a_call_has_natural_words_written_down() {
    for capability in gating_capabilities() {
        assert!(
            CAPABILITY_KEYWORDS.iter().any(|(id, _)| *id == capability),
            "`{capability}` grants a model-facing call and has no keywords in \
             CAPABILITY_KEYWORDS, so nothing checks that an agent granted it can find it"
        );
    }
}

/// **Natural words the surface does not answer yet**, each with the reason, and each held to still
/// missing.
///
/// This is where a red run of the gate above goes when the honest fix is a **prose** change to an
/// SDK rather than a change to the ranking — and it is written down rather than quietly dropped from
/// [`CAPABILITY_KEYWORDS`], because a keyword deleted for failing is a finding erased. Every row
/// here is a word a model plausibly reaches for and that no arm's documentation contains, so the
/// capability is reachable only by gg's own vocabulary for it.
///
/// It is shaped like an [operation exemption](crate::sandbox::Applicability::UniversalExcept) and for
/// the same reason: the **reason is required**, so the waiver is reviewed in the diff that grants it.
///
/// [`a_word_the_surface_does_not_answer_is_still_unanswered`] holds each row to being *dead-wrong to
/// keep*: the moment every registered arm's prose answers a word, that test fails and the word must
/// be promoted into [`CAPABILITY_KEYWORDS`]. So a rewrite that fixes the wording cannot leave the
/// stronger assertion unclaimed.
const UNANSWERED_KEYWORDS: &[(&str, &str, &str)] = &[
    (
        CAPABILITY_MEMORIES,
        "remember",
        "every arm's memory prose says *record* and *memory*; not one uses the verb a model would.",
    ),
    (
        CAPABILITY_MEMORIES,
        "recall",
        "the read side is documented as *read one memory's full contents*, in gg's own noun.",
    ),
    (
        CAPABILITY_TASKS,
        "todo",
        "the family is documented entirely as *tasks*, and the word a model brings to it appears \
         nowhere.",
    ),
    (
        CAPABILITY_EXEC,
        "successor",
        "gg's own word for the agent that takes over is not in any SDK's prose, which says \
         *takes over from your next turn*.",
    ),
    (
        CAPABILITY_EXEC,
        "hand off",
        "the same gap from the other side: the documentation never names the act, only its effect.",
    ),
    (
        CAPABILITY_FORK,
        "branch",
        "fork is documented as *a copy of yourself, in parallel*; the version-control word a model \
         would reach for is absent.",
    ),
];

/// **A word recorded as unanswered is still unanswered** — on at least one registered arm.
///
/// The forcing function on the waiver above. A row that every arm now answers is a stronger
/// assertion going unmade, so it fails here and has to be moved into [`CAPABILITY_KEYWORDS`]. The
/// condition is *at least one arm still misses* rather than *every arm misses*, because promotion
/// requires all eleven: a word half the arms answer is not yet a word the gate can hold every arm to.
#[test]
fn a_word_the_surface_does_not_answer_is_still_unanswered() {
    for (capability, keyword, reason) in UNANSWERED_KEYWORDS {
        assert!(
            !reason.trim().is_empty(),
            "`{keyword}` is waived with no reason"
        );
        assert!(
            !CAPABILITY_KEYWORDS
                .iter()
                .any(|(id, keywords)| *id == *capability && keywords.contains(keyword)),
            "`{keyword}` is both asserted and waived for `{capability}`"
        );
        let unanswered = all_languages().any(|language| {
            let expected = spellings(language, capability);
            let docs = granted(language, capability);
            let found = docs
                .search(DocQuery {
                    query: keyword,
                    limit: Some(MAX_SEARCH_LIMIT),
                    ..DocQuery::default()
                })
                .expect("a usable query");
            !found
                .hits
                .iter()
                .any(|hit| expected.contains(&hit.key.as_str()))
        });
        assert!(
            unanswered,
            "every arm now answers `{keyword}` for `{capability}`; move it into \
             CAPABILITY_KEYWORDS, where it will be asserted rather than waived"
        );
    }
}
