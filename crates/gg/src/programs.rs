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
//! One entry per **submission that carried a program**, under the id its `submit_program`
//! acknowledgement carried, holding the source that *executed*. A call whose reply was not a program
//! contributes nothing (there is no source, and no id was minted for it), and a submission whose
//! program was itself handed over by `programs.rerun` records the program that ran rather than the
//! two lines that asked for it — which is the property that makes fetch-patch-rerun compose across
//! turns instead of degenerating into a chain of trampolines. A reply that carried several
//! submissions leaves several entries in the same turn, each under its own id.
//!
//! Nothing about a program's *effects* is kept here. This is a text store: what the program did is
//! the run's telemetry, its session record, and the workspace.
//!
//! # Program ids
//!
//! An id is a cuid2 of the length the agent's [`idLength`](PARAM_ID_LENGTH) param sets, minted
//! when the submission is acknowledged and before the program runs, so the acknowledgement is a
//! receipt rather than a verdict. It is minted against **every id this library has ever issued**,
//! retained or since dropped — so a fetch of a program the retention has dropped is `not-found`
//! rather than a different program answering to a re-used name. Minting makes at most
//! [`ID_ATTEMPTS`] attempts, re-rolling a collision; exhausting the bound is gg's own defect, and
//! the turn it lands on is fatal the way a host fault is.
//!
//! Ids are scoped to the agent: an agent fetches its own programs and no other agent's, and the same
//! id string may name different programs in different agents' libraries.
//!
//! # Across a succession
//!
//! The library follows the agent through an exec, fork or FSM transition on the same terms as its
//! other per-instance state: a fork [clones](ProgramLibrary::clone) it, an exec or a machine edge
//! moves it, and the successor [adopts](ProgramLibrary::adopt) what was carried after resolving its
//! retention and id length from its own profile.
//!
//! # Why it is not a context item
//!
//! The obvious alternative — leave the programs in the window, where the model can already see them
//! — is what the library exists to be independent of. A window is compacted, archived and evicted;
//! gg's own state is not. An agent forty turns past a compaction can still fetch the program it
//! wrote before it, and an agent whose window holds its last program still pays nothing extra to
//! reach for one, because the library is never rendered into a prompt. The model reads it by asking.

use std::collections::BTreeSet;
use std::fmt;
use std::sync::Arc;

use serde_json::Value;
use test_cabinet_core::gg::{CAPABILITY_PROGRAM_LIBRARY, GgAgentConfig};

use crate::tools::ToolFailure;

/// The params this module reads, re-exported from the crate that owns gg's configuration
/// vocabulary: the spelling a document is written in and the spelling gg reads it by are one
/// constant, so a key cannot be renamed on one side of the wire alone.
pub use test_cabinet_core::gg::{PARAM_ID_LENGTH, PARAM_KEEP};

/// The shortest id an agent may be configured to mint. One character is thirty-six ids for a
/// session, which the re-roll bound would exhaust inside an ordinary run.
pub const ID_LENGTH_MIN: u64 = 2;

/// The longest id an agent may be configured to mint. A cuid2 is at most thirty-two characters,
/// and every one past four is tokens the model pays on each fetch.
pub const ID_LENGTH_MAX: u64 = 32;

/// How many candidate ids are minted, in total, before the library gives up: the first roll plus
/// at most fifteen re-rolls of a collision.
///
/// Sixteen is far past what a healthy id space ever needs: at the shortest length the space holds
/// over a thousand ids, and a session holds tens of programs. Reaching it says the id source is
/// broken, which is exactly why exhausting it is fatal rather than a longer loop.
pub const ID_ATTEMPTS: usize = 16;

/// One program this agent ran, as the library holds it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgramRecord {
    /// The id its `submit_program` acknowledgement carried — the handle `programs.get` takes.
    pub id: String,
    /// The session turn it ran on, for orientation: the same number the context window's turn
    /// headers carry, and `0` for one of gg's own opening programs, which run before the model's
    /// first turn.
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
/// time, by id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgramSummary {
    /// The id `programs.get` takes for it.
    pub id: String,
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

/// Why a `programs.*` lookup was refused, in a shape the membrane lowers into a typed `api-error`.
///
/// It carries a [`ToolFailure`] rather than the membrane's generated `error-code` for the reason
/// every other type on that seam does: nothing outside `sandbox/membrane` may depend on the
/// `bindgen!` types, and the membrane already owns the one conversion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgramRefusal {
    /// The failure class — `not-found` for an id the library does not hold.
    pub failure: ToolFailure,
    /// The model-facing guidance, which for a miss **names the ids that are held** (and the turn
    /// each ran in) rather than leaving the model to guess at a string twice.
    pub message: String,
}

