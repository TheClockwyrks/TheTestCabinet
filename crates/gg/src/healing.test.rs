//! Tests for the healing **pipeline**: the fixture corpus, the ordering, the fixpoint, idempotence,
//! the deletion-only invariant, disclosure, and configuration resolution.
//!
//! The per-strategy cases live beside them in `healing.fences.test.rs` (everything about a fence)
//! and `healing.programs.test.rs` (prose, imports, async, comments, the predicates and the mask).
//! This file owns the round-1 corpus itself, because the corpus is one thing and the properties
//! asserted over it — subsequence, idempotence, convergence — are properties of the whole of it.
//!
//! Nothing here compiles a component, starts a runtime, or touches a file at run time: healing is a
//! pure function over a string, which is exactly why every failure shape real models produced can be
//! pinned as a microsecond-scale unit test.

use serde_json::json;
use test_cabinet_core::gg::{CAPABILITY_RESPONSES_AS_CODE, GgAgentConfig, GgCapabilityConfig};

use super::*;

/// The [dialect](Dialect) every case in this file heals through: **TypeScript's**.
///
/// Named for the language rather than for gg's default, because that is what these cases are about:
/// the corpus is a set of replies real models sent to a TypeScript run, and every expectation in it
/// — which fence tags are the program's, which lines are prose, what an import looks like — is that
/// language's answer. A case that means to assert something about **every** registered language
/// iterates [`all_languages`](crate::sandbox::all_languages) instead, and one that means to assert
/// something about the skeleton alone uses the inert dialect in `healing.programs.test.rs`.
pub(crate) fn dialect() -> &'static dyn Dialect {
    crate::sandbox::language(test_cabinet_core::gg::GgProgramLanguage::TypeScript).healing()
}

// ---------------------------------------------------------------------------------------------
// The committed round-1 corpus
// ---------------------------------------------------------------------------------------------

/// The minimal malformed close: one `ts` block whose closing fence carries a sentence on the same
/// line. The first six lines of the reply below, and the shape that made a round-1 session
/// unrecoverable.
pub(crate) const GEMINI_GLUED_CLOSE: &str = include_str!("testdata/round1-gemini-glued-close.txt");

/// 9,800 bytes: **seven** `ts` candidates (two of them opened by prose glued to the fence), every
/// one of them closed with prose glued on, beside seven fabricated `json` blocks and seven `text`
/// blocks of invented output. The flagship of the round-1 failures.
pub(crate) const GEMINI_TURN_01: &str = include_str!("testdata/round1-gemini-turn-01.txt");

/// **Five** cleanly-fenced `ts` blocks in one reply, then a paragraph narrating the whole task as
/// finished. The model whose deliverable was in a discarded block.
pub(crate) const GPT_TURN_01: &str = include_str!("testdata/round1-gpt-turn-01.txt");

/// Prose, **two** `ts` blocks, prose.
pub(crate) const HAIKU_TURN_01: &str = include_str!("testdata/round1-haiku-turn-01.txt");

/// The glued **open**: a sentence and the next block's opening fence on one line, making **two**
/// candidates out of what reads as one program and one follow-up.
pub(crate) const DEEPSEEK_TURN_01: &str = include_str!("testdata/round1-deepseek-turn-01.txt");

/// The positive case: prose, one `ts` block, prose — the single most common real shape.
pub(crate) const HAIKU_TURN_03: &str = include_str!("testdata/round1-haiku-turn-03.txt");

/// The modal terminal reply: four lines of prose declaring the task complete.
pub(crate) const HAIKU_TURN_04: &str = include_str!("testdata/round1-haiku-turn-04.txt");

/// A one-line terminal prose reply.
pub(crate) const DEEPSEEK_TURN_04: &str = include_str!("testdata/round1-deepseek-turn-04.txt");

/// A one-line terminal prose reply.
pub(crate) const GEMINI_TURN_03: &str = include_str!("testdata/round1-gemini-turn-03.txt");

/// A one-line terminal prose reply.
pub(crate) const GPT_TURN_02: &str = include_str!("testdata/round1-gpt-turn-02.txt");

// ---------------------------------------------------------------------------------------------
// The committed round-2 corpus — the fence-free shapes
// ---------------------------------------------------------------------------------------------

/// Round 2, with fences gone from the contract: **the same five-line program pasted verbatim
/// twice**, with no fence anywhere. It redeclares `const root`, so as sent it could not execute a
/// single statement — the guest answered it with `SyntaxError: redeclaration of const root` and the
/// turn was lost.
pub(crate) const SOL_DUPLICATE_PROGRAM: &str =
    include_str!("testdata/round2-sol-duplicate-program.txt");

/// The same shape from the other model, two lines long: `const files` declared twice.
pub(crate) const TERRA_DUPLICATE_PROGRAM: &str =
    include_str!("testdata/round2-terra-duplicate-program.txt");

