//! The post-run stage seam: host-side analysis of a finished run.
//!
//! A run produces two kinds of output. The first is the run's *result* — metrics,
//! a validation summary, a terminal state — which the engine computes itself. The
//! second is *analysis of what the run did*: gg's session record assembled from the
//! journal the session streamed, a static read of the code the model wrote, and
//! whatever else later wants to measure a finished run. That second kind is what
//! this module exists for.
//!
//! # The one rule
//!
//! **All post-run analysis runs on the host, after the working tree is collected,
//! before validation, and outside the harness session's runtime cap.** There is
//! exactly one insertion point in [`RunEngine::run_resolved`](crate::RunEngine::run_resolved),
//! and every stage goes through it. Three properties fall out of that single
//! placement, each of which was the reason for one of the three constraints:
//!
//! - **Analysis never costs the test case its budget.** The runtime cap
//!   (`max_runtime_hours`, applied by `with_runtime_cap`) wraps only the harness
//!   session, and the run's measured duration is frozen before this seam. A stage
//!   can take as long as it needs without a run being scored as if the model had
//!   spent that time. This is satisfied *by construction* rather than by policy:
//!   there is no cap to compete with here, because the capped future has already
//!   resolved.
//! - **What is analysed is what the model wrote.** Validation runs the case's
//!   install and build commands **in the produced tree itself**, so after it the
//!   tree carries build output, a rewritten lockfile and toolchain caches — and
//!   carries different amounts of them depending on how far validation got.
//!   Measuring before validation is the only placement under which "the code the
//!   model wrote" is literally true.
//! - **A canceled run is still analysed.** Validation is the one post-session
//!   stage a cancellation skips, because it is fresh work that judges output an
//!   operator chose to stop. Analysis is not that: it reads bytes that already
//!   exist and renders no verdict, so it runs for a canceled run exactly as for a
//!   completed one — matching the established posture that a killed run keeps its
//!   metrics.
//!
//! # Why a trait
//!
//! Stages are supplied by the host through `Option<Box<dyn PostRunStage>>` fields
//! on the engine — the [`ReferenceRenderer`](crate::ReferenceRenderer) pattern:
//! the contract lives in core, the implementation is injected by whoever assembles
//! the engine. For code analysis this is not stylistic. The analyzer crate depends
//! on core for the contract types, so core cannot depend back on it without a
//! cycle; and injecting it keeps heavyweight parser dependencies out of every
//! binary that links core, the desktop shell included. A host that wires no stages
//! (the default, and every test) simply runs none.

use std::path::{Path, PathBuf};

use crate::error::Result;
use crate::execution::ArtifactCollection;
use crate::test_case::{TestCaseVersion, Variant};

/// Everything a [`PostRunStage`] is given about the run it is analysing.
///
/// Borrowed rather than owned: the stage runs inline in the engine's post-session
/// path, with the run's state still in scope, and nothing here needs to outlive
/// the call.
pub struct PostRunContext<'a> {
    /// The run's ID — minted before the harness started, and the name of
    /// [`run_dir`](Self::run_dir).
    pub run_id: &'a str,
    /// The run's output directory (`<output_dir>/<run_id>`), where the run record
    /// and a copy of the produced tree are written when the run finishes. It is
    /// created before any stage is invoked, so a stage may write its artifact
    /// straight into it.
    ///
    /// A stage's own artifact belongs **here**, at the root of the run tree, not
    /// inside `implementation/`: the implementation directory is a copy of what
    /// the model produced, and anything the host adds to it would show up as code
    /// the model wrote.
    pub run_dir: &'a Path,
    /// The collected working tree, exactly as the run left it: the container is
    /// already stopped and validation has not yet touched it.
    pub artifacts: &'a ArtifactCollection,
    /// The commit the seeder made after laying the workspace down — the exact
    /// boundary between the scaffolding the run was given and the code the model
    /// wrote. Always present here: a run only reaches this seam by way of a
    /// successfully seeded workspace.
    pub seed_commit: &'a str,
    /// What was run: the resolved test case version.
    pub test_case: &'a TestCaseVersion,
    /// The variant of that case the run was seeded from.
    pub variant: &'a Variant,
    /// The request that drove the run — the harness, the model, and a gg run's
    /// capability set. A stage that only applies to some runs (the replay
    /// assembly, which has nothing to read for a third-party harness) decides that
    /// from here.
    pub request: &'a crate::RunRequest,
    /// Whether an operator canceled this run. A stage still runs for a canceled
    /// run; this tells it that the tree and any journal it reads were cut short
    /// deliberately, so a partial result can be reported as such rather than as a
    /// complete one.
    pub canceled: bool,
}

