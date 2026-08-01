//! The **code analysis** data contract: what a deterministic static read of a run's
//! produced tree reports, and how each figure is labelled.
//!
//! The analysis itself lives in `crates/code-analysis`, which depends on this crate for
//! these types. The dependency is deliberately one-way: the analyzer needs the contract,
//! and core must never gain a parser — `oxc` and `syn` would otherwise be linked into
//! every binary that links core, the desktop shell included. See
//! [`post_run`](crate::post_run) for the seam the analyzer is injected through.
//!
//! # Two tiers, on purpose
//!
//! [`CodeAnalysisSummary`] is the **bounded** tier: roughly ninety-five scalars, every
//! leaf a number, a boolean or a small enum, destined for the run record and therefore
//! deserialized on every run listing. [`CodeAnalysisDocument`] is the **unbounded** tier:
//! every file, every symbol, every import edge, every cycle, every clone group, served
//! per run as its own artifact. Same posture, and the same reason, as the replay record.
//!
//! # Why a typed struct and not an open bag
//!
//! An open `BTreeMap<String, f64>` buys exactly one thing — a new metric with no
//! per-metric code change — and the query language's document builder already provides
//! that for free, because a typed block flattens to the same dotted `code.*` keys a bag
//! would. What a bag costs is decisive: no JSON Schema, no TypeScript type, no units, no
//! polarity, no `approximate` flag, and no CI gate that fails when a field is renamed out
//! from under a saved query. And three of the most load-bearing fields are not numbers at
//! all — [`CodeAnalysisNotes::truncated`] is a boolean, and the authored basis, the tree
//! basis and the language are enums — so a bag would have forced a parallel typed block
//! anyway. A generic sink with exactly one producer is a typed field with extra steps.
//!
//! # Approximation is data, not prose
//!
//! [`CodeMetricDef::approximate`] is a **field on the metric definition**, read by the
//! field sidebar, the chart axis, the symbol-table header and the docs page alike, so the
//! four cannot drift apart. Cross-file reference counting is the metric family it exists
//! for: neither front end performs type inference, so all cross-file attribution rests on
//! a hand-rolled resolver that is honest in aggregate and unreliable per symbol.
//!
//! # Nothing here is a score
//!
//! No figure in this module influences a run's verdict, its review, or whether it
//! publishes. [`CodeMetricDef::higher_is_better`] exists only to orient a sort and pick an
//! arrow's direction, never to rank.
//!
//! Like the rest of the contract these types are the source of truth: the TypeScript
//! bindings and the JSON Schemas are generated from them by `crates/contract-codegen` and
//! are never edited by hand. JSON is camelCase.

use serde::{Deserialize, Serialize};

#[path = "code_analysis.catalog.rs"]
mod catalog;

pub use catalog::CODE_METRICS;

/// The analyzer **generation** every result is stamped with.
///
/// Load-bearing in three ways, and the third is the real one. It gives a backfill a cheap
/// SQL pushdown instead of a full-table scan; it makes a corpus that spans two
/// generations *visible* rather than a silent step change that reads as a model getting
/// worse; and it **licenses improving the analyzer** — without a version, every
/// improvement is a silent data-corruption event, so nobody makes one.
///
/// **Bump policy.** Bump when an existing metric's *definition* changes, **or when any
/// cap changes** — a cap change is a definition change, because it changes which files
/// contribute. Do *not* bump for a purely additive metric, which older records simply
/// lack.
pub const CODE_ANALYZER_VERSION: u32 = 1;

