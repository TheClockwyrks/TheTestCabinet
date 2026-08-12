use std::collections::BTreeSet;

use super::*;
use crate::memories::MemoryStrategy;
use crate::reference::tools::MAXIMAL_CONFIGURATION;
use crate::tasks::TaskMode;
use crate::tools::{READ_MODE_DEFAULT_CAP, READ_MODE_UNLIMITED};
use test_cabinet_core::gg::{SHELL_OUTPUT_ADAPTIVE, SHELL_OUTPUT_INLINE, SHELL_OUTPUT_OFFLOAD};

/// **The derived conditions predict `from_run` exactly, in every configuration this test can
/// build.**
///
/// This is the gate the whole derivation rests on, and it is the one the table it replaced could
/// never have: the old gate asserted that a hand-written note *existed* for every tool, which says
/// nothing about whether the note was true. This asks the two things the same question — for this
/// configuration, which tools are offered? — and fails on the first disagreement about one tool.
///
/// It matters most for what the derivation is known **not** to look at. Conditions are learned by
/// withholding one thing, and then two; a condition that only appears when three are withheld
/// together would be invisible to the learner and is exactly what the random subsets below are
/// for. A failure here is not fixed by widening this test.
#[test]
fn the_derived_conditions_predict_every_registry() {
    let derived = derive();
    assert_eq!(
        derived.len(),
        ALL_TOOL_NAMES.len(),
        "every tool must have a witness configuration and therefore conditions"
    );

    for configuration in every_configuration() {
        let offered: BTreeSet<&str> = registry_definitions(&configuration)
            .iter()
            .map(|definition| {
                ALL_TOOL_NAMES
                    .iter()
                    .find(|name| **name == definition.name)
                    .copied()
                    .unwrap_or_else(|| panic!("`{}` is not in the vocabulary", definition.name))
            })
            .collect();
        let predicted: BTreeSet<&str> = derived
            .iter()
            .filter(|conditions| conditions.permits(&configuration))
            .map(|conditions| conditions.tool)
            .collect();
        assert_eq!(
            predicted, offered,
            "the conditions and `from_run` disagree under {configuration:?}"
        );
    }
}

/// Every configuration this test asks about: the maximal points, every single and every pair of
/// ablations from them, a deterministic sample of arbitrary ones, and the policy cross product.
///
/// The singles and the pairs are what the derivation itself looked at, so they prove only that it
/// recorded what it saw. The **sample** is the part that can find something new — every axis and
/// every policy moved at once, so a third-order condition has somewhere to show up — and it is
/// seeded rather than random so that a failure is reproducible from the seed alone rather than
/// being a test that fails once a fortnight.
fn every_configuration() -> Vec<Configuration> {
    let axes = axes();
    let mut configurations: Vec<Configuration> = Vec::new();
    for base in base_configurations() {
        configurations.push(base);
        for (first, axis) in axes.iter().enumerate() {
            for value in 0..axis.arity() {
                let mut single = base;
                axis.choose(&mut single, value);
                configurations.push(single);
                for other in &axes[(first + 1)..] {
                    for second in 0..other.arity() {
                        let mut pair = single;
                        other.choose(&mut pair, second);
                        configurations.push(pair);
                    }
                }
            }
        }
    }
    configurations.extend(sampled(&axes, SAMPLE_SIZE));
    configurations.extend(every_policy());
    configurations
}

/// How many arbitrary configurations to draw. Large enough that every axis has been moved against
/// every other many times over, and small enough that the whole test is a couple of seconds:
/// a registry is cheap, and this test builds one per configuration.
const SAMPLE_SIZE: usize = 3_000;

/// `count` configurations with every axis and every policy chosen at random from one fixed seed.
fn sampled(axes: &[Axis], count: usize) -> Vec<Configuration> {
    // Any odd constant does. It is written down rather than taken from the clock precisely so that
    // a failure names a configuration this function will produce again.
    let mut seed = Seeded(0x2545_F491_4F6C_DD1D);
    (0..count)
        .map(|_| {
            let mut configuration = MAXIMAL_CONFIGURATION;
            for axis in axes {
                axis.choose(&mut configuration, seed.next(axis.arity()));
            }
            configuration.read = [READ_MODE_UNLIMITED, READ_MODE_DEFAULT_CAP][seed.next(2)];
            configuration.shell = [
                SHELL_OUTPUT_ADAPTIVE,
                SHELL_OUTPUT_INLINE,
                SHELL_OUTPUT_OFFLOAD,
            ][seed.next(3)];
            configuration.reviewers = seed.next(2) == 1;
            configuration.tasks = [TaskMode::Simple, TaskMode::Issues][seed.next(2)];
            configuration
        })
        .collect()
}

