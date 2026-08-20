//! **What buys a tool, derived from the registry that decides it.**
//!
//! Every tool gg offers is gated by a chain of `if`s in
//! [`ToolRegistry::from_run`](crate::tools::ToolRegistry::from_run) — a capability check, a module's
//! `offers_*`, a strategy's shape, a roster's emptiness, a position in a machine — and no
//! [`ToolDefinition`](crate::model::ToolDefinition) carries any of it. A reader of the console's
//! Reference section who cannot tell *what buys this tool* is left with the question the page was
//! built to answer.
//!
//! This module answers it by **withholding**. From the [maximal configuration](super::tools) it
//! withholds one thing at a time and records what disappears; where nothing disappears one at a
//! time it withholds two, which is what finds a condition either half of which is enough on its own
//! (`wait_for_subagents` wants a non-empty roster *or* the `fork` capability, and neither
//! withholding
//! alone reveals that). What comes out is a small conjunctive normal form per tool, over axes gg can
//! really move, computed from `from_run` itself.
//!
//! # Why the conditions are computed rather than authored
//!
//! A hand-written note per tool is prose nothing compares against the `if` it describes, so every
//! note could be wrong at once and every gate would stay green. A note also goes stale silently,
//! because the code it describes moves in a file the note is not in.
//!
//! The honest cost, recorded rather than glossed: a sentence generated from an enum reads more
//! mechanically than one a person wrote, and the templates below are still authored prose one level
//! down. The trade is that a template cannot be wrong about *which* condition applies to a tool,
//! and a note can. Configuration advice, remarks about *when within a run* a tool is offered, and
//! implementation notes about interception are not gates and live on the documentation site.
//!
//! # What withholding one thing at a time cannot see
//!
//! A condition that only reveals itself when **three** things are withheld together is not found
//! here. That is a real limit rather than an assumption, which is why the derivation is not trusted:
//! `the_derived_conditions_predict_every_registry` re-derives the offered set from these conditions
//! across the whole configuration space — singles, pairs, a deterministic sample of arbitrary
//! subsets, and the policy cross product — and fails if the prediction and `from_run` ever disagree
//! about one tool in one configuration. A missing third-order condition is therefore a red test
//! rather than a quiet lie on the page.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_COMPACTION, CAPABILITY_EDIT_FILE, CAPABILITY_EXEC,
    CAPABILITY_FORK, CAPABILITY_LIST_DIR, CAPABILITY_MEMORIES, CAPABILITY_PROJECT_MANAGEMENT,
    CAPABILITY_READ_FILE, CAPABILITY_RESPONSES_AS_CODE, CAPABILITY_SHELL, CAPABILITY_SKILLS,
    CAPABILITY_SUBAGENTS, CAPABILITY_TASKS, CAPABILITY_WRITE_FILE,
    COMPACTION_STRATEGY_HANDOFF_COMPACTION, COMPACTION_STRATEGY_HANDOFF_SUMMARIZATION,
    COMPACTION_STRATEGY_MEMORY, COMPACTION_STRATEGY_SELF_COMPACTION,
    COMPACTION_STRATEGY_SELF_SUMMARIZATION,
};
use test_cabinet_core::gg_reference::GgToolCondition;

use super::tools::{Configuration, base_configurations, registry_definitions};
use crate::compaction::CompactionStrategy;
use crate::memories::MemoryStrategy;
use crate::tools::ALL_TOOL_NAMES;

