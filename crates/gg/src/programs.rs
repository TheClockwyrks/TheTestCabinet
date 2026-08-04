//! The **program library**: the source of every program one agent has run, and the retention that
//! bounds it.
//!
//! Under [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) a reply is a whole
//! program, which is why the protocol pays for itself — far more work lands per turn — and also why
//! its retries are so expensive: a sixty-line program with one wrong identifier is sixty lines the
//! model has to write again to change one of them. The
//! [program-library](test_cabinet_core::gg::CAPABILITY_PROGRAM_LIBRARY) capability makes the retry
//! proportional to the mistake. gg keeps what it ran, the agent fetches it back, patches it with
//! ordinary string work, and hands it over to be run.
//!
//! # What is kept, and what is not
//!
//! One entry per turn that **ran a program**, holding the source that *executed*. A turn whose reply
//! was not a program contributes nothing (there is no source), and a turn whose program was itself
//! handed over by `programs.rerun` records the program that ran rather than the two lines that asked
//! for it — which is the property that makes fetch-patch-rerun compose across turns instead of
//! degenerating into a chain of trampolines.
//!
//! Nothing about a program's *effects* is kept here. This is a text store: what the program did is
//! the run's telemetry, its replay record, and the workspace.
//!
//! # Why it is not a context item
//!
//! The obvious alternative — leave the programs in the window, where the model can already see them
//! — is what the library exists to be independent of. A window is compacted, archived and evicted;
//! gg's own state is not. An agent forty turns past a compaction can still fetch the program it
//! wrote before it, and an agent whose window holds its last program still pays nothing extra to
//! reach for one, because the library is never rendered into a prompt. The model reads it by asking.

use serde_json::Value;
use test_cabinet_core::gg::{CAPABILITY_PROGRAM_LIBRARY, GgAgentConfig};

use crate::tools::ToolFailure;

/// How many programs a library keeps when the capability names no `keep` — the most recent 20.
///
/// Chosen from what the capability is *for*: a model reaches back for the turn it just ran, and
/// occasionally for something a few turns older that it wants to run again. Twenty covers both with
/// room to spare while bounding an agent's resident source at something on the order of a few
/// hundred kilobytes. A study that wants the whole session sets `keep` to `0`.
pub const DEFAULT_KEEP: usize = 20;

/// The `keep` param: how many of the most recent programs are retained, `0` meaning every one.
pub const PARAM_KEEP: &str = "keep";

/// One program this agent ran, as the library holds it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgramRecord {
    /// The session turn it ran on — the handle `programs.get` takes, and the same number the
    /// context window's turn headers carry.
    pub turn: u64,
    /// The source that **executed**, exactly as it was run.
    pub source: String,
    /// Whether it ran to its end: no uncaught throw, and no sandbox ceiling stopping it.
    pub ok: bool,
    /// The error it ended with, when it did not run to its end — the same sentence the model was
    /// given in its turn feedback, so a program deciding whether to reach for this one can read
    /// what went wrong without searching its window for it.
    pub error: Option<String>,
}

/// One program as `programs.history()` reports it: its shape, never its source.
///
/// A directory that inlined sixty lines per entry would put the whole session back in front of the
/// model, which is the one thing the library exists to avoid — so the source is reached for one at a
/// time, by turn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgramSummary {
    /// The turn it ran on.
    pub turn: u64,
    /// How many lines of source it was.
    pub lines: u32,
    /// How many characters of source it was.
    pub chars: u32,
    /// Whether it ran to its end.
    pub ok: bool,
    /// The error it ended with, when it did not.
    pub error: Option<String>,
}

/// Why a `programs.*` lookup was refused, in a shape the membrane lowers into a typed `tool-error`.
///
/// It carries a [`ToolFailure`] rather than the membrane's generated `error-code` for the reason
/// every other type on that seam does: nothing outside `sandbox/membrane` may depend on the
/// `bindgen!` types, and the membrane already owns the one conversion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgramRefusal {
    /// The failure class — `not-found` for a turn the library does not hold.
    pub failure: ToolFailure,
    /// The model-facing guidance, which for a miss **names the turns that are held** rather than
    /// leaving the model to guess at a number twice.
    pub message: String,
}

