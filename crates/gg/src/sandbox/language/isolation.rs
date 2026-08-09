//! **The per-agent compiler isolation gate** — the assertion that preparing a program is a function
//! of that program alone, held under the concurrency a gg run really produces.
//!
//! # The bug this reproduces
//!
//! A program's language is resolved **per agent**. Agents run in parallel up to `limits.maxParallel`
//! (16), each turn may chain several programs, and every one of those preparations happens in one
//! process. Two silent-corruption bugs of exactly that shape were measured on real toolchains while
//! this capability was being designed:
//!
//! * eight concurrent `purs` compiles into one shared output tree produced a single
//!   `output/Main/index.js` containing **two different agents' programs interleaved** — reproduced
//!   3 times out of 3;
//! * a shared TeaVM `InProcessBuildStrategy` driven from four threads produced **no output at all
//!   for three of the four**, and `build()` threw nothing.
//!
//! **Every process exited zero in both.** Nothing crashed, nothing raised a diagnostic, and nothing
//! would have been recorded as a [toolchain failure](super::PrepareFailure::Toolchain). One agent
//! silently evaluates another agent's program, the turn reports success, and every number the study
//! collects downstream is wrong while looking healthy. In a measurement harness that is the worst
//! failure available, which is why this gate exists at all and why it landed before any compiler did.
//!
//! # What it asserts
//!
//! One property, in three observable parts. Sixteen preparations, each with its own distinguishable
//! input, are driven simultaneously; every result must belong to **its own** input:
//!
//! 1. **It succeeded.** The same input prepared cleanly on its own a moment earlier, so a failure
//!    that appears only under concurrency is contention, not a bad program.
//! 2. **It is not empty**, and it **carries its own marker** — the TeaVM shape, where a build
//!    silently produced nothing.
//! 3. **It carries no other preparation's marker** — the `purs` shape, where one artifact held two
//!    agents' programs.
//!
//! Plus one thing observed rather than derived: no two of the sixteen were handed the same
//! [workspace](super::Workspace).
//!
//! # The fourth check this used to have, and why it is gone
//!
//! There was a fourth: that each concurrent artifact **matched byte-for-byte** what the same input
//! produced alone. The argument for it was that it would catch a corruption too partial to move a
//! marker — a fragment of somebody else's program, a truncated tail, a stale artifact left by a
//! previous compile. It is recorded here rather than simply deleted, so the next author weighing the
//! same idea starts from the three things that decided against it:
//!
//! * **The seam already isolates structurally, per preparation.** A [workspace](super::Workspace) is
//!   a private tree keyed on the process id and a monotonic counter, created with `create_dir` and
//!   not `create_dir_all` — so a collision is a loud error rather than a quiet share — with `HOME`,
//!   `TMPDIR`, the `XDG_*` roots and the working directory redirected into it and the whole tree
//!   removed on drop. What is genuinely shared between preparations is content-keyed, installed by
//!   rename and sealed read-only (0444/0555). The paths a partial corruption would have to arrive
//!   through are closed by construction, which is a stronger statement than one run of a comparison.
//! * **It never caught anything on its own.** Every deliberately broken preparation in
//!   [`tests`] — the shared output tree, the shared build strategy, the memoised compile, the
//!   miskeyed cache — is caught by the marker checks above, and two of the four *are* the bugs that
//!   were measured on real toolchains. Not one of them needed the comparison to be reported.
//! * **It could not be paid for once.** Byte equality only means anything over the part of an
//!   artifact that is a function of the program, and a compiler is entitled to write things into an
//!   artifact that are a function of the environment or of nothing at all. Holding [Swift](super::swift)
//!   to it cost a per-language projection of ~290 lines: a section-framing walk dropping ~1.5 MB of
//!   `.debug_*`, plus a mask for the random 16-byte module hash `swiftc` stamps into every object,
//!   located by compiling one program twice and diffing it. That derivation asserted that two random
//!   16-byte values differ in **all sixteen** positions — which is a property of two random numbers
//!   rather than of the compiler, and holds only `(255/256)^16` ≈ 93.9% of the time. So it failed
//!   about **6%** of runs by arithmetic, and was observed failing 2 times in 60 when the derivation
//!   was driven in a loop, in the one gate whose whole value is being believed when it goes red.
//!   Every compiled arm after Swift would have owed a tax of the same shape, paid in machinery the
//!   checks that catch the real bugs never read.
//!
//! **None of that projection survived.** What did is one narrower hook, and the distinction matters
//! because the wider one is what this section exists to stop being reinvented: an arm may make its
//! artifact **readable** for the marker search — see
//! [`isolation_readable`](ProgramLanguage::isolation_readable) — and may never hide, mask or
//! summarise any part of it. Its only implementor is [C#](super::csharp), which base64-decodes an
//! assembly that would otherwise carry no findable marker at all.
//!
//! # Why the gate is generic over a preparation rather than over a language
//!
//! Because a gate nothing has ever failed is a gate nobody knows works. This drives any
//! [`Preparation`] — which lets its [tests](self::tests) point it at deliberately broken ones that
//! have each measured bug, and require it to *catch* them, beside pointing it at every registered
//! language and requiring it to pass. A registered language is a `Preparation` (see
//! [`preparations`]), so what proves the gate has teeth and what the gate protects are the same code
//! path.
//!
//! # What a language author needs from this
//!
//! Nothing, if the language compiles through the [seam's own affordances](super::compile): the
//! private workspace, the isolated invocation, the exclusive-checkout pool. A language that reaches
//! around them — a fixed output path, a `static` compiler daemon, a shared build cache — fails here,
//! at 16-way, with a message naming which preparation got whose program.