/// **Every capability a run can withhold**, in the order the page lists them.
///
/// It is not "every capability gg has": a capability that contributes no tool and participates in no
/// tool's condition would add an axis nothing could ever be measured on, and every one of the
/// hundreds of registries built below would cost the same again for it. It *is* every capability
/// `from_run` reads, which is the list a reader of that function would write — including
/// [`responses-as-code`](CAPABILITY_RESPONSES_AS_CODE), which contributes nothing of its own and is
/// half of the condition on `compact`.
///
/// [`fsm`](test_cabinet_core::gg::CAPABILITY_FSM) is deliberately absent, and its absence is the
/// substance of `transition_state`'s condition: that capability is declared on the *shell* profile
/// driving a machine, never on the agent's own, so an agent's capability set is not where the
/// question is asked. The [machine axis](Axis::Machine) is.
pub(crate) const CAPABILITY_AXES: &[&str] = &[
    CAPABILITY_SHELL,
    CAPABILITY_READ_FILE,
    CAPABILITY_WRITE_FILE,
    CAPABILITY_EDIT_FILE,
    CAPABILITY_LIST_DIR,
    CAPABILITY_SKILLS,
    CAPABILITY_MEMORIES,
    CAPABILITY_TASKS,
    CAPABILITY_PROJECT_MANAGEMENT,
    CAPABILITY_AGENT_MANAGED_CONTEXT,
    CAPABILITY_COMPACTION,
    CAPABILITY_SUBAGENTS,
    CAPABILITY_EXEC,
    CAPABILITY_FORK,
    CAPABILITY_RESPONSES_AS_CODE,
];

/// **Every store a run can leave unbound.** A capability whose module is absent contributes no
/// tools even when the capability itself is on, because those tools would have nothing to act on —
/// so the module is a second, genuinely separate axis rather than a restatement of the capability.
pub(crate) const MODULE_AXES: &[ModuleAxis] = &[
    ModuleAxis::Skills,
    ModuleAxis::Memories,
    ModuleAxis::Tasks,
    ModuleAxis::Board,
    ModuleAxis::Archive,
];

/// One of the [stores](MODULE_AXES) an agent either holds or does not.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ModuleAxis {
    /// The skill library. Held means **non-empty**: an empty library and an absent one are the same
    /// thing to `read_skill`, which would have nothing to read either way.
    Skills,
    /// The memory store.
    Memories,
    /// The task list.
    Tasks,
    /// The run-global epic/issue board.
    Board,
    /// The thread archive.
    Archive,
}

impl ModuleAxis {
    /// What an agent holding this module holds, as a noun phrase completing "the agent holds …".
    fn held(self) -> &'static str {
        match self {
            Self::Skills => "a skill library with at least one skill in it",
            Self::Memories => "a bound memory store",
            Self::Tasks => "a task list",
            Self::Board => "the run's board",
            Self::Archive => "a thread archive",
        }
    }

    /// The same phrase in the negative, completing "the agent holds …".
    ///
    /// No tool is gated on a module being *absent* today, so nothing renders this. It is written
    /// because the derivation reports whichever half of an axis it measures and a half with no
    /// sentence would come out blank rather than wrong — the failure that is hardest to notice.
    fn withheld(self) -> &'static str {
        match self {
            Self::Skills => "no skill library, or one with nothing in it",
            Self::Memories => "no memory store",
            Self::Tasks => "no task list",
            Self::Board => "no board",
            Self::Archive => "no thread archive",
        }
    }
}

/// The compaction strategies, in the order they are listed anywhere else, indexed by the
/// [axis](Axis::CompactionStrategy)'s value.
///
/// The axis is over the **resolved** strategy rather than the configured one, because that is what
/// `from_run` reads: a run that asks for `memory-compaction` with a read-only memory handle gets
/// `self-summarization`, and a condition stated in terms of what was *asked for* would be wrong
/// about exactly that run.
const COMPACTION_STRATEGIES: &[&str] = &[
    COMPACTION_STRATEGY_SELF_SUMMARIZATION,
    COMPACTION_STRATEGY_SELF_COMPACTION,
    COMPACTION_STRATEGY_HANDOFF_SUMMARIZATION,
    COMPACTION_STRATEGY_HANDOFF_COMPACTION,
    COMPACTION_STRATEGY_MEMORY,
];

/// The memory strategies, indexed by the [axis](Axis::MemoryStrategy)'s value.
const MEMORY_STRATEGIES: &[MemoryStrategy] = &[
    MemoryStrategy::Scratchpad,
    MemoryStrategy::Markdown,
    MemoryStrategy::KeywordSearch,
];

/// The value of a two-valued axis meaning **the run has the thing**. The other is `0`.
const HELD: usize = 1;

