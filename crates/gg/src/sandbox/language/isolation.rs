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
//! One property, in four observable parts. Sixteen preparations, each with its own distinguishable
//! input, are driven simultaneously; every result must belong to **its own** input:
//!
//! 1. **It succeeded.** The same input prepared cleanly on its own a moment earlier, so a failure
//!    that appears only under concurrency is contention, not a bad program.
//! 2. **It is not empty**, and it **carries its own marker** — the TeaVM shape, where a build
//!    silently produced nothing.
//! 3. **It carries no other preparation's marker** — the `purs` shape, where one artifact held two
//!    agents' programs.
//! 4. **It matches what the same input produced alone.** Stricter than the marker checks and the one
//!    that catches a corruption too partial to move a marker: a fragment of somebody else's program,
//!    a truncated tail, a stale artifact left by a previous compile.
//!
//! Plus one thing observed rather than derived: no two of the sixteen were handed the same
//! [workspace](super::Workspace).
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
    /// The artifact differs from what the same input produced alone, in a way no marker caught.
    Unstable {
        /// Which of the sixteen inputs.
        marker: String,
        /// What the input produced on its own.
        alone: String,
        /// What it produced under concurrency.
        together: String,
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
            Self::Unstable {
                marker,
                alone,
                together,
            } => write!(
                formatter,
                "{marker} prepared to {alone:?} alone and {together:?} at {WIDTH}-way"
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
/// The baseline is taken **serially first**: the same sixteen inputs, one at a time, each in its own
/// context. Serial preparation cannot be corrupted by concurrency, so it is the ground truth every
/// concurrent result is held against — and an input that cannot prepare alone is reported as a
/// [`Breach::Baseline`] rather than allowed to look like an isolation failure.
///
/// Every artifact has its own preparation's workspace path replaced by a fixed token before it is
/// compared. A toolchain that bakes its build directory into debug information is isolated, not
/// unstable, and the two must not be confused — the workspace path is *supposed* to differ, and it
/// is the one thing that legitimately does.
pub(super) fn breaches(preparation: &dyn Preparation) -> Vec<Breach> {
    let markers: Vec<String> = (0..WIDTH).map(marker).collect();
    let sources: Vec<String> = markers.iter().map(|m| preparation.source(m)).collect();

    let mut alone = Vec::with_capacity(WIDTH);
    for (marker, source) in markers.iter().zip(&sources) {
        let context = PrepareContext::new();
        match preparation.prepare(source, &context) {
            Ok(prepared) => alone.push(normalise(&prepared, &context)),
            Err(error) => {
                return vec![Breach::Baseline {
                    marker: marker.clone(),
                    error,
                }];
            }
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
                    (
                        prepared.map(|prepared| normalise(&prepared, &context)),
                        workspace,
                    )
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
        if !prepared.contains(marker) {
            breaches.push(Breach::Missing {
                marker: marker.clone(),
                prepared: excerpt(prepared),
            });
        }
        for foreign in markers.iter().filter(|other| *other != marker) {
            if prepared.contains(foreign) {
                breaches.push(Breach::Foreign {
                    marker: marker.clone(),
                    foreign: foreign.clone(),
                });
            }
        }
        if prepared != &alone[index] {
            breaches.push(Breach::Unstable {
                marker: marker.clone(),
                alone: excerpt(&alone[index]),
                together: excerpt(prepared),
            });
        }
    }

    let mut seen: Vec<(PathBuf, Vec<String>)> = Vec::new();
    for (index, (_, workspace)) in together.iter().enumerate() {
        let Some(path) = workspace else { continue };
        match seen.iter_mut().find(|(seen, _)| seen == path) {
            Some((_, markers_here)) => markers_here.push(markers[index].clone()),
            None => seen.push((path.clone(), vec![markers[index].clone()])),
        }
    }
    for (path, markers) in seen {
        if markers.len() > 1 {
            breaches.push(Breach::SharedWorkspace { path, markers });
        }
    }
    breaches
}

/// The `n`th input's marker.
///
/// Zero-padded and suffixed so that no marker is a substring of another — without the padding,
/// `gg-isolation-1` is inside `gg-isolation-10` and every artifact would look contaminated.
fn marker(n: usize) -> String {
    format!("gg-isolation-{n:03}-marker")
}

/// An artifact with this preparation's own workspace path replaced by a fixed token.
///
/// The one thing that is *meant* to differ between two preparations of the same input, so comparing
/// them without removing it would report every well-isolated toolchain that emits debug information
/// as unstable.
fn normalise(prepared: &str, context: &PrepareContext) -> String {
    match context.opened_workspace() {
        Some(path) => prepared.replace(&path.to_string_lossy().into_owned(), "<workspace>"),
        None => prepared.to_string(),
    }
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
                .prepare_program(source, context)
                .map(|prepared| prepared.source),
            Half::Module => self
                .language
                .prepare_module(source, context)
                .map(|prepared| prepared.source),
        }
        .map_err(|failure| failure.to_string())
    }
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