use std::path::{Path, PathBuf};
use std::sync::Barrier;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::compile::PrepareContext;
use super::{ProgramLanguage, all_languages};

/// How many preparations the gate drives at once.
///
/// `limits.maxParallel`'s ceiling, because that is how many agents a run may have in flight, and a
/// gate that proved isolation at four would prove nothing about the sixteenth. The measured `purs`
/// corruption needed eight to show itself.
pub(super) const WIDTH: usize = 16;

/// One thing the gate can drive: something that turns a source carrying a marker into a prepared
/// artifact.
///
/// A registered language's program step and its module step are each one of these, and so is a
/// deliberately broken stand-in with a measured bug in it. The gate cannot tell them apart, which is
/// the point.
pub(super) trait Preparation: Sync {
    /// What this preparation is, for a failure message: `TypeScript program`, `a shared output
    /// tree`.
    fn describe(&self) -> String;

    /// A source carrying `marker`, valid for whatever this prepares.
    ///
    /// The marker has to survive preparation — it is what says whose program an artifact is. A
    /// language builds the source out of its own SDK so that the marker rides inside a **call**
    /// rather than an unused constant: an argument cannot be eliminated by a compiler that drops
    /// dead code.
    fn source(&self, marker: &str) -> String;

    /// Prepare it, in `context`, and hand back the artifact as text.
    fn prepare(&self, source: &str, context: &PrepareContext) -> Result<String, String>;

    /// Every way `marker` may be **spelled inside** this preparation's artifact — the forms
    /// [`breaches`] accepts as the marker being present, and rejects as another input's marker being
    /// present.
    ///
    /// The marker itself for almost everything, because an artifact that carries a string carries
    /// its bytes: an interpreted arm's is source, and a compiled arm's wasm module keeps a string
    /// literal in its data section as the bytes the model wrote. The list exists for the one arm
    /// where that is false — see
    /// [`isolation_marker_forms`](ProgramLanguage::isolation_marker_forms).
    fn marker_forms(&self, marker: &str) -> Vec<String> {
        vec![marker.to_string()]
    }
}

