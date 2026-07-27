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

// ---------------------------------------------------------------------------------------------
// The committed round-1 corpus
// ---------------------------------------------------------------------------------------------

/// The minimal malformed close: one `ts` block whose closing fence carries a sentence on the same
/// line. The first six lines of the reply below, and the shape that made a round-1 session
/// unrecoverable.
pub(super) const GEMINI_GLUED_CLOSE: &str = include_str!("testdata/round1-gemini-glued-close.txt");

/// 9,800 bytes: **seven** `ts` candidates (two of them opened by prose glued to the fence), every
/// one of them closed with prose glued on, beside seven fabricated `json` blocks and seven `text`
/// blocks of invented output. The flagship of the round-1 failures.
pub(super) const GEMINI_TURN_01: &str = include_str!("testdata/round1-gemini-turn-01.txt");

/// **Five** cleanly-fenced `ts` blocks in one reply, then a paragraph narrating the whole task as
/// finished. The model whose deliverable was in a discarded block.
pub(super) const GPT_TURN_01: &str = include_str!("testdata/round1-gpt-turn-01.txt");

/// Prose, **two** `ts` blocks, prose.
pub(super) const HAIKU_TURN_01: &str = include_str!("testdata/round1-haiku-turn-01.txt");

/// The glued **open**: a sentence and the next block's opening fence on one line, making **two**
/// candidates out of what reads as one program and one follow-up.
pub(super) const DEEPSEEK_TURN_01: &str = include_str!("testdata/round1-deepseek-turn-01.txt");

/// The positive case: prose, one `ts` block, prose — the single most common real shape.
pub(super) const HAIKU_TURN_03: &str = include_str!("testdata/round1-haiku-turn-03.txt");

/// The modal terminal reply: four lines of prose declaring the task complete.
pub(super) const HAIKU_TURN_04: &str = include_str!("testdata/round1-haiku-turn-04.txt");

/// A one-line terminal prose reply.
pub(super) const DEEPSEEK_TURN_04: &str = include_str!("testdata/round1-deepseek-turn-04.txt");

/// A one-line terminal prose reply.
pub(super) const GEMINI_TURN_03: &str = include_str!("testdata/round1-gemini-turn-03.txt");

/// A one-line terminal prose reply.
pub(super) const GPT_TURN_02: &str = include_str!("testdata/round1-gpt-turn-02.txt");

// ---------------------------------------------------------------------------------------------
// The committed round-2 corpus — the fence-free shapes
// ---------------------------------------------------------------------------------------------

/// Round 2, with fences gone from the contract: **the same five-line program pasted verbatim
/// twice**, with no fence anywhere. It redeclares `const root`, so as sent it could not execute a
/// single statement — the guest answered it with `SyntaxError: redeclaration of const root` and the
/// turn was lost.
pub(super) const SOL_DUPLICATE_PROGRAM: &str =
    include_str!("testdata/round2-sol-duplicate-program.txt");

/// The same shape from the other model, two lines long: `const files` declared twice.
pub(super) const TERRA_DUPLICATE_PROGRAM: &str =
    include_str!("testdata/round2-terra-duplicate-program.txt");

/// Round 2's other fence-free shape: **two different drafts**, the first ending in a top-level
/// `return`. It compiles and runs — and everything after that `return`, including the `writeFile`
/// of the deliverable and the `finish` that would have ended the run, is dead code. Healing must
/// leave it alone (there is nothing here it could delete without changing what runs); the
/// [type-strip](crate::sandbox) is what reports the dead half.
pub(super) const TERRA_TWO_DRAFTS: &str = include_str!("testdata/round2-terra-two-drafts.txt");

/// The same two-draft shape from the other model, and the one whose discarded half held the whole
/// deliverable.
pub(super) const SOL_TWO_DRAFTS: &str = include_str!("testdata/round2-sol-two-drafts.txt");

/// Round 2's largest fence-free shape: **five** programs in one reply, each followed by the output
/// the model invented for it — a whole session narrated in a single turn. Only one name (`const
/// srcEntries`) is declared by two of the five, so it is the fixture that pins what the candidate
/// count means when the redeclaration evidence proves fewer programs than the reply holds.
pub(super) const GEMINI_FIVE_PROGRAMS: &str =
    include_str!("testdata/round2-gemini-five-programs.txt");

/// One reply in the corpus, named so a failure says which one.
pub(super) struct Fixture {
    /// The fixture's file stem, or a description for the synthetic shapes.
    pub(super) name: &'static str,
    /// The reply, verbatim.
    pub(super) reply: &'static str,
}

