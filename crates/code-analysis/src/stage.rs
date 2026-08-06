//! The [post-run stage](test_cabinet_core::post_run) that runs this analyzer on a
//! finished run's produced tree.
//!
//! This is the whole of the analyzer's presence in the run pipeline. Core owns the seam
//! and the contract; this crate owns the parsers; the host that assembles the engine wires
//! the two together by putting a [`StaticCodeAnalyzer`] in
//! [`RunEngine::analyzer`](test_cabinet_core::RunEngine). Nothing in core ever names this
//! crate, which is what keeps `oxc` and `syn` out of every binary that links core.
//!
//! # Where in the run it sits, and why that is the point
//!
//! The seam runs **after the tree is collected and before validation**, outside the
//! harness session's runtime cap. All three neighbours matter, and the middle one is the
//! one that is easy to lose in a refactor: the validator runs the case's install and build
//! commands *in the produced tree itself*, so after it the tree carries build output, a
//! rewritten lockfile and toolchain caches — and carries *different amounts of them*
//! depending on whether validation ran at all (a canceled run skips it) and how far it
//! got. Running before validation is the only placement under which
//! [`treeBasis: preValidation`](test_cabinet_core::CodeTreeBasis::PreValidation) is
//! literally true, and the ordering is asserted end to end by
//! `tests/run_path_ordering.rs`.
//!
//! # It applies to every harness
//!
//! Unlike the session-record assembly, this stage does not check the harness. Analysing a
//! directory involves zero harness-specific work, and restricting it to gg would cost
//! coverage for nothing. The gg-only constraint binds where it matters — the aggregate
//! query surface — not here.

use std::io::Write;
use std::path::{Path, PathBuf};

use flate2::Compression;
use flate2::write::GzEncoder;
use test_cabinet_core::post_run::{PostRunContext, PostRunReport, PostRunStage};
use test_cabinet_core::{CODE_ANALYSIS_TREE_ARTIFACT, CodeAnalysisDocument, CodeTreeBasis, Result};

use crate::{AnalysisRequest, analyze};

/// The [post-run stage](test_cabinet_core::post_run) that statically analyses the code a
/// run's model wrote.
///
/// It writes the unbounded [`CodeAnalysisDocument`] to the run tree's
/// [`code-analysis.json.gz`](CODE_ANALYSIS_TREE_ARTIFACT) and hands the bounded
/// `CodeAnalysisSummary` back through the report, which the engine folds onto
/// [`RunRecord::code_analysis`](test_cabinet_core::RunRecord::code_analysis). Two tiers,
/// one pass: the record is deserialized on every run listing, so the per-file and
/// per-symbol detail cannot ride on it, and a consumer that has the document never needs
/// the record.
///
/// **No figure it produces may influence the run's score or verdict.** The stage returns
/// nothing the engine consults for either, and the record field it fills is read by the
/// Code tab and the query language alone.
#[derive(Debug, Default, Clone, Copy)]
pub struct StaticCodeAnalyzer;

#[async_trait::async_trait]
impl PostRunStage for StaticCodeAnalyzer {
    fn name(&self) -> &'static str {
        "code-analysis"
    }

    async fn run(&self, context: &PostRunContext<'_>) -> Result<PostRunReport> {
        // A run whose tree never made it to the host has nothing to measure, and a
        // figure computed from a missing directory would be a convincing-looking zero
        // rather than an absence. Absence is the honest answer, and it is what the
        // record's `Option` encodes.
        if !context.artifacts.repo_path.is_dir() {
            return Ok(PostRunReport::empty());
        }

        let root = context.artifacts.repo_path.clone();
        let seed_commit = context.seed_commit.to_string();
        let output = context.run_dir.join(CODE_ANALYSIS_TREE_ARTIFACT);

        // Off the runtime's worker threads. The pass is seconds of pure CPU (two
        // recursive-descent parsers over every authored file) plus a handful of
        // synchronous `git` invocations, and it is invoked inside a host that is still
        // relaying a run's tail — the driver's event stream, the CLI's progress. There
        // is no runtime cap here to overrun, but there are other tasks on the same
        // executor, and none of them should stall behind a parser.
        let analysis = tokio::task::spawn_blocking(move || {
            let document = analyze(&AnalysisRequest {
                root: &root,
                // The run record's own seed commit, threaded through the seam. This is
                // the *exact* top rung of the authored-set ladder and the only reason a
                // run's figures are the model's work rather than the model's work plus
                // whatever the case seeded.
                seed_commit: Some(&seed_commit),
                // Asserted, not assumed: this stage is only ever reached before
                // validation. See the module documentation.
                tree_basis: CodeTreeBasis::PreValidation,
            });
            write_document_gz(&output, &document).map(|bytes| (output, document, bytes))
        })
        .await
        // A panic on the blocking thread is the analyzer's own bug, and it must reach
        // the seam's warning rather than being swallowed into an empty report — a
        // missing analysis with no explanation is exactly what the stage's error path
        // exists to prevent.
        .map_err(|err| {
            test_cabinet_core::Error::CodeAnalysis(format!(
                "the analysis thread did not finish: {err}"
            ))
        })??;
        let (output, document, compressed_bytes) = analysis;

        tracing::info!(
            files = document.summary.size.files,
            code_lines = document.summary.size.code_lines,
            authored_basis = ?document.summary.authored_basis,
            truncated = document.summary.notes.truncated,
            compressed_bytes,
            "analysed the code the model wrote",
        );
        Ok(PostRunReport::analysis(output, document.summary))
    }
}

/// Write `document` to `output` as gzipped compact JSON, returning its size on disk.
///
/// Written to a sibling temporary file and renamed into place, so `output` either does not
/// exist or is a whole document — never a truncated one a reader would have to
/// distinguish from a valid short one. The temporary sits beside the destination rather
/// than in `/tmp` so the rename is a rename and not a cross-device copy of a file that can
/// run to tens of megabytes.
///
/// Gzip because a run tree's artifacts are gzipped by
/// [convention](test_cabinet_core::post_run) — the same convention the session record set —
/// and because this document compresses roughly tenfold: it is mostly repeated path and
/// symbol strings.
fn write_document_gz(output: &Path, document: &CodeAnalysisDocument) -> Result<u64> {
    let partial = partial_path(output);
    {
        let file = std::fs::File::create(&partial)?;
        let mut encoder = GzEncoder::new(std::io::BufWriter::new(file), Compression::default());
        serde_json::to_writer(&mut encoder, document).map_err(|err| {
            test_cabinet_core::Error::CodeAnalysis(format!(
                "serializing the document for `{}`: {err}",
                output.display()
            ))
        })?;
        encoder.flush()?;
        encoder.finish()?;
    }
    std::fs::rename(&partial, output)?;
    Ok(std::fs::metadata(output)
        .map(|meta| meta.len())
        .unwrap_or(0))
}

/// The scratch path a document is streamed to before it is renamed over `output`.
fn partial_path(output: &Path) -> PathBuf {
    let mut name = output.file_name().unwrap_or_default().to_os_string();
    name.push(".partial");
    output.with_file_name(name)
}

#[cfg(test)]
#[path = "stage.test.rs"]
mod tests;