/// One dimension of a run that [`ToolRegistry::from_run`](crate::tools::ToolRegistry::from_run)
/// reads, together with the values it can take.
///
/// Values are small integers rather than a per-axis type so that the derivation can walk axes
/// uniformly — every axis is "a thing with N values that a configuration can be moved along". What
/// each value *means* is the axis's own business, and lives in [`observe`](Self::observe),
/// [`choose`](Self::choose) and [`clause`](Self::clause).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Axis {
    /// Whether the profile enables the capability at this position in [`CAPABILITY_AXES`].
    Capability(usize),
    /// Whether the agent holds the store at this position in [`MODULE_AXES`].
    Module(usize),
    /// Whether the agent's memory handle may write.
    MemoryAccess,
    /// Whether the agent's roster lists anyone it may spawn.
    Roster,
    /// Which of the [memory strategies](MEMORY_STRATEGIES) the store is organized by.
    MemoryStrategy,
    /// Which of the [compaction strategies](COMPACTION_STRATEGIES) the run **resolves** to.
    CompactionStrategy,
    /// Whether the agent stands in a machine state that has somewhere to go.
    Machine,
}

/// Every [axis](Axis), in the order conditions are emitted in.
///
/// Built rather than declared, so a capability or a module added to the two lists above becomes an
/// axis without a second list being edited — the failure mode that made the table this replaced
/// worth replacing.
pub(crate) fn axes() -> Vec<Axis> {
    (0..CAPABILITY_AXES.len())
        .map(Axis::Capability)
        .chain((0..MODULE_AXES.len()).map(Axis::Module))
        .chain([
            Axis::MemoryAccess,
            Axis::Roster,
            Axis::MemoryStrategy,
            Axis::CompactionStrategy,
            Axis::Machine,
        ])
        .collect()
}

impl Axis {
    /// How many values this axis takes.
    fn arity(self) -> usize {
        match self {
            Self::MemoryStrategy => MEMORY_STRATEGIES.len(),
            Self::CompactionStrategy => COMPACTION_STRATEGIES.len(),
            _ => 2,
        }
    }

    /// The value `configuration` sits at on this axis — **as `from_run` will read it**, not as the
    /// caller set it.
    ///
    /// The distinction has exactly one subject and it is worth stating: the compaction axis reports
    /// the strategy gg [resolves](CompactionStrategy::resolve) from the name the configuration
    /// carries, rather than the name itself. Deriving in resolved coordinates and predicting in
    /// resolved coordinates is what keeps the condition and the check asking the same question.
    fn observe(self, configuration: &Configuration) -> usize {
        match self {
            Self::Capability(axis) => usize::from(configuration.holds(axis)),
            Self::Module(axis) => usize::from(configuration.binds(axis)),
            Self::MemoryAccess => usize::from(configuration.memory_writable),
            Self::Roster => usize::from(configuration.roster),
            Self::MemoryStrategy => MEMORY_STRATEGIES
                .iter()
                .position(|strategy| *strategy == configuration.memories)
                .unwrap_or_default(),
            Self::CompactionStrategy => {
                // The one input `from_run` gives the resolver, read exactly the way it reads it.
                // A strategy resolves to itself whatever the agent's memory access is: an arm gg
                // cannot conduct refuses the launch rather than resolving to another, so there is
                // no fold here for a prediction to get wrong.
                //
                // Every value on this axis is drawn from `COMPACTION_STRATEGIES`, so there is
                // nothing here a resolver could fail to read.
                let resolved = CompactionStrategy::resolve(
                    Some(configuration.compaction),
                    &mut crate::validate::LaunchReport::Discarding,
                )
                .id();
                COMPACTION_STRATEGIES
                    .iter()
                    .position(|strategy| *strategy == resolved)
                    .unwrap_or_default()
            }
            Self::Machine => usize::from(configuration.fsm),
        }
    }