/// Round 2's other fence-free shape: **two different drafts**, the first ending in a top-level
/// `return`. It compiles and runs — and everything after that `return`, including the `writeFile`
/// of the deliverable and the `finish` that would have ended the run, is dead code. Healing must
/// leave it alone (there is nothing here it could delete without changing what runs); the
/// [type-strip](crate::sandbox) is what reports the dead half.
pub(crate) const TERRA_TWO_DRAFTS: &str = include_str!("testdata/round2-terra-two-drafts.txt");

/// The same two-draft shape from the other model, and the one whose discarded half held the whole
/// deliverable.
pub(crate) const SOL_TWO_DRAFTS: &str = include_str!("testdata/round2-sol-two-drafts.txt");

/// Round 2's largest fence-free shape: **five** programs in one reply, each followed by the output
/// the model invented for it — a whole session narrated in a single turn. Only one name (`const
/// srcEntries`) is declared by two of the five, so it is the fixture that pins what the candidate
/// count means when the redeclaration evidence proves fewer programs than the reply holds.
pub(crate) const GEMINI_FIVE_PROGRAMS: &str =
    include_str!("testdata/round2-gemini-five-programs.txt");

/// One reply in the corpus, named so a failure says which one.
pub(crate) struct Fixture {
    /// The fixture's file stem, or a description for the synthetic shapes.
    pub(crate) name: &'static str,
    /// The reply, verbatim.
    pub(crate) reply: &'static str,
}

/// The four terminal prose replies real models ended their sessions with — the failure Decision B
/// exists to break, and the evidence that `strip-prose` cannot be the thing that catches it.
pub(crate) const TERMINAL_PROSE: [Fixture; 4] = [
    Fixture {
        name: "round1-haiku-turn-04",
        reply: HAIKU_TURN_04,
    },
    Fixture {
        name: "round1-deepseek-turn-04",
        reply: DEEPSEEK_TURN_04,
    },
    Fixture {
        name: "round1-gemini-turn-03",
        reply: GEMINI_TURN_03,
    },
    Fixture {
        name: "round1-gpt-turn-02",
        reply: GPT_TURN_02,
    },
];

/// Every reply that carried at least one program, so a test can walk the programs real models
/// actually emitted.
pub(crate) const CAPTURED_PROGRAM_REPLIES: [Fixture; 6] = [
    Fixture {
        name: "round1-gemini-glued-close",
        reply: GEMINI_GLUED_CLOSE,
    },
    Fixture {
        name: "round1-gemini-turn-01",
        reply: GEMINI_TURN_01,
    },
    Fixture {
        name: "round1-gpt-turn-01",
        reply: GPT_TURN_01,
    },
    Fixture {
        name: "round1-haiku-turn-01",
        reply: HAIKU_TURN_01,
    },
    Fixture {
        name: "round1-deepseek-turn-01",
        reply: DEEPSEEK_TURN_01,
    },
    Fixture {
        name: "round1-haiku-turn-03",
        reply: HAIKU_TURN_03,
    },
];

/// A program wrapped in a fence, an `import` and an `async` wrapper at once — every rewriting
/// strategy in one reply.
const EVERY_STRATEGY: &str = "\
```ts
Here is what I will do.

