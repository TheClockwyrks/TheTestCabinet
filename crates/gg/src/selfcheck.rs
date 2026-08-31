//! **`gg selfcheck`** — every registered [program language](crate::sandbox::ProgramLanguage) arm's
//! bootstrap round trip, driven in whatever environment the binary was started in.
//!
//! # The failure this module exists to make impossible
//!
//! A C# run died on its first turn with `gg's C# bootstrap program did not prepare: gg's own C# SDK
//! did not compile`, and every gate that arm has was green. It has the most test coverage of the
//! eleven — nine files, several of which spawn a real `csc` and load a real 35 MB component — the
//! catalogue reflection ran at build time, the isolation, agreement and register gates ran, and the
//! `.NET` installer finished with a verification compile of its own. None of them was wrong. **All
//! of them ran somewhere else.**
//!
//! `csc` aborts at CLR start-up in the run image because that image carries no ICU. .NET reaches
//! `libicuuc` and `libicui18n` through `dlopen`, so they appear in no ELF header, `ldd` reports a
//! complete closure over a binary that cannot start, and the process dies on `SIGABRT` having
//! written nothing to stdout. The installer's own verification passed because the *builder* stage it
//! ran in had `libicu72` apt-installed for exactly that purpose, and the shipping stage is
//! `FROM scratch` with the toolchain copied across and the packages left behind. The verification
//! proved that the stage which assembled the toolchain could run it. Nothing had ever asked the
//! image.
//!
//! Three properties of that bug are what this subcommand is shaped by, and each of them rules out
//! one cheaper check:
//!
//! | What was true | What follows |
//! | --- | --- |
//! | The missing library was `dlopen`'d | A link check settles nothing. Only running the compiler does. |
//! | The compile that verified it ran in a builder stage | The check has to happen *in* the image, from the binary a run is handed. |
//! | The arm was broken in every run and green in every test | It cannot be a test: `cargo` never enters the environment that answers the question. |
//!
//! So this is a subcommand rather than a test, its whole input is the binary and the environment
//! around it, and what it drives is the real thing. The gate is `gg selfcheck` inside a built `-gg`
//! variant of each ENVIRONMENT the twenty-six variants fall into — the image a lineage is rooted at
//! plus every package a run image installs on the way down, which is four groups and not the two
//! parents it looks like. `containers/build.sh` names them and re-derives the grouping on every
//! gated build; the documentation page
//! (`apps/docs/src/content/docs/gg/languages/selfcheck.md`) is where that placement is argued.
//!
//! # Why it drives the real bootstrap turn
//!
//! Each arm is checked by [seeding a real window](crate::bootstrap::seed_bootstrap) with that arm's
//! own bootstrap program — the same call [the loop](crate::agent) makes first on every code-mode
//! run, and literally the call that failed in the run above. Nothing here is written for the check:
//! the program is the arm's [`bootstrap_program`](crate::sandbox::ProgramLanguage::bootstrap_program),
//! the scope is a fully-granted agent's, the api under it is the production
//! [`BootstrapApi`](crate::bootstrap), and the verdict is the one a run would reach.
//!
//! A bespoke "trivial program" per arm was the obvious alternative and is the wrong one. It would be
//! a **second code path**, and a second code path is exactly the thing that can be green while the
//! one a run takes is broken — which is the class of failure this whole module is an answer to. The
//! round trip that is driven is therefore the whole of the first turn:
//!
//! 1. the arm's guest component is compiled into the process cache and whatever its prepare step
//!    unpacks is warmed ([`precompile`](crate::sandbox::precompile)) — for a compiled arm, where its
//!    toolchain is first resolved and its SDK first built;
//! 2. the bootstrap program is prepared — the real toolchain, the real compiler, the real
//!    shared-library loads;
//! 3. the guest is instantiated, the program is evaluated, and its calls cross the membrane into
//!    gg's own api;
//! 4. the views those calls placed are counted, and a program that ran and placed none fails.
//!
//! # Serially, and every arm regardless of the ones before it
//!
//! **Serially**, because a failure must name one arm and because the memory ceiling of the run is
//! then one arm's rather than eleven: C#'s guest component alone is 35 MB, and the set costs about
//! 2 GB peak resident and single-digit minutes even so. **Every arm regardless**, because an
//! operator reading a failed CI job needs the whole list — a gate that stopped at the first broken
//! arm would turn one image build into as many as there are broken arms.
//!
//! `--language <id>`, repeatable, narrows the set; it is what a developer iterating on one arm
//! reaches for, and it is the only reason the flag exists. The report keeps
//! [registration order](crate::sandbox::all_languages) whatever order the flags were written in, so
//! two invocations naming the same arms produce the same report.
//!
//! # Whose failure it was
//!
//! The seam this check runs over exists to keep three owners apart — the model's program, the run
//! image's toolchain, and gg itself — and the report carries that distinction rather than flattening
//! it into "failed". Where the failure arrives typed, as a
//! [`SandboxError`], the answer is read off the predicates that type
//! already publishes ([`is_toolchain_defect`](crate::sandbox::SandboxError::is_toolchain_defect) is
//! the image's; everything else here is gg's).
//!
//! Where it arrives from [`seed_bootstrap`] it arrives as a
//! **sentence**: that seam has already decided the one thing a run needs — this is not the model's,
//! so the run ends — and it hands back prose rather than a variant. The sentence carries the
//! underlying [`PrepareFailure`](crate::sandbox::PrepareFailure)'s own words, which is where the
//! remaining split is legible ("the compiler could not finish", with the exit status, the signal and
//! the tail of its stderr, against gg's own SDK failing to compile). This module prints that
//! sentence **whole and unshortened** and claims no attribution of its own for it, because inferring
//! a variant back out of another module's prose would be a classification that breaks silently the
//! next time a word changes.
//!
//! # What it does not settle
//!
//! It is one turn per arm, not a session: what a model does with an arm, what a run costs, and how a
//! failure reads to a model are a run's questions and the per-arm failure-shape gates'. It asserts
//! nothing about the *catalogue* either — whether a call is spelled, gated and described correctly
//! is the capability, register and spelling gates' question, and `gg reference` is where that
//! surface is read. This compiles one program per arm and looks at what it placed.