    /// Move `configuration` to `value` on this axis, leaving every other axis where it was.
    fn choose(self, configuration: &mut Configuration, value: usize) {
        match self {
            Self::Capability(axis) => configuration.capabilities[axis] = value == HELD,
            Self::Module(axis) => configuration.modules[axis] = value == HELD,
            Self::MemoryAccess => configuration.memory_writable = value == HELD,
            Self::Roster => configuration.roster = value == HELD,
            Self::MemoryStrategy => configuration.memories = MEMORY_STRATEGIES[value],
            Self::CompactionStrategy => configuration.compaction = COMPACTION_STRATEGIES[value],
            Self::Machine => configuration.fsm = value == HELD,
        }
    }

    /// The axis's stable id, carried on the wire so a page can group or filter conditions by the
    /// kind of thing that decides them.
    fn id(self) -> &'static str {
        match self {
            Self::Capability(_) => "capability",
            Self::Module(_) => "module",
            Self::MemoryAccess => "memory-access",
            Self::Roster => "roster",
            Self::MemoryStrategy => "memory-strategy",
            Self::CompactionStrategy => "compaction-strategy",
            Self::Machine => "machine",
        }
    }

    /// The clause this axis contributes when a tool is offered only at `allowed` — a predicate about
    /// the run, in the second person the tool descriptions themselves are not, ready to be joined
    /// with " or " into a [sentence](Conjunct::sentence).
    ///
    /// There is one template per axis and none per tool, which is the whole of what is still
    /// authored here.
    fn clause(self, allowed: &[usize]) -> String {
        match self {
            Self::MemoryStrategy => format!(
                "the memory strategy is {}",
                quoted(allowed.iter().map(|value| MEMORY_STRATEGIES[*value].id())),
            ),
            Self::CompactionStrategy => format!(
                "the run's compaction strategy resolves to {}",
                quoted(allowed.iter().map(|value| COMPACTION_STRATEGIES[*value])),
            ),
            _ => self.binary_clause(allowed.first().copied()),
        }
    }

    /// The clause of a two-valued axis, which is offered at exactly one of its values wherever it
    /// constrains anything at all.
    ///
    /// `None` is unreachable — an axis at which a tool is offered nowhere would mean the tool is
    /// offered nowhere, and only tools with a witness reach this file — and is answered with a
    /// sentence saying so rather than a panic, because a binary that aborts while printing
    /// documentation is a worse failure inside a run container than a page with one strange line.
    fn binary_clause(self, allowed: Option<usize>) -> String {
        let Some(value) = allowed else {
            return "no run offers it at all".to_string();
        };
        let held = value == HELD;
        match self {
            Self::Capability(axis) => match held {
                true => format!("the agent holds the `{}` capability", CAPABILITY_AXES[axis]),
                false => format!(
                    "the agent does not hold the `{}` capability",
                    CAPABILITY_AXES[axis]
                ),
            },
            Self::Module(axis) => match held {
                true => format!("the agent holds {}", MODULE_AXES[axis].held()),
                false => format!("the agent holds {}", MODULE_AXES[axis].withheld()),
            },
            Self::MemoryAccess => match held {
                true => "the agent's memory handle is writable".to_string(),
                false => "the agent's memory handle is read-only".to_string(),
            },
            Self::Roster => match held {
                true => "the agent's roster lists at least one agent it may spawn".to_string(),
                false => "the agent's roster is empty".to_string(),
            },
            Self::Machine => match held {
                true => "the agent stands in a state of a machine — declared by a separate FSM \
                         shell agent, never by the agent's own profile — that has somewhere to go"
                    .to_string(),
                false => "the agent stands in no machine state".to_string(),
            },
            // The two value axes never reach here; `clause` answers them without asking for a
            // single value, because "only under these two of three strategies" is one clause and
            // not a choice between two.
            Self::MemoryStrategy | Self::CompactionStrategy => {
                "the run is configured for it".to_string()
            }
        }
    }
}

/// One thing that must be true of a run, on one axis: the axis, and the values at which the tool is
/// offered.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Atom {
    /// The dimension this constrains.
    axis: Axis,
    /// The values of it at which the tool is offered. Always a proper, non-empty subset of the
    /// axis's values — an atom that allowed everything would constrain nothing and is never built.
    allowed: Vec<usize>,
}