/// One way a preparation failed to belong to its own input.
#[derive(Debug)]
pub(super) enum Breach {
    /// The input could not be prepared **on its own**, before any concurrency. Not an isolation
    /// failure — a harness failure, or a language that cannot prepare its own SDK's call — and
    /// reported separately so the two are never confused.
    Baseline {
        /// Which of the sixteen inputs.
        marker: String,
        /// What preparing it said.
        error: String,
    },
    /// It prepared alone and failed under concurrency. Contention: a lock nobody took, a file
    /// another preparation removed, a daemon another preparation was mid-build on.
    Contended {
        /// Which of the sixteen inputs.
        marker: String,
        /// What preparing it said this time.
        error: String,
    },
    /// The artifact does not contain its own input's marker — including the case where there is no
    /// artifact at all. The TeaVM shape: a build that silently produced nothing.
    Missing {
        /// Which of the sixteen inputs.
        marker: String,
        /// What came back instead, capped.
        prepared: String,
    },
    /// The artifact contains **another** preparation's marker. The `purs` shape: one artifact
    /// holding two agents' programs.
    Foreign {
        /// Which of the sixteen inputs this artifact was for.
        marker: String,
        /// Whose marker turned up in it.
        foreign: String,
    },
    /// Two preparations were handed the same workspace — the precondition of the `purs` corruption,
    /// caught directly rather than through its consequences.
    SharedWorkspace {
        /// The path both were given.
        path: PathBuf,
        /// Which inputs shared it.
        markers: Vec<String>,
    },
}

impl std::fmt::Display for Breach {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Baseline { marker, error } => write!(
                formatter,
                "{marker} could not be prepared on its own, before any concurrency: {error}"
            ),
            Self::Contended { marker, error } => write!(
                formatter,
                "{marker} prepared alone and failed at {WIDTH}-way: {error}"
            ),
            Self::Missing { marker, prepared } => write!(
                formatter,
                "{marker}'s artifact does not carry its own marker — it got {prepared:?}"
            ),
            Self::Foreign { marker, foreign } => write!(
                formatter,
                "{marker}'s artifact carries {foreign}'s program: one agent would evaluate another's"
            ),
            Self::SharedWorkspace { path, markers } => write!(
                formatter,
                "{} were handed the same workspace {}",
                markers.join(" and "),
                path.display()
            ),
        }
    }
}