import { writeFile } from \"@test-cabinet/gg\";
async function main() {
  await writeFile(\"a.txt\", \"hi\");
}
main();
```
That should be everything.";

/// Five fences nested by decreasing length — the shape the pipeline cannot reduce inside its pass
/// budget.
const NESTED_FENCES: &str = "\
```````md
``````md
`````md
````md
```ts
const x = 1;
```
````
`````
``````
```````";

/// The whole corpus the pipeline's properties are asserted over: the ten committed round-1 replies
/// plus the synthetic shapes that exercise the strategies round 1 never triggered.
///
/// Synthetic entries are here rather than in the per-strategy files because the properties are
/// properties of *every* input, and a property test that only sees the shapes that happened to occur
/// in one round of measurement is a property test with a blind spot.
pub(crate) const CORPUS: &[Fixture] = &[
    Fixture {
        name: "round1-gemini-glued-close",
        reply: GEMINI_GLUED_CLOSE,
    },
    Fixture {
        name: "round1-gemini-turn-01",
        reply: GEMINI_TURN_01,
    },
    Fixture {
        name: "round1-gpt-turn-01",
        reply: GPT_TURN_01,
    },
    Fixture {
        name: "round1-haiku-turn-01",
        reply: HAIKU_TURN_01,
    },
    Fixture {
        name: "round1-deepseek-turn-01",
        reply: DEEPSEEK_TURN_01,
    },
    Fixture {
        name: "round1-haiku-turn-03",
        reply: HAIKU_TURN_03,
    },
    Fixture {
        name: "round1-haiku-turn-04",
        reply: HAIKU_TURN_04,
    },
    Fixture {
        name: "round1-deepseek-turn-04",
        reply: DEEPSEEK_TURN_04,
    },
    Fixture {
        name: "round1-gemini-turn-03",
        reply: GEMINI_TURN_03,
    },
    Fixture {
        name: "round1-gpt-turn-02",
        reply: GPT_TURN_02,
    },
    Fixture {
        name: "every-strategy",
        reply: EVERY_STRATEGY,
    },
    Fixture {
        name: "nested-fences",
        reply: NESTED_FENCES,
    },
    Fixture {
        name: "empty",
        reply: "   \n\n  ",
    },
    Fixture {
        name: "comment-only",
        reply: "// Everything is already done.\n/* Nothing left. */",
    },
    Fixture {
        name: "prose-only",
        reply: "I have finished the task and everything is in place.\nBoth files are listed.",
    },
    Fixture {
        name: "bare-program",
        reply: "const files = listDir(\"src\");\nreturn files.length;",
    },
    Fixture {
        name: "windows-line-endings",
        reply: "Here is the program:\r\n\r\n```ts\r\nconst x = 1;\r\nreturn x;\r\n```\r\n",
    },
    Fixture {
        name: "program-writing-a-fence",
        reply: "writeFile(\"README.md\", `# How to run\n\n```ts\nconst x = 1;\n```\n`);\nreturn 1;",
    },
    Fixture {
        name: "round2-sol-duplicate-program",
        reply: SOL_DUPLICATE_PROGRAM,
    },
    Fixture {
        name: "round2-terra-duplicate-program",
        reply: TERRA_DUPLICATE_PROGRAM,
    },
    Fixture {
        name: "round2-terra-two-drafts",
        reply: TERRA_TWO_DRAFTS,
    },
    Fixture {
        name: "round2-sol-two-drafts",
        reply: SOL_TWO_DRAFTS,
    },
];

/// Every one of the 2^n on/off combinations of the strategies — what "every configuration" means in
/// the property tests.
///
/// Written against [`HealingStrategy::ALL`] rather than against a hard-coded arity so that adding a
/// strategy widens the property tests by itself: six strategies is 64 configurations, and the day
/// there are seven it is 128 with no edit here.
pub(crate) fn every_configuration() -> Vec<HealingConfig> {
    (0..(1u32 << HealingStrategy::ALL.len()))
        .map(|bits| {
            let mut config = HealingConfig::default();
            for (index, strategy) in HealingStrategy::ALL.into_iter().enumerate() {
                config.set(strategy, bits & (1 << index) != 0);
            }
            config
        })
        .collect()
}

/// Heal under the **default** configuration — what most cases mean by "heal".
///
/// That is deliberately not the same as "every strategy armed": `drop-doubled-response` is
/// [armed only when a configuration asks for it](HealingStrategy::default_armed), so a case that
/// exercises it goes through [`healed_with`] instead.
pub(crate) fn healed(reply: &str) -> Healed {
    heal(reply, &HealingConfig::default(), dialect())
}

/// Heal with `strategy` armed on top of the defaults — the way the one default-off strategy is
/// exercised, and the way an operator arms it for a real run.
pub(crate) fn healed_with(strategy: HealingStrategy, reply: &str) -> Healed {
    let mut config = HealingConfig::default();
    config.set(strategy, true);
    heal(reply, &config, dialect())
}

/// An agent profile carrying `responses-as-code` with the given params.
fn set_with(params: serde_json::Value) -> GgAgentConfig {
    GgAgentConfig {
        capabilities: vec![GgCapabilityConfig {
            params,
            ..GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE)
        }],
        ..GgAgentConfig::root()
    }
}

/// **The delete-only harness**: healing `corpus` through `dialect`, under every configuration, only
/// ever deletes.
///
/// Written once and applied to every dialect there is — each registered language's, the seam's
/// [fixture](crate::sandbox::fixture_languages) one, and the inert one — because the invariant is
/// not TypeScript's. It is the property that makes healing safe to run at all, and a dialect that
/// answered one predicate too generously would delete a line of a model's program with nothing else
/// in the tree noticing.
///
/// `whose` names the dialect in the failure, since the corpus alone rarely says which one was asked.
pub(crate) fn assert_delete_only(dialect: &dyn Dialect, corpus: &[&str], whose: &str) {
    for reply in corpus {
        for config in every_configuration() {
            let result = heal(reply, &config, dialect);
            assert!(
                is_subsequence(&result.program, reply),
                "{whose}: healing invented or reordered text\n--- reply ---\n{reply}\n--- program \
                 ---\n{}",
                result.program
            );
        }
    }
}

/// Whether `needle`'s non-whitespace characters appear, in order, among `haystack`'s.
pub(crate) fn is_subsequence(needle: &str, haystack: &str) -> bool {
    let mut haystack = haystack.chars().filter(|c| !c.is_whitespace());
    needle
        .chars()
        .filter(|c| !c.is_whitespace())
        .all(|wanted| haystack.any(|c| c == wanted))
}