/// The library could not mint an id: every one of its [`ID_ATTEMPTS`] rolls came back already
/// issued.
///
/// gg's own defect — the id source is not producing fresh ids — and never a silent fallback: the
/// turn it lands on ends the run the way a host fault does, with this sentence on the operator's
/// stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgramIdExhausted {
    /// The operator-facing sentence.
    pub message: String,
}

/// Where a library's ids come from: the real cuid2 mint, or whatever a test injects in its place
/// so a collision can be staged deterministically.
pub trait ProgramIdMinter: Send + Sync {
    /// One candidate id of `length` characters. Uniqueness is the library's to check, not the
    /// minter's.
    fn mint(&self, length: usize) -> String;
}

/// The production minter: a cuid2 of the requested length.
struct Cuid2Minter;

impl ProgramIdMinter for Cuid2Minter {
    fn mint(&self, length: usize) -> String {
        cuid2::CuidConstructor::new()
            .with_length(u16::try_from(length).unwrap_or(u16::MAX))
            .create_id()
    }
}

/// **Keep every program of the session** — the retention `keep: 0` states.
///
/// The one integral param in gg whose zero is the widest setting rather than the narrowest, which
/// is why it is spelled here rather than left as a bare `None` at the two loci that produce it.
const KEEP_EVERY_PROGRAM: Option<usize> = None;

/// The retention a resolver hands back once it has [refused the launch](crate::validate).
///
/// Named rather than written as [`KEEP_EVERY_PROGRAM`], which is a configuration an operator can
/// ask for and which every reader downstream would read this as. Nothing is ever kept under it: the
/// run it belongs to does not start.
const KEEP_LAUNCH_REFUSED: Option<usize> = Some(0);

/// The id length a resolver hands back once it has [refused the launch](crate::validate): the
/// shortest one, which is a value an operator can ask for but which nothing runs under here, because
/// the run it belongs to does not start.
const ID_LENGTH_LAUNCH_REFUSED: usize = ID_LENGTH_MIN as usize;

/// One agent's library of the programs it has run.
///
/// Created disabled for every agent, and [armed](Self::enabled) only for one whose profile enables
/// the capability — the same shape [`SkillsRuntime`](crate::skills) uses, so the loop holds one
/// value either way and nothing has to branch on an `Option` per turn.
#[derive(Clone)]
pub struct ProgramLibrary {
    /// Whether this agent keeps programs at all. A disabled library records nothing and holds
    /// nothing, so an agent without the capability cannot accrue state it will never read.
    enabled: bool,
    /// How many of the most recent programs to retain, or `None` for every one.
    keep: Option<usize>,
    /// How many characters long each minted id is.
    id_length: usize,
    /// Where candidate ids come from.
    minter: Arc<dyn ProgramIdMinter>,
    /// Every id this library has ever issued, retained or since dropped. What a fresh id is checked
    /// against, so a dropped program's id is never re-used for another.
    issued: BTreeSet<String>,
    /// The retained programs, oldest first. Bounded by [`keep`](Self::keep).
    entries: Vec<ProgramRecord>,
}

impl fmt::Debug for ProgramLibrary {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ProgramLibrary")
            .field("enabled", &self.enabled)
            .field("keep", &self.keep)
            .field("id_length", &self.id_length)
            .field("issued", &self.issued)
            .field("entries", &self.entries)
            .finish_non_exhaustive()
    }
}

