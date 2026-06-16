//! `tcab validate` — run validation over a produced implementation.

use std::path::PathBuf;

use anyhow::Context;
use test_cabinet_core::{
    ArtifactCollection, BrowserRenderer, BuildValidator, ReferenceRenderer, TestCaseCatalog,
    Validator,
};

use crate::cli::ValidateArgs;

/// Run the core validation pass (load check plus any declared checks) over an
/// already-produced implementation, summarizing the result.
///
/// Validation is a cheap first pass, not a pass/fail gate; the core's
/// [`Validator`] owns the actual work.
pub async fn execute(args: ValidateArgs) -> anyhow::Result<()> {
    println!(
        "tcab validate: {} against {}@{} [{}]",
        args.implementation.display(),
        args.test_case,
        args.version,
        args.variant,
    );

    let catalog = TestCaseCatalog::new(catalog_root());
    let test_case = catalog
        .resolve(&args.test_case, &args.version)
        .with_context(|| format!("resolving {}@{}", args.test_case, args.version))?;
    let variant = test_case
        .variant(&args.variant)
        .with_context(|| format!("selecting variant `{}`", args.variant))?;

    // Render the selected variant's reference baselines the declared checks
    // compare against. A check's baseline may be a common reference or one the
    // variant declares, so the baselines are variant-specific.
    let references = BrowserRenderer::new()
        .render_references(&test_case, variant)
        .context("rendering reference baselines")?;

    let artifacts = ArtifactCollection {
        repo_path: args.implementation,
    };
    let validator = BuildValidator::new(crate::work_dir::staging_dir(None).join("screenshots"));
    let summary = validator
        .validate(&test_case, &artifacts, &references)
        .context("validation failed")?;

    println!("  loaded: {}", summary.loaded);
    if let Some(detail) = &summary.detail {
        println!("  detail: {detail}");
    }
    if summary.checks.is_empty() {
        println!("  checks: none");
    } else {
        for check in &summary.checks {
            if check.reached {
                println!("  {} similarity: {:.2}", check.view, check.similarity);
            } else {
                let detail = check.detail.as_deref().unwrap_or("not reached");
                println!("  {} not reached ({detail})", check.view);
            }
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