use std::process::ExitCode;
use std::sync::Arc;
use std::time::{Duration, Instant};

use test_cabinet_core::gg::{GgOpeningTurn, GgProgramLanguage};

use crate::bootstrap::{Bootstrap, BootstrapAgent, seed_bootstrap};
use crate::context::{ContextModel, HeuristicTokenEstimator};
use crate::docs::{DocViewTypes, DocsRuntime};
use crate::ending::EndingRole;
use crate::programs::ProgramLibrary;
use crate::sandbox::{
    ProgramLanguage, SandboxError, SandboxLimits, all_languages, capability_operations,
    gating_capabilities,
};
use crate::tools::ToolContext;

/// The ceilings the check's own programs run under — 30 s of guest CPU and 256 MiB of linear
/// memory.
///
/// **This reaches no run.** A run's ceilings come from that run's own document or the launch is
/// refused ([`resolve_sandbox_limits`](crate::sandbox::resolve_sandbox_limits)), and nothing here is
/// a default gg would stand in for an absent figure. It is the selfcheck's own ceiling on the
/// selfcheck's own program, and it is wide enough that no honest program approaches either half: the
/// bootstrap program searches one module listing and opens a handful of documentation views.
///
/// Spelled out rather than borrowed from the fixture ceiling beside it in
/// `crates/gg/src/sandbox/limits.rs`, which is `#[cfg(test)]` and argues in its own doc comment that
/// it must stay that way — a figure gg would run a *release* binary under has to be declared where a
/// release binary can see it.
const SELFCHECK_LIMITS: SandboxLimits = SandboxLimits {
    timeout: Duration::from_secs(30),
    max_memory_bytes: 268_435_456,
};