// ---------------------------------------------------------------------------------------------
// The conservatism invariant
// ---------------------------------------------------------------------------------------------

/// **The invariant the whole subsystem rests on.**
///
/// Healing only ever deletes, so the healed program — whitespace removed — is a subsequence of the
/// response the model sent. One machine-checkable sentence covering "never invents code" and "never
/// reorders" for every strategy at once, over the whole corpus under
/// [every configuration](every_configuration) — all 64 of them, since a sixth strategy doubled the
/// space.
#[test]
fn every_healed_program_is_a_subsequence_of_the_response() {
    for fixture in CORPUS {
        for config in every_configuration() {
            let result = heal(fixture.reply, &config, dialect());
            assert!(
                is_subsequence(&result.program, fixture.reply),
                "{}: healing invented or reordered text\n--- program ---\n{}",
                fixture.name,
                result.program
            );
        }
    }
}

/// **The same invariant, re-earned per registered [program language](crate::sandbox::language) —
/// over that language's own fixtures *and* over the shared corpus.**
///
/// Two corpora, because each catches what the other cannot.
///
/// Every language contributes [fixtures](Dialect::fixtures) of its own: replies whose repair is its
/// dialect's rather than the skeleton's. A language cannot be registered without them, because
/// `fixtures` is a trait method rather than a list beside these tests — a dialect that answered one
/// predicate too generously would delete a line of a model's program, and nothing in the skeleton
/// would notice.
///
/// But a dialect's own fixtures are chosen by the person who wrote it, and the replies most likely
/// to break a predicate are the ones nobody thought of. So every dialect also faces [`CORPUS`]: real
/// replies real models sent. Their *expectations* are TypeScript's and are asserted elsewhere; what
/// is asserted here is only that healing them **deleted**, which has to hold for any dialect over
/// any text and is exactly the property whose violation is unrecoverable.
#[test]
fn every_language_heals_by_deletion_alone() {
    let shared: Vec<&'static str> = CORPUS.iter().map(|fixture| fixture.reply).collect();
    for language in crate::sandbox::all_languages() {
        assert_delete_only(
            language.healing(),
            language.healing_fixtures(),
            language.display_name(),
        );
        assert_delete_only(language.healing(), &shared, language.display_name());
    }
}

/// Healing a healed response is a no-op: the pipeline runs to a fixpoint, so there is nothing left
/// for a second pass to find.
///
/// Asserted over every configuration because a fixpoint that only holds with everything armed is not
/// a fixpoint — an ablation arm that oscillated would produce a different program every turn.
#[test]
fn healing_is_idempotent() {
    for fixture in CORPUS {
        for config in every_configuration() {
            let once = heal(fixture.reply, &config, dialect());
            let twice = heal(&once.program, &config, dialect());
            assert_eq!(
                twice.program, once.program,
                "{}: healing a healed response changed it again",
                fixture.name
            );
        }
    }
}

/// The pipeline is **confluent**: whichever pass a repair becomes possible in, the program that
/// comes out is the same one.
///
/// Healing a response with only some strategies armed and then healing *that* with all of them must
/// land on the program a single full run produces. It is what makes the fixed order an
/// implementation detail of the *reporting* rather than of the result — and `applied`, which is
/// deliberately order-dependent, is exactly the thing this does not claim.
#[test]
fn the_repairs_reach_the_same_program_in_any_order() {
    let target = healed(EVERY_STRATEGY).program;
    let partials = [
        vec![HealingStrategy::StripFences],
        vec![HealingStrategy::StripFences, HealingStrategy::StripProse],
        vec![
            HealingStrategy::StripFences,
            HealingStrategy::StripProse,
            HealingStrategy::DropImports,
        ],
    ];
    for armed in partials {
        let mut config = HealingConfig::OFF;
        for strategy in &armed {
            config.set(*strategy, true);
        }
        let partial = heal(EVERY_STRATEGY, &config, dialect());
        assert_eq!(
            healed(&partial.program).program,
            target,
            "finishing the pipeline after {armed:?} reached a different program"
        );
    }
}

// ---------------------------------------------------------------------------------------------
// The fixpoint
// ---------------------------------------------------------------------------------------------

/// No real response needs more than two productive passes, which is what makes a budget of four
/// generous rather than arbitrary.
///
/// A response needing exactly *n* productive passes converges at a budget of *n + 1* — the extra
/// pass is what observes the fixpoint — so a budget of three proves "at most two".
#[test]
fn no_case_in_the_corpus_needs_more_than_two_passes() {
    for fixture in CORPUS {
        if fixture.name == "nested-fences" {
            continue;
        }
        let mut text = fixture.reply.trim().to_string();
        let mut applied = Vec::new();
        let converged = !matches!(
            to_fixpoint(
                &mut text,
                &HealingConfig::default(),
                &mut applied,
                3,
                dialect()
            ),
            Fixpoint::Exhausted
        );
        assert!(converged, "{}: needed more than two passes", fixture.name);
    }
}

