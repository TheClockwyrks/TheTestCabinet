//! Tests for the healing **pipeline**: the fixture corpus, the ordering, the fixpoint, idempotence,
//! the deletion-only invariant, disclosure, and configuration resolution.
//!
//! The per-strategy cases live beside them in `healing.fences.test.rs` (everything about a fence)
//! and `healing.programs.test.rs` (prose, the doubled response, comments and the predicates).
//! This file owns the round-1 corpus itself, because the corpus is one thing and the properties
//! asserted over it — subsequence, idempotence, convergence — are properties of the whole of it.
//!
//! Nothing here compiles a component, starts a runtime, or touches a file at run time: healing is a
//! pure function over a string, which is exactly why every failure shape real models produced can be
//! pinned as a microsecond-scale unit test.

use serde_json::json;
use test_cabinet_core::gg::{CAPABILITY_RESPONSES_AS_CODE, GgAgentConfig, GgCapabilityConfig};

use super::*;
use crate::validate::{LaunchDefect, LaunchReport};

/// The healing configuration `profile` resolves to, asserting gg honoured it exactly as written.
fn healing_of(profile: &GgAgentConfig) -> HealingConfig {
    let mut report = LaunchReport::collecting();
    let config = resolve_healing(profile, &mut report);
    let defects = report.into_defects();
    assert!(defects.is_empty(), "unexpected refusals: {defects:?}");
    config
}

/// Everything resolving `profile`'s healing reports, for the cases whose subject is the refusal.
fn healing_refusal(profile: &GgAgentConfig) -> (HealingConfig, Vec<LaunchDefect>) {
    let mut report = LaunchReport::collecting();
    let config = resolve_healing(profile, &mut report);
    (config, report.into_defects())
}

/// The assistant-message mode `profile` resolves to, asserting gg honoured it exactly as written.
fn assistant_messages_of(profile: &GgAgentConfig) -> AssistantMessageMode {
    let mut report = LaunchReport::collecting();
    let mode = resolve_assistant_messages(profile, &mut report);
    let defects = report.into_defects();
    assert!(defects.is_empty(), "unexpected refusals: {defects:?}");
    mode
}

/// Everything resolving `profile`'s assistant-message mode reports.
fn assistant_messages_refusal(
    profile: &GgAgentConfig,
) -> (AssistantMessageMode, Vec<LaunchDefect>) {
    let mut report = LaunchReport::collecting();
    let mode = resolve_assistant_messages(profile, &mut report);
    (mode, report.into_defects())
}

/// The [dialect](Dialect) every case in this file heals through: **TypeScript's**.
///
/// Named for the language rather than for a language gg would pick, because that is what these
/// cases are about:
/// the corpus is a set of replies real models sent to a TypeScript run, and every expectation in it
/// — which fence tags are the program's, which lines are prose, which could only be code — is that
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
/// leave it alone: there is nothing here it could delete without changing what runs, and the
/// halves are two different drafts rather than the byte-exact copy
/// [`DropDoubledResponse`](HealingStrategy::DropDoubledResponse) matches.
///
/// Nothing else reports the dead half either, for as long as the ECMAScript arms evaluate a program
/// as a function body: the `return` is legal, the turn is recorded as a success, and the model is
/// told its program ran. The wrapper is what makes the tail dead, and deleting the wrapper is what
/// turns this reply into an early error the language itself refuses.
pub(crate) const TERRA_TWO_DRAFTS: &str = include_str!("testdata/round2-terra-two-drafts.txt");

/// The same two-draft shape from the other model, and the one whose discarded half held the whole
/// deliverable.
pub(crate) const SOL_TWO_DRAFTS: &str = include_str!("testdata/round2-sol-two-drafts.txt");

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

/// A program wrapped in a fence with prose inside it — both of the
/// [safe repairs](HealingConfig::SAFE_REPAIRS), in one reply.
const EVERY_STRATEGY: &str = "\
```ts
Here is what I will do.

