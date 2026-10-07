//! **Code analysis**: a deterministic, execute-nothing static read of the source tree a run
//! produced.
//!
//! It answers the question no other measurement in The Test Cabinet touches — not what the
//! run cost or whether it worked, but **how the model built it**. Nothing else in the
//! repository computes a single figure over produced source: the validator runs the case's
//! install and build commands and never inspects what it built.
//!
//! ```no_run
//! use std::path::Path;
//! use test_cabinet_code_analysis::{AnalysisRequest, analyze};
//! use test_cabinet_code_analysis::walk::RootSeeding;
//! use test_cabinet_core::CodeTreeBasis;
//!
//! let analysis = analyze(&AnalysisRequest {
//!     root: Path::new("/runs/abc123/implementation"),
//!     seed_commit: Some("6f03bfee…"),
//!     tree_basis: CodeTreeBasis::PreValidation,
//!     root_seeding: RootSeeding { engine_docs: true },
//! });
//! println!("{} files, {} cycles", analysis.summary.size.files, analysis.summary.graph.cycles);
//! ```
//!
//! # The shape of a pass
//!
//! 1. [`walk`] the tree, honouring its ignore files and applying the hardcoded floor.
//! 2. [`authored`] resolves which of those files the **model** wrote, by a three-rung
//!    ladder whose rung is itself recorded.
//! 3. Each authored file is read once: its lines are counted, and if it is source it is
//!    handed to a front end — [`typescript`] or [`rust`] — through [`caps::parse_guarded`],
//!    which is the whole reason an unguarded recursive-descent parser can be pointed at
//!    model-written code at all.
//! 4. [`graph`] resolves imports into a module graph and finds its cycles; [`clones`] finds
//!    the copy-paste.
//! 5. The rollup folds all of it into the [`CodeAnalysisDocument`] contract.
//!
//! # It is not a score, and not a gate
//!
//! Nothing computed here influences a run's verdict, its review, or whether it publishes. A
//! run is judged on what it built, never on what a metric said about it. Metric definitions
//! carry a polarity only to orient a sort and pick an arrow's direction.
//!
//! # It executes nothing
//!
//! No build, no package manager, no script, no `cargo`. The only subprocess this crate ever
//! starts is a read-only `git`, to answer which files the model wrote — and reading
//! repository metadata is not "executing the produced code".

pub mod authored;
pub mod caps;
pub mod clones;
pub mod facts;
pub mod graph;
mod rollup;
pub mod rust;
pub mod stage;
pub mod text;
pub mod typescript;
pub mod walk;

/// The run pipeline's entry point: wire one of these into
/// [`RunEngine::analyzer`](test_cabinet_core::RunEngine) and every run gets analysed at
/// the [post-run seam](test_cabinet_core::post_run).
pub use stage::StaticCodeAnalyzer;

use std::path::Path;

use test_cabinet_core::{CodeAnalysisDocument, CodeLanguage, CodeTreeBasis, CodeTruncationCap};

use crate::facts::FileFacts;
use crate::text::{CommentStyle, LineCounts};
use crate::walk::FileRole;

/// What to analyse, and what the caller knows about it that the tree cannot say for itself.
pub struct AnalysisRequest<'a> {
    /// The produced tree's root — the `implementation/` directory a run's `/work` was
    /// copied into.
    pub root: &'a Path,
    /// The commit the seeder made after laying the workspace down, from the run record.
    ///
    /// This is the top rung of the authored-set ladder and the only one that is **exact**.
    /// `None` is legitimate (a tree from before the field was recorded, or an ad-hoc
    /// directory) and drops the resolution to the inferred rung.
    pub seed_commit: Option<&'a str>,
    /// Which state of the tree this is. The run path always passes
    /// [`PreValidation`](CodeTreeBasis::PreValidation); a result computed off an archived
    /// tree can only ever be [`PostValidation`](CodeTreeBasis::PostValidation), and saying
    /// so is what keeps a mixed corpus sliceable rather than silently incomparable.
    pub tree_basis: CodeTreeBasis,
    /// What the host wrote into the tree's own root, which the tree cannot say for itself —
    /// see [`RootSeeding`](walk::RootSeeding).
    ///
    /// The only caller that can answer is one that knows the run's engine, so
    /// [`RootSeeding::default`](walk::RootSeeding::default) — floor nothing that cannot be
    /// established — is what an ad-hoc analysis of a checkout passes. The cost of that
    /// default is bounded: on the exact rung of the authored-set ladder, seeded material the
    /// model never touched is excluded anyway.
    pub root_seeding: walk::RootSeeding,
}

/// One authored file, as the analysis holds it between the walk and the rollup.
pub(crate) struct AnalyzedFile {
    /// Path relative to the tree root, `/`-separated.
    pub path: String,
    /// What the walk decided it was.
    pub role: FileRole,
    /// Bytes on disk.
    pub bytes: u64,
    /// The file's text, when it was readable as UTF-8.
    pub source: Option<String>,
    /// Its line counts.
    pub lines: LineCounts,
    /// What a front end found, when one parsed it.
    pub facts: Option<FileFacts>,
    /// Why it was not parsed, when it was not.
    pub size_only_reason: Option<&'static str>,
}

impl AnalyzedFile {
    /// The language a front end parsed it as, if any.
    pub(crate) fn language(&self) -> Option<CodeLanguage> {
        match self.role {
            FileRole::Source(language) if self.facts.is_some() => Some(language),
            _ => None,
        }
    }
}