/// A response the pipeline cannot reduce within its budget is returned **exactly as the model sent
/// it**, with nothing recorded and the failure stated.
///
/// The alternative — half a repair, or an empty `applied` beside an untouched program — would be
/// byte-identical to a clean response, and reporting the one response pathological enough to defeat
/// the pipeline as "nothing was unusual" is the quiet lie this flag exists to remove.
#[test]
fn healing_that_does_not_converge_changes_nothing_and_says_so() {
    let result = healed(NESTED_FENCES);
    assert!(result.did_not_converge, "the flag was not raised");
    assert_eq!(
        result.program,
        NESTED_FENCES.trim(),
        "text was still edited"
    );
    assert!(
        result.applied.is_empty(),
        "repairs survived: {:?}",
        result.applied
    );
    assert!(!result.rewritten(), "a discarded repair counted as a heal");
}

/// A shallower nest **does** converge, so the previous test is measuring the budget rather than a
/// pipeline that cannot nest at all.
#[test]
fn a_doubly_nested_fence_converges_within_the_budget() {
    let result = healed("````md\n```ts\nconst x = 1;\n```\n````");
    assert!(!result.did_not_converge);
    assert_eq!(result.program, "const x = 1;");
    assert_eq!(result.strategies().len(), 2);
}

// ---------------------------------------------------------------------------------------------
// Ordering and short-circuiting
// ---------------------------------------------------------------------------------------------

/// The strategies fire in the documented order, and the order is `HealingStrategy::ALL`.
///
/// One reply that needs all four repairs produces them in one pass, in order — which is also the
/// order the config table, the session summary and the docs page list them in, so the four cannot
/// drift apart.
#[test]
fn strategies_apply_in_the_documented_order() {
    assert_eq!(
        HealingStrategy::ALL.map(HealingStrategy::id),
        [
            "strip-fences",
            "strip-prose",
            "drop-doubled-response",
            "drop-duplicate-program",
            "drop-imports",
            "unwrap-async"
        ]
    );
    let result = healed(EVERY_STRATEGY);
    assert_eq!(
        result.strategies(),
        vec![
            HealingStrategy::StripFences,
            HealingStrategy::StripProse,
            HealingStrategy::DropImports,
            HealingStrategy::UnwrapAsync,
        ],
        "program: {}",
        result.program
    );
    assert_eq!(result.program, "writeFile(\"a.txt\", \"hi\");");
}

/// One strategy's output is what lets the next one match: the `import` line is exactly what stops
/// `unwrap-async` seeing a top level made only of the wrapper.
#[test]
fn dropping_an_import_is_what_lets_the_async_wrapper_unwrap() {
    let reply = "import { writeFile } from \"gg\";\n\
                 async function main() {\n  \
                 await writeFile(\"a.txt\", \"hi\");\n\
                 }\n\
                 main();";

    let result = healed(reply);
    assert_eq!(
        result.strategies(),
        vec![HealingStrategy::DropImports, HealingStrategy::UnwrapAsync]
    );
    assert_eq!(result.program, "writeFile(\"a.txt\", \"hi\");");

    let mut without_imports = HealingConfig::default();
    without_imports.set(HealingStrategy::DropImports, false);
    let unhelped = heal(reply, &without_imports, dialect());
    assert!(
        unhelped.applied.is_empty(),
        "the wrapper unwrapped with the import still above it: {:?}",
        unhelped.applied
    );
}

/// A reply offering several candidate blocks is left **exactly as the model sent it**.
///
/// gg does not choose between them and does not refuse the turn over its own count of how many
/// programs it thinks the reply holds: `strip-fences` declines, nothing else matches, and the whole
/// reply goes to the type-strip, whose diagnostic is the model's feedback.
#[test]
fn several_candidate_blocks_are_left_alone_for_the_type_strip() {
    let reply = "Here is the plan.\n\n\
                 ```ts\nwriteFile(\"a.txt\", \"a\");\n```\n\n\
                 ```ts\nwriteFile(\"b.txt\", \"b\");\n```\n\n\
                 That is everything.";
    let result = healed(reply);
    assert_eq!(result.program, reply.trim(), "the reply was edited");
    assert!(result.applied.is_empty(), "{:?}", result.applied);
    assert!(!result.rewritten());
}

// ---------------------------------------------------------------------------------------------
// What counts as a heal
// ---------------------------------------------------------------------------------------------