writeFile(\"a.txt\", \"hi\");
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
        name: "indented-fence",
        reply: "1. First, list the files:\n\n   ```ts\n   const files = listDir(\"src\");\n   return files.length;\n   ```\n",
    },
    Fixture {
        name: "indented-fence-with-a-nested-block",
        reply: "  ```ts\n  const files = listDir(\"src\");\n  for (const file of files) {\n    view.openFile(file);\n  }\n  ```",
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
/// strategy widens the property tests by itself: three strategies is eight configurations, and the
/// day there are four it is sixteen with no edit here.
pub(crate) fn every_configuration() -> Vec<HealingConfig> {
    (0..(1u32 << HealingStrategy::ALL.len()))
        .map(|bits| {
            let mut config = HealingConfig::OFF;
            for (index, strategy) in HealingStrategy::ALL.into_iter().enumerate() {
                config.set(strategy, bits & (1 << index) != 0);
            }
            config
        })
        .collect()
}

/// Heal under the [two repairs whose warrant holds unconditionally](HealingConfig::SAFE_REPAIRS) —
/// what most cases mean by "heal".
///
/// That is deliberately not the same as "every strategy armed":
/// [`drop-doubled-response`](HealingStrategy::DropDoubledResponse) deletes a half that is valid code
/// under any other reading, so a case that exercises it goes through [`healed_with`] instead.
pub(crate) fn healed(reply: &str) -> Healed {
    heal(reply, &HealingConfig::SAFE_REPAIRS, dialect())
}

/// Heal with `strategy` armed on top of the [safe repairs](HealingConfig::SAFE_REPAIRS) — the way
/// the third strategy is exercised, and the way an operator arms it for a real run.
pub(crate) fn healed_with(strategy: HealingStrategy, reply: &str) -> Healed {
    let mut config = HealingConfig::SAFE_REPAIRS;
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
/// [every configuration](every_configuration) — all eight of them.
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

/// **The invariant the delete-only one cannot see: unwrapping moves every line by the same
/// indent.**
///
/// [`is_subsequence`] compares non-whitespace characters, so a repair that dedented one line of a
/// program and not the next would pass it — and passed it for as long as gg had one language, which
/// is a language that ignores leading whitespace. The moment a program is written in one where
/// indentation is punctuation, a half-dedented program is a syntax error over text the model never
/// wrote, reported against a reply that is fine. The defect is invisible to every other property
/// here by construction, so it gets one of its own.
///
/// The claim: after the two strategies that *unwrap* — [`StripFences`](HealingStrategy::StripFences)
/// and [`StripProse`](HealingStrategy::StripProse) — there is a single indent that, put back in
/// front of every non-blank line of the program, yields a line the model really sent. One indent for
/// all of them is exactly "the block moved"; two would be "gg misaligned it".
///
/// Only those two are armed, deliberately. `drop-doubled-response` deletes a copy of the reply
/// rather than moving a block, so it has no indent to preserve and nothing to say here.
#[test]
fn unwrapping_moves_every_line_of_the_program_by_one_indent() {
    let mut config = HealingConfig::OFF;
    config.set(HealingStrategy::StripFences, true);
    config.set(HealingStrategy::StripProse, true);

    for fixture in CORPUS {
        let result = heal(fixture.reply, &config, dialect());
        let program: Vec<&str> = result
            .program
            .lines()
            .map(str::trim_end)
            .filter(|line| !line.is_empty())
            .collect();
        if program.is_empty() {
            continue;
        }
        let sent: std::collections::HashSet<&str> =
            fixture.reply.lines().map(str::trim_end).collect();
        // The candidate indents are the ones the reply actually uses, plus none at all.
        let mut candidates: Vec<&str> = fixture
            .reply
            .lines()
            .map(|line| &line[..line.len() - line.trim_start().len()])
            .collect();
        candidates.push("");
        assert!(
            candidates.iter().any(|indent| program
                .iter()
                .all(|line| sent.contains(format!("{indent}{line}").trim_end()))),
            "{}: healing left the program's lines at two different indents\n--- program ---\n{}",
            fixture.name,
            result.program
        );
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
/// a fixpoint — a configuration that oscillated would produce a different program every turn.
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
                &HealingConfig::SAFE_REPAIRS,
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
/// One reply that needs both [safe repairs](HealingConfig::SAFE_REPAIRS) produces them in one pass,
/// in order — which is
/// also the order the config table, the session summary and the docs page list them in, so the
/// listings cannot drift apart.
#[test]
fn strategies_apply_in_the_documented_order() {
    assert_eq!(
        HealingStrategy::ALL.map(HealingStrategy::id),
        ["strip-fences", "strip-prose", "drop-doubled-response"]
    );
    let result = healed(EVERY_STRATEGY);
    assert_eq!(
        result.strategies(),
        vec![HealingStrategy::StripFences, HealingStrategy::StripProse],
        "program: {}",
        result.program
    );
    assert_eq!(result.program, "writeFile(\"a.txt\", \"hi\");");
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

/// Every one of the ten committed round-1 replies now reaches the type-strip. This case walks the
/// six that carry a program, and the two of those that carry one candidate block are unwrapped to
/// it.
///
/// The table is measured rather than estimated: the other four carry several candidates each and
/// are handed on whole. The remaining four replies of the ten are
/// terminal prose, and the case above is where they are pinned.
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

/// With everything disarmed, healing changes nothing at all — the off arm of the comparison.
#[test]
fn healing_off_is_a_no_op() {
    let result = heal(EVERY_STRATEGY, &HealingConfig::OFF, dialect());
    assert_eq!(result.program, EVERY_STRATEGY.trim());
    assert!(result.applied.is_empty());
}

/// Each strategy can be turned off on its own, and turning one off leaves the others working —
/// which is what makes a single-strategy configuration mean what it says.
#[test]
fn each_strategy_can_be_disabled_on_its_own() {
    let cases = [
        (HealingStrategy::StripFences, "```ts\nconst x = 1;\n```"),
        (
            HealingStrategy::StripProse,
            "Here is the program.\n\nconst x = 1;\nreturn x;",
        ),
    ];
    for (strategy, reply) in cases {
        let armed = healed(reply);
        assert!(
            armed.strategies().contains(&strategy),
            "{}: did not fire when armed",
            strategy.id()
        );

        let mut config = HealingConfig::SAFE_REPAIRS;
        config.set(strategy, false);
        let disarmed = heal(reply, &config, dialect());
        assert!(
            !disarmed.strategies().contains(&strategy),
            "{}: fired while disarmed",
            strategy.id()
        );
    }
}

/// **A capability that says nothing about healing is refused.** What a run repaired is the thing
/// under test, so a set gg armed on the operator's behalf would leave the record naming a
/// configuration the run was not conducted under.
#[test]
fn an_absent_healing_param_is_refused() {
    for params in [json!({}), json!({ "healing": null })] {
        let (config, defects) = healing_refusal(&set_with(params.clone()));
        assert_eq!(
            config,
            HealingConfig::LAUNCH_REFUSED,
            "{params}: the resolver stays total, on a named placeholder"
        );
        assert_eq!(defects.len(), 1, "{params} -> {defects:?}");
        assert_eq!(
            defects[0].locus, "responses-as-code.params.healing",
            "{params}"
        );
        assert_eq!(defects[0].found, "", "an absence has no value as written");
    }
}

/// **An object naming two of the three is refused, at the one it left out.** A set that says
/// nothing about a strategy has not said what that arm of the comparison was, and gg will not
/// decide it.
#[test]
fn an_object_leaving_a_strategy_out_is_refused() {
    for missing in HealingStrategy::ALL {
        let toggles: serde_json::Map<String, serde_json::Value> = HealingStrategy::ALL
            .into_iter()
            .filter(|strategy| *strategy != missing)
            .map(|strategy| (strategy.id().to_string(), json!(true)))
            .collect();
        let (_, defects) = healing_refusal(&set_with(json!({ "healing": toggles })));
        assert_eq!(defects.len(), 1, "{} -> {defects:?}", missing.id());
        assert_eq!(
            defects[0].locus,
            format!("responses-as-code.params.healing.{}", missing.id())
        );
    }

    // The empty object names none of them, so it is short of all three at once.
    let (_, defects) = healing_refusal(&set_with(json!({ "healing": {} })));
    let loci: Vec<&str> = defects.iter().map(|defect| defect.locus.as_str()).collect();
    assert_eq!(
        loci,
        HealingStrategy::ALL
            .iter()
            .map(|strategy| format!("responses-as-code.params.healing.{}", strategy.id()))
            .collect::<Vec<_>>()
    );
}

/// A key that is *named* but carries no toggle is one line, not two: the operator wrote something
/// there, and telling them it is also missing would be gg reading its own refusal back.
#[test]
fn a_named_but_unreadable_strategy_is_reported_once() {
    let (_, defects) = healing_refusal(&set_with(json!({ "healing": {
        "strip-fences": true, "strip-prose": 0, "drop-doubled-response": false
    } })));
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(
        defects[0].locus,
        "responses-as-code.params.healing.strip-prose"
    );
}

/// **The two words that state a whole set.** `true` arms every strategy and `false` arms none;
/// there is nothing between them a single word can say.
#[test]
fn the_master_switch_states_a_whole_set_in_either_direction() {
    assert_eq!(
        healing_of(&set_with(json!({ "healing": true }))),
        HealingConfig::EVERY
    );
    assert_eq!(
        healing_of(&set_with(json!({ "healing": false }))),
        HealingConfig::OFF
    );
    for strategy in HealingStrategy::ALL {
        assert!(HealingConfig::EVERY.enabled(strategy), "{}", strategy.id());
        assert!(!HealingConfig::OFF.enabled(strategy), "{}", strategy.id());
    }
}

/// An object naming all three is read strategy by strategy, in either direction — one arm of code
/// arms and disarms, which is what keeps the documented truth table a description of one line.
#[test]
fn an_object_naming_every_strategy_is_read_toggle_by_toggle() {
    let resolved = healing_of(&set_with(json!({ "healing": {
        "strip-fences": false, "strip-prose": true, "drop-doubled-response": true
    } })));
    assert!(!resolved.enabled(HealingStrategy::StripFences));
    assert!(resolved.enabled(HealingStrategy::StripProse));
    assert!(resolved.enabled(HealingStrategy::DropDoubledResponse));
    assert!(
        resolved.armed_summary().contains("drop-doubled-response"),
        "the launch log did not name the strategy the operator armed: {}",
        resolved.armed_summary()
    );
}

/// **An agent that takes no code turn has no reply to repair**, so a profile without the capability
/// resolves to every strategy off and is short of nothing.
#[test]
fn an_absent_capability_repairs_nothing() {
    assert_eq!(healing_of(&GgAgentConfig::root()), HealingConfig::OFF);
}

/// The set gg's own cases heal a fixture under is an ordinary configuration a profile could write,
/// which is what keeps it a fixture rather than a figure gg holds on anyone's behalf.
#[test]
fn the_test_fixture_is_a_configuration_a_profile_could_write() {
    assert_eq!(
        healing_of(&set_with(json!({ "healing": {
            "strip-fences": true, "strip-prose": true, "drop-doubled-response": false
        } }))),
        HealingConfig::SAFE_REPAIRS
    );
    assert_eq!(
        HealingConfig::SAFE_REPAIRS.armed(),
        vec![HealingStrategy::StripFences, HealingStrategy::StripProse]
    );
}

/// A key that names nothing gg knows **refuses the launch**, never guessed at.
///
/// A typo in a healing configuration is the one failure this subsystem cannot survive:
/// `stripFences` running one arm under the other's name would make every number the study produced
/// a measurement of the wrong thing.
#[test]
fn an_unknown_healing_key_is_refused() {
    let (config, defects) = healing_refusal(&set_with(json!({ "healing": {
        "strip-fences": true,
        "strip-prose": true,
        "drop-doubled-response": false,
        "stripFences": false
    } })));
    assert_eq!(
        config,
        HealingConfig::SAFE_REPAIRS,
        "the resolver stays total, on the three toggles it could read"
    );
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(
        defects[0].locus,
        "responses-as-code.params.healing.stripFences"
    );
    assert_eq!(
        defects[0].known,
        HealingStrategy::ALL.map(HealingStrategy::id).to_vec()
    );
}

/// **Every unreadable key is named in one refusal.** An operator fixing a sweep's one shared
/// configuration wants every typo, not the first one.
#[test]
fn every_unreadable_healing_key_is_named_at_once() {
    let (_, defects) = healing_refusal(&set_with(json!({ "healing": {
        "strip-fences": true,
        "strip-prose": 0,
        "drop-doubled-response": false,
        "stripFences": false
    } })));
    let mut loci: Vec<&str> = defects.iter().map(|defect| defect.locus.as_str()).collect();
    loci.sort_unstable();
    assert_eq!(
        loci,
        vec![
            "responses-as-code.params.healing.strip-prose",
            "responses-as-code.params.healing.stripFences",
        ]
    );
}

/// A strategy id written with stray whitespace around it is the strategy it names — the one liberty
/// taken with a vocabulary otherwise read literally — and it counts as having named it.
#[test]
fn surrounding_whitespace_does_not_hide_a_strategy() {
    let resolved = healing_of(&set_with(json!({ "healing": {
        "strip-fences": true, " strip-prose ": false, "drop-doubled-response": false
    } })));
    assert!(!resolved.enabled(HealingStrategy::StripProse));
    assert!(resolved.enabled(HealingStrategy::StripFences));
}

/// A known id whose value is not a toggle **refuses the launch**: `0` is not `false`, and reading it
/// as one would be exactly the silent reinterpretation above.
///
/// It cuts both ways — `{"drop-doubled-response": 1}` would leave the strategy **off**, because `1`
/// is not `true` either, and an operator who thinks they armed it would never be told they did not.
#[test]
fn a_non_boolean_toggle_is_refused() {
    for (key, unreadable) in [
        ("strip-prose", json!(0)),
        ("drop-doubled-response", json!(1)),
    ] {
        let mut toggles = serde_json::Map::new();
        for strategy in HealingStrategy::ALL {
            toggles.insert(strategy.id().to_string(), json!(true));
        }
        toggles.insert(key.to_string(), unreadable.clone());
        let (_, defects) = healing_refusal(&set_with(json!({ "healing": toggles })));
        assert_eq!(defects.len(), 1, "{key}: {unreadable} -> {defects:?}");
        assert_eq!(
            defects[0].locus,
            format!("responses-as-code.params.healing.{key}"),
            "{unreadable}"
        );
    }

    // A `healing` that is not a set of toggles at all has nothing in it gg can read.
    for unreadable in [json!(5), json!("off"), json!([])] {
        let (config, defects) =
            healing_refusal(&set_with(json!({ "healing": unreadable.clone() })));
        assert_eq!(
            config,
            HealingConfig::LAUNCH_REFUSED,
            "{unreadable}: the resolver stays total"
        );
        assert_eq!(defects.len(), 1, "{unreadable} -> {defects:?}");
        assert_eq!(defects[0].locus, "responses-as-code.params.healing");
    }
}

/// **A disabled capability's healing params are still read.** Nothing about the run changes —
/// healing never runs where responses-as-code is off — and they are read anyway, on the rule the
/// whole params table follows: a disabled capability records the configuration the arm would have
/// used, and a typo skipped because a switch happened to be off is a typo that surfaces on the
/// launch where it is flipped.
#[test]
fn a_disabled_capabilitys_healing_params_are_still_read() {
    let set = GgAgentConfig {
        capabilities: vec![GgCapabilityConfig {
            params: json!({ "healing": false }),
            ..GgCapabilityConfig::disabled(CAPABILITY_RESPONSES_AS_CODE)
        }],
        ..GgAgentConfig::root()
    };
    assert_eq!(healing_of(&set), HealingConfig::OFF);
}

/// **…and a disabled capability that writes nothing is short of nothing.** Requirement is a
/// property of the switch, so the arm that is off has no set to have stated.
#[test]
fn a_disabled_capability_requires_no_healing_set() {
    let set = GgAgentConfig {
        capabilities: vec![GgCapabilityConfig {
            params: json!({}),
            ..GgCapabilityConfig::disabled(CAPABILITY_RESPONSES_AS_CODE)
        }],
        ..GgAgentConfig::root()
    };
    assert_eq!(healing_of(&set), HealingConfig::OFF);
}

/// …and one gg cannot read is refused there too.
#[test]
fn a_disabled_capabilitys_unreadable_healing_param_is_refused() {
    let set = GgAgentConfig {
        capabilities: vec![GgCapabilityConfig {
            params: json!({ "healing": 5 }),
            ..GgCapabilityConfig::disabled(CAPABILITY_RESPONSES_AS_CODE)
        }],
        ..GgAgentConfig::root()
    };
    let (_, defects) = healing_refusal(&set);
    assert_eq!(defects.len(), 1, "{defects:?}");
}

// ---------------------------------------------------------------------------------------------
// The assistant-message mode
// ---------------------------------------------------------------------------------------------

/// **A capability that says nothing about assistant messages is refused.** The two modes are the
/// arms of a comparison — one records what the model wrote, the other what gg ran — so picking one
/// for an operator would be picking which arm their run measured.
#[test]
fn an_absent_assistant_messages_is_refused() {
    for params in [json!({}), json!({ "assistantMessages": null })] {
        let (mode, defects) = assistant_messages_refusal(&set_with(params.clone()));
        assert_eq!(
            mode,
            AssistantMessageMode::LAUNCH_REFUSED,
            "{params}: the resolver stays total, on a named placeholder"
        );
        assert_eq!(defects.len(), 1, "{params} -> {defects:?}");
        assert_eq!(
            defects[0].locus, "responses-as-code.params.assistantMessages",
            "{params}"
        );
        assert_eq!(defects[0].found, "", "an absence has no value as written");
    }
}

/// **An agent that takes no code turn has no healed program to record in a reply's place**, so a
/// profile without the capability records what the model sent and is short of nothing.
#[test]
fn an_absent_capability_records_the_reply_as_sent() {
    assert_eq!(
        assistant_messages_of(&GgAgentConfig::root()),
        AssistantMessageMode::None
    );
}

/// **…and a disabled capability is short of nothing either.** Requirement is a property of the
/// switch, so the arm that is off has no mode to have named.
#[test]
fn a_disabled_capability_requires_no_mode() {
    let set = GgAgentConfig {
        capabilities: vec![GgCapabilityConfig {
            params: json!({}),
            ..GgCapabilityConfig::disabled(CAPABILITY_RESPONSES_AS_CODE)
        }],
        ..GgAgentConfig::root()
    };
    assert_eq!(assistant_messages_of(&set), AssistantMessageMode::None);
}

/// The two named modes each resolve to their variant, and neither is reported.
#[test]
fn each_named_mode_resolves() {
    assert_eq!(
        assistant_messages_of(&set_with(json!({ "assistantMessages": "none" }))),
        AssistantMessageMode::None
    );
    assert_eq!(
        assistant_messages_of(&set_with(
            json!({ "assistantMessages": "response-healing" })
        )),
        AssistantMessageMode::ResponseHealing
    );
    // Surrounding whitespace is not part of what an operator wrote.
    assert_eq!(
        assistant_messages_of(&set_with(
            json!({ "assistantMessages": " response-healing " })
        )),
        AssistantMessageMode::ResponseHealing
    );
}

/// A value naming no mode gg knows **refuses the launch**, never guessed at — the same discipline
/// the healing keys follow, and for the same reason: a mode is a lever a study slices on, so a typo
/// must never leave the transcript recorded under the arm nobody chose.
#[test]
fn an_unknown_assistant_messages_value_is_refused() {
    for unreadable in [json!("healed"), json!(true), json!(5), json!([])] {
        let (mode, defects) = assistant_messages_refusal(&set_with(
            json!({ "assistantMessages": unreadable.clone() }),
        ));
        assert_eq!(
            mode,
            AssistantMessageMode::LAUNCH_REFUSED,
            "the resolver stays total, on a named placeholder"
        );
        assert_eq!(defects.len(), 1, "{unreadable} -> {defects:?}");
        assert_eq!(
            defects[0].locus,
            "responses-as-code.params.assistantMessages"
        );
        assert_eq!(defects[0].known, AssistantMessageMode::ALL, "{unreadable}");
    }
}

/// A present but **disabled** capability's mode is read exactly as its healing params are.
#[test]
fn a_disabled_capabilitys_assistant_messages_is_still_read() {
    let set = GgAgentConfig {
        capabilities: vec![GgCapabilityConfig {
            params: json!({ "assistantMessages": "response-healing" }),
            ..GgCapabilityConfig::disabled(CAPABILITY_RESPONSES_AS_CODE)
        }],
        ..GgAgentConfig::root()
    };
    assert_eq!(
        assistant_messages_of(&set),
        AssistantMessageMode::ResponseHealing
    );
}
