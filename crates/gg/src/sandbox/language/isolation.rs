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
//! One property — a result belongs to **its own** input — in the two arrangements a run really
//! produces.
//!
//! **[`WIDTH`] preparations, one after another, in one agent's [workspace](super::Workspace).**
//! That is a session: an agent's turns, the modules its reads load and the on-use scripts they queue
//! all compile in the tree the agent was given when it started. Each must succeed, must carry its
//! own marker, and must carry **no earlier preparation's** marker — which is what says the previous
//! response's sources and build output were gone before this one wrote. All of them must also have
//! been handed the *same* tree, since an agent that got a fresh one per preparation would
//! satisfy every other check here while quietly costing a session what it was given a tree to avoid.
//!
//! A failure to prepare in this phase is failing on its own account rather than under contention — a
//! harness fault, or a language that cannot prepare its own SDK's call — so it is reported as a
//! [`Breach::Baseline`] and the second phase is abandoned.
//!
//! **[`WIDTH`] agents at once, one preparation each, released together.** That is a run with
//! several agents in flight. Each result must succeed, must carry its own marker, and must carry **no
//! other agent's** marker — the `purs` shape, where one artifact held two agents' programs, and the
//! TeaVM shape, where a build silently produced nothing. Plus one thing observed rather than
//! derived: no two of the agents were handed the same tree.
//!
//! # Why there is no byte-for-byte comparison
//!
//! A fourth check is available in principle: that each concurrent artifact **matches byte-for-byte**
//! what the same input produces alone, which would catch a corruption too partial to move a
//! marker — a fragment of somebody else's program, a truncated tail, a stale artifact left by a
//! previous compile. Three things decide against it:
//!
//! * **The seam already isolates structurally, per agent.** A [workspace](super::Workspace) is a
//!   private tree keyed on the process id, the moment it was made and a monotonic counter, created
//!   with `create_dir` and not `create_dir_all` — so a collision is a loud error rather than a quiet
//!   share — with `HOME`, `TMPDIR`, the `XDG_*` roots and the working directory redirected into it,
//!   the working and artifact directories emptied before each preparation writes, and the whole tree
//!   removed when the agent ends. What is genuinely shared between agents is content-keyed, installed
//!   by rename and sealed read-only (0444/0555). The paths a partial corruption would have to arrive
//!   through are closed by construction, which is a stronger statement than one run of a comparison.
//! * **It catches nothing on its own.** Every deliberately broken preparation in
//!   [`tests`] — the shared output tree, the shared build strategy, the memoised compile, the
//!   miskeyed cache, the output kept where a preparation's reset does not reach — is caught by the
//!   marker checks above, and two of the five *are* the bugs that were measured on real toolchains.
//!   Not one of them needs the comparison to be reported.
//! * **It cannot be paid for once.** Byte equality only means anything over the part of an
//!   artifact that is a function of the program, and a compiler is entitled to write things into an
//!   artifact that are a function of the environment or of nothing at all. Holding
//!   [Swift](super::swift) to it costs a per-language projection of ~290 lines: a section-framing
//!   walk dropping ~1.5 MB of `.debug_*`, plus a mask for the random 16-byte module hash `swiftc`
//!   stamps into every object. Such a mask asserts that two random 16-byte values differ in **all
//!   sixteen** positions, which is a property of two random numbers rather than of the compiler and
//!   holds only `(255/256)^16` ≈ 93.9% of the time, so the gate whose whole value is being believed
//!   when it goes red fails about **6%** of runs by arithmetic. Every compiled arm would owe a tax
//!   of the same shape, paid in machinery the checks that catch the real bugs never read.
//!
//! What an arm gets instead is one narrower hook, and the distinction matters
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
//! agent's workspace, the isolated invocation, the exclusive-checkout pool. A language that reaches
//! around them — a fixed output path, a `static` compiler daemon, a shared build cache, an artifact
//! kept somewhere the reset does not reach — fails here with a message naming which preparation got
//! whose program.

use std::path::{Path, PathBuf};
use std::sync::Barrier;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::ProgramLanguage;
use super::compile::{AgentWorkspace, PrepareContext};