/// Trimming is canonicalisation, not repair: a program differing only in surrounding whitespace is
/// the same program, and there is no contract violation to disclose.
///
/// What is trimmed is deliberately not "whitespace": the byte-order mark, the blank lines around the
/// reply and the trailing whitespace go, and the **indentation of the first content line stays**.
/// Indentation means nothing to JavaScript and everything to Markdown — four spaces make an indented
/// code block rather than a fence — so removing it here would decide a question the fence scanner
/// exists to answer.
#[test]
fn trimming_alone_is_not_a_heal() {
    let result = healed("\u{feff}\n  const x = 1;\n\n  ");
    assert_eq!(result.program, "  const x = 1;");
    assert!(result.applied.is_empty());
    assert!(!result.rewritten(), "trimming was reported as a repair");
}

/// A reply of nothing but comments is healed of its fence and then **runs**, doing nothing.
///
/// gg does not read a comment-only reply as "not a program": it is a program, it compiles, and it
/// has no statements. Judging it would be gg deciding what the model meant.
#[test]
fn a_comment_only_reply_is_a_program_that_does_nothing() {
    let result = healed("```ts\n// Everything is already done.\n```");
    assert_eq!(result.program, "// Everything is already done.");
    assert_eq!(result.strategies(), vec![HealingStrategy::StripFences]);
    assert!(result.rewritten(), "the fence really was removed");
}

/// An empty reply heals to an empty program, which the type-strip compiles and the sandbox runs.
#[test]
fn an_empty_reply_is_an_empty_program() {
    let result = healed("   \n  ");
    assert!(result.program.is_empty());
    assert!(result.applied.is_empty());
    assert!(!result.rewritten());
}

/// A reply of terminal prose is left as the model wrote it: `strip-prose` has nothing to strip
/// *to*, so it declines and the compiler is what answers.
#[test]
fn a_reply_that_is_prose_from_end_to_end_is_left_alone() {
    for fixture in TERMINAL_PROSE {
        let result = healed(fixture.reply);
        assert_eq!(
            result.program,
            fixture.reply.trim(),
            "{}: prose was edited",
            fixture.name
        );
        assert!(
            result.applied.is_empty(),
            "{}: {:?}",
            fixture.name,
            result.applied
        );
    }
}

/// Every one of the ten committed round-1 replies now reaches the type-strip, and the four that
/// carry one candidate block are unwrapped to it.
///
/// The table is measured rather than estimated: the five multi-candidate replies are the ones gg
/// used to refuse, are handed on whole.
#[test]
fn the_committed_round_one_replies_all_reach_the_type_strip() {
    let unwrapped: [(&str, &str); 2] = [
        ("round1-gemini-glued-close", GEMINI_GLUED_CLOSE),
        ("round1-haiku-turn-03", HAIKU_TURN_03),
    ];
    for (name, reply) in unwrapped {
        let result = healed(reply);
        assert!(
            result.strategies().contains(&HealingStrategy::StripFences),
            "{name}: the single candidate block was not unwrapped"
        );
    }

    let untouched: [(&str, &str); 4] = [
        ("round1-gemini-turn-01", GEMINI_TURN_01),
        ("round1-gpt-turn-01", GPT_TURN_01),
        ("round1-haiku-turn-01", HAIKU_TURN_01),
        ("round1-deepseek-turn-01", DEEPSEEK_TURN_01),
    ];
    for (name, reply) in untouched {
        let result = healed(reply);
        assert_eq!(
            result.program,
            reply.trim(),
            "{name}: a multi-candidate reply was edited"
        );
    }
}

// ---------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------

/// With everything disarmed, healing changes nothing at all — the ablation's off arm.
#[test]
fn healing_off_is_a_no_op() {
    let result = heal(EVERY_STRATEGY, &HealingConfig::OFF, dialect());
    assert_eq!(result.program, EVERY_STRATEGY.trim());
    assert!(result.applied.is_empty());
}

/// Each strategy can be turned off on its own, and turning one off leaves the others working —
/// which is what makes a single-strategy ablation mean what it says.
#[test]
fn each_strategy_can_be_disabled_on_its_own() {
    let cases = [
        (HealingStrategy::StripFences, "```ts\nconst x = 1;\n```"),
        (
            HealingStrategy::StripProse,
            "Here is the program.\n\nconst x = 1;\nreturn x;",
        ),
        (
            HealingStrategy::DropImports,
            "import { writeFile } from \"gg\";\nwriteFile(\"a.txt\", \"hi\");",
        ),
        (
            HealingStrategy::UnwrapAsync,
            "async function main() {\n  await writeFile(\"a.txt\", \"hi\");\n}\nmain();",
        ),
    ];
    for (strategy, reply) in cases {
        let armed = healed(reply);
        assert!(
            armed.strategies().contains(&strategy),
            "{}: did not fire when armed",
            strategy.id()
        );

        let mut config = HealingConfig::default();
        config.set(strategy, false);
        let disarmed = heal(reply, &config, dialect());
        assert!(
            !disarmed.strategies().contains(&strategy),
            "{}: fired while disarmed",
            strategy.id()
        );
    }
}

