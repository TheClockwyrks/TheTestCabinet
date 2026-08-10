//! **The discoverability gate**: for every capability an agent is granted, the words a model would
//! reach for find it something it may actually call.
//!
//! # Why this is a first-class gate rather than a nicety
//!
//! It is the replacement for `REQUIRED_CALLS` in `prompts.test.rs`, which asserted that a run's
//! system prompt *names the call* for every capability the run granted. That assertion is retired
//! once the prompt names no functions at all — and what it was protecting is not: a capability whose
//! calls a model cannot find is, from outside, indistinguishable from a capability the run withheld.
//! Under the old design a section of the prompt guaranteed it could be found. Under this one nothing
//! does except **search**, which makes search quality load-bearing for whether a capability is usable
//! at all.
//!
//! So this is where that guarantee moved to, and it is strictly the better test: it verifies the
//! discovery end to end — through the real committed catalogue, the real ranking and the real
//! permission filter — instead of asserting that a string appears in a template. It needs no
//! per-language call spellings, so it runs identically on all eleven arms and needs no maintenance
//! when an SDK is reshaped.
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

use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_COMPACTION, CAPABILITY_EDIT_FILE, CAPABILITY_EXEC,
    CAPABILITY_FORK, CAPABILITY_FSM, CAPABILITY_LIST_DIR, CAPABILITY_MEMORIES,
    CAPABILITY_PROGRAM_LIBRARY, CAPABILITY_PROJECT_MANAGEMENT, CAPABILITY_READ_FILE,
    CAPABILITY_SHELL, CAPABILITY_SKILLS, CAPABILITY_SUBAGENTS, CAPABILITY_TASKS,
    CAPABILITY_WRITE_FILE,
};
use test_cabinet_core::gg_query::GG_CAPABILITY_CATALOG;

use super::*;
use crate::ending::EndingRole;
use crate::reference::TOOL_GATES;
use crate::sandbox::{Binding, OPERATIONS, all_languages, catalogue_functions};

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
    (CAPABILITY_SKILLS, &["skill"]),
    (CAPABILITY_MEMORIES, &["memory", "durable"]),
    (CAPABILITY_TASKS, &["task", "blocked"]),
    (CAPABILITY_PROJECT_MANAGEMENT, &["issue", "epic", "board"]),
    (CAPABILITY_SUBAGENTS, &["subagent", "delegate", "spawn"]),
    (CAPABILITY_PROGRAM_LIBRARY, &["program", "rerun", "history"]),
    (
        CAPABILITY_AGENT_MANAGED_CONTEXT,
        &["archive", "evict", "context"],
    ),
    (CAPABILITY_COMPACTION, &["compact", "summar"]),
    (CAPABILITY_EXEC, &["take over", "different agent"]),
    (CAPABILITY_FORK, &["fork", "copy", "parallel"]),
    (CAPABILITY_FSM, &["state", "transition"]),
];

/// Which gg tools a capability contributes, from the [reference table](TOOL_GATES) that is already
/// the one place a tool's gate is written down.
///
/// Read from there rather than restated here, because a second copy of "what buys this tool" is
/// exactly the drift this whole stage has been removing.
fn tools_of(capability: &str) -> Vec<String> {
    TOOL_GATES
        .iter()
        .filter(|gate| gate.capability == capability)
        .map(|gate| gate.tool.to_string())
        .collect()
}

/// The [operations](OPERATIONS) a capability grants: everything bound by a tool it contributes, plus
/// everything bound by the capability itself.
///
/// The two arms of [`Binding`] a capability can reach. An operation bound to an
/// [ending role](Binding::Ending) belongs to a role rather than a capability, and one that is
/// [`Always`](Binding::Always) belongs to everybody — neither is a thing a capability can make
/// undiscoverable, so neither is this gate's business.
fn operations_of(capability: &str) -> Vec<(&'static str, &'static str)> {
    let tools = tools_of(capability);
    OPERATIONS
        .iter()
        .filter(|operation| match operation.binding {
            Binding::Tool(tool) => tools.iter().any(|enabled| enabled == tool),
            Binding::Capability(id) => id == capability,
            Binding::Ending(_) | Binding::Always => false,
        })
        .map(|operation| (operation.call.object, operation.call.key))
        .collect()
}