impl ProgramLibrary {
    /// A library that keeps nothing — every agent without the capability, and the placeholder the
    /// loop leaves behind while the live one is moved into a turn.
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            keep: None,
            id_length: ID_LENGTH_LAUNCH_REFUSED,
            minter: Arc::new(Cuid2Minter),
            issued: BTreeSet::new(),
            entries: Vec::new(),
        }
    }

    /// A live library retaining the most recent `keep` programs, or every one for `None`, minting
    /// ids `id_length` characters long.
    pub fn enabled(keep: Option<usize>, id_length: usize) -> Self {
        Self {
            enabled: true,
            keep,
            id_length,
            minter: Arc::new(Cuid2Minter),
            issued: BTreeSet::new(),
            entries: Vec::new(),
        }
    }

    /// The same library minting its ids from `minter` instead of cuid2 — how a test stages a
    /// collision without sleeping or trusting randomness.
    #[cfg(test)]
    pub fn with_minter<M: ProgramIdMinter + 'static>(mut self, minter: Arc<M>) -> Self {
        self.minter = minter;
        self
    }

    /// Whether this agent's programs are kept — which is also whether the `programs` object is bound
    /// into its scope. The loop reads it for both, from one value, so the surface a model is shown
    /// and the state gg holds cannot disagree.
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// How many of the most recent programs are retained, or `None` for every one.
    pub fn keep(&self) -> Option<usize> {
        self.keep
    }

    /// How many characters long each id this library mints is.
    pub fn id_length(&self) -> usize {
        self.id_length
    }

    /// Mint the id for a program that is about to run: fresh against every id this library has
    /// ever issued, and remembered as issued from this moment.
    ///
    /// A disabled library issues nothing and answers `Ok(None)`: an agent without the capability
    /// has no id length to mint at, and its acknowledgements say so in the fixed word instead.
    /// `Err` is the [attempt bound](ID_ATTEMPTS) exhausted, which is gg's own defect.
    pub fn issue_id(&mut self) -> Result<Option<String>, ProgramIdExhausted> {
        if !self.enabled {
            return Ok(None);
        }
        for _ in 0..ID_ATTEMPTS {
            let candidate = self.minter.mint(self.id_length);
            if self.issued.insert(candidate.clone()) {
                return Ok(Some(candidate));
            }
        }
        Err(ProgramIdExhausted {
            message: format!(
                "the program library could not mint a fresh program id: all {ID_ATTEMPTS} ids of \
                 length {} it rolled were already issued, {} issued so far (gg defect)",
                self.id_length,
                self.issued.len()
            ),
        })
    }

    /// Record the program that ran under `id` on `turn`, dropping the oldest if retention is now
    /// exceeded.
    ///
    /// A no-op for a disabled library. Recording the **same** id twice replaces the earlier entry
    /// rather than adding one — a submission is one program as far as the model is concerned, even
    /// when gg ran a chain of them to get there, and the one worth keeping is the last: the program
    /// that actually did the submission's work. (The chain records once, with that program, so the
    /// replacement path is an invariant kept explicit rather than one the loop reaches.)
    pub fn record(&mut self, id: &str, turn: u64, source: &str, ok: bool, error: Option<String>) {
        if !self.enabled {
            return;
        }
        let record = ProgramRecord {
            id: id.to_string(),
            turn,
            source: source.to_string(),
            ok,
            error,
        };
        match self.entries.iter_mut().find(|entry| entry.id == id) {
            Some(existing) => *existing = record,
            None => self.entries.push(record),
        }
        self.truncate();
    }

    /// Drop the oldest entries past this library's retention.
    fn truncate(&mut self) {
        if let Some(keep) = self.keep.filter(|keep| self.entries.len() > *keep) {
            let excess = self.entries.len() - keep;
            self.entries.drain(..excess);
        }
    }

    /// Adopt what a predecessor [carried](crate::agent) across a succession: its entries, truncated
    /// to **this** library's retention, and every id it ever issued, so this incarnation never
    /// re-issues one its predecessor handed out.
    ///
    /// This library's `enabled`, `keep` and `id_length` are its own profile's and are left alone;
    /// a disabled library adopts nothing, because a successor whose profile withholds the
    /// capability keeps nothing.
    pub fn adopt(&mut self, carried: ProgramLibrary) {
        if !self.enabled {
            return;
        }
        self.entries = carried.entries;
        self.issued = carried.issued;
        self.truncate();
    }

    /// Every retained program's shape, oldest first — what `programs.history()` returns.
    pub fn summaries(&self) -> Vec<ProgramSummary> {
        self.entries
            .iter()
            .map(|entry| ProgramSummary {
                id: entry.id.clone(),
                turn: entry.turn,
                lines: saturating_u32(entry.source.lines().count()),
                chars: saturating_u32(entry.source.chars().count()),
                ok: entry.ok,
                error: entry.error.clone(),
            })
            .collect()
    }

    /// The source of the program that ran under `id`.
    ///
    /// A miss names the ids that *are* held and the turn each ran in, because the alternative is a
    /// model spending a second turn discovering the same thing — and because the two ways to miss
    /// (the id was never issued, the id's program has aged out) have the same remedy: ask for one
    /// of these.
    pub fn source(&self, id: &str) -> Result<&str, ProgramRefusal> {
        match self.entries.iter().find(|entry| entry.id == id) {
            Some(entry) => Ok(entry.source.as_str()),
            None => Err(ProgramRefusal {
                failure: ToolFailure::NotFound,
                message: self.miss(id),
            }),
        }
    }

    /// The sentence a miss is refused with.
    fn miss(&self, id: &str) -> String {
        let asked = format!("no program is kept under the id `{id}`");
        if self.entries.is_empty() {
            return format!("{asked}; no program has been kept yet");
        }
        format!(
            "{asked}; ids held: {}",
            self.entries
                .iter()
                .map(|entry| format!("`{}` (turn {})", entry.id, entry.turn))
                .collect::<Vec<_>>()
                .join(", ")
        )
    }
}