/// How the analyzer decided which files the **model** wrote, as opposed to which were
/// seeded into the workspace before it started.
///
/// This is the most important correctness question the analysis answers, and getting it
/// wrong pollutes every figure *differently per test case* — silently breaking exactly
/// the cross-case comparison the analysis exists for. So the basis is recorded rather
/// than assumed, and a tree that fails every check degrades **loudly** rather than
/// reporting a confidently-wrong empty authored set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum CodeAuthoredBasis {
    /// The run record carried a [seed commit](crate::run_record::RunRecord::seed_commit)
    /// and that commit is present in the collected tree. **Exact**: the boundary between
    /// the scaffolding and the model's work is the one the seeder actually created.
    SeedCommit,
    /// No recorded seed commit, but the tree has exactly one root commit and its message
    /// is the seeding message. **Inferred**, and kept only for trees that predate the
    /// recorded field.
    ///
    /// The message check is not cosmetic: it is the only thing distinguishing a seed root
    /// from a model-created one. Taking the root commit *unconditionally* fails in the
    /// worst possible direction — if the model amends, squashes, rebases or runs a fresh
    /// `git init`, the root commit's tree contains the model's own work, the seeded set
    /// swallows the authored files, and the run reports near-zero authored code stamped
    /// as an exact measurement.
    RootCommit,
    /// Neither check passed. **Degraded**: seeded scaffolding is included in every
    /// figure, and a consumer should say so rather than compare the run to one measured
    /// exactly.
    AllFiles,
}

/// Which state of the produced tree was measured.
///
/// The analysis runs on the host after collection and **before validation**, because
/// validation runs the case's install and build commands *in the produced tree itself*:
/// after it the tree carries build output, a rewritten lockfile and toolchain caches — and
/// carries different amounts of them depending on whether validation ran at all and how
/// far it got. [`PreValidation`](Self::PreValidation) is therefore the only basis under
/// which "the code the model wrote" is literally true.
///
/// [`PostValidation`](Self::PostValidation) exists because a result computed off an
/// archived tree can only ever be that, and because a live run's basis can still degrade.
/// Recording it keeps a mixed corpus sliceable instead of silently incomparable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum CodeTreeBasis {
    /// The tree as the run left it: collected, with validation not yet run.
    PreValidation,
    /// The tree after validation installed dependencies and built. Comparable to another
    /// `PostValidation` result, not to a `PreValidation` one.
    PostValidation,
}

/// A language the analysis parsed, as opposed to merely counted for size.
///
/// Everything else in a tree — JSON, Markdown, CSS, shaders, HTML — is counted for size
/// only and contributes to no complexity, graph or type-discipline figure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum CodeLanguage {
    /// TypeScript, TSX, JavaScript and JSX, through one front end.
    TypeScript,
    /// Rust, through the other.
    Rust,
}

impl CodeLanguage {
    /// The stable lowercase token this language is written as in a document field, so a
    /// query and a chart legend agree on its spelling.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TypeScript => "typescript",
            Self::Rust => "rust",
        }
    }
}

/// Which content-derived cap a truncated analysis hit.
///
/// Every bound in the analyzer is derived from the tree's own bytes rather than from a
/// clock, so *which* cap fires — and which files it drops — is a pure function of the
/// input. A wall-clock budget would make the output a function of machine speed and load,
/// and an "analyse it twice, assert equal" test would pass while proving nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum CodeTruncationCap {
    /// More files than the analyzer will visit. Files are visited in sorted order, so the
    /// dropped set is deterministic.
    FileCount,
    /// The total bytes handed to a parser across the whole tree was exhausted; later
    /// files in sorted order were counted for size only.
    ParseBytes,
    /// More functions than the symbol budget admits; later files contributed size and
    /// imports but no per-function complexity.
    SymbolBudget,
}

