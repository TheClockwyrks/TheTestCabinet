//! The Test Cabinet's contracts: the shapes more than one party must agree on.
//!
//! A run record and its parts, gg's configuration, telemetry and session record, the
//! TCQ query contract, the code-analysis contract, the engine identity a run names,
//! the ingest feed, and the layout of a run tree and a case version. Each is read or
//! written by more than one of the orchestrator, the backend, the console, gg and the
//! seeded packages, which is what puts it here rather than in the crate that happens
//! to produce it.
//!
//! This crate is data and the pure functions over it: no container, process, network
//! or clock. `test_cabinet_core` depends on it and re-exports every module at the
//! path it had before the split (`test_cabinet_core::gg`, `::metrics`, ...), so a
//! caller names the same items either way. The TypeScript bindings and JSON Schemas
//! are derived on these types behind the `contract` feature; see
//! `docs/components/core/overview.md`.

pub mod code_analysis;
pub mod cold_storage;
pub mod engine;
pub mod gg;
pub mod gg_query;
pub mod gg_reference;
pub mod gg_session_journal;
pub mod gg_session_record;
pub mod ingest;
pub mod layout;
pub mod metrics;
pub mod orchestrator;
pub mod pricing;
pub mod showcase;
pub mod toolchain;

pub use code_analysis::{
    CODE_ANALYSIS_ARTIFACT, CODE_ANALYSIS_TREE_ARTIFACT, CODE_ANALYZER_VERSION, CODE_METRICS,
    CodeAnalysisDocument, CodeAnalysisNotes, CodeAnalysisSummary, CodeApiSummary,
    CodeAuthoredBasis, CodeCloneGroup, CodeCloneInstance, CodeComplexitySummary,
    CodeDuplicationSummary, CodeFileEntry, CodeGraphSummary, CodeImportEdge, CodeLanguage,
    CodeMetricDef, CodeMetricUnit, CodeRustSummary, CodeSizeSummary, CodeSymbolEntry,
    CodeTestSummary, CodeTreeBasis, CodeTruncationCap, CodeTypeScriptSummary,
};
pub use cold_storage::{COLD_STORAGE_DIR, COLD_STORAGE_DIR_ENV, ColdStorage};
pub use engine::{
    BUILT_IN_SLUGS as BUILT_IN_ENGINE_SLUGS, EngineLookup, EngineManifest, EngineSelection,
    NONE_SLUG, ResolvedEngine,
};
pub use ingest::{IngestMode, IngestProgress, IngestSummary};
pub use layout::{
    BUILD_OUTPUTS, MAX_SHOWCASE_DESCRIPTION_BYTES, MAX_SHOWCASE_MEDIA_ENTRIES,
    MAX_SHOWCASE_MEDIA_FILE_BYTES, VALIDATION_BASELINE_DIR, VALIDATION_IMAGE_PREFIX,
    VALIDATION_SCRIPT_DIR, is_validation_image_name,
};
pub use metrics::{Cost, RunDurations, RunMetrics, TokenCounts, TokenPrices};
pub use orchestrator::ONE_SHOT_SLUG;
pub use toolchain::{
    CoverageFile, CoverageMetric, CoverageMetrics, TOOLCHAIN_COVERAGE_FILE_LIMIT,
    TOOLCHAIN_COVERAGE_SUMMARY_PATH, TOOLCHAIN_FAILURE_MESSAGE_LIMIT, TOOLCHAIN_OUTPUT_LIMIT,
    TOOLCHAIN_TEST_ENTRY_LIMIT, TOOLCHAIN_TEST_FAILURE_LIMIT, TOOLCHAIN_TEST_FILE_LIMIT,
    TOOLCHAIN_TEST_REPORT_PATH, ToolchainCommandResult, ToolchainCommands, ToolchainCoverage,
    ToolchainSmokeResult, ToolchainSummary, ToolchainTest, ToolchainTestFailure, ToolchainTestFile,
    ToolchainTestRun, ToolchainTestStatus, ToolchainTests,
};