/// Resolve one agent's [program library](ProgramLibrary) from its
/// [capability](CAPABILITY_PROGRAM_LIBRARY) params.
///
/// | `params` | Meaning |
/// | --- | --- |
/// | capability absent or disabled | no library, and the `programs` object is not bound |
/// | `keep: 0` | [every program of the session](KEEP_EVERY_PROGRAM) is retained |
/// | `keep: 5` | the five most recent |
/// | no `keep` | **refused** — the launch does not proceed |
/// | `keep: "5"`, `keep: -1` | **refused** — the launch does not proceed |
/// | `idLength: 4` | ids four characters long |
/// | no `idLength`, `idLength: "4"`, `idLength: 1`, `idLength: 33` | **refused** — the launch does not proceed |
///
/// `0` is a value here rather than an absence, and the one integral param in gg whose zero is the
/// widest setting rather than the narrowest: it says *keep everything*, which is what a study
/// reading whole sessions back wants. That is exactly why an absent `keep` cannot be read as one —
/// the two say opposite things, and gg will not pick between them. A `keep` gg cannot read takes no
/// setting at all, and is refused on the same terms, so a study never holds a different number of
/// programs than its configuration says. `idLength` is refused on the same terms, and outside
/// [`ID_LENGTH_MIN`]`..=`[`ID_LENGTH_MAX`] besides, so a study's ids are never a different shape
/// than its configuration says.
///
/// Per **agent** rather than per run, like every other capability: a reviewer may keep programs
/// where its spawner does not, and the object a program sees is exactly what its own profile
/// declares.
pub fn resolve_program_library(
    profile: &GgAgentConfig,
    report: &mut crate::validate::LaunchReport,
) -> ProgramLibrary {
    let Some(capability) = profile
        .capability(CAPABILITY_PROGRAM_LIBRARY)
        .filter(|capability| capability.enabled)
    else {
        return ProgramLibrary::disabled();
    };
    ProgramLibrary::enabled(
        required_keep(&capability.params, report),
        required_id_length(&capability.params, report),
    )
}

/// The retention an **enabled** capability declares, or [`KEEP_LAUNCH_REFUSED`] once it has been
/// reported short of one.
///
/// The two ways to come back with nothing are separated here rather than folded together, because
/// they are opposite statements: a written `0` is an operator asking to keep the whole session, and
/// an absent `keep` is nobody having said anything at all.
fn required_keep(params: &Value, report: &mut crate::validate::LaunchReport) -> Option<usize> {
    match crate::validate::required_count_param(
        params,
        CAPABILITY_PROGRAM_LIBRARY,
        PARAM_KEEP,
        report,
    ) {
        Some(0) => KEEP_EVERY_PROGRAM,
        Some(keep) => Some(usize::try_from(keep).unwrap_or(usize::MAX)),
        // Absent, or written and unreadable: either way the launch is over long before any program
        // reaches the library it would have been kept in.
        None => KEEP_LAUNCH_REFUSED,
    }
}

/// The id length an **enabled** capability declares, or [`ID_LENGTH_LAUNCH_REFUSED`] once it has
/// been reported short of one — absent, unreadable, or outside
/// [`ID_LENGTH_MIN`]`..=`[`ID_LENGTH_MAX`].
fn required_id_length(params: &Value, report: &mut crate::validate::LaunchReport) -> usize {
    let Some(length) = crate::validate::required_count_param(
        params,
        CAPABILITY_PROGRAM_LIBRARY,
        PARAM_ID_LENGTH,
        report,
    ) else {
        return ID_LENGTH_LAUNCH_REFUSED;
    };
    match bounded_id_length(length, report) {
        Some(length) => length,
        None => ID_LENGTH_LAUNCH_REFUSED,
    }
}