/// The bounded, typed summary that rides on the run record.
///
/// Every leaf is a number, a boolean or a small enum, so the whole block flattens into
/// the query language's `code.*` namespace with no per-metric code. The catalog in
/// [`CODE_METRICS`] carries the display metadata for each leaf.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CodeAnalysisSummary {
    /// The [analyzer generation](CODE_ANALYZER_VERSION) that produced these figures.
    pub analyzer_version: u32,
    /// How the authored set was resolved. See [`CodeAuthoredBasis`].
    pub authored_basis: CodeAuthoredBasis,
    /// Which state of the tree was measured. See [`CodeTreeBasis`].
    pub tree_basis: CodeTreeBasis,
    /// The languages actually parsed, sorted and deduplicated.
    ///
    /// An array, so it flattens to a useless `code.languages.count`; the query
    /// language's document builder therefore emits a derived **scalar** `code.language`
    /// (`"typescript"`, `"rust"`, `"mixed"` or `"none"`) alongside it. Stated here so the
    /// rule is visible from the field that motivates it.
    pub languages: Vec<CodeLanguage>,
    /// Totals, and the three shape metrics that distinguish "modularised" from "one
    /// god-file and forty stubs".
    pub size: CodeSizeSummary,
    /// Per-function complexity, folded. Both languages score from one normative
    /// definition, enforced by paired fixture tests in the analyzer.
    pub complexity: CodeComplexitySummary,
    /// The module graph: cycles, coupling, orphans.
    pub graph: CodeGraphSummary,
    /// The exported surface, and how much of it nothing references.
    pub api: CodeApiSummary,
    /// TypeScript-only type discipline. Absent when the tree contains no TypeScript or
    /// JavaScript the analyzer parsed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub typescript: Option<CodeTypeScriptSummary>,
    /// Rust-only discipline. Absent when the tree contains no Rust the analyzer parsed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub rust: Option<CodeRustSummary>,
    /// Static counts of the test code the model chose to write. **Never coverage** — see
    /// [`CodeTestSummary`].
    pub tests: CodeTestSummary,
    /// Copy-paste, from a normalised sliding-window clone detector.
    pub duplication: CodeDuplicationSummary,
    /// What the walk skipped and whether any cap fired.
    pub notes: CodeAnalysisNotes,
}

/// Totals and shape. Three of these carry most of the signal, because they are what
/// distinguish a modularised tree from a single god-file surrounded by stubs.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CodeSizeSummary {
    /// Authored files that contributed to any figure, parsed or size-only.
    pub files: u32,
    /// Of those, how many a front end actually parsed.
    pub parsed_files: u32,
    /// Of those, how many were counted for size only — another language, over the
    /// per-file parse cap, or refused by the nesting prescan.
    ///
    /// A file too large to *parse* is still counted for **size**. A 300 KB god-file is
    /// precisely the interesting case; dropping it entirely would bias every size metric
    /// against the worst outcomes.
    pub size_only_files: u32,
    /// Total bytes of the authored files.
    pub bytes: u64,
    /// Lines that are neither blank nor wholly a comment.
    pub code_lines: u32,
    /// Lines that are wholly a comment.
    pub comment_lines: u32,
    /// Lines that are empty or whitespace.
    pub blank_lines: u32,
    /// Distinct directories the authored files live in, counting the source root.
    pub directories: u32,
    /// The deepest directory nesting, with a file at the source root scoring zero.
    pub max_directory_depth: u32,
    /// Authored files divided by directories.
    pub mean_files_per_directory: f64,
    /// **The Gini coefficient of code lines across files.** Zero means every file is the
    /// same size; approaching one means a single file holds everything. One number that
    /// answers "did the model split the work?", and it costs a sort.
    pub gini_code_lines: f64,
    /// The fraction of code lines living directly in the source root. A model that never
    /// created a subdirectory scores one.
    pub root_share: f64,
    /// Code lines in the largest file.
    pub max_file_code_lines: u32,
    /// The median file's code lines.
    pub median_file_code_lines: u32,
    /// The 90th-percentile file's code lines — the tail the mean hides.
    pub p90_file_code_lines: u32,
    /// Files over 500 code lines.
    pub files_over500_lines: u32,
    /// Files over 1000 code lines.
    pub files_over1000_lines: u32,
}