/// The ending role the checked agent stands under. [`Standard`](EndingRole::Standard) is the
/// ordinary worker's, which is what a run's first agent is; the bootstrap program declares no ending
/// call, so the role decides only what the membrane *would* accept beside it.
const SELFCHECK_ROLE: EndingRole = EndingRole::Standard;

/// The context window the check's own [`ContextModel`] is given, in tokens.
///
/// Large enough that nothing the bootstrap places can approach it, because a window that compacted
/// mid-check would be measuring the compaction rather than the arm. It is not a run's figure and
/// nothing reads it back.
const SELFCHECK_WINDOW_TOKENS: u64 = 1_000_000;

// ---------------------------------------------------------------------------
// What one arm's check amounts to
// ---------------------------------------------------------------------------

/// Which step of the round trip a check stopped in.
///
/// Two rather than four, and the two are **the steps this module itself drives**. The bootstrap
/// seam runs prepare, evaluate and place behind one call and reports which of them broke in the
/// sentence it hands back; splitting them here would mean reading that sentence's prose, which is
/// the one thing the module docs refuse to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// Compiling the arm's guest component into the process cache and warming whatever its prepare
    /// step would otherwise unpack — [`precompile`](crate::sandbox::precompile).
    WarmUp,
    /// The bootstrap round trip: prepare the arm's own opening program, instantiate the guest,
    /// evaluate it, and count the views its calls placed.
    Bootstrap,
}

impl Phase {
    /// The word the report prints for this step.
    fn name(self) -> &'static str {
        match self {
            Self::WarmUp => "warm-up",
            Self::Bootstrap => "bootstrap",
        }
    }
}

/// Whose failure it was, where the seam that reported it said so in a form this module can read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Attribution {
    /// **The run image's**: a compiler that could not finish — missing from the image, missing a
    /// library it loads, crashed, or killed by its own timeout. Fixed without touching gg's source.
    Image,
    /// **gg's own**: the committed artifact, the engine around it, or gg's own preparation of a
    /// source something had already accepted.
    Harness,
}

impl Attribution {
    /// Whose it is, as the report says it.
    fn name(self) -> &'static str {
        match self {
            Self::Image => "the image's",
            Self::Harness => "gg's own",
        }
    }

    /// The owner a typed [`SandboxError`] names, read off the predicates that type publishes rather
    /// than re-derived from its variants here — a second reading of "whose failure was it?" is a
    /// second answer.
    fn of(error: &SandboxError) -> Self {
        if error.is_toolchain_defect() {
            Self::Image
        } else {
            Self::Harness
        }
    }
}

/// Why one arm's check did not reach a verdict, and everything an operator needs to act on it.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Failure {
    /// The step it stopped in.
    phase: Phase,
    /// Whose failure it was, or `None` where the seam reported prose. See the module docs.
    attribution: Option<Attribution>,
    /// The whole failure sentence, **never shortened**. For the bug this subcommand exists for it
    /// is the sentence naming the compiler that could not start, with its exit status, its signal
    /// and the tail of its stderr, and every one of those is the part an operator reads.
    detail: String,
}

/// What checking one arm amounted to.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ArmCheck {
    /// The arm, by the [id](GgProgramLanguage::id) a report line names it under.
    language: GgProgramLanguage,
    /// What warming the arm cost — for a compiled arm, resolving its toolchain and building its
    /// SDK; for an interpreted one, compiling its guest component.
    warm: Duration,
    /// What the bootstrap round trip cost, or `None` where the warm-up failed before it.
    bootstrap: Option<Duration>,
    /// The views the bootstrap program placed, or why it did not get there.
    outcome: Result<usize, Failure>,
}