/// The 144 policy combinations, at the maximal point, so that a policy cannot silently withhold a
/// tool — which would make it a gate nobody wrote a condition for.
fn every_policy() -> Vec<Configuration> {
    let mut configurations = Vec::new();
    for read in [READ_MODE_UNLIMITED, READ_MODE_DEFAULT_CAP] {
        for shell in [
            SHELL_OUTPUT_ADAPTIVE,
            SHELL_OUTPUT_INLINE,
            SHELL_OUTPUT_OFFLOAD,
        ] {
            for reviewers in [false, true] {
                for memories in [
                    MemoryStrategy::Scratchpad,
                    MemoryStrategy::Markdown,
                    MemoryStrategy::KeywordSearch,
                ] {
                    for tasks in [TaskMode::Simple, TaskMode::Issues] {
                        for fsm in [false, true] {
                            configurations.push(Configuration {
                                read,
                                shell,
                                reviewers,
                                memories,
                                tasks,
                                fsm,
                                ..MAXIMAL_CONFIGURATION
                            });
                        }
                    }
                }
            }
        }
    }
    configurations
}

/// A xorshift, which is all the randomness a spread of configurations needs.
struct Seeded(u64);

impl Seeded {
    /// The next value below `bound`.
    fn next(&mut self, bound: usize) -> usize {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 % bound as u64) as usize
    }
}

/// Every capability a tool is said to require is a capability gg has an axis for, and no tool
/// requires one twice.
///
/// A duplicate would be a condition derived twice from one axis, which the page would render as two
/// identical chips — and a capability outside the axis list would mean the derivation had measured
/// something it could not name.
#[test]
fn the_required_capabilities_are_axes_and_are_named_once() {
    for conditions in derive() {
        let required = conditions.capabilities();
        let distinct: BTreeSet<&String> = required.iter().collect();
        assert_eq!(
            distinct.len(),
            required.len(),
            "`{}` names a capability twice",
            conditions.tool
        );
        for capability in &required {
            assert!(
                CAPABILITY_AXES.contains(&capability.as_str()),
                "`{}` requires `{capability}`, which is not an axis",
                conditions.tool
            );
        }
    }
}

/// Every condition arrives as a sentence a page can print, naming the axes it constrains.
///
/// The sentence is composed here rather than in the console, so it is this crate's business that it
/// reads as one — and a condition with no axes would be one the page could not group, which is the
/// only structured thing it carries.
#[test]
fn every_condition_is_a_sentence_over_named_axes() {
    let known = [
        "capability",
        "module",
        "memory-access",
        "roster",
        "memory-strategy",
        "compaction-strategy",
        "machine",
    ];
    for conditions in derive() {
        for condition in conditions.requires() {
            assert!(
                condition.sentence.starts_with("Only when ") && condition.sentence.ends_with('.'),
                "`{}` carries `{}`, which does not read as a condition",
                conditions.tool,
                condition.sentence
            );
            assert!(
                !condition.axes.is_empty(),
                "`{}` carries a condition over no axis at all",
                conditions.tool
            );
            for axis in &condition.axes {
                assert!(
                    known.contains(&axis.as_str()),
                    "`{}` names the axis `{axis}`, which the page does not know",
                    conditions.tool
                );
            }
        }
    }
}

/// The three conditions that are worth reading in full, because each is a shape a single-axis
/// ablation cannot see or a sentence a reader would otherwise have to take on trust.
///
/// Pinned as *text* rather than as structure on purpose: what is being checked is that the
/// derivation reached the right conclusion about three genuinely awkward gates, and the sentence is
/// where a wrong conclusion would be visible to a reader.
#[test]
fn the_disjunctive_conditions_name_both_alternatives() {
    let derived = derive();
    let sentences = |tool: &str| -> Vec<String> {
        derived
            .iter()
            .find(|conditions| conditions.tool == tool)
            .unwrap_or_else(|| panic!("`{tool}` has no conditions"))
            .requires()
            .into_iter()
            .map(|condition| condition.sentence)
            .collect()
    };

    // An agent can have children by spawning them from a roster or by forking itself, and either is
    // enough. Neither ablation alone reveals it, which is why the derivation looks at pairs.
    assert_eq!(
        sentences("wait_for_subagents"),
        vec![
            "Only when the agent holds the `fork` capability, or the agent's roster lists at least \
             one agent it may spawn."
        ]
    );

    // `compact` is offered under self-compaction always, and under self-summarization only in code
    // mode — a pair of conditions over two axes, one of which already constrains on its own.
    assert_eq!(
        sentences("compact"),
        vec![
            "Only when the run's compaction strategy resolves to `self-summarization` or \
             `self-compaction`.",
            "Only when the agent holds the `responses-as-code` capability, or the run's compaction \
             strategy resolves to `self-compaction`.",
        ]
    );

    // `transition_state` is the one tool no capability on the agent's own profile buys, and the
    // sentence has to say where it comes from instead or the page shows a tool with no gate at all.
    assert!(
        derive()
            .iter()
            .find(|conditions| conditions.tool == "transition_state")
            .expect("`transition_state` has conditions")
            .capabilities()
            .is_empty(),
        "`transition_state` must be bought by no capability of the agent's own"
    );
    assert_eq!(
        sentences("transition_state"),
        vec![
            "Only when the agent stands in a state of a machine — declared by a separate FSM shell \
             agent, never by the agent's own profile — that has somewhere to go."
        ]
    );
}