/// `length` checked against the id range, reporting one outside it.
fn bounded_id_length(length: u64, report: &mut crate::validate::LaunchReport) -> Option<usize> {
    if (ID_LENGTH_MIN..=ID_LENGTH_MAX).contains(&length) {
        return usize::try_from(length).ok();
    }
    report.report(crate::validate::LaunchDefect::run_level(
        crate::validate::param_locus(CAPABILITY_PROGRAM_LIBRARY, PARAM_ID_LENGTH),
        length.to_string(),
        format!(
            "the `{CAPABILITY_PROGRAM_LIBRARY}` capability's `{PARAM_ID_LENGTH}` must be from \
             {ID_LENGTH_MIN} to {ID_LENGTH_MAX}"
        ),
    ));
    None
}

/// The program library's whole contribution to the [launch pass](crate::validate::validate_launch):
/// the retention and id length `profile` declares.
///
/// Read on a **disabled** capability too, unlike the resolver above, which has no library to build
/// for one — but read as optional values there. A switched-off capability requires nothing of
/// itself, and what it does write is still configuration: it records the retention and id length
/// the arm would have kept, so a typo in either is a typo now rather than on the launch that flips
/// the switch.
pub fn check_launch(profile: &GgAgentConfig, report: &mut crate::validate::LaunchReport) {
    let Some(capability) = profile.capability(CAPABILITY_PROGRAM_LIBRARY) else {
        return;
    };
    if capability.enabled {
        required_keep(&capability.params, report);
        required_id_length(&capability.params, report);
        return;
    }
    crate::validate::count_param(
        &capability.params,
        CAPABILITY_PROGRAM_LIBRARY,
        PARAM_KEEP,
        report,
    );
    if let Some(length) = crate::validate::count_param(
        &capability.params,
        CAPABILITY_PROGRAM_LIBRARY,
        PARAM_ID_LENGTH,
        report,
    ) {
        bounded_id_length(length, report);
    }
}

/// The launch-time `info` line naming which agents keep programs, how many each keeps and how long
/// its ids are, or `None` when no agent does.
///
/// Emitted for the reason [`RunLimits::armed_summary`](crate::limits::RunLimits::armed_summary)
/// is — a resolved configuration an operator's log must name: the arm of a study without the
/// library and the arm with it where no program ever reached back are indistinguishable otherwise. It is per agent because the capability is —
/// a run may keep programs for its implementer and not for its reviewer, and a single number would
/// describe neither.
pub fn launch_summary(agents: &[GgAgentConfig]) -> Option<String> {
    let keeping: Vec<(&GgAgentConfig, ProgramLibrary)> = agents
        .iter()
        .filter_map(|agent| {
            // Discarding: every one of these params was read, and refused if unhonourable, by
            // `check_launch` before the run started.
            let library =
                resolve_program_library(agent, &mut crate::validate::LaunchReport::Discarding);
            library.is_enabled().then_some((agent, library))
        })
        .collect();
    if keeping.is_empty() {
        return None;
    }
    let clauses: Vec<String> = keeping
        .iter()
        .map(|(agent, library)| {
            let ids = format!("under {}-character ids", library.id_length());
            match library.keep() {
                Some(keep) => format!("`{}` keeps its {keep} most recent {ids}", agent.slug),
                None => format!("`{}` keeps every one {ids}", agent.slug),
            }
        })
        .collect();
    // The two calls, spelled by the languages the agents this line is *about* actually write in —
    // deduplicated, so the ordinary single-language run reads as one pair and a mixed-language run
    // names both rather than quietly picking one.
    let calls: BTreeSet<String> = keeping
        .iter()
        .map(|(agent, _)| {
            let language = crate::sandbox::language(crate::sandbox::resolve_program_language(
                agent,
                &mut crate::validate::LaunchReport::Discarding,
            ));
            format!(
                "`{}`, `{}`",
                crate::sandbox::spell(language, crate::sandbox::PROGRAMS_GET),
                crate::sandbox::spell(language, crate::sandbox::PROGRAMS_RERUN)
            )
        })
        .collect();
    Some(format!(
        "program library: a program can fetch and re-run a program this agent already ran ({}) — {}",
        calls.into_iter().collect::<Vec<_>>().join(" or "),
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