impl ArmCheck {
    /// Whether this arm works here.
    fn passed(&self) -> bool {
        self.outcome.is_ok()
    }

    /// Everything this check spent.
    fn elapsed(&self) -> Duration {
        self.warm + self.bootstrap.unwrap_or_default()
    }
}

/// Every arm's check, in the order they were driven.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Report {
    checks: Vec<ArmCheck>,
}

impl Report {
    /// The ids of the arms that failed, in the order they were driven.
    fn failed(&self) -> Vec<&'static str> {
        self.checks
            .iter()
            .filter(|check| !check.passed())
            .map(|check| check.language.id())
            .collect()
    }

    /// Failure when **any** arm failed, and success only when every one of them passed. The exit
    /// code is the whole of what the image build reads, so it is the one thing here that must not
    /// depend on how the report renders.
    fn exit_code(&self) -> ExitCode {
        if self.failed().is_empty() {
            ExitCode::SUCCESS
        } else {
            ExitCode::FAILURE
        }
    }

    /// What every check together spent.
    fn elapsed(&self) -> Duration {
        self.checks.iter().map(ArmCheck::elapsed).sum()
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/// The width the arm ids are padded to — `javascript`, `purescript` and `typescript` are the longest
/// at ten, and a column that lines up is what makes eleven lines scannable.
const ID_WIDTH: usize = 10;

/// The indent a failure's own sentence is printed under, so a multi-line compiler report reads as
/// belonging to the line above it.
const DETAIL_INDENT: &str = "    ";

/// One arm's line, and — where it failed — its whole report beneath.
///
/// Ends in a newline, because it is printed the moment the arm finishes rather than collected: an
/// eleven-arm run takes minutes, and an operator watching it should see each arm land.
fn render_arm(check: &ArmCheck) -> String {
    let verdict = if check.passed() { "ok" } else { "FAILED" };
    let bootstrap = match check.bootstrap {
        Some(bootstrap) => duration(bootstrap),
        // Not reached: the warm-up failed, and a dash says so without claiming a measurement.
        None => "-".to_string(),
    };
    let tail = match &check.outcome {
        Ok(placed) => format!("{placed} view(s)"),
        Err(failure) => match failure.attribution {
            Some(attribution) => format!("{} failed, {}", failure.phase.name(), attribution.name()),
            None => format!("{} failed", failure.phase.name()),
        },
    };
    let mut line = format!(
        "{:<ID_WIDTH$}  {verdict:<6}  warm {:>6}  bootstrap {:>6}  {tail}\n",
        check.language.id(),
        duration(check.warm),
        bootstrap,
    );
    if let Err(failure) = &check.outcome {
        for sentence in failure.detail.lines() {
            line.push_str(DETAIL_INDENT);
            line.push_str(sentence);
            line.push('\n');
        }
    }
    line
}

/// The closing line: how many arms were driven, what they cost, and — naming them — which failed.
fn render_summary(report: &Report) -> String {
    let checked = report.checks.len();
    let elapsed = duration(report.elapsed());
    let failed = report.failed();
    if failed.is_empty() {
        format!("{checked} arm(s) checked in {elapsed}, all passed\n")
    } else {
        format!(
            "{checked} arm(s) checked in {elapsed}, {} failed: {}\n",
            failed.len(),
            failed.join(", ")
        )
    }
}

/// A duration as an operator reads one: `4.1s` under a minute, `2m04s` over it.
///
/// Tenths below a minute because the arms differ by tenths and a comparison between two images is
/// one of the things this report is read for; whole seconds above it because nothing about a
/// two-minute compile is decided by a tenth.
fn duration(elapsed: Duration) -> String {
    let seconds = elapsed.as_secs_f64();
    if seconds < 60.0 {
        format!("{seconds:.1}s")
    } else {
        format!("{}m{:02}s", elapsed.as_secs() / 60, elapsed.as_secs() % 60)
    }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/// The arms to drive: every registered one, or the ones `requested` names.
///
/// **Derived from the registry** ([`all_languages`], itself derived from
/// [`GgProgramLanguage::ALL`]), so a twelfth arm is covered by this gate the moment it is
/// registered and there is no list here to forget to extend. It is also exactly the registered set:
/// the fixture arm the seam's own tests are written against is not in that iterator, so no spelling
/// on the command line can reach it.
///
/// An unknown id is **refused** rather than skipped, and the refusal lists the arms — a typo that
/// quietly checked nothing would exit zero, which is the one answer this command must never give
/// wrongly. The result keeps registration order however the flags were written, so two invocations
/// naming the same set produce the same report.
fn select(requested: &[String]) -> Result<Vec<&'static dyn ProgramLanguage>, String> {
    if requested.is_empty() {
        return Ok(all_languages().collect());
    }
    let mut wanted: Vec<GgProgramLanguage> = Vec::new();
    for id in requested {
        let Some(arm) = GgProgramLanguage::from_id(id) else {
            return Err(format!(
                "`{id}` is not one of gg's program languages. The registered arms are: {}.",
                registered_ids().join(", ")
            ));
        };
        if !wanted.contains(&arm) {
            wanted.push(arm);
        }
    }
    Ok(all_languages()
        .filter(|arm| wanted.contains(&arm.id()))
        .collect())
}

/// Every registered arm's id, in registration order — what a refusal lists.
fn registered_ids() -> Vec<&'static str> {
    all_languages().map(|arm| arm.id().id()).collect()
}