/// The names `language` spells a capability's operations under — the keys a hit must carry to count
/// as having found that capability.
fn spellings(
    language: &'static dyn crate::sandbox::ProgramLanguage,
    capability: &str,
) -> Vec<&'static str> {
    let operations = operations_of(capability);
    catalogue_functions(language)
        .into_iter()
        .filter(|function| {
            // Matched on the operation each entry resolves to rather than on the grouping it was
            // filed under: gg's `(object, key)` pair is identity, and a converted arm carries
            // neither half of it — it groups by module and names the operation.
            crate::sandbox::operation_of(function).is_some_and(|resolved| {
                operations.iter().any(|(object, key)| {
                    *object == resolved.call.object && *key == resolved.call.key
                })
            })
        })
        // The key a hit is filed under, which is the fully-qualified name where the arm emits one.
        .map(|function| function.fqn.unwrap_or(function.name))
        .collect()
}

/// A runtime for an agent granted **exactly** `capability` and nothing else.
fn granted(
    language: &'static dyn crate::sandbox::ProgramLanguage,
    capability: &str,
) -> DocsRuntime {
    // The capability id is carried whether or not anything is bound by it, exactly as the loop
    // carries an agent's resolved set: a capability that buys tools buys nothing here, and one that
    // buys a family directly is the whole of what this agent holds.
    let held: Vec<&'static str> = GG_CAPABILITY_CATALOG
        .iter()
        .copied()
        .filter(|id| *id == capability)
        .collect();
    DocsRuntime::new(
        tools_of(capability),
        EndingRole::Standard,
        &held,
        language.id(),
    )
}

/// A runtime for an agent granted **everything** — every tool gg has and every capability in the
/// catalogue.
///
/// The counterpart of [`granted`], and the one where **rank** is a real question. A lone-capability
/// agent's whole visible surface is six to twelve functions, so a page of
/// [`MAX_SEARCH_LIMIT`] holds every match there could be and *found it at all* and *found it near
/// the top* are the same assertion. Against the full surface — forty-odd functions and twenty-odd
/// types — they are not.
fn fully_granted(language: &'static dyn crate::sandbox::ProgramLanguage) -> DocsRuntime {
    DocsRuntime::new(
        crate::tools::ALL_TOOL_NAMES
            .iter()
            .map(|tool| tool.to_string())
            .collect(),
        EndingRole::Standard,
        GG_CAPABILITY_CATALOG,
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
                    .map(|function| function.fqn.unwrap_or(function.name))
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

/// **Every capability with a model-facing call has a row here.**
///
/// The forcing function. A capability added to gg with functions behind it makes this fail until the
/// words a model would look for it by are written down — which is the only thing standing between a
/// new capability and one that exists, is granted, and is never found.
///
/// A capability with **no** operation is skipped rather than exempted, and needs no waiver: there is
/// nothing to discover, so there is nothing to be undiscoverable.
/// [`docview-close`](test_cabinet_core::gg::CAPABILITY_DOCVIEW_CLOSE) is the live example — the two
/// calls it buys are refused at the membrane under gg's own names because no arm's committed
/// catalogue spells them yet, so they are in no catalogue for a search to return. The moment an arm
/// catalogues them they become operations, and this test demands a row for them on the same commit.
#[test]
fn every_capability_with_a_call_has_natural_words_written_down() {
    for capability in GG_CAPABILITY_CATALOG {
        if operations_of(capability).is_empty() {
            continue;
        }
        assert!(
            CAPABILITY_KEYWORDS.iter().any(|(id, _)| *id == *capability),
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
