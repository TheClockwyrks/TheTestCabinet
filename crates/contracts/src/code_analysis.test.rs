//! Tests for the code-analysis contract.
//!
//! These guard the two properties the *types* are responsible for — the rest of the
//! behaviour lives in `crates/code-analysis`, which produces them.

use super::*;
use serde_json::Value;

/// A summary with every optional block present, so every catalog path has something to
/// resolve against. The figures are arbitrary; only the shape matters.
fn populated_summary() -> CodeAnalysisSummary {
    CodeAnalysisSummary {
        analyzer_version: CODE_ANALYZER_VERSION,
        authored_basis: CodeAuthoredBasis::SeedCommit,
        tree_basis: CodeTreeBasis::PreValidation,
        languages: vec![CodeLanguage::TypeScript, CodeLanguage::Rust],
        size: CodeSizeSummary::default(),
        complexity: CodeComplexitySummary::default(),
        graph: CodeGraphSummary::default(),
        api: CodeApiSummary::default(),
        typescript: Some(CodeTypeScriptSummary::default()),
        rust: Some(CodeRustSummary::default()),
        tests: CodeTestSummary::default(),
        duplication: CodeDuplicationSummary::default(),
        notes: CodeAnalysisNotes::default(),
    }
}

/// Resolve a dotted path against a JSON value, as the Code tab and the field sidebar do.
fn resolve<'a>(root: &'a Value, path: &str) -> Option<&'a Value> {
    let mut here = root;
    for segment in path.split('.') {
        here = here.get(segment)?;
    }
    Some(here)
}

/// Every catalog path must name a leaf that actually exists in a serialized summary.
///
/// This is the gate that keeps the `approximate` flag honest. The flag's whole value is
/// that the sidebar, the axis, the table header and the docs page read *one* source; a
/// path that no longer resolves silently unlabels a chart instead of failing anything, so
/// the renaming of a field has to fail here.
#[test]
fn catalog_paths_resolve() {
    let json = serde_json::to_value(populated_summary()).expect("the summary serializes");
    for def in CODE_METRICS {
        let leaf = resolve(&json, def.path)
            .unwrap_or_else(|| panic!("catalog path `{}` does not resolve", def.path));
        assert!(
            leaf.is_number() || leaf.is_boolean(),
            "catalog path `{}` resolves to {leaf}, which is neither a number nor a boolean",
            def.path
        );
    }
}

/// The catalog must not carry the same path twice: a duplicate would give one figure two
/// labels, and which one a sidebar rendered would depend on iteration order.
#[test]
fn catalog_paths_are_unique() {
    let mut seen = std::collections::BTreeSet::new();
    for def in CODE_METRICS {
        assert!(
            seen.insert(def.path),
            "duplicate catalog path `{}`",
            def.path
        );
    }
}

/// Every family a catalog entry names must be a real top-level block of the summary, so a
/// sidebar can group by family without a lookup table of its own — and so a typo cannot
/// invent an empty group.
#[test]
fn catalog_families_are_summary_blocks() {
    let json = serde_json::to_value(populated_summary()).expect("the summary serializes");
    for def in CODE_METRICS {
        if def.family == "provenance" {
            // The provenance family is deliberately flat: `analyzerVersion` and the two
            // basis enums sit at the summary's root rather than in a block of their own.
            continue;
        }
        assert!(
            json.get(def.family).is_some(),
            "catalog family `{}` (from `{}`) is not a block of the summary",
            def.family,
            def.path
        );
        assert!(
            def.path.starts_with(&format!("{}.", def.family)),
            "catalog path `{}` is filed under family `{}`",
            def.path,
            def.family
        );
    }
}

/// The reference-derived figures must all carry the `approximate` flag, because that flag
/// is the *only* place the honesty requirement is expressed. A prose warning on a docs
/// page cannot reach a chart axis; this can.
#[test]
fn reference_derived_metrics_are_labelled_approximate() {
    for path in [
        "api.unreferencedExports",
        "api.unreferencedExportRatio",
        "graph.orphans",
        "graph.maxDepth",
        "graph.entryPoints",
    ] {
        let def = CODE_METRICS
            .iter()
            .find(|def| def.path == path)
            .unwrap_or_else(|| panic!("`{path}` is missing from the catalog"));
        assert!(
            def.approximate,
            "`{path}` rests on cross-file reference resolution and must be labelled approximate"
        );
    }
}

/// A summary round-trips through JSON unchanged, including the two absent-language cases —
/// the run record carries this block verbatim, and an absent `typescript` must stay absent
/// rather than materialising as a block of zeros that reads as "the model wrote no types".
#[test]
fn a_summary_round_trips_with_absent_language_blocks() {
    let mut summary = populated_summary();
    summary.typescript = None;
    summary.languages = vec![CodeLanguage::Rust];

    let json = serde_json::to_string(&summary).expect("the summary serializes");
    assert!(
        !json.contains("\"typescript\""),
        "an absent language block must not be emitted: {json}"
    );

    let back: CodeAnalysisSummary = serde_json::from_str(&json).expect("the summary parses");
    assert_eq!(back, summary);
}