/// One agent's library of the programs it has run.
///
/// Created disabled for every agent, and [armed](Self::enabled) only for one whose profile enables
/// the capability — the same shape [`SkillsRuntime`](crate::skills) uses, so the loop holds one
/// value either way and nothing has to branch on an `Option` per turn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgramLibrary {
    /// Whether this agent keeps programs at all. A disabled library records nothing and holds
    /// nothing, so an agent without the capability cannot accrue state it will never read.
    enabled: bool,
    /// How many of the most recent programs to retain, or `None` for every one.
    keep: Option<usize>,
    /// The retained programs, oldest first. Bounded by [`keep`](Self::keep).
    entries: Vec<ProgramRecord>,
}

impl ProgramLibrary {
    /// A library that keeps nothing — every agent without the capability, and the placeholder the
    /// loop leaves behind while the live one is moved into a turn.
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            keep: None,
            entries: Vec::new(),
        }
    }

    /// A live library retaining the most recent `keep` programs, or every one for `None`.
    pub fn enabled(keep: Option<usize>) -> Self {
        Self {
            enabled: true,
            keep,
            entries: Vec::new(),
        }
    }

    /// Whether this agent's programs are kept — which is also whether the `programs` object is bound
    /// into its scope. The loop reads it for both, from one value, so the surface a model is shown
    /// and the state gg holds cannot disagree.
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// Record the program that ran on `turn`, dropping the oldest if retention is now exceeded.
    ///
    /// A no-op for a disabled library. Recording the **same** turn twice replaces the earlier entry
    /// rather than adding one: a turn runs one program as far as the model is concerned, even when
    /// gg ran a chain of them to get there, and the one worth keeping is the last — the program that
    /// actually did the turn's work.
    pub fn record(&mut self, turn: u64, source: &str, ok: bool, error: Option<String>) {
        if !self.enabled {
            return;
        }
        let record = ProgramRecord {
            turn,
            source: source.to_string(),
            ok,
            error,
        };
        match self.entries.iter_mut().find(|entry| entry.turn == turn) {
            Some(existing) => *existing = record,
            None => self.entries.push(record),
        }
        if let Some(keep) = self.keep.filter(|keep| self.entries.len() > *keep) {
            let excess = self.entries.len() - keep;
            self.entries.drain(..excess);
        }
    }

    /// Every retained program's shape, oldest first — what `programs.history()` returns.
    pub fn summaries(&self) -> Vec<ProgramSummary> {
        self.entries
            .iter()
            .map(|entry| ProgramSummary {
                turn: entry.turn,
                lines: saturating_u32(entry.source.lines().count()),
                chars: saturating_u32(entry.source.chars().count()),
                ok: entry.ok,
                error: entry.error.clone(),
            })
            .collect()
    }

    /// The source of the program that ran on `turn`, or of the most recent one for `None`.
    ///
    /// A miss names the turns that *are* held, because the alternative is a model spending a second
    /// turn discovering the same thing — and because the two ways to miss (the turn ran no program,
    /// the turn's program has aged out) have the same remedy: ask for one of these.
    pub fn source(&self, turn: Option<u64>) -> Result<&str, ProgramRefusal> {
        let found = match turn {
            Some(turn) => self.entries.iter().find(|entry| entry.turn == turn),
            None => self.entries.last(),
        };
        match found {
            Some(entry) => Ok(entry.source.as_str()),
            None => Err(ProgramRefusal {
                failure: ToolFailure::NotFound,
                message: self.miss(turn),
            }),
        }
    }

    /// The sentence a miss is refused with.
    fn miss(&self, turn: Option<u64>) -> String {
        let asked = match turn {
            Some(turn) => format!("no program was kept for turn {turn}"),
            None => "no program has been kept yet".to_string(),
        };
        if self.entries.is_empty() {
            return asked;
        }
        format!(
            "{asked}; turns held: {}",
            self.entries
                .iter()
                .map(|entry| entry.turn.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        )
    }
}