// ---------------------------------------------------------------------------
// Driving
// ---------------------------------------------------------------------------

/// Drive the selected arms and print the report, returning the process exit code.
///
/// The one entry point, and the only part of this module that touches the world.
pub(crate) async fn selfcheck(requested: &[String]) -> ExitCode {
    let arms = match select(requested) {
        Ok(arms) => arms,
        Err(refusal) => {
            eprintln!("gg selfcheck: {refusal}");
            return ExitCode::FAILURE;
        }
    };
    let mut checks = Vec::with_capacity(arms.len());
    for arm in arms {
        let check = check_arm(arm).await;
        // Printed as it lands rather than at the end: the set takes minutes, and a CI log that says
        // nothing until it is over is a log an operator cannot tell from a hang.
        print!("{}", render_arm(&check));
        checks.push(check);
    }
    let report = Report { checks };
    print!("{}", render_summary(&report));
    report.exit_code()
}

/// Drive one arm's whole round trip, and say what happened.
///
/// Total: every way this can fail is an [`ArmCheck`] carrying a [`Failure`], never an early return
/// out of the command, because the next arm is driven whatever this one did.
async fn check_arm(arm: &'static dyn ProgramLanguage) -> ArmCheck {
    let id = arm.id();

    // Blocking, and deliberately called on the runtime thread rather than through `spawn_blocking`:
    // the arms are driven serially and there is nothing else on this runtime to starve, so a
    // blocking call here costs one indirection less than the alternative and reads as what it is.
    let warming = Instant::now();
    let warmed = crate::sandbox::precompile(arm);
    let warm = warming.elapsed();
    if let Err(error) = warmed {
        return ArmCheck {
            language: id,
            warm,
            bootstrap: None,
            outcome: Err(Failure {
                phase: Phase::WarmUp,
                attribution: Some(Attribution::of(&error)),
                detail: format!(
                    "gg's {} guest could not be warmed: {error}",
                    arm.display_name()
                ),
            }),
        };
    }

    // A **fully granted** agent, built the way gg's own fixtures build one — from
    // `gating_capabilities` and the operations those buy — rather than from a list written here.
    // The check is asking whether the arm works at all, so it opens on the widest surface the arm
    // has: an entry the agent did not hold would be dropped before the program was written, and a
    // gate that dropped its way to a passing empty program would be a gate that proves nothing.
    let capabilities: Vec<String> = gating_capabilities()
        .into_iter()
        .map(str::to_string)
        .collect();
    let operations = capability_operations(capabilities.iter().map(String::as_str));

    let mut context = ContextModel::new(
        // The heuristic estimator rather than the run's BPE one: nothing here reads a token count
        // back, and a gate that loads a BPE table per arm would be paying for an answer it discards.
        Arc::new(HeuristicTokenEstimator::new()),
        Some(SELFCHECK_WINDOW_TOKENS),
        true,
    );
    let mut docs = DocsRuntime::new(capabilities.clone(), SELFCHECK_ROLE, &operations, id);
    // A library that keeps nothing: the check has no session to file an opening program into, and a
    // library that issued ids would be recording a run that does not exist.
    let mut programs = ProgramLibrary::disabled();
    // The opening turn a **fresh profile** is seeded with — the two lists and the tree every real
    // run's first window opens on, rather than a set chosen here to be easy to satisfy.
    let opening = GgOpeningTurn::seeded();
    // Where the opening tree is walked from. The check has no run workspace, so it walks the
    // directory gg was invoked from: a real tree, which is what makes the tree call a real call
    // rather than one answered by an empty directory.
    let tool_ctx =
        ToolContext::new(std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")));

    let seeding = Instant::now();
    let seeded = seed_bootstrap(
        &mut context,
        &mut docs,
        &mut programs,
        BootstrapAgent {
            opening_turn: &opening,
            tool_ctx: &tool_ctx,
            capabilities: &capabilities,
            operations: &operations,
            role: SELFCHECK_ROLE,
            limits: SELFCHECK_LIMITS,
            // Every view type, which is the widest an `openDocsView` places: a documentation page
            // that renders nothing on one arm is then this check's failure rather than a run's.
            doc_view_types: DocViewTypes::EVERY,
        },
    )
    .await;
    let bootstrap = seeding.elapsed();

    let arm_name = arm.display_name();
    let outcome = match seeded {
        // The one passing shape. `placed > 0` is asserted here as well as inside the seam, because
        // "the program ran and the window got nothing" is precisely the silent pass this gate exists
        // to refuse.
        Ok(Bootstrap::Seeded { placed, .. }) if placed > 0 => Ok(placed),
        Ok(Bootstrap::Seeded { .. }) => Err(harness(format!(
            "gg's {arm_name} bootstrap program ran and placed no views"
        ))),
        // Unreachable from a fully granted agent: it would mean this arm's catalogue binds none of
        // the functions a fresh profile opens on, and there was no program to compile at all.
        Ok(Bootstrap::Empty { .. }) => Err(harness(format!(
            "gg's {arm_name} opening turn resolved to nothing under a fully granted agent, so no \
             program was written and this arm's toolchain was never reached"
        ))),
        // Unreachable: the window above is constructed in code mode.
        Ok(Bootstrap::NotCodeMode) => Err(harness(format!(
            "gg's {arm_name} check built a window that is not in code mode, so no program was \
             seeded"
        ))),
        // The seam's own sentence, carried whole and attributed to nobody here. See the module docs.
        Err(detail) => Err(Failure {
            phase: Phase::Bootstrap,
            attribution: None,
            detail,
        }),
    };

    ArmCheck {
        language: id,
        warm,
        bootstrap: Some(bootstrap),
        outcome,
    }
}

/// A bootstrap-phase failure this module itself decided, and decided is gg's.
///
/// The three shapes it wraps are the ones [`seed_bootstrap`] reports as `Ok` and this check does
/// not accept — each of them a gg defect that would leave a model opening on a window with nothing
/// in it.
fn harness(detail: String) -> Failure {
    Failure {
        phase: Phase::Bootstrap,
        attribution: Some(Attribution::Harness),
        detail,
    }
}

#[cfg(test)]
#[path = "selfcheck.test.rs"]
mod tests;
