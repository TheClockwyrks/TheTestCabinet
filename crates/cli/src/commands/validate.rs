//! `tcab validate` — run validation over a produced implementation.

use std::path::PathBuf;

use anyhow::Context;
use test_cabinet_core::{ArtifactCollection, BuildValidator, TestCaseCatalog, Validator};

use crate::cli::ValidateArgs;

/// Run the core validation pass (load check plus any reference comparisons) over
/// an already-produced implementation, summarizing the result.
///
/// Validation is a cheap first pass, not a pass/fail gate; the core's
/// [`Validator`] owns the actual work.
pub async fn execute(args: ValidateArgs) -> anyhow::Result<()> {
    println!(
        "tcab validate: {} against {}@{}",
        args.implementation.display(),
        args.test_case,
        args.version,
    );

    let catalog = TestCaseCatalog::new(catalog_root());
    let test_case = catalog
        .resolve(&args.test_case, &args.version)
        .with_context(|| format!("resolving {}@{}", args.test_case, args.version))?;

    let artifacts = ArtifactCollection {
        repo_path: args.implementation,
    };
    let validator = BuildValidator::new(std::env::temp_dir().join("tcab/screenshots"));
    let summary = validator
        .validate(&test_case, &artifacts)
        .context("validation failed")?;

    println!("  loaded: {}", summary.loaded);
    if summary.reference_comparisons.is_empty() {
        println!("  reference comparisons: none");
    } else {
        for comparison in &summary.reference_comparisons {
            println!(
                "  {} similarity: {:.2}",
                comparison.view, comparison.similarity
            );
        }
    }

    Ok(())
}

/// Locate the test case catalog root (see `tcab run`).
fn catalog_root() -> PathBuf {
    std::env::var_os("TCAB_TEST_CASES_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("test-cases"))
}