/// Per-function complexity, folded over every function both front ends found.
///
/// The two complexity measures are kept side by side deliberately. Cyclomatic is famously
/// blind to nesting, and nesting is precisely what makes generated code unreadable.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CodeComplexitySummary {
    /// Functions scored, across both languages.
    pub functions: u32,
    /// Summed McCabe cyclomatic complexity.
    pub total_cyclomatic: u32,
    /// The worst single function's cyclomatic complexity.
    pub max_cyclomatic: u32,
    /// Mean cyclomatic complexity per function.
    pub mean_cyclomatic: f64,
    /// Summed Sonar cognitive complexity.
    pub total_cognitive: u32,
    /// The worst single function's cognitive complexity.
    pub max_cognitive: u32,
    /// Mean cognitive complexity per function.
    pub mean_cognitive: f64,
    /// The deepest nesting inside any one function.
    pub max_nesting: u32,
    /// Mean per-function maximum nesting.
    pub mean_max_nesting: f64,
    /// The largest parameter list.
    pub max_parameters: u32,
    /// Mean parameter count.
    pub mean_parameters: f64,
    /// The most exit points (`return`/`throw`, plus Rust's `?`) in one function.
    pub max_exits: u32,
    /// Mean exit count.
    pub mean_exits: f64,
    /// Functions whose cyclomatic complexity exceeds 10 — the conventional review
    /// threshold.
    pub functions_over10_cyclomatic: u32,
    /// Functions whose cyclomatic complexity exceeds 20.
    pub functions_over20_cyclomatic: u32,
    /// Lines spanned by the longest function.
    pub max_function_lines: u32,
    /// Mean lines per function.
    pub mean_function_lines: f64,
}

/// The module graph: one node per authored source file, edges from resolved intra-tree
/// imports. This is where the "did the model think about layering?" signal lives.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CodeGraphSummary {
    /// Files in the graph.
    pub nodes: u32,
    /// Resolved intra-tree import edges, deduplicated per (from, to) pair.
    pub edges: u32,
    /// Strongly connected components of more than one file — **import cycles**. The
    /// clearest "did not think about layering" signal there is, and invisible to every
    /// other metric here.
    pub cycles: u32,
    /// Files in the largest cycle.
    pub largest_cycle: u32,
    /// Files participating in any cycle.
    pub files_in_cycles: u32,
    /// Mean instability — outgoing over total coupling, per file. Distinguishes a
    /// codebase of leaves from a codebase of tangles.
    pub mean_instability: f64,
    /// Mean outgoing edges per file.
    pub mean_fan_out: f64,
    /// The most intra-tree imports in one file. A file importing thirty others is a
    /// god-module by another name.
    pub max_fan_out: u32,
    /// Mean incoming edges per file.
    pub mean_fan_in: f64,
    /// The most-imported file's incoming edge count.
    pub max_fan_in: u32,
    /// Files reachable from no entry point: dead modules the model wrote and abandoned.
    pub orphans: u32,
    /// The longest shortest-path from any entry point, in edges.
    pub max_depth: u32,
    /// Distinct external packages imported (bare specifiers for TypeScript, non-local
    /// crate roots for Rust).
    pub external_packages: u32,
    /// Entry points the graph was rooted at — HTML `<script src>` targets, and each
    /// discovered crate root.
    pub entry_points: u32,
}

/// The exported surface, and how much of it nothing references.
///
/// Both reference figures are **approximate** in both languages and worst exactly where
/// this corpus lives — barrels, namespace imports, bundler entry points. The label is
/// carried in [`CODE_METRICS`], not in prose, so the sidebar, the axis and the table
/// header cannot disagree about it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CodeApiSummary {
    /// Exported symbols across all parsed files.
    pub exports: u32,
    /// Exports divided by parsed files.
    pub mean_exports_per_module: f64,
    /// Exports no other authored file appears to reference.
    pub unreferenced_exports: u32,
    /// [`unreferenced_exports`](Self::unreferenced_exports) over
    /// [`exports`](Self::exports).
    pub unreferenced_export_ratio: f64,
}