/// A capability that says nothing about healing gets **the defaults** — which is not the same thing
/// as every strategy.
#[test]
fn absent_healing_takes_the_defaults() {
    for params in [
        json!({}),
        json!({ "healing": null }),
        json!({ "healing": true }),
    ] {
        let resolved = resolve_healing(&set_with(params.clone()));
        assert_eq!(resolved.config, HealingConfig::default(), "{params}");
        assert!(resolved.unknown_params.is_empty(), "{params}");
    }
    assert_eq!(
        resolve_healing(&GgAgentConfig::root()).config,
        HealingConfig::default()
    );
}

/// **The default arm, spelled out.** Five strategies are on because repairing is strictly safer than
/// not; `drop-doubled-response` is off because the half it deletes is valid code under any other
/// reading, so it is armed deliberately rather than by omission.
///
/// Asserted as a literal table rather than by folding `default_armed` over `ALL`, because a test
/// that recomputed the thing it is checking would agree with any change to it.
#[test]
fn the_defaults_arm_every_strategy_except_the_doubled_response_one() {
    let expected = [
        (HealingStrategy::StripFences, true),
        (HealingStrategy::StripProse, true),
        (HealingStrategy::DropDoubledResponse, false),
        (HealingStrategy::DropDuplicateProgram, true),
        (HealingStrategy::DropImports, true),
        (HealingStrategy::UnwrapAsync, true),
    ];
    let config = HealingConfig::default();
    for (strategy, armed) in expected {
        assert_eq!(
            strategy.default_armed(),
            armed,
            "{}: wrong declared default",
            strategy.id()
        );
        assert_eq!(
            config.enabled(strategy),
            armed,
            "{}: the default configuration disagrees with the declared default",
            strategy.id()
        );
    }
    assert_eq!(
        config.armed(),
        vec![
            HealingStrategy::StripFences,
            HealingStrategy::StripProse,
            HealingStrategy::DropDuplicateProgram,
            HealingStrategy::DropImports,
            HealingStrategy::UnwrapAsync,
        ],
        "the launch log would name the wrong arm"
    );
}

/// The default-off strategy is armed by the **same** `{ "<id>": true }` mechanism that disarms a
/// default-on one with `false` — there is no second path, which is what keeps the documented truth
/// table a description of one line of code.
#[test]
fn the_doubled_response_strategy_is_armed_by_naming_it() {
    let resolved = resolve_healing(&set_with(
        json!({ "healing": { "drop-doubled-response": true } }),
    ));
    assert!(
        resolved
            .config
            .enabled(HealingStrategy::DropDoubledResponse)
    );
    assert!(resolved.unknown_params.is_empty());
    // Naming one strategy leaves every other one at its own default.
    for strategy in HealingStrategy::ALL {
        if strategy != HealingStrategy::DropDoubledResponse {
            assert_eq!(
                resolved.config.enabled(strategy),
                strategy.default_armed(),
                "{}",
                strategy.id()
            );
        }
    }
    assert!(
        resolved
            .config
            .armed_summary()
            .contains("drop-doubled-response"),
        "the launch log did not name the strategy the operator armed: {}",
        resolved.config.armed_summary()
    );
}

/// `"healing": false` is still the master switch **over the defaults**: it turns off the five that
/// were on and leaves off the one that already was.
#[test]
fn the_master_switch_disarms_the_default_off_strategy_too() {
    let resolved = resolve_healing(&set_with(json!({ "healing": false })));
    for strategy in HealingStrategy::ALL {
        assert!(!resolved.config.enabled(strategy), "{}", strategy.id());
    }
}

/// `"healing": false` is the master switch.
#[test]
fn healing_false_disarms_everything() {
    let resolved = resolve_healing(&set_with(json!({ "healing": false })));
    assert_eq!(resolved.config, HealingConfig::OFF);
    assert!(resolved.unknown_params.is_empty());
}

/// One strategy can be named and disarmed; every other one stays at its own default.
#[test]
fn a_named_strategy_can_be_disarmed() {
    let resolved = resolve_healing(&set_with(json!({ "healing": { "strip-prose": false } })));
    assert!(!resolved.config.enabled(HealingStrategy::StripProse));
    for strategy in HealingStrategy::ALL {
        if strategy != HealingStrategy::StripProse {
            assert_eq!(
                resolved.config.enabled(strategy),
                strategy.default_armed(),
                "{}",
                strategy.id()
            );
        }
    }
    assert!(resolved.unknown_params.is_empty());
}

/// A key that names nothing gg knows is **reported**, never guessed at.
///
/// A typo in an ablation's configuration is the one failure this subsystem cannot survive:
/// `stripFences` silently running the default arm under the disabled arm's name would make every
/// number the study produced a measurement of the wrong thing.
#[test]
fn an_unknown_healing_key_is_reported_not_guessed_at() {
    let resolved = resolve_healing(&set_with(json!({ "healing": { "stripFences": false } })));
    assert_eq!(resolved.config, HealingConfig::default());
    assert_eq!(resolved.unknown_params, vec!["healing.stripFences"]);
}