/// Drive `preparation` `WIDTH` ways with distinguishable inputs and report every way a result failed
/// to belong to its own input.
///
/// Each input is prepared **alone first**: the same sixteen, one at a time, each in its own context.
/// Serial preparation cannot be corrupted by concurrency, so an input that fails there is failing on
/// its own account — a harness fault, or a language that cannot prepare its own SDK's call — and it
/// is reported as a [`Breach::Baseline`] and the concurrent run is abandoned, rather than being
/// allowed to come back a moment later looking like an isolation failure.
///
/// That is the *whole* of what the alone run is for. What it produced is deliberately not kept:
/// nothing compares against it any more, and the reasoning behind that is in this module's header.
pub(super) fn breaches(preparation: &dyn Preparation) -> Vec<Breach> {
    let markers: Vec<String> = (0..WIDTH).map(marker).collect();
    let sources: Vec<String> = markers.iter().map(|m| preparation.source(m)).collect();

    for (marker, source) in markers.iter().zip(&sources) {
        if let Err(error) = preparation.prepare(source, &PrepareContext::new()) {
            return vec![Breach::Baseline {
                marker: marker.clone(),
                error,
            }];
        }
    }

    let barrier = Barrier::new(WIDTH);
    let together: Vec<(Result<String, String>, Option<PathBuf>)> = std::thread::scope(|scope| {
        let handles: Vec<_> = sources
            .iter()
            .map(|source| {
                let barrier = &barrier;
                scope.spawn(move || {
                    let context = PrepareContext::new();
                    // Every preparation is inside the step before any of them leaves it, which is
                    // what makes a shared anything collide rather than merely be able to.
                    barrier.wait();
                    let prepared = preparation.prepare(source, &context);
                    let workspace = context.opened_workspace().map(Path::to_path_buf);
                    (prepared, workspace)
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|handle| handle.join().expect("a preparation thread does not panic"))
            .collect()
    });

    let mut breaches = Vec::new();
    for (index, (result, _)) in together.iter().enumerate() {
        let marker = &markers[index];
        let prepared = match result {
            Ok(prepared) => prepared,
            Err(error) => {
                breaches.push(Breach::Contended {
                    marker: marker.clone(),
                    error: error.clone(),
                });
                continue;
            }
        };
        // Asked of the preparation rather than of the marker string, because one arm's artifact does
        // not spell a string the way the model wrote it: see `Preparation::marker_forms`.
        let carries = |marker: &str| {
            preparation
                .marker_forms(marker)
                .iter()
                .any(|form| prepared.contains(form))
        };
        if !carries(marker) {
            breaches.push(Breach::Missing {
                marker: marker.clone(),
                prepared: excerpt(prepared),
            });
        }
        for foreign in markers.iter().filter(|other| *other != marker) {
            if carries(foreign) {
                breaches.push(Breach::Foreign {
                    marker: marker.clone(),
                    foreign: foreign.clone(),
                });
            }
        }
    }

    breaches.extend(shared_workspaces(markers.iter().zip(&together).map(
        |(marker, (_, workspace))| (marker.as_str(), workspace.as_deref()),
    )));
    breaches
}

/// Every workspace path that more than one preparation was handed, as one breach apiece.
///
/// A preparation that never asked for a workspace has no path to collide and is skipped rather than
/// counted as sharing one — which is why the argument is an `Option` and not a path.
///
/// # Why this is a function rather than four lines inside [`breaches`]
///
/// Because it is the one check here that a broken [`Preparation`] **cannot** drive, and that is a
/// fact about the seam rather than a gap in the fixtures. A [`Workspace`](super::Workspace)'s path is
/// `{process id}-{n}` where `n` comes from a monotonic counter the seam owns, and a
/// [`PrepareContext`] can only be minted by the two functions that dispatch through the trait — so no
/// fixture, however badly behaved, can arrange for two contexts to hand back the same path. The
/// condition is unreachable by construction.
///
/// That is exactly what makes the check worth keeping and exactly what makes it untestable through
/// the front door: it is the canary on that construction, and it would earn its keep on the day
/// somebody made those paths reusable. So the detector is proved directly, by
/// [its own test](tests::two_preparations_handed_one_workspace_are_reported), rather than by a
/// sixteen-way run that can never produce the input.
pub(super) fn shared_workspaces<'a>(
    handed: impl IntoIterator<Item = (&'a str, Option<&'a Path>)>,
) -> Vec<Breach> {
    let mut seen: Vec<(PathBuf, Vec<String>)> = Vec::new();
    for (marker, workspace) in handed {
        let Some(path) = workspace else { continue };
        match seen.iter_mut().find(|(seen, _)| seen == path) {
            Some((_, markers_here)) => markers_here.push(marker.to_string()),
            None => seen.push((path.to_path_buf(), vec![marker.to_string()])),
        }
    }
    seen.into_iter()
        .filter(|(_, markers)| markers.len() > 1)
        .map(|(path, markers)| Breach::SharedWorkspace { path, markers })
        .collect()
}

/// The `n`th input's marker.
///
/// Zero-padded and suffixed so that no marker is a substring of another — without the padding,
/// `gg-isolation-1` is inside `gg-isolation-10` and every artifact would look contaminated.
fn marker(n: usize) -> String {
    format!("gg-isolation-{n:03}-marker")
}

/// Enough of an artifact to recognise it in a failure, and no more. A prepared program can be
/// hundreds of kilobytes and a test failure is read in a terminal.
fn excerpt(prepared: &str) -> String {
    const LIMIT: usize = 240;
    if prepared.len() <= LIMIT {
        return prepared.to_string();
    }
    let mut end = LIMIT;
    while !prepared.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &prepared[..end])
}

/// Both halves of one registered language, as preparations the gate can drive.
///
/// Both, because a module compiles exactly as a program does and a turn that reads three code skills
/// compiles three of them beside its own program. A language that isolated one and not the other
/// would corrupt a code skill's namespace instead of a program, which is the same bug in a place
/// nobody would think to look.
pub(super) fn preparations() -> Vec<Box<dyn Preparation>> {
    let mut preparations: Vec<Box<dyn Preparation>> = Vec::new();
    // The [fixture](super::fixture) is driven beside the registered set, and it stays here even now
    // that a real compiled arm has landed. TypeScript's artifact is produced in memory by the strip
    // and only validated by `tsc`, so corrupting its check directory moves no bytes; the fixture's —
    // and [Ruby](super::ruby)'s, whose prepared bytes are the JavaScript Opal wrote into the
    // workspace — are read back off a filesystem, which is the shape every compiled language has.
    // The fixture is the cheap subject of that shape (no process, no 2.9 MB compiler), so it is what
    // keeps these checks biting when the expensive one is skipped or slow.
    let languages = all_languages().chain(std::iter::once(
        super::fixture::fixture_language() as &'static dyn ProgramLanguage
    ));
    for language in languages {
        preparations.push(Box::new(LanguagePreparation {
            language,
            half: Half::Program,
        }));
        preparations.push(Box::new(LanguagePreparation {
            language,
            half: Half::Module,
        }));
    }
    preparations
}

/// Which of a language's two preparation steps is being driven.
#[derive(Clone, Copy)]
enum Half {
    /// A model's reply.
    Program,
    /// A code skill's or memory's module.
    Module,
}

/// One registered language's program or module step, as the gate sees it.
struct LanguagePreparation {
    /// The language.
    language: &'static dyn ProgramLanguage,
    /// Which step.
    half: Half,
}

impl Preparation for LanguagePreparation {
    fn describe(&self) -> String {
        let half = match self.half {
            Half::Program => "program",
            Half::Module => "module",
        };
        format!("{} {half}", self.language.display_name())
    }

    /// A source built out of the language's **own** SDK, so it is valid in that language's syntax
    /// and passes that language's own checker.
    ///
    /// [`open_docs_views_statement`](ProgramLanguage::open_docs_views_statement) is the one **whole
    /// program** the seam requires every language to be able to write — it is the on-use script of
    /// every built-in family skill, and a sibling gate already asserts that each language can prepare
    /// what it generated. That is exactly what this needs, and it is why a *statement* is not: a
    /// language whose programs are modules ([PureScript](super::purescript)) has no compiling
    /// artifact for one loose line, so a subject built out of
    /// [`open_file_statement`](ProgramLanguage::open_file_statement) would fail this gate's baseline
    /// over its own syntax rather than over anything about isolation.
    ///
    /// The marker rides in as one of the names, which puts it inside a call's argument — where a
    /// compiler that eliminates dead code cannot drop it, and where a type checker reads it as the
    /// string the SDK declares.
    ///
    /// The **module** half asks the language rather than reusing that program, because a language is
    /// entitled to have a module shape that is not its program shape — and one does. See
    /// [`isolation_module`](ProgramLanguage::isolation_module), whose default is this same program
    /// for every language whose module is ordinary source of the language.
    fn source(&self, marker: &str) -> String {
        let name = format!("gg-isolation-{marker}");
        match self.half {
            Half::Program => self.language.open_docs_views_statement(&[&name]),
            Half::Module => self.language.isolation_module(&name),
        }
    }

    fn prepare(&self, source: &str, context: &PrepareContext) -> Result<String, String> {
        match self.half {
            Half::Program => self
                .language
                .prepare_program(source, &[], context)
                .map(|prepared| artifact(self.language, prepared)),
            Half::Module => self
                .language
                .prepare_module(source, context)
                .map(|prepared| prepared.source),
        }
        .map_err(|failure| failure.to_string())
    }

    /// The language's own answer, and only for the **program** half.
    ///
    /// A module's artifact on every arm is either its source or something compiled from it that
    /// still carries the author's own bytes, so the marker is spelled the way it was written. The
    /// program half is where an arm's compiler gets to choose — see
    /// [`isolation_marker_forms`](ProgramLanguage::isolation_marker_forms).
    fn marker_forms(&self, marker: &str) -> Vec<String> {
        match self.half {
            Half::Program => self.language.isolation_marker_forms(marker),
            Half::Module => vec![marker.to_string()],
        }
    }
}

/// What a prepared program's **artifact** is, as text this gate can search for a marker.
///
/// The two shapes of arm keep their artifacts in different places, and the gate's question is the
/// same for both — *whose program is this?* — so it asks it of whichever one the language filled in.
/// An interpreted arm's is [`source`](super::PreparedProgram::source); a **compiled** arm's is the
/// wasm [`component`](super::PreparedProgram::component) it produced for this program and nothing
/// else.
///
/// Either half's bytes are mapped **one byte to one `char` of the same value** rather than through
/// [`String::from_utf8_lossy`], and the difference is load-bearing. The forms a marker may take are
/// spelled by the arm itself, byte by byte, in the same mapping — see
/// [`isolation_marker_forms`](ProgramLanguage::isolation_marker_forms) — so the two sides have to
/// agree byte for byte or the search is looking for something no artifact contains. Lossy decoding
/// agrees with nothing: it collapses each invalid sequence into one replacement character, which
/// both destroys bytes a foreign marker could be sitting in and renumbers everything after it.
///
/// The bytes go through the language's own
/// [readable form](ProgramLanguage::isolation_readable) first, which is identity for every arm but
/// [C#](super::csharp), whose artifact rides over the wire's `program` string **base64-encoded** and
/// has to be decoded before an ASCII or UTF-16 marker can be found in it at all. That hook reaches
/// the source half rather than the component half for exactly that arm: C# is neither of the two
/// shapes above, so an artifact that lives in `source` is not necessarily source, and a gate that
/// assumed it was would look for a marker in text that cannot carry one.
fn artifact(language: &'static dyn ProgramLanguage, prepared: super::PreparedProgram) -> String {
    let bytes = match prepared.component {
        Some(component) => component,
        None => prepared.source.into_bytes(),
    };
    language
        .isolation_readable(bytes)
        .into_iter()
        .map(char::from)
        .collect()
}

/// The rendezvous a deliberately broken preparation in [`tests`] uses to make its bug fire every
/// time rather than when the scheduler happens to cooperate.
///
/// A race reproduced by luck is a test that passes on a quiet machine, which for a gate guarding a
/// silent-corruption bug is worse than no test. A broken preparation pauses here between the two
/// halves of its own critical section, so all sixteen have written before any of them reads — the
/// same interleaving both measured bugs took, made certain.
///
/// It has to be a no-op during the gate's **serial baseline**, or the first of the sixteen would
/// wait for fifteen preparations that have not started. Which phase a call is in is decided by
/// counting: [`breaches`] prepares each input once alone and once together, in that order, so calls
/// `0..WIDTH` are the baseline and calls `WIDTH..2 * WIDTH` are the concurrent run. A broken
/// preparation must therefore be broken *only* under concurrency — one that failed its own baseline
/// would be reported as a [`Breach::Baseline`] and would prove nothing about isolation.
pub(super) struct Rendezvous {
    /// How many preparations have passed through, across both phases.
    calls: AtomicUsize,
    /// What the concurrent phase waits on.
    barrier: Barrier,
}

impl Rendezvous {
    /// A rendezvous for the gate's own width.
    pub(super) fn new() -> Self {
        Self {
            calls: AtomicUsize::new(0),
            barrier: Barrier::new(WIDTH),
        }
    }

    /// Pause until every concurrent preparation has reached this point; return immediately during
    /// the serial baseline.
    pub(super) fn wait(&self) {
        if self.calls.fetch_add(1, Ordering::SeqCst) >= WIDTH {
            self.barrier.wait();
        }
    }
}

#[cfg(test)]
#[path = "isolation.test.rs"]
mod tests;