/// TypeScript-only type discipline. Everything here is **syntactic**: the front end
/// performs no type inference, so there is no implicit-`any` detection and no "is this
/// cast actually unsound". For the question being asked — *did the model annotate its own
/// API?* — that is arguably the better definition, and it keeps the two languages
/// symmetric, which is what makes the cross-language comparison honest.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CodeTypeScriptSummary {
    /// Files this front end parsed.
    pub files: u32,
    /// Code lines in those files.
    pub code_lines: u32,
    /// Explicit `any` annotations.
    pub any_occurrences: u32,
    /// `any` annotations per thousand code lines.
    pub any_density: f64,
    /// Explicit `unknown` annotations — the honest alternative to `any`.
    pub unknown_occurrences: u32,
    /// `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` and `eslint-disable` comments.
    pub suppression_comments: u32,
    /// Non-null assertions (`x!`).
    pub non_null_assertions: u32,
    /// `as T` and `<T>x` assertion casts, excluding `as const`.
    pub assertion_casts: u32,
    /// The fraction of function parameters carrying a type annotation.
    pub annotated_parameter_ratio: f64,
    /// The fraction of functions carrying a return-type annotation.
    pub annotated_return_ratio: f64,
    /// The same ratio restricted to **exported** functions — the API-boundary version,
    /// and the one that actually matters.
    pub exported_annotated_ratio: f64,
    /// Interfaces, type aliases and enums declared.
    pub type_declarations: u32,
    /// Type declarations per thousand code lines: did the model model its domain, or pass
    /// object literals around?
    pub type_declarations_per_kloc: f64,
}

/// Rust-only discipline, chosen to mirror the TypeScript questions rather than to
/// enumerate Rust features: `unwrap`/`expect` is the analogue of `any` (papering over the
/// type system), and clone density is a proxy for fighting the borrow checker instead of
/// designing ownership.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CodeRustSummary {
    /// Files this front end parsed.
    pub files: u32,
    /// Code lines in those files.
    pub code_lines: u32,
    /// `unsafe` blocks, functions and impls.
    pub unsafe_items: u32,
    /// `.unwrap()` calls.
    pub unwrap_calls: u32,
    /// `.expect(…)` calls.
    pub expect_calls: u32,
    /// `unwrap` plus `expect` per thousand code lines.
    pub unwrap_density: f64,
    /// `panic!` and `unreachable!` sites — where the program chooses to abort.
    ///
    /// Assertion macros are excluded: they live overwhelmingly in test code, where an
    /// assertion firing is the test working, and counting them would make this a proxy for
    /// [`CodeTestSummary::test_functions`] wearing a different name.
    pub panic_sites: u32,
    /// `todo!` and `unimplemented!` macros: holes in shipped code.
    pub todo_macros: u32,
    /// `#[allow(…)]` attributes.
    pub suppressed_lints: u32,
    /// `.clone()` calls.
    pub clone_calls: u32,
    /// `.clone()` calls per thousand code lines.
    pub clone_density: f64,
    /// Items declared `pub` (including `pub(crate)` and friends).
    pub public_items: u32,
    /// Public items over all items — whether visibility was narrowed at all, or
    /// everything is public.
    pub public_ratio: f64,
    /// Traits declared: abstraction actually used, rather than available.
    pub traits: u32,
    /// Items carrying generic parameters.
    pub generic_items: u32,
}

/// Static counts of the test code the model chose to write, computed by parsing and
/// executing nothing.
///
/// **These are an authorship signal and must never be presented as coverage.** Neither
/// coverage nor mutation testing is in scope; a count of `#[test]` functions says what the
/// model wrote, not what it exercised.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CodeTestSummary {
    /// Files whose path or contents mark them as test files.
    pub test_files: u32,
    /// `#[test]` functions, and `it`/`test` calls in TypeScript.
    pub test_functions: u32,
    /// Code lines in test files.
    pub test_code_lines: u32,
    /// Test code lines over all code lines.
    pub test_line_ratio: f64,
}

/// Copy-paste, from a normalised sliding-window clone detector — one hash pass.
///
/// This answers "did the model abstract, or copy-paste the enemy AI five times?", and
/// **no other metric here catches it**.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CodeDuplicationSummary {
    /// Code lines covered by at least one clone instance.
    pub cloned_lines: u32,
    /// [`cloned_lines`](Self::cloned_lines) over all code lines in parsed files.
    pub cloned_line_ratio: f64,
    /// Distinct groups of identical normalised windows.
    pub clone_groups: u32,
    /// Lines in the largest single clone.
    pub largest_clone_lines: u32,
}