/// A known id whose value is not a toggle keeps its default, and the key is reported: `0` is not
/// `false`, and reading it as one would be exactly the silent reinterpretation above.
///
/// It cuts both ways — `{"drop-doubled-response": 1}` leaves the strategy **off**, because `1` is
/// not `true` either, and an operator who thinks they armed it is told they did not.
#[test]
fn a_non_boolean_toggle_keeps_its_default_and_is_reported() {
    let resolved = resolve_healing(&set_with(json!({ "healing": { "strip-prose": 0 } })));
    assert!(resolved.config.enabled(HealingStrategy::StripProse));
    assert_eq!(resolved.unknown_params, vec!["healing.strip-prose"]);

    let resolved = resolve_healing(&set_with(
        json!({ "healing": { "drop-doubled-response": 1 } }),
    ));
    assert!(
        !resolved
            .config
            .enabled(HealingStrategy::DropDoubledResponse)
    );
    assert_eq!(
        resolved.unknown_params,
        vec!["healing.drop-doubled-response"]
    );

    for unreadable in [json!(5), json!("off"), json!([])] {
        let resolved = resolve_healing(&set_with(json!({ "healing": unreadable })));
        assert_eq!(resolved.config, HealingConfig::default());
        assert_eq!(resolved.unknown_params, vec!["healing"]);
    }
}

/// A capability that is present but **disabled** configures nothing: healing never runs for such a
/// run, so honouring its params would record an intention that had no effect.
#[test]
fn healing_params_on_a_disabled_capability_are_ignored() {
    let set = GgAgentConfig {
        capabilities: vec![GgCapabilityConfig {
            params: json!({ "healing": false }),
            ..GgCapabilityConfig::disabled(CAPABILITY_RESPONSES_AS_CODE)
        }],
        ..GgAgentConfig::root()
    };
    let resolved = resolve_healing(&set);
    assert_eq!(resolved.config, HealingConfig::default());
    assert!(resolved.unknown_params.is_empty());
}

// ---------------------------------------------------------------------------------------------
// The assistant-message mode
// ---------------------------------------------------------------------------------------------

/// A capability that says nothing about assistant messages records the reply as sent — the default,
/// and the behaviour every run had before the mode existed.
#[test]
fn absent_assistant_messages_is_no_post_processing() {
    for params in [json!({}), json!({ "assistantMessages": null })] {
        let resolved = resolve_assistant_messages(&set_with(params.clone()));
        assert_eq!(resolved.mode, AssistantMessageMode::None, "{params}");
        assert!(resolved.unknown_params.is_empty(), "{params}");
    }
    assert_eq!(
        resolve_assistant_messages(&GgAgentConfig::root()).mode,
        AssistantMessageMode::None
    );
}

/// The two named modes each resolve to their variant, and neither is reported.
#[test]
fn each_named_mode_resolves() {
    let none = resolve_assistant_messages(&set_with(json!({ "assistantMessages": "none" })));
    assert_eq!(none.mode, AssistantMessageMode::None);
    assert!(none.unknown_params.is_empty());

    let healing = resolve_assistant_messages(&set_with(
        json!({ "assistantMessages": "response-healing" }),
    ));
    assert_eq!(healing.mode, AssistantMessageMode::ResponseHealing);
    assert!(healing.unknown_params.is_empty());
}

/// A value naming no mode gg knows falls back to the default and is **reported**, never guessed at —
/// the same discipline the healing keys follow, and for the same reason: a mode is a lever a study
/// slices on, so a typo must change nothing silently.
#[test]
fn an_unknown_assistant_messages_value_is_reported() {
    for unreadable in [json!("healed"), json!(true), json!(5), json!([])] {
        let resolved =
            resolve_assistant_messages(&set_with(json!({ "assistantMessages": unreadable })));
        assert_eq!(resolved.mode, AssistantMessageMode::None);
        assert_eq!(resolved.unknown_params, vec!["assistantMessages"]);
    }
}

/// A present but **disabled** capability configures nothing, exactly as its healing params do.
#[test]
fn assistant_messages_on_a_disabled_capability_are_ignored() {
    let set = GgAgentConfig {
        capabilities: vec![GgCapabilityConfig {
            params: json!({ "assistantMessages": "response-healing" }),
            ..GgCapabilityConfig::disabled(CAPABILITY_RESPONSES_AS_CODE)
        }],
        ..GgAgentConfig::root()
    };
    let resolved = resolve_assistant_messages(&set);
    assert_eq!(resolved.mode, AssistantMessageMode::None);
    assert!(resolved.unknown_params.is_empty());
}
