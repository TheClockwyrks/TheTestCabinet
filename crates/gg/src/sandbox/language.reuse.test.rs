//! **The reuse gate**: every registered language compiles a loaded code module once for the agent
//! and compiles the response alone on every turn after it.
//!
//! # What it drives
//!
//! One agent per language: its [compile workspace](crate::sandbox::AgentWorkspace), one module
//! loaded into it through that language's own module step, and two programs prepared in it
//! afterwards. What is asserted is the **count** the workspace recorded — a build per key, and not
//! one more — because that is the property, and because a turn that rebuilt every loaded module
//! would pass every other assertion this directory makes while costing the turn one compiler
//! invocation per loaded module.
//!
//! It is deliberately generic over the registry rather than written per arm: this is the one gate an
//! arm cannot pass by being the arm it was when it was written, and a twelfth language registered
//! tomorrow is held to it without anybody remembering to.
//!
//! # Separating the honest zero from the regression
//!
//! An arm that reads no program on the host records nothing, which is the honest answer for it: a
//! [Python](super::python) module is source the guest binds at run time, so there is no build to
//! keep and no turn that could pay for one twice. A count that stayed at zero would otherwise pass
//! this gate for an arm that had abandoned the band and was rebuilding its module inside every
//! program's own compile, which is the exact regression it exists to catch.
//!
//! So an arm that names a checker is held to leaving its read's work somewhere a turn can reach:
//! either a build recorded in the band, or the compiled source it handed back, which is what
//! [TypeScript](super::typescript) and [Ruby](super::ruby) keep instead of a file. An arm that
//! names no checker compiles nothing at the read and is held to neither.
//!
//! # Why it drives real compilers
//!
//! Because what the property is about is what the compilers are asked to do. The seam's own count is
//! asserted [against a fixture](crate::knowledge::compile_tests) in microseconds; this is the
//! assertion that each of the eleven registered arms actually reaches for the build its read
//! produced rather than making another one.

use std::path::{Path, PathBuf};

use super::compile::{AgentWorkspace, PrepareContext};
use super::{ProgramLanguage, all_languages};

/// How many programs each agent prepares after its module has loaded.
///
/// Two rather than one, because the figure a rebuild produces has to *grow*: a single program
/// after the load would read the same as one that rebuilt if the read itself had been skipped.
const TURNS: usize = 2;

/// What the module the gate loads is called, before each arm spells it as a binding key.
const MODULE_NAME: &str = "gg-reuse-marker";

/// What one arm's session recorded: the builds counted and what the read left on disk, each read
/// after the load and again after the turns.
struct Session {
    /// The builds the workspace had recorded after the read that loaded the module, and after the
    /// last program.
    counted: (usize, usize),
    /// Every file the read left standing, the loaded-module band and every artifact this arm
    /// registered both, with its length and the moment it was last written, at those same two
    /// points.
    kept: (Vec<Built>, Vec<Built>),
    /// Whether the module's prepared source is the author's own bytes. False for an arm that
    /// compiles a module into source rather than into a file, which is what it keeps instead of a
    /// build.
    verbatim: bool,
}

/// One file a read left behind, read closely enough that a compiler writing it again shows.
#[derive(Debug, PartialEq, Eq)]
struct Built {
    /// Its path.
    path: PathBuf,
    /// How long it is.
    bytes: u64,
    /// When it was last written, as the nanoseconds since the epoch a rewrite moves.
    written: u128,
}

/// Prepare one arm's module and then its programs in one agent's workspace.
fn session(language: &'static dyn ProgramLanguage) -> Result<Session, String> {
    let agent = AgentWorkspace::new();
    let key = language.binding_name(MODULE_NAME);
    let authored = language.gate_module(MODULE_NAME);
    let load = PrepareContext::for_agent(&agent, language.persistent_work());
    let module = language
        .prepare_module(&key, &authored, &load)
        .map_err(|failure| format!("the module did not prepare: {failure}"))?;
    let band = load
        .opened_workspace()
        .map(|root| root.join("work").join("modules"));
    let kept = |agent: &AgentWorkspace| {
        let mut roots: Vec<PathBuf> = band.iter().cloned().collect();
        roots.extend(agent.recorded_artifacts());
        built(&roots)
    };
    let after_load = (agent.module_builds(), kept(&agent));
    let verbatim = module.source == authored;
    drop(load);

    let modules = [crate::sandbox::CodeModule {
        name: key,
        source: module.source,
    }];
    let program = language.open_docs_views_statement(&[MODULE_NAME]);
    for turn in 0..TURNS {
        language
            .prepare_program(
                &program,
                &modules,
                &PrepareContext::for_agent(&agent, language.persistent_work()),
            )
            .map_err(|failure| format!("program {turn} did not prepare: {failure}"))?;
    }
    Ok(Session {
        counted: (after_load.0, agent.module_builds()),
        kept: (after_load.1, kept(&agent)),
        verbatim,
    })
}

/// Every file the read left standing, in a stable order, with what a rewrite would change about it.
///
/// The band and every artifact an arm registered, because one arm keeps its module's compiled form
/// where its compiler keeps everything else: `purs` writes into the project's output directory, and
/// a gate that walked the band alone would read the same list whether that module was rebuilt on
/// every turn or not.
fn built(roots: &[PathBuf]) -> Vec<Built> {
    let mut files = Vec::new();
    for root in roots {
        walk(root, &mut files);
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    files.dedup_by(|left, right| left.path == right.path);
    files
}

/// Collect `path` — the file it names, or every file under it when it names a directory.
fn walk(path: &Path, into: &mut Vec<Built>) {
    if path.is_file() {
        if let Some(built) = read(path) {
            into.push(built);
        }
        return;
    }
    let Ok(entries) = std::fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        walk(&entry.path(), into);
    }
}

/// One file, read closely enough that a compiler writing it again shows.
fn read(path: &Path) -> Option<Built> {
    let metadata = std::fs::metadata(path).ok()?;
    let written = metadata
        .modified()
        .ok()
        .and_then(|at| at.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|since| since.as_nanos())
        .unwrap_or_default();
    Some(Built {
        path: path.to_path_buf(),
        bytes: metadata.len(),
        written,
    })
}

/// **A loaded module is compiled once per agent, on every registered arm.**
///
/// Two readings, because either alone has a way through. A rebuild that registers itself grows the
/// count; a rebuild that registers nothing rewrites the file it produced, and the band's own
/// lengths and write times say so.
#[test]
fn every_registered_language_compiles_a_loaded_module_once_for_the_agent() {
    let mut failures: Vec<String> = Vec::new();
    for language in all_languages() {
        let name = language.display_name();
        match session(language) {
            Err(error) => failures.push(format!("{name}: {error}")),
            Ok(session) => {
                let (after_load, after_turns) = session.counted;
                if after_turns != after_load {
                    failures.push(format!(
                        "{name}: {TURNS} turns took the build count from {after_load} to \
                         {after_turns} — a loaded module was compiled again"
                    ));
                }
                if language.prepare_compiles() && after_load == 0 && session.verbatim {
                    failures.push(format!(
                        "{name}: the read that loaded the module recorded no build and handed back \
                         the author's own bytes, so this arm's read left a turn nothing to reach \
                         for and every turn compiles the module itself"
                    ));
                }
                let (loaded, turned) = session.kept;
                for file in &loaded {
                    if !turned.contains(file) {
                        failures.push(format!(
                            "{name}: {} was written again by a turn's compile.\n  after the load: \
                             {file:?}\n  after {TURNS} turns: {:?}",
                            file.path.display(),
                            turned.iter().find(|later| later.path == file.path)
                        ));
                    }
                }
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