/// What the walk skipped, and whether any content-derived cap fired.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CodeAnalysisNotes {
    /// Whether a cap dropped work that would otherwise have contributed.
    ///
    /// **A truncated analysis is excluded from aggregation by default**: a partial figure
    /// that looks complete is worse than a missing one. Under the query language that is
    /// the composable filter `not code.notes.truncated`, not a hidden flag on a query.
    pub truncated: bool,
    /// Which cap fired first. Absent when [`truncated`](Self::truncated) is false.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub truncated_by: Option<CodeTruncationCap>,
    /// Whether any ignore file was in play — a `.gitignore`, `.git/info/exclude` or a
    /// nested ignore file.
    ///
    /// An over-broad `.gitignore` shrinks the measured tree, and the model owns that file.
    /// Recording that ignore rules applied is what makes an implausibly small measurement
    /// explicable instead of mysterious.
    pub gitignore_applied: bool,
    /// Paths the hardcoded floor removed: dependency and vendored trees, build output,
    /// minified and generated files, binaries. Counted, never silently dropped.
    pub files_skipped: u32,
    /// Bytes those paths held.
    pub bytes_skipped: u64,
    /// Authored files a front end was offered but could not parse — a syntax error, or a
    /// panic contained on the parse thread.
    pub files_unparsable: u32,
}

/// The unit a [`CodeMetricDef`] is measured in, so an axis can be labelled and two
/// metrics can be told apart at a glance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum CodeMetricUnit {
    /// A plain count.
    Count,
    /// Lines of source.
    Lines,
    /// Bytes.
    Bytes,
    /// A fraction in `[0, 1]`, rendered as a percentage.
    Ratio,
    /// A rate per thousand code lines.
    PerKiloLine,
    /// A dimensionless score (the complexity measures).
    Score,
    /// True or false.
    Boolean,
}

/// Display metadata for one leaf of [`CodeAnalysisSummary`].
///
/// This is **not** a query vocabulary — the query language derives its field catalog from
/// observed documents, so a new metric needs no entry here to be queryable. It is what the
/// Code tab and the field sidebar read to label a figure, choose its formatting, and — the
/// reason it exists at all — say whether the figure is approximate.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CodeMetricDef {
    /// The dotted path of the leaf inside [`CodeAnalysisSummary`]'s JSON, without the
    /// `code.` namespace prefix the query document adds. `catalog_paths_resolve` asserts
    /// every one of these resolves against a serialized summary, so a renamed field fails
    /// the suite rather than silently unlabelling a chart.
    pub path: &'static str,
    /// The short human label for an axis, a table header or a sidebar row.
    pub label: &'static str,
    /// What the number is measured in.
    pub unit: CodeMetricUnit,
    /// The family the metric belongs to, matching the top-level block of the summary, so
    /// the sidebar can group without re-deriving it from the path.
    pub family: &'static str,
    /// Which direction is "better", used **only** to orient a sort and pick an arrow's
    /// direction. `None` means the metric is descriptive and has no good direction — most
    /// counts are like this. No figure here influences a run's score or verdict.
    pub higher_is_better: Option<bool>,
    /// Whether the figure rests on approximation rather than resolution.
    ///
    /// This is the honesty requirement expressed as **data**: the field sidebar, the chart
    /// axis, the symbol-table header and the docs page all read this one flag, so they
    /// cannot drift apart. Set on everything downstream of cross-file reference counting,
    /// which is approximate in both languages.
    pub approximate: bool,
}