/// One condition: a **disjunction** of [atoms](Atom), any one of which satisfies it.
///
/// Most are a single atom. A disjunction appears where either of two things is enough on its own —
/// an agent may have children by spawning them from a roster *or* by forking itself — which is a
/// shape no single-axis probe can see and the reason the derivation looks at pairs.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Conjunct {
    /// The alternatives, in axis order. Never empty.
    atoms: Vec<Atom>,
}

impl Conjunct {
    /// Whether `configuration` satisfies this condition.
    #[cfg(test)]
    fn permits(&self, configuration: &Configuration) -> bool {
        self.atoms
            .iter()
            .any(|atom| atom.allowed.contains(&atom.axis.observe(configuration)))
    }

    /// The sentence the page renders — the alternatives joined into one.
    fn sentence(&self) -> String {
        let clauses: Vec<String> = self
            .atoms
            .iter()
            .map(|atom| atom.axis.clause(&atom.allowed))
            .collect();
        format!("Only when {}.", clauses.join(", or "))
    }

    /// Whether this condition is a bare "hold this capability", which the page carries as a
    /// [capability](super::tools) rather than as a sentence.
    fn as_capability(&self) -> Option<&'static str> {
        match self.atoms.as_slice() {
            [atom] => match atom.axis {
                Axis::Capability(axis) if atom.allowed == [HELD] => Some(CAPABILITY_AXES[axis]),
                _ => None,
            },
            _ => None,
        }
    }
}

/// What a run must satisfy for one tool to be offered, in conjunctive normal form.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ToolConditions {
    /// The tool these are the conditions of — a member of [`ALL_TOOL_NAMES`], exactly.
    pub(crate) tool: &'static str,
    /// Every condition, all of which must hold. Derived; never authored.
    conjuncts: Vec<Conjunct>,
}

impl ToolConditions {
    /// The capabilities a run must hold **on its own** for this tool, in axis order.
    ///
    /// These are the conditions that are nothing but "hold this capability", lifted out of the
    /// sentences because a page renders them as a chip rather than as prose. A capability that is
    /// only one *alternative* of a condition stays in [`requires`](Self::requires), because a run
    /// does not have to hold it.
    pub(crate) fn capabilities(&self) -> Vec<String> {
        self.conjuncts
            .iter()
            .filter_map(Conjunct::as_capability)
            .map(str::to_string)
            .collect()
    }

    /// Every other condition, each as the sentence gg composed for it.
    pub(crate) fn requires(&self) -> Vec<GgToolCondition> {
        self.conjuncts
            .iter()
            .filter(|conjunct| conjunct.as_capability().is_none())
            .map(|conjunct| GgToolCondition {
                sentence: conjunct.sentence(),
                axes: conjunct
                    .atoms
                    .iter()
                    .map(|atom| atom.axis.id().to_string())
                    .collect(),
            })
            .collect()
    }

    /// Whether a run configured like `configuration` is offered this tool, according to what was
    /// derived.
    ///
    /// The prediction side of `the_derived_conditions_predict_every_registry`: this and
    /// `from_run` are asked the same question about the same configuration, and a disagreement is
    /// a condition that was not found.
    ///
    /// `#[cfg(test)]` because nothing in a *build* asks it. gg does not decide what to offer from
    /// this — `from_run` does, and a second implementation of that decision reached at run time is
    /// the very duplication the derivation exists to remove. What it is for is proving the
    /// derivation complete, which happens under test or not at all.
    #[cfg(test)]
    pub(crate) fn permits(&self, configuration: &Configuration) -> bool {
        self.conjuncts
            .iter()
            .all(|conjunct| conjunct.permits(configuration))
    }
}