/// The four terminal prose replies real models ended their sessions with — the failure Decision B
/// exists to break, and the evidence that `strip-prose` cannot be the thing that catches it.
pub(super) const TERMINAL_PROSE: [Fixture; 4] = [
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
pub(super) const CAPTURED_PROGRAM_REPLIES: [Fixture; 6] = [
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
pub(super) const CORPUS: &[Fixture] = &[
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

/// Every one of the 32 on/off combinations of the five strategies — what "every configuration"
/// means in the property tests.
pub(super) fn every_configuration() -> Vec<HealingConfig> {
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

/// Heal with every strategy armed — the default arm, and what most cases mean by "heal".
pub(super) fn healed(reply: &str) -> Healed {
    heal(reply, false, &HealingConfig::default())
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

/// Whether `needle`'s non-whitespace characters appear, in order, among `haystack`'s.
fn is_subsequence(needle: &str, haystack: &str) -> bool {
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
/// reorders" for all five strategies at once, over the whole corpus under all 32 configurations.
#[test]
fn every_healed_program_is_a_subsequence_of_the_response() {
    for fixture in CORPUS {
        for config in every_configuration() {
            for had_tool_calls in [false, true] {
                let result = heal(fixture.reply, had_tool_calls, &config);
                assert!(
                    is_subsequence(&result.program, fixture.reply),
                    "{}: healing invented or reordered text\n--- program ---\n{}",
                    fixture.name,
                    result.program
                );
            }
        }
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
            let once = heal(fixture.reply, false, &config);
            let twice = heal(&once.program, false, &config);
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
        let partial = heal(EVERY_STRATEGY, false, &config);
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
            to_fixpoint(&mut text, &HealingConfig::default(), &mut applied, 3),
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
    assert_eq!(result.verdict, HealingVerdict::Program);
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
            "drop-duplicate-program",
            "drop-imports",
            "unwrap-async",
            "strip-comment-only"
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
    let unhelped = heal(reply, false, &without_imports);
    assert!(
        unhelped.applied.is_empty(),
        "the wrapper unwrapped with the import still above it: {:?}",
        unhelped.applied
    );
}

/// A not-a-program verdict stops the pipeline dead, so `program` really is "the text as it stood
/// when classification stopped".
///
/// Without the rule, `strip-fences` could classify a response and `strip-prose` could then edit the
/// very text the verdict describes.
#[test]
fn a_not_a_program_verdict_short_circuits_the_pipeline() {
    let reply = "Here is the plan.\n\n\
                 ```ts\nwriteFile(\"a.txt\", \"a\");\n```\n\n\
                 ```ts\nwriteFile(\"b.txt\", \"b\");\n```\n\n\
                 That is everything.";
    let result = healed(reply);
    assert_eq!(
        result.verdict,
        HealingVerdict::NotAProgram(NotAProgramReason::SeveralBlocks {
            blocks: 2,
            shape: CandidateShape::Fenced,
        })
    );
    assert_eq!(
        result.program,
        reply.trim(),
        "a later strategy edited a classified response"
    );
    assert!(result.applied.is_empty(), "{:?}", result.applied);
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

/// A response that was only *classified* was not healed: nothing ran, so nothing was repaired — and
/// both facts are still recorded, because the model has to be told both.
#[test]
fn a_classified_response_is_counted_but_not_healed() {
    let result = healed("```ts\n// Everything is already done.\n```");
    assert_eq!(
        result.verdict,
        HealingVerdict::NotAProgram(NotAProgramReason::CommentOnly)
    );
    assert_eq!(
        result.strategies(),
        vec![
            HealingStrategy::StripFences,
            HealingStrategy::StripCommentOnly
        ],
        "both applications must be recorded"
    );
    assert!(!result.rewritten(), "a classified response is not a heal");
    assert_eq!(
        result.notes().len(),
        1,
        "the verdict must not be rendered twice: {:?}",
        result.notes()
    );
}

/// A reply with no text but native tool calls is told what it actually did, rather than that it was
/// empty.
#[test]
fn a_response_with_tool_calls_and_no_text_is_tool_calls_only() {
    let result = heal("", true, &HealingConfig::default());
    assert_eq!(
        result.verdict,
        HealingVerdict::NotAProgram(NotAProgramReason::ToolCallsOnly)
    );
    assert!(
        NotAProgramReason::ToolCallsOnly
            .message()
            .contains("no text"),
        "the model is told its reply was empty rather than what it did"
    );
}

/// Every one of the ten committed round-1 replies produces the verdict this design was built
/// against. The table is the specification's, and the counts are measured rather than estimated.
#[test]
fn the_committed_round_one_replies_produce_their_recorded_verdicts() {
    let expected: [(&str, &str, HealingVerdict); 10] = [
        (
            "round1-gemini-glued-close",
            GEMINI_GLUED_CLOSE,
            HealingVerdict::Program,
        ),
        (
            "round1-gemini-turn-01",
            GEMINI_TURN_01,
            HealingVerdict::NotAProgram(NotAProgramReason::SeveralBlocks {
                blocks: 7,
                shape: CandidateShape::Fenced,
            }),
        ),
        (
            "round1-gpt-turn-01",
            GPT_TURN_01,
            HealingVerdict::NotAProgram(NotAProgramReason::SeveralBlocks {
                blocks: 5,
                shape: CandidateShape::Fenced,
            }),
        ),
        (
            "round1-haiku-turn-01",
            HAIKU_TURN_01,
            HealingVerdict::NotAProgram(NotAProgramReason::SeveralBlocks {
                blocks: 2,
                shape: CandidateShape::Fenced,
            }),
        ),
        (
            "round1-deepseek-turn-01",
            DEEPSEEK_TURN_01,
            HealingVerdict::NotAProgram(NotAProgramReason::SeveralBlocks {
                blocks: 2,
                shape: CandidateShape::Fenced,
            }),
        ),
        (
            "round1-haiku-turn-03",
            HAIKU_TURN_03,
            HealingVerdict::Program,
        ),
        (
            "round1-haiku-turn-04",
            HAIKU_TURN_04,
            HealingVerdict::Program,
        ),
        (
            "round1-deepseek-turn-04",
            DEEPSEEK_TURN_04,
            HealingVerdict::Program,
        ),
        (
            "round1-gemini-turn-03",
            GEMINI_TURN_03,
            HealingVerdict::Program,
        ),
        ("round1-gpt-turn-02", GPT_TURN_02, HealingVerdict::Program),
    ];
    for (name, reply, verdict) in expected {
        assert_eq!(healed(reply).verdict, verdict, "{name}");
    }
}

// ---------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------

/// With everything disarmed, healing changes nothing at all — the ablation's off arm.
#[test]
fn healing_off_is_a_no_op() {
    let result = heal(EVERY_STRATEGY, false, &HealingConfig::OFF);
    assert_eq!(result.program, EVERY_STRATEGY.trim());
    assert!(result.applied.is_empty());
    assert_eq!(result.verdict, HealingVerdict::Program);
}

/// Even with everything disarmed, an empty reply is not a program.
///
/// Reading an empty string as "nothing to run" is not a repair, it is reading it correctly — and the
/// alternative is that the off arm transpiles the empty program, runs it to a silent success, and
/// loops forever on a model that has stopped answering.
#[test]
fn healing_off_still_refuses_an_empty_response() {
    assert_eq!(
        heal("   \n  ", false, &HealingConfig::OFF).verdict,
        HealingVerdict::NotAProgram(NotAProgramReason::Empty)
    );
    assert_eq!(
        heal("", true, &HealingConfig::OFF).verdict,
        HealingVerdict::NotAProgram(NotAProgramReason::ToolCallsOnly)
    );
}

/// Each strategy can be turned off on its own, and turning one off leaves the other four working —
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
        (
            HealingStrategy::StripCommentOnly,
            "// Everything is already done.",
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
        let disarmed = heal(reply, false, &config);
        assert!(
            !disarmed.strategies().contains(&strategy),
            "{}: fired while disarmed",
            strategy.id()
        );
    }
}

/// A capability that says nothing about healing gets every strategy.
#[test]
fn absent_healing_arms_everything() {
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

/// `"healing": false` is the master switch.
#[test]
fn healing_false_disarms_everything() {
    let resolved = resolve_healing(&set_with(json!({ "healing": false })));
    assert_eq!(resolved.config, HealingConfig::OFF);
    assert!(resolved.unknown_params.is_empty());
}

/// One strategy can be named and disarmed; the rest stay armed.
#[test]
fn a_named_strategy_can_be_disarmed() {
    let resolved = resolve_healing(&set_with(json!({ "healing": { "strip-prose": false } })));
    assert!(!resolved.config.enabled(HealingStrategy::StripProse));
    for strategy in HealingStrategy::ALL {
        if strategy != HealingStrategy::StripProse {
            assert!(resolved.config.enabled(strategy), "{}", strategy.id());
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

/// A known id whose value is not a toggle stays armed, and the key is reported: `0` is not `false`,
/// and reading it as one would be exactly the silent reinterpretation above.
#[test]
fn a_non_boolean_toggle_stays_armed_and_is_reported() {
    let resolved = resolve_healing(&set_with(json!({ "healing": { "strip-prose": 0 } })));
    assert!(resolved.config.enabled(HealingStrategy::StripProse));
    assert_eq!(resolved.unknown_params, vec!["healing.strip-prose"]);

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
// Disclosure
// ---------------------------------------------------------------------------------------------

/// Every reason carries a model-facing sentence and an operator-facing clause, and the `match` is
/// exhaustive so a reason cannot ship without either.
#[test]
fn every_not_a_program_reason_has_a_message() {
    for reason in [
        NotAProgramReason::Empty,
        NotAProgramReason::ToolCallsOnly,
        NotAProgramReason::Prose,
        NotAProgramReason::CommentOnly,
        NotAProgramReason::NoProgramBlock,
        NotAProgramReason::SeveralBlocks {
            blocks: 3,
            shape: CandidateShape::Fenced,
        },
    ] {
        // The exhaustive arm: adding a reason without a sentence fails to compile here.
        match reason {
            NotAProgramReason::Empty
            | NotAProgramReason::ToolCallsOnly
            | NotAProgramReason::Prose
            | NotAProgramReason::CommentOnly
            | NotAProgramReason::NoProgramBlock
            | NotAProgramReason::SeveralBlocks { .. } => {}
        }
        assert!(!reason.message().is_empty(), "{reason:?}");
        assert!(!reason.short().is_empty(), "{reason:?}");
        assert!(
            reason.message().ends_with('.'),
            "the model-facing sentence is not a sentence: {reason:?}"
        );
        assert!(
            !reason.short().ends_with('.'),
            "the operator clause is embedded in a longer sentence: {reason:?}"
        );
    }
}

/// The several-blocks wording names the count, because the count *is* the instruction-following
/// signal: how many programs the model believed it was emitting in one turn.
#[test]
fn the_several_blocks_message_names_the_count() {
    let reason = NotAProgramReason::SeveralBlocks {
        blocks: 7,
        shape: CandidateShape::Fenced,
    };
    assert!(
        reason.message().contains("7 separate code blocks"),
        "{}",
        reason.message()
    );
    assert!(reason.short().contains('7'), "{}", reason.short());
}

/// Every repair renders a clause the model can learn from, and the two classifications render none —
/// they are verdicts, and the not-a-program message already carries them.
///
/// The `match` is exhaustive over `HealingDetail`, so a new variant cannot ship without deciding
/// what the model is told about it.
#[test]
fn every_detail_renders_a_note() {
    let details = [
        HealingDetail::Fence {
            close: FenceClose::Fenced,
            ignored: 0,
            ignored_code: 0,
        },
        HealingDetail::Fence {
            close: FenceClose::Glued,
            ignored: 1,
            ignored_code: 0,
        },
        HealingDetail::Fence {
            close: FenceClose::Unterminated,
            ignored: 2,
            ignored_code: 1,
        },
        HealingDetail::Prose {
            leading: 2,
            trailing: 1,
        },
        HealingDetail::Prose {
            leading: 0,
            trailing: 3,
        },
        HealingDetail::Imports { lines: 1 },
        HealingDetail::Async {
            wrapper: AsyncWrapper::Function,
            awaits: 3,
        },
        HealingDetail::Async {
            wrapper: AsyncWrapper::Iife,
            awaits: 0,
        },
        HealingDetail::CommentOnly,
        HealingDetail::ProseOnly,
        HealingDetail::DuplicateProgram,
        HealingDetail::SeveralPrograms,
    ];
    for detail in details {
        let note = detail.note();
        match detail {
            HealingDetail::CommentOnly
            | HealingDetail::ProseOnly
            | HealingDetail::SeveralPrograms => {
                assert!(
                    note.is_none(),
                    "a verdict rendered a repair clause: {detail:?}"
                );
            }
            HealingDetail::Fence { .. }
            | HealingDetail::Prose { .. }
            | HealingDetail::Imports { .. }
            | HealingDetail::DuplicateProgram
            | HealingDetail::Async { .. } => {
                let note = note.expect("a repair with no model-facing clause");
                assert!(!note.is_empty(), "{detail:?}");
                assert!(
                    !note.contains("1 lines") && !note.contains("1 awaits"),
                    "a plural where the count is one: {note}"
                );
            }
        }
    }

    // The exact wording of the counted clauses, since it is a product surface rather than a comment.
    assert_eq!(
        HealingDetail::Prose {
            leading: 2,
            trailing: 1
        }
        .note()
        .unwrap(),
        "removed 2 lines of explanation before your program and 1 after it"
    );
    assert_eq!(
        HealingDetail::Imports { lines: 1 }.note().unwrap(),
        "removed 1 import line — every tool is already in scope, and there is nothing to import"
    );
    assert_eq!(
        HealingDetail::Async {
            wrapper: AsyncWrapper::Function,
            awaits: 3
        }
        .note()
        .unwrap(),
        "unwrapped the async function you wrapped your program in, and removed its 3 awaits — \
         every tool function is synchronous and returns its value directly"
    );
}