/// Analyse the tree described by `request`.
///
/// Never fails. Every degradation this can suffer — a tree that is not a repository, a file
/// that will not parse, a cap that fires — is reported *in the result* rather than as an
/// error, because the caller is a post-run stage whose failure would leave a finished run
/// with no analysis and no explanation of why.
pub fn analyze(request: &AnalysisRequest<'_>) -> CodeAnalysisDocument {
    analyze_within(request, &caps::TreeBudgets::default())
}

/// [`analyze`] under `budgets` rather than the production [`TreeBudgets`](caps::TreeBudgets).
///
/// The tree-wide caps are part of what the analyzer version defines, so a result produced
/// under anything but the default is not a record figure. This exists so a truncation can
/// be exercised on a tree of a dozen files instead of one of production scale.
pub fn analyze_within(
    request: &AnalysisRequest<'_>,
    budgets: &caps::TreeBudgets,
) -> CodeAnalysisDocument {
    let walk = walk::walk_within(request.root, request.root_seeding, budgets.max_files);
    let authored = authored::resolve(request.root, request.seed_commit);

    let mut files = Vec::new();
    let mut truncated_by = walk.truncated.then_some(CodeTruncationCap::FileCount);
    let mut skipped_files = walk.skipped_files;
    let mut skipped_bytes = walk.skipped_bytes;
    let mut parse_budget = budgets.max_total_parse_bytes;
    let mut symbol_budget = budgets.max_symbols;

    for walked in &walk.files {
        if !authored.contains(&walked.path) {
            continue;
        }
        let Ok(bytes) = std::fs::read(request.root.join(&walked.path)) else {
            skipped_files += 1;
            continue;
        };
        // A binary, or a generator's output, is not code the model wrote — and the NUL
        // sniff is what catches the ones an extension list misses.
        if text::looks_binary(&bytes) {
            skipped_files += 1;
            skipped_bytes += walked.bytes;
            continue;
        }
        let Ok(source) = String::from_utf8(bytes) else {
            skipped_files += 1;
            skipped_bytes += walked.bytes;
            continue;
        };
        if text::looks_generated(&source) {
            skipped_files += 1;
            skipped_bytes += walked.bytes;
            continue;
        }

        let style = match walked.role {
            FileRole::Source(_) => CommentStyle::CFamily,
            _ => CommentStyle::None,
        };
        let lines = text::count_lines(&source, style);
        let (facts, size_only_reason) = match walked.role {
            FileRole::Source(language) => parse(
                &walked.path,
                &source,
                language,
                &mut parse_budget,
                &mut symbol_budget,
                &mut truncated_by,
            ),
            _ => (None, None),
        };

        files.push(AnalyzedFile {
            path: walked.path.clone(),
            role: walked.role,
            bytes: walked.bytes,
            source: Some(source),
            lines,
            facts,
            size_only_reason,
        });
    }

    let graph = graph::build(
        &files
            .iter()
            .map(|file| graph::GraphInput {
                path: &file.path,
                role: file.role,
                facts: file.facts.as_ref(),
                source: file.source.as_deref(),
            })
            .collect::<Vec<_>>(),
    );

    let clones = clones::detect(
        &files
            .iter()
            .enumerate()
            .filter(|(_, file)| file.facts.is_some())
            .map(|(position, file)| clones::CloneInput {
                file: position,
                source: file.source.as_deref().unwrap_or(""),
            })
            .collect::<Vec<_>>(),
    );

    rollup::build(rollup::Rollup {
        files: &files,
        graph: &graph,
        clones: &clones,
        authored_basis: authored.basis,
        tree_basis: request.tree_basis,
        gitignore_applied: walk.gitignore_applied,
        skipped_files,
        skipped_bytes,
        truncated_by,
    })
}

/// Hand one source file to its front end, under the content-derived budgets.
///
/// Returns the facts and, when there are none, the stable reason recorded on the file's
/// document entry. A refused file still contributes every size figure — the one deliberate
/// reversal in the whole floor, because a file too large to parse is precisely the
/// interesting one.
fn parse(
    path: &str,
    source: &str,
    language: CodeLanguage,
    parse_budget: &mut u64,
    symbol_budget: &mut usize,
    truncated_by: &mut Option<CodeTruncationCap>,
) -> (Option<FileFacts>, Option<&'static str>) {
    if *parse_budget < source.len() as u64 {
        truncated_by.get_or_insert(CodeTruncationCap::ParseBytes);
        return (None, Some("budget-exhausted"));
    }
    if *symbol_budget == 0 {
        truncated_by.get_or_insert(CodeTruncationCap::SymbolBudget);
        return (None, Some("budget-exhausted"));
    }
    *parse_budget -= source.len() as u64;

    let parsed = match language {
        CodeLanguage::TypeScript => {
            caps::parse_guarded(source, |text| typescript::analyze(path, text))
        }
        CodeLanguage::Rust => caps::parse_guarded(source, |text| rust::analyze(path, text)),
    };
    match parsed {
        Ok(Some(facts)) => {
            *symbol_budget = symbol_budget.saturating_sub(facts.functions.len());
            (Some(facts), None)
        }
        // The front end was entered and declined: the file does not parse. Recorded under
        // the same token a contained panic gets, because from the document's point of view
        // they are the same fact — this file has no honest figures — and splitting them
        // would put an implementation detail of the parser into a served artifact.
        Ok(None) => (None, Some("parse-failed")),
        Err(refusal) => (None, Some(refusal.as_str())),
    }
}

/// The analyzer generation this build stamps every result with.
pub const ANALYZER_VERSION: u32 = test_cabinet_core::CODE_ANALYZER_VERSION;

#[cfg(test)]
#[path = "lib.test.rs"]
mod tests;
