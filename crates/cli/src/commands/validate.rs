//! `tcab validate` — run validation over a produced implementation.

use std::path::PathBuf;

use anyhow::Context;
use test_cabinet_core::{
    AdversarialOutcome, AdversarialTeam, ArtifactCollection, BrowserRenderer, DispatchValidator,
    ReferenceRenderer, StepResult, TestCaseCatalog, Validator,
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

    // The proof-of-implementation artifacts requested for this variant; the
    // validator records whether each is present in the produced tree.
    let proofs = test_case.proofs_for(variant);

    let artifacts = ArtifactCollection {
        repo_path: args.implementation,
    };
    // Validation runs entirely on the host against an existing implementation
    // directory (nothing is bind-mounted into a runtime VM), so the screenshot
    // scratch can live in the system temp directory.
    let validator = DispatchValidator::new(std::env::temp_dir().join("tcab").join("screenshots"));
    // `tcab validate` re-checks an already-produced tree on the host, with no run
    // container in play, so it runs no in-container build — the build validator
    // falls back to building on the host (which resolves for a case without the
    // `packages` mechanism; a `packages`-declaring case must be validated through
    // a full `tcab run`, where the build runs in the container).
    let summary = validator
        .validate(&test_case, variant, &artifacts, &references, &proofs, None)
        .context("validation failed")?;

    println!("  loaded: {}", summary.loaded);
    if let Some(detail) = &summary.detail {
        println!("  detail: {detail}");
    }
    print_step("install", summary.install.as_ref());
    print_step("build", summary.build.as_ref());
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
    if summary.proofs.is_empty() {
        println!("  proofs: none");
    } else {
        for proof in &summary.proofs {
            if proof.present {
                println!("  proof {}: present", proof.id);
            } else {
                let detail = proof.detail.as_deref().unwrap_or("missing");
                println!("  proof {}: missing ({detail})", proof.id);
            }
        }
    }
    if let Some(asset) = &summary.asset {
        let kind = if asset.sheet.is_some() {
            "sprite sheet"
        } else {
            "sprite"
        };
        println!("  asset: {} ({} frame(s))", kind, asset.frames.len());
        for frame in &asset.frames {
            // A single sprite has one frame (index 0); label per frame so a sheet's
            // independent signals are each visible.
            let label = if asset.sheet.is_some() {
                format!("frame {}", frame.index)
            } else {
                "sprite".to_string()
            };
            println!(
                "    {label}: {} operations{}",
                frame.operation_count,
                match frame.cheat_divergence {
                    Some(divergence) if divergence > 0.05 =>
                        format!(", divergence {divergence:.2} (drew outside the tool)"),
                    Some(divergence) => format!(", divergence {divergence:.2}"),
                    None => ", divergence unmeasured".to_string(),
                }
            );
            if let Some(detail) = &frame.detail {
                println!("      {detail}");
            }
        }
        if let Some(detail) = &asset.detail {
            println!("  asset detail: {detail}");
        }
    }
    if let Some(adversarial) = &summary.adversarial {
        let outcome = match adversarial.outcome {
            AdversarialOutcome::Win => "win",
            AdversarialOutcome::Loss => "loss",
            AdversarialOutcome::Draw => "draw",
            AdversarialOutcome::Forfeit => "forfeit",
        };
        let winner = match adversarial.winner {
            Some(AdversarialTeam::Red) => "red",
            Some(AdversarialTeam::Blue) => "blue",
            None => "draw",
        };
        println!("  opponent: {}", adversarial.opponent);
        println!("  outcome: {outcome} (winner: {winner})");
        println!(
            "  score: red {} — blue {}",
            adversarial.red_score, adversarial.blue_score
        );
        println!(
            "  ended: {} after {} ticks",
            adversarial.ended, adversarial.ticks
        );
        if let Some(detail) = &adversarial.detail {
            println!("  adversarial detail: {detail}");
        }
    }

    Ok(())
}

/// Print the outcome of a required build step (install or build), or that it was
/// never reached.
fn print_step(label: &str, step: Option<&StepResult>) {
    match step {
        Some(step) if step.succeeded => println!("  {label}: ok (`{}`)", step.command),
        Some(step) => {
            let detail = step.detail.as_deref().unwrap_or("failed");
            println!("  {label}: failed (`{}`: {detail})", step.command);
        }
        None => println!("  {label}: not reached"),
    }
}

/// Locate the test case catalog root (see `tcab run`).
fn catalog_root() -> PathBuf {
    std::env::var_os("TCAB_TEST_CASES_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("test-cases"))
}