/// A [library](ProgramLibrary) resolved from an agent profile, together with every
/// `program-library` param gg could not act on.
///
/// The unknown params are carried out rather than dropped for the reason
/// [`ResolvedHealing`](crate::healing::ResolvedHealing) carries its own: a typo in an ablation's
/// configuration that silently runs the default arm is a study measuring the wrong thing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedProgramLibrary {
    /// The library this agent runs with — disabled when the capability is absent or off.
    pub library: ProgramLibrary,
    /// Every param that named nothing gg knows, or named something it knows with a value it could
    /// not read. Reported at `warn` when the run starts.
    pub unknown_params: Vec<String>,
}

/// Resolve one agent's [program library](ProgramLibrary) from its
/// [capability](CAPABILITY_PROGRAM_LIBRARY) params.
///
/// | `params` | Meaning |
/// | --- | --- |
/// | capability absent or disabled | no library, and the `programs` object is not bound |
/// | no `keep` | the [default](DEFAULT_KEEP) retention |
/// | `keep: 0` | every program of the session is retained |
/// | `keep: 5` | the five most recent |
/// | `keep: "5"`, `keep: -1` | the default retention, and `keep` is reported |
///
/// Per **agent** rather than per run, like every other capability: a reviewer may keep programs
/// where its spawner does not, and the object a program sees is exactly what its own profile
/// declares.
pub fn resolve_program_library(profile: &GgAgentConfig) -> ResolvedProgramLibrary {
    let Some(capability) = profile
        .capability(CAPABILITY_PROGRAM_LIBRARY)
        .filter(|capability| capability.enabled)
    else {
        return ResolvedProgramLibrary {
            library: ProgramLibrary::disabled(),
            unknown_params: Vec::new(),
        };
    };

    let mut unknown_params = Vec::new();
    let keep = match capability.params.get(PARAM_KEEP) {
        None | Some(Value::Null) => Some(DEFAULT_KEEP),
        // `0` is a value, not an absence: it says "keep everything", which is what a study reading
        // whole sessions back wants and what a bounded default cannot express.
        Some(Value::Number(number)) => match number.as_u64() {
            Some(0) => None,
            Some(keep) => Some(usize::try_from(keep).unwrap_or(usize::MAX)),
            None => {
                unknown_params.push(PARAM_KEEP.to_string());
                Some(DEFAULT_KEEP)
            }
        },
        Some(_) => {
            unknown_params.push(PARAM_KEEP.to_string());
            Some(DEFAULT_KEEP)
        }
    };

    ResolvedProgramLibrary {
        library: ProgramLibrary::enabled(keep),
        unknown_params,
    }
}

/// The launch-time `info` line naming which agents keep programs and how many each keeps, or `None`
/// when no agent does.
///
/// Emitted for the reason [`assistant_messages_summary`](crate::healing::assistant_messages_summary)
/// is: the arm of a study without the library and the arm with it where no program ever reached back
/// are indistinguishable in an operator's log otherwise. It is per agent because the capability is —
/// a run may keep programs for its implementer and not for its reviewer, and a single number would
/// describe neither.
pub fn launch_summary(agents: &[GgAgentConfig]) -> Option<String> {
    let clauses: Vec<String> = agents
        .iter()
        .filter_map(|agent| {
            let library = resolve_program_library(agent).library;
            library.is_enabled().then(|| match library.keep {
                Some(keep) => format!("`{}` keeps its {keep} most recent", agent.name),
                None => format!("`{}` keeps every one", agent.name),
            })
        })
        .collect();
    if clauses.is_empty() {
        return None;
    }
    Some(format!(
        "program library: a program can fetch and re-run a program this agent already ran \
         (`programs.get`, `programs.rerun`) — {}",
        clauses.join("; ")
    ))
}

/// A count narrowed to the `u32` the membrane carries, saturating rather than wrapping: a program
/// larger than four billion characters cannot exist inside the sandbox's memory cap, and a wrap
/// would report a huge program as a tiny one.
fn saturating_u32(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

#[cfg(test)]
#[path = "programs.test.rs"]
mod tests;