/// **Derive what buys every tool**, by withholding one axis at a time from the maximal point.
///
/// One pass per tool, each starting from the first [base configuration](base_configurations) that
/// offers it — its *witness*. A witness is needed rather than one global maximum because two axes
/// have no maximal value: `transition_state` exists only inside a machine and `exec` only outside
/// one, and the three memory strategies offer disjoint sets, so no single registry can hold
/// everything. Taking the witness from the same ordered list the [entries](super::tools) are
/// rendered from is what keeps a tool's prose and its conditions describing one configuration.
///
/// **Computed once per process.** It builds a few thousand registries, which is a third of a second
/// — nothing for the one call that projects the reference, and far too much for the callers that
/// ask "what does this capability contribute" once per capability per language. Caching a pure
/// function of nothing changes no answer: the derivation reads no file, no clock and no
/// configuration, so the second call could only ever produce the bytes the first did.
pub(crate) fn derive() -> &'static [ToolConditions] {
    static DERIVED: OnceLock<Vec<ToolConditions>> = OnceLock::new();
    DERIVED.get_or_init(derive_uncached).as_slice()
}

/// [`derive`](fn@derive)'s one real evaluation.
fn derive_uncached() -> Vec<ToolConditions> {
    let axes = axes();
    let mut lattice = Lattice::new(&axes);
    let base = base_configurations();
    ALL_TOOL_NAMES
        .iter()
        .filter_map(|tool| {
            let witness = base
                .iter()
                .copied()
                .find(|configuration| lattice.offers(configuration, tool))?;
            Some(learn(&mut lattice, tool, &witness, &axes))
        })
        .collect()
}

/// The conditions on one tool, measured around `witness`.
fn learn(
    lattice: &mut Lattice,
    tool: &'static str,
    witness: &Configuration,
    axes: &[Axis],
) -> ToolConditions {
    // Where the tool survives when one axis moves and everything else stays. Recorded in *observed*
    // coordinates, which is what the prediction will later read — see `Axis::observe`.
    let allowed: Vec<Vec<usize>> = axes
        .iter()
        .map(|axis| {
            (0..axis.arity())
                .filter_map(|value| {
                    let mut candidate = *witness;
                    axis.choose(&mut candidate, value);
                    lattice
                        .offers(&candidate, tool)
                        .then(|| axis.observe(&candidate))
                })
                .collect::<BTreeSet<usize>>()
                .into_iter()
                .collect()
        })
        .collect();

    let mut conjuncts: Vec<Conjunct> = axes
        .iter()
        .zip(&allowed)
        .filter(|(axis, allowed)| allowed.len() < axis.arity())
        .map(|(axis, allowed)| Conjunct {
            atoms: vec![Atom {
                axis: *axis,
                allowed: allowed.clone(),
            }],
        })
        .collect();

    for first in 0..axes.len() {
        for second in (first + 1)..axes.len() {
            // An axis with one surviving value is already stated as a condition of its own, and the
            // pair scan over it would only revisit the configurations the single scan just made.
            if allowed[first].len() < 2 || allowed[second].len() < 2 {
                continue;
            }
            conjuncts.extend(pair(
                lattice,
                tool,
                witness,
                (axes[first], &allowed[first]),
                (axes[second], &allowed[second]),
            ));
        }
    }

    ToolConditions { tool, conjuncts }
}