/// How many agents the gate drives at once, and how many preparations it drives in one of them.
///
/// Three, because that is the smallest number at which every breach the gate reports can occur:
///
/// * **Sequentially**, a [`Breach::Stale`] needs a second preparation to find the first one's
///   leftovers, and a third also catches a leftover from two turns back — an arm that clears only
///   the previous turn's output. A [`Breach::UnstableWorkspace`] needs two.
/// * **Concurrently**, every corruption the gate exists for is a *pairwise* collision — two agents
///   in one output tree, one build strategy, one memoised result — and the barrier puts every
///   preparation inside the step together, so two are enough to collide. The third is for the
///   [`CompilerPool`](super::CompilerPool): an arm that pools a warm compiler only waits for one, and
///   only hands an instance one agent returned to a *different* agent, when more preparations arrive
///   than the pool holds. Under test every pool is built with
///   [`TEST_POOL_CAPACITY`](super::compile::TEST_POOL_CAPACITY), which is one less than this.
///
/// A run allows more agents than this (`limits.maxParallel` is sixteen), but a larger width adds
/// only more pairs of the same collision. What keeps a real toolchain from colliding at any width is
/// structural and asserted elsewhere: every workspace is a private tree created with `create_dir`
/// under a unique name, and [a source check](tests::a_language_module_reaches_a_compiler_only_through_the_seam)
/// holds every arm to the seam that hands those trees out.
///
/// The same number is the length of one agent's sequence, so both phases of [`breaches`] do the same
/// amount of work and a broken preparation can tell them apart by counting its calls.
pub(super) const WIDTH: usize = super::compile::TEST_POOL_CAPACITY + 1;

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

    /// What this preparation's language keeps under the working directory across a reset — see
    /// [`persistent_work`](ProgramLanguage::persistent_work).
    ///
    /// Empty for a stand-in, which is what makes the deliberately broken ones in [`tests`] subject
    /// to the whole reset rather than to a version of it they chose.
    fn persistent_work(&self) -> &'static [&'static str] {
        &[]
    }

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
        /// Which of the inputs.
        marker: String,
        /// What preparing it said.
        error: String,
    },
    /// It prepared alone and failed under concurrency. Contention: a lock nobody took, a file
    /// another preparation removed, a daemon another preparation was mid-build on.
    Contended {
        /// Which of the inputs.
        marker: String,
        /// What preparing it said this time.
        error: String,
    },
    /// The artifact does not contain its own input's marker — including the case where there is no
    /// artifact at all. The TeaVM shape: a build that silently produced nothing.
    Missing {
        /// Which of the inputs.
        marker: String,
        /// What came back instead, capped.
        prepared: String,
    },
    /// The artifact contains **another agent's** marker. The `purs` shape: one artifact holding two
    /// agents' programs.
    Foreign {
        /// Which of the inputs this artifact was for.
        marker: String,
        /// Whose marker turned up in it.
        foreign: String,
    },
    /// The artifact contains a marker from an **earlier preparation of the same agent**. Not another
    /// agent's program: the agent's own previous response, still reachable because the workspace it
    /// was written into was not cleared before this preparation wrote.
    ///
    /// It is a variant of its own rather than a [`Foreign`](Self::Foreign) because the two have
    /// different causes and different fixes. A foreign marker means an arm reached outside the tree
    /// it was given; a stale one means the tree it was given still held the last turn's files.
    Stale {
        /// Which of the sequential inputs this artifact was for.
        marker: String,
        /// Which earlier one of them turned up in it.
        earlier: String,
    },
    /// Two agents were handed the same workspace — the precondition of the `purs` corruption, caught
    /// directly rather than through its consequences.
    SharedWorkspace {
        /// The path both were given.
        path: PathBuf,
        /// Which agents' inputs shared it.
        markers: Vec<String>,
    },
    /// One agent's sequential preparations were handed **more than one** workspace.
    ///
    /// The inverse of [`SharedWorkspace`](Self::SharedWorkspace), and the check that keeps the
    /// workspace an agent's rather than a preparation's. Every other assertion here passes if the
    /// seam quietly went back to a tree per preparation, so nothing else would notice a session
    /// paying to re-stage its language's library set on every turn.
    UnstableWorkspace {
        /// The paths one agent's preparations were handed, in order.
        paths: Vec<PathBuf>,
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
            Self::Stale { marker, earlier } => write!(
                formatter,
                "{marker}'s artifact carries {earlier}'s program: one agent's turn would evaluate an \
                 earlier turn's leftovers"
            ),
            Self::SharedWorkspace { path, markers } => write!(
                formatter,
                "{} were handed the same workspace {}",
                markers.join(" and "),
                path.display()
            ),
            Self::UnstableWorkspace { paths } => write!(
                formatter,
                "one agent's preparations were handed {} different workspaces: {}",
                paths.len(),
                paths
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        }
    }
}

