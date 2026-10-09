//! The collected tree a validator is handed.
//!
//! A run's container, its seeding and its artifact collection are core's
//! (`test_cabinet_core::execution`). What a validator reads of the collected tree —
//! where it is, the install already run over it and the engine it was built on — is
//! here, beside the validator runners that read it; core re-exports both types at
//! their old paths.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::validation::StepResult;

// The run workspace's layout and the output-stream tag, re-exported so this module
// reads as the one core's `execution` re-exports.
pub use test_cabinet_contracts::execution::*;

/// The case's dependency install, already run to its final outcome over a
/// collected tree.
///
/// The toolchain stage (`test_cabinet_core::toolchain_stage`) runs the case's `[build]` install
/// over the collected tree so its commands have their dependencies, and validation
/// then needs that same tree installed. A lockfile install such as `npm ci` clears
/// `node_modules` and rebuilds it from the lockfile, so running the command a second
/// time reproduces the state it already produced. Carrying the recorded install on
/// the tree's own description is what lets validation skip the repeat and report the
/// recorded step in its place.
///
/// An install that did not succeed is carried too. The verified
/// install (`test_cabinet_core::install`) has already made every attempt it is allowed, so its
/// failure is final: validation reports that step as its own and never builds the
/// tree, rather than spending the attempts over again.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedInstall {
    /// The install command that was run, verbatim as the case's `[build]` table
    /// declares it. Validation compares its own case's install command against this
    /// before reusing the step, so a tree prepared by one command is never taken as
    /// preparation for a different one.
    pub command: String,
    /// The recorded outcome, reported by validation as its own install step so a
    /// reader sees the same summary whether or not validation ran the command.
    pub step: StepResult,
}

impl PreparedInstall {
    /// Describe the tree an install left behind, whatever it came to.
    pub fn recorded(step: &StepResult) -> Self {
        Self {
            command: step.command.trim().to_string(),
            step: step.clone(),
        }
    }
}

/// The collected output of a finished run.
///
/// When a run finishes, the working tree is collected as the run's primary
/// artifact. This produced repository is what gets validated and, if published,
/// released.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactCollection {
    /// Host path to the collected working tree.
    pub repo_path: PathBuf,
    /// The dependency install a post-run stage (`test_cabinet_core::post_run`) already ran over
    /// this tree, when one did.
    ///
    /// Deliberately not serialized. This describes the tree as it stands in **this**
    /// process, right now, and the only writer is the engine stamping what its own
    /// stages just did to the tree it is about to validate. A value that could be
    /// persisted or shipped could outlive the tree it describes, and validation would
    /// then skip an install for a tree nobody ever installed into. Every collection
    /// built anywhere else — `tcab validate` against an implementation directory
    /// among them — starts with nothing prepared and installs for itself.
    #[serde(skip)]
    pub prepared_install: Option<PreparedInstall>,
    /// The [engine](crate::engine) the run that produced this tree selected, when
    /// the caller resolved one.
    ///
    /// A seeded tree is engine-specific: the engine's package is vendored into it,
    /// its documentation is copied beside the specs, and the build writes its game
    /// against that runtime's API. The selection is a property of the tree itself,
    /// so it is carried on the tree's own description rather than passed to every
    /// `Validator` (`test_cabinet_core::validation::Validator`) implementation, only one of which
    /// has any use for it.
    ///
    /// Deliberately not serialized, for the same reason
    /// [`prepared_install`](Self::prepared_install) is not: it describes the tree as
    /// it stands in **this** process. The run record carries the run's engine slug
    /// and version for anything that reads the selection back later.
    #[serde(skip)]
    pub engine: Option<crate::engine::ResolvedEngine>,
}

impl ArtifactCollection {
    /// A tree at `repo_path` that nothing has prepared.
    pub fn new(repo_path: impl Into<PathBuf>) -> Self {
        Self {
            repo_path: repo_path.into(),
            prepared_install: None,
            engine: None,
        }
    }

    /// The same tree, now carrying the install that was run over it.
    #[must_use]
    pub fn prepared_by(mut self, install: Option<PreparedInstall>) -> Self {
        self.prepared_install = install;
        self
    }

    /// The same tree, now carrying the engine the run that produced it was built on.
    #[must_use]
    pub fn built_on(mut self, engine: Option<crate::engine::ResolvedEngine>) -> Self {
        self.engine = engine;
        self
    }

    /// The engine **runtime** this tree was built on, or `None` when the run vendored
    /// none.
    ///
    /// The filter is what makes the answer usable directly: a run that selected
    /// [`NONE_SLUG`](crate::engine::NONE_SLUG) resolved an engine supplying no
    /// runtime, and that is indistinguishable here from a tree recording no selection
    /// at all, because both are validated by driving the build in a browser.
    pub fn engine_runtime(&self) -> Option<&crate::engine::ResolvedEngine> {
        self.engine
            .as_ref()
            .filter(|engine| engine.provides_runtime())
    }

    /// The recorded install to reuse for `command`, when this tree has had exactly
    /// that command run over it.
    ///
    /// The comparison is what keeps the signal honest: a tree prepared by one case's
    /// install command answers only for that command, and any other caller gets
    /// `None` and installs for itself.
    pub fn prepared_install_for(&self, command: &str) -> Option<&PreparedInstall> {
        self.prepared_install
            .as_ref()
            .filter(|prepared| prepared.command == command.trim())
    }
}