/// The conditions that only appear when **two** axes move together.
///
/// Every pair of surviving values is tried; the ones that withhold the tool are the *forbidden*
/// combinations, and their complement is what is recorded. A forbidden set that happens to be a
/// rectangle — every `a` in one set against every `b` in another, which is what a real disjunctive
/// condition looks like — collapses into one sentence naming both alternatives. Anything else is
/// recorded one forbidden pair at a time, which says exactly the same thing in more sentences
/// rather than approximating it: the conjunction of "not this pair" over every forbidden pair is
/// precisely the complement of the forbidden set, whatever shape it has.
fn pair(
    lattice: &mut Lattice,
    tool: &str,
    witness: &Configuration,
    (first, first_allowed): (Axis, &[usize]),
    (second, second_allowed): (Axis, &[usize]),
) -> Vec<Conjunct> {
    let (at_first, at_second) = (first.observe(witness), second.observe(witness));
    let mut forbidden: Vec<(usize, usize)> = Vec::new();
    for &one in first_allowed {
        for &other in second_allowed {
            // Either half alone is a single-axis variation the scan above already found the tool
            // in, so only genuine pairs are worth a registry.
            if one == at_first || other == at_second {
                continue;
            }
            let mut candidate = *witness;
            first.choose(&mut candidate, one);
            second.choose(&mut candidate, other);
            if !lattice.offers(&candidate, tool) {
                forbidden.push((first.observe(&candidate), second.observe(&candidate)));
            }
        }
    }
    if forbidden.is_empty() {
        return Vec::new();
    }

    let ones: Vec<usize> = deduplicated(forbidden.iter().map(|(one, _)| *one));
    let others: Vec<usize> = deduplicated(forbidden.iter().map(|(_, other)| *other));
    let rectangular = forbidden.len() == ones.len() * others.len();
    let excluding = |allowed: &[usize], removed: &[usize]| -> Vec<usize> {
        allowed
            .iter()
            .copied()
            .filter(|value| !removed.contains(value))
            .collect()
    };

    if rectangular {
        return vec![Conjunct {
            atoms: vec![
                Atom {
                    axis: first,
                    allowed: excluding(first_allowed, &ones),
                },
                Atom {
                    axis: second,
                    allowed: excluding(second_allowed, &others),
                },
            ],
        }];
    }
    forbidden
        .iter()
        .map(|(one, other)| Conjunct {
            atoms: vec![
                Atom {
                    axis: first,
                    allowed: excluding(first_allowed, &[*one]),
                },
                Atom {
                    axis: second,
                    allowed: excluding(second_allowed, &[*other]),
                },
            ],
        })
        .collect()
}

/// `values`, sorted and without repeats.
fn deduplicated(values: impl Iterator<Item = usize>) -> Vec<usize> {
    values.collect::<BTreeSet<usize>>().into_iter().collect()
}

/// `items` as a list of backquoted names, joined the way a sentence joins them.
fn quoted<'a>(items: impl Iterator<Item = &'a str>) -> String {
    let quoted: Vec<String> = items.map(|item| format!("`{item}`")).collect();
    match quoted.split_last() {
        None => String::new(),
        Some((last, [])) => last.clone(),
        Some((last, rest)) => format!("{} or {last}", rest.join(", ")),
    }
}

/// The registries the derivation has already built, so a configuration two tools both ask about is
/// assembled once.
///
/// Keyed by what a registry actually depends on — the value every axis is observed at, plus the
/// policies, which change nothing about *which* tools are offered but are part of the key so that a
/// caller who does vary them cannot be answered from another policy's cache line.
///
/// Ordered rather than hashed, like every other map in this crate: nothing here walks it, but the
/// rule gg holds itself to is the blunt one, and a lookup table that is one refactor away from
/// being iterated is exactly the kind of thing the blunt rule exists for.
struct Lattice<'a> {
    /// The axes, in [`axes`] order, held so a key can be built without rebuilding the list.
    axes: &'a [Axis],
    /// Offered tool names by configuration key.
    offered: BTreeMap<(Vec<usize>, String), BTreeSet<String>>,
}

impl<'a> Lattice<'a> {
    /// A cache over `axes`.
    fn new(axes: &'a [Axis]) -> Self {
        Self {
            axes,
            offered: BTreeMap::new(),
        }
    }

    /// Whether a run configured like `configuration` is offered `tool`, asking
    /// [`from_run`](crate::tools::ToolRegistry::from_run) itself the first time and the cache after.
    fn offers(&mut self, configuration: &Configuration, tool: &str) -> bool {
        let key = (
            self.axes
                .iter()
                .map(|axis| axis.observe(configuration))
                .collect(),
            format!(
                "{}|{}|{}|{:?}",
                configuration.read,
                configuration.shell,
                configuration.reviewers,
                configuration.tasks
            ),
        );
        self.offered
            .entry(key)
            .or_insert_with(|| {
                registry_definitions(configuration)
                    .into_iter()
                    .map(|definition| definition.name)
                    .collect()
            })
            .contains(tool)
    }
}

#[cfg(test)]
#[path = "reference.conditions.test.rs"]
mod tests;