/// Drive `preparation` through both arrangements a run produces and report every way a result failed
/// to belong to its own input.
///
/// **One agent first**, [`WIDTH`] inputs one after another in the tree that agent was given. Nothing
/// here can be corrupted by concurrency, so an input that fails to prepare is failing on its own
/// account and is reported as a [`Breach::Baseline`], and the concurrent phase is abandoned rather
/// than allowed to report the same failure a moment later as an isolation breach. What this phase
/// asserts beyond that is the whole of the sequential-reuse guarantee: each artifact carries its own
/// marker and no earlier one's, and every one of them was handed the same tree.
///
/// **[`WIDTH`] agents next**, one preparation each, released together. Every artifact must carry its
/// own marker and no other agent's, and no two agents may have been handed the same tree.
///
/// A preparation that cannot keep one agent's own turns apart is not asked whether it can keep two
/// agents apart, so anything the first phase reports is returned as it stands.
pub(super) fn breaches(preparation: &dyn Preparation) -> Vec<Breach> {
    let markers: Vec<String> = (0..WIDTH).map(marker).collect();
    let sources: Vec<String> = markers.iter().map(|m| preparation.source(m)).collect();

    let sequential = one_agents_session(preparation, &markers, &sources);
    if !sequential.is_empty() {
        return sequential;
    }

    let barrier = Barrier::new(WIDTH);
    let together: Vec<(Result<String, String>, Option<PathBuf>)> = std::thread::scope(|scope| {
        let handles: Vec<_> = sources
            .iter()
            .map(|source| {
                let barrier = &barrier;
                scope.spawn(move || {
                    // One agent per thread, each starting its session here, which is what the
                    // concurrent agents of a run are.
                    let agent = AgentWorkspace::new();
                    let context = PrepareContext::for_agent(&agent, preparation.persistent_work());
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
        breaches.extend(marker_breaches(
            preparation,
            prepared,
            marker,
            &markers,
            false,
        ));
    }

    breaches.extend(shared_workspaces(markers.iter().zip(&together).map(
        |(marker, (_, workspace))| (marker.as_str(), workspace.as_deref()),
    )));
    breaches
}

/// One agent's whole session: `WIDTH` preparations, in order, in the one workspace that agent holds.
///
/// This is where the reuse is asserted. A preparation that read a file the previous one wrote is
/// carrying an earlier marker, and an arm that was quietly handed a fresh tree each time is handed a
/// [`Breach::UnstableWorkspace`] — the two failures a session has that a single preparation does not.
fn one_agents_session(
    preparation: &dyn Preparation,
    markers: &[String],
    sources: &[String],
) -> Vec<Breach> {
    let agent = AgentWorkspace::new();
    let mut breaches = Vec::new();
    let mut opened: Vec<PathBuf> = Vec::new();
    for (index, (marker, source)) in markers.iter().zip(sources).enumerate() {
        let context = PrepareContext::for_agent(&agent, preparation.persistent_work());
        let prepared = match preparation.prepare(source, &context) {
            Ok(prepared) => prepared,
            // Abandoned at the first one, and alone in what comes back: an input that cannot be
            // prepared with nothing else running says nothing about isolation, and reporting the
            // ones after it would bury the one fact worth reading.
            Err(error) => {
                return vec![Breach::Baseline {
                    marker: marker.clone(),
                    error,
                }];
            }
        };
        if let Some(path) = context.opened_workspace() {
            opened.push(path.to_path_buf());
        }
        // Only the markers already prepared can have been left behind; the rest of the inputs have
        // not been written yet, so finding one would mean the marker itself is not distinguishing.
        breaches.extend(marker_breaches(
            preparation,
            &prepared,
            marker,
            &markers[..index],
            true,
        ));
    }
    breaches.extend(unstable_workspace(&opened));
    breaches
}

/// Whether an artifact carries its own marker and nothing else's — the check both phases make, over
/// whichever set of other markers that phase can meaningfully look for.
///
/// `sequential` decides which breach a foreign marker earns: an earlier turn of the same agent is a
/// [`Breach::Stale`], another agent is a [`Breach::Foreign`].
fn marker_breaches(
    preparation: &dyn Preparation,
    prepared: &str,
    marker: &str,
    others: &[String],
    sequential: bool,
) -> Vec<Breach> {
    let mut breaches = Vec::new();
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
            marker: marker.to_string(),
            prepared: excerpt(prepared),
        });
    }
    for other in others.iter().filter(|other| *other != marker) {
        if carries(other) {
            breaches.push(match sequential {
                true => Breach::Stale {
                    marker: marker.to_string(),
                    earlier: other.clone(),
                },
                false => Breach::Foreign {
                    marker: marker.to_string(),
                    foreign: other.clone(),
                },
            });
        }
    }
    breaches
}

/// Every workspace path that more than one agent was handed, as one breach apiece.
///
/// A preparation that never asked for a workspace has no path to collide and is skipped rather than
/// counted as sharing one — which is why the argument is an `Option` and not a path.
///
/// # Why this is a function rather than four lines inside [`breaches`]
///
/// Because it is the one check here that a broken [`Preparation`] **cannot** drive, and that is a
/// fact about the seam rather than a gap in the fixtures. A [`Workspace`](super::Workspace)'s path
/// carries a monotonic counter the seam owns, and a [`PrepareContext`] can only be minted by the two
/// functions that dispatch through the trait — so no fixture, however badly behaved, can arrange for
/// two agents to be handed the same path. The condition is unreachable by construction.
///
/// That is exactly what makes the check worth keeping and exactly what makes it untestable through
/// the front door: it is the canary on that construction, and it would earn its keep on the day
/// somebody made those paths reusable. So the detector is proved directly, by
/// [its own test](tests::two_agents_handed_one_workspace_are_reported), rather than by a concurrent
/// run that can never produce the input.
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

/// The one breach earned by one agent's preparations standing on more than one tree.
///
/// The list holds only the preparations that actually opened a workspace, so an arm that compiles
/// nothing contributes an empty list and no breach — the same reason
/// [`shared_workspaces`] takes an `Option`.
pub(super) fn unstable_workspace(opened: &[PathBuf]) -> Vec<Breach> {
    let mut distinct: Vec<PathBuf> = Vec::new();
    for path in opened {
        if !distinct.contains(path) {
            distinct.push(path.clone());
        }
    }
    match distinct.len() > 1 {
        true => vec![Breach::UnstableWorkspace { paths: distinct }],
        false => Vec::new(),
    }
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

/// Both halves of one language, as preparations the gate can drive.
///
/// Both, because a module compiles exactly as a program does and a turn that reads three code skills
/// compiles three of them beside its own program. A language that isolated one and not the other
/// would corrupt a code skill's namespace instead of a program, which is the same bug in a place
/// nobody would think to look.
pub(super) fn preparations(language: &'static dyn ProgramLanguage) -> [LanguagePreparation; 2] {
    [
        LanguagePreparation {
            language,
            half: Half::Program,
        },
        LanguagePreparation {
            language,
            half: Half::Module,
        },
    ]
}

/// The name the gate's module half is loaded under, spelled as each language spells a binding key.
///
/// One key for all of a phase's preparations, which is what a session really does when a
/// model rewrites the memory behind a key it already has: each preparation opens that key's
/// directory in the band empty and builds into it. An artifact carrying an earlier preparation's
/// marker under this key is therefore a band that was not cleared.
const GATE_KEY: &str = "ggIsolationModule";

/// Which of a language's two preparation steps is being driven.
#[derive(Clone, Copy)]
enum Half {
    /// A model's reply.
    Program,
    /// A code skill's or memory's module.
    Module,
}

/// One registered language's program or module step, as the gate sees it.
pub(super) struct LanguagePreparation {
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
    /// [`gate_module`](ProgramLanguage::gate_module), whose default is this same program
    /// for every language whose module is ordinary source of the language.
    fn source(&self, marker: &str) -> String {
        let name = format!("gg-isolation-{marker}");
        match self.half {
            Half::Program => self.language.open_docs_views_statement(&[&name]),
            Half::Module => self.language.gate_module(&name),
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
                .prepare_module(&self.language.binding_name(GATE_KEY), source, context)
                .map(|prepared| prepared.source),
        }
        .map_err(|failure| failure.to_string())
    }

    fn persistent_work(&self) -> &'static [&'static str] {
        self.language.persistent_work()
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
/// halves of its own critical section, so every one has written before any of them reads — the
/// same interleaving both measured bugs took, made certain.
///
/// It has to be a no-op during the gate's **serial baseline**, or the first input would wait for
/// preparations that have not started. Which phase a call is in is decided by
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