/// The full exploration document, served per run as its own artifact.
///
/// The unbounded tier: every file, every symbol with its complexity, every import edge,
/// every cycle, every clone group. Its bounded sibling
/// ([`summary`](Self::summary)) is embedded so a consumer that has the document never
/// needs the record too.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CodeAnalysisDocument {
    /// The [analyzer generation](CODE_ANALYZER_VERSION) that produced this document.
    pub analyzer_version: u32,
    /// The same figures that ride on the run record.
    pub summary: CodeAnalysisSummary,
    /// Every authored file, in sorted path order.
    pub files: Vec<CodeFileEntry>,
    /// Every function both front ends scored, in file-then-line order.
    pub symbols: Vec<CodeSymbolEntry>,
    /// Every resolved intra-tree import edge, as indices into [`files`](Self::files).
    pub imports: Vec<CodeImportEdge>,
    /// Every import cycle, as sorted indices into [`files`](Self::files).
    pub cycles: Vec<Vec<u32>>,
    /// Every clone group.
    pub clones: Vec<CodeCloneGroup>,
}

/// One authored file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CodeFileEntry {
    /// The path relative to the produced tree's root, with `/` separators on every
    /// platform.
    pub path: String,
    /// The language a front end parsed it as, absent when it was counted for size only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub language: Option<CodeLanguage>,
    /// Bytes on disk.
    pub bytes: u64,
    /// Lines that are neither blank nor wholly a comment.
    pub code_lines: u32,
    /// Lines that are wholly a comment.
    pub comment_lines: u32,
    /// Lines that are empty or whitespace.
    pub blank_lines: u32,
    /// Functions scored in this file.
    pub functions: u32,
    /// Summed cyclomatic complexity of those functions.
    pub cyclomatic: u32,
    /// Summed cognitive complexity of those functions.
    pub cognitive: u32,
    /// Resolved intra-tree imports out of this file.
    pub fan_out: u32,
    /// Resolved intra-tree imports into this file.
    pub fan_in: u32,
    /// Whether the file is test code.
    pub is_test: bool,
    /// Why the file was not parsed, when it was not — one of `"over-parse-cap"`,
    /// `"over-nesting-cap"`, `"parse-failed"`, `"thread-unavailable"` or
    /// `"budget-exhausted"`.
    ///
    /// Absent both for a file that parsed and for one no front end was ever offered (JSON,
    /// Markdown, an image): "the analyzer declined" and "there is nothing here to parse"
    /// are different facts, and only the first is a reason.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub size_only_reason: Option<String>,
}

/// One function, with the figures that make it sortable in the Code tab's symbol table.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CodeSymbolEntry {
    /// Index into [`CodeAnalysisDocument::files`].
    pub file: u32,
    /// The function's name, or a synthesized one for an anonymous function
    /// (`"<anonymous>"`, or `"<default>"` for a default-exported one).
    pub name: String,
    /// The 1-based line the function starts on.
    pub line: u32,
    /// Lines the function spans.
    pub lines: u32,
    /// McCabe cyclomatic complexity.
    pub cyclomatic: u32,
    /// Sonar cognitive complexity.
    pub cognitive: u32,
    /// Deepest nesting inside the function.
    pub max_nesting: u32,
    /// Parameter count.
    pub parameters: u32,
    /// Exit points.
    pub exits: u32,
    /// Whether the function is exported (TypeScript) or `pub` (Rust).
    pub exported: bool,
    /// How many other authored files appear to reference it. **Approximate** — see
    /// [`CodeMetricDef::approximate`]. Absent for a non-exported function, whose
    /// references are not attributed across files at all.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub references: Option<u32>,
}

/// One resolved intra-tree import edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CodeImportEdge {
    /// Index into [`CodeAnalysisDocument::files`] of the importing file.
    pub from: u32,
    /// Index into [`CodeAnalysisDocument::files`] of the imported file.
    pub to: u32,
}

/// One group of identical normalised windows: the same shape, written more than once.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CodeCloneGroup {
    /// Lines in each instance.
    pub lines: u32,
    /// Where the group occurs, at least twice.
    pub instances: Vec<CodeCloneInstance>,
}

/// One occurrence of a clone group.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CodeCloneInstance {
    /// Index into [`CodeAnalysisDocument::files`].
    pub file: u32,
    /// The 1-based line the clone starts on.
    pub line: u32,
}

#[cfg(test)]
#[path = "code_analysis.test.rs"]
mod tests;