/// What a [`PostRunStage`] produced.
///
/// Stages primarily write artifacts into [`PostRunContext::run_dir`], and this
/// reports what they wrote so a run's log names its analysis outputs — a stage
/// runs after the event stream has gone quiet, and would otherwise be invisible.
///
/// This is also the channel by which a stage contributes to the **run record**: a
/// stage that computes a typed summary destined for a record field returns it
/// here, and the engine folds it into the record it builds. The code analyzer is
/// the first stage to use it — it writes the unbounded document as an artifact and
/// hands back the bounded summary — which is why the seam returns a struct rather
/// than `()`.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct PostRunReport {
    /// Paths of the artifacts the stage wrote, for the run's log line. Empty when
    /// the stage had nothing to do (a replay assembly on a non-gg run) or wrote
    /// nothing.
    pub artifacts: Vec<PathBuf>,
    /// The bounded [code-analysis summary](crate::code_analysis::CodeAnalysisSummary)
    /// destined for [`RunRecord::code_analysis`](crate::RunRecord::code_analysis),
    /// when a stage computed one.
    ///
    /// Returned rather than written straight onto the record because the record does
    /// not exist yet when a stage runs — the seam is deliberately upstream of it, so
    /// that an analysis measures the tree before validation touches it. `None` from
    /// every stage that is not the analyzer, and from an analyzer that had nothing to
    /// measure.
    pub code_analysis: Option<crate::code_analysis::CodeAnalysisSummary>,
}

impl PostRunReport {
    /// A report for a stage that produced no artifact — the common "nothing to do
    /// for this run" answer.
    pub fn empty() -> Self {
        Self::default()
    }

    /// A report for a stage that wrote a single artifact.
    pub fn artifact(path: impl Into<PathBuf>) -> Self {
        Self {
            artifacts: vec![path.into()],
            code_analysis: None,
        }
    }

    /// A report for a stage that computed the run's [code
    /// analysis](crate::code_analysis): the document it wrote, and the bounded
    /// summary destined for the record.
    pub fn analysis(
        path: impl Into<PathBuf>,
        summary: crate::code_analysis::CodeAnalysisSummary,
    ) -> Self {
        Self {
            artifacts: vec![path.into()],
            code_analysis: Some(summary),
        }
    }

    /// Fold another stage's report into this one, accumulating what the run's
    /// stages produced between them.
    ///
    /// A summary already folded in is **kept**: exactly one wired stage produces one,
    /// so a second is a wiring mistake rather than a merge, and preferring the first
    /// keeps the fold order-independent instead of letting the last stage in the list
    /// silently win.
    fn merge(&mut self, other: Self) {
        self.artifacts.extend(other.artifacts);
        if self.code_analysis.is_none() {
            self.code_analysis = other.code_analysis;
        }
    }
}

/// One unit of host-side analysis of a finished run.
///
/// Implementations are supplied by the host that assembles the
/// [`RunEngine`](crate::RunEngine) and are invoked once per run, at the single
/// seam this module documents. A stage may read the produced tree and write
/// artifacts into the run directory; it must not execute anything the run
/// produced, and it must not judge the run — no figure a stage computes may
/// influence a run's score or verdict.
#[async_trait::async_trait]
pub trait PostRunStage: Send + Sync {
    /// A short, stable name for the stage, used in the log line that reports what
    /// it produced and in the warning emitted when it fails.
    fn name(&self) -> &'static str;

    /// Analyse the finished run described by `context`.
    ///
    /// Returning `Err` is how a stage reports that it could not do its job; the
    /// engine logs it and carries on, so the error should say what was being
    /// attempted. A stage that simply does not apply to this run returns
    /// [`PostRunReport::empty`] rather than an error.
    async fn run(&self, context: &PostRunContext<'_>) -> Result<PostRunReport>;
}

/// Run each stage in order and fold what they produced into one report.
///
/// **A failing stage never fails the run.** By the time this is called the run's
/// result exists — the tree is collected, the metrics are computed, the outcome is
/// known — and a stage is a diagnostic read of that result, not part of producing
/// it. Turning a finished run into a failed one because an analysis could not
/// parse something would destroy the very run the analysis was meant to explain,
/// so a stage's error is warned about and skipped, exactly as a failed reference
/// render degrades rather than aborts. The missing artifact is the honest signal
/// that the analysis is absent.
///
/// Stages run sequentially, in the order given, because they are not independent:
/// a stage may leave the tree in the state the next one reads (the replay assembly
/// lifts gg's journal *out* of the working tree, which is what keeps it from being
/// counted as code the model wrote).
pub(crate) async fn run_stages(
    stages: impl IntoIterator<Item = &dyn PostRunStage>,
    context: &PostRunContext<'_>,
) -> PostRunReport {
    let mut report = PostRunReport::default();
    for stage in stages {
        match stage.run(context).await {
            Ok(produced) => {
                if !produced.artifacts.is_empty() {
                    tracing::debug!(
                        stage = stage.name(),
                        artifacts = produced.artifacts.len(),
                        "post-run stage produced artifacts",
                    );
                }
                report.merge(produced);
            }
            Err(err) => {
                tracing::warn!(
                    stage = stage.name(),
                    error = %err,
                    "post-run analysis stage failed; the run is unaffected",
                );
                eprintln!(
                    "warning: the post-run `{}` stage failed ({err}); the run itself is \
                     unaffected, but its analysis will be missing",
                    stage.name(),
                );
            }
        }
    }
    report
}

#[cfg(test)]
#[path = "post_run.test.rs"]
mod tests;
