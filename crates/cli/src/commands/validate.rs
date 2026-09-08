//! `tcab validate` — run validation over a produced implementation.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::ExitCode;

use anyhow::Context;
use test_cabinet_core::validation::Inconclusive;
use test_cabinet_core::{
    AdversarialOutcome, AdversarialTeam, ArtifactCollection, BrowserRenderer, DebugScriptResult,
    DispatchValidator, ReferenceRenderer, StepResult, TestCaseCatalog, TestType, ValidationSummary,
    Validator,
};

use crate::cli::ValidateArgs;
use crate::commands::engines;

/// Run the core validation pass (load check plus any declared checks) over an
/// already-produced implementation, summarizing the result and reporting whether
/// everything the case declared actually held.
///
/// The core's [`Validator`] owns the work; this command owns the *verdict*. An
/// operator points `tcab validate` at a tree — most often a case's own reference
/// implementation while authoring validators — and wants one question answered: did
/// this tree satisfy everything the case declares? So the process status carries the
/// answer. The pass completing is not the same as the pass passing: a summary
/// reporting a failed verdict is a successful run of the validator and a failed
/// validation, and only the latter decides the exit code. See [`faults`] for exactly
/// what counts.
///
/// The distinction is why this returns an [`ExitCode`] rather than an error. A case
/// that cannot be resolved, a browser that will not start, an engine slug the case
/// does not support — those are errors, and they propagate as such. A validation that
/// ran to completion and found faults is a verdict, and it is reported by returning
/// [`ExitCode::FAILURE`] after printing the summary line that names them.
pub async fn execute(args: ValidateArgs) -> anyhow::Result<ExitCode> {
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

    // Resolving the engine is the gate: a build written against an engine is driven
    // through that engine's host interface, so validating it as though it were on a
    // different engine measures it against a contract it was never given. The check
    // is the case's declared support, and it happens before anything is built,
    // because a mismatch is a mistake in the invocation rather than a result.
    let engine = engines::resolve_for_case(&args.engine, &test_case)
        .with_context(|| format!("selecting engine `{}`", args.engine))?;
    println!("  engine: {}", engine.slug());

    // Render the selected variant's reference baselines the declared checks
    // compare against. A check's baseline may be a common reference or one the
    // variant declares, so the baselines are variant-specific.
    let references = BrowserRenderer::new()
        .render_references(&test_case, variant)
        .context("rendering reference baselines")?;

    // The proof-of-implementation artifacts requested for this variant; the
    // validator records whether each is present in the produced tree.
    let proofs = test_case.proofs_for(variant);

    // The tree is described by the engine it was built on, which is what decides
    // whether the case's validators run as a vitest project or its instrumentation is
    // driven in a browser. Nothing has installed this tree, so validation installs it.
    let artifacts = ArtifactCollection::new(args.implementation).built_on(Some(engine.clone()));
    // Validation runs entirely on the host against an existing implementation
    // directory (nothing is bind-mounted into a runtime VM), so the screenshot
    // scratch can live in the system temp directory.
    let validator = DispatchValidator::new(std::env::temp_dir().join("tcab").join("screenshots"));
    let summary = validator
        .validate(&test_case, variant, &artifacts, &references, &proofs)
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
    if !summary.debug_scripts.is_empty() {
        // Two counts, because they are different failures. A script that did not run
        // against a build that was supposed to answer it is a contract failure the
        // build earned; a script recorded inconclusive decided nothing about the build,
        // because a precondition went unmet, the suites could not be run at all or the
        // host stopped them on time. Both fail this command (see [`faults`]), but
        // printing them apart is what lets an operator tell a broken build from a
        // broken host or tree.
        let not_run = summary
            .debug_scripts
            .iter()
            .filter(|script| !script.ran && !script.precondition_unmet)
            .count();
        let inconclusive = summary
            .debug_scripts
            .iter()
            .filter(|script| !script.ran && script.precondition_unmet)
            .count();
        println!(
            "  debug scripts: {} ({not_run} did not run, {inconclusive} inconclusive)",
            summary.debug_scripts.len(),
        );
        for script in &summary.debug_scripts {
            println!(
                "    {} [{}] ran={}{}",
                script.item_id,
                script.script,
                script.ran,
                script
                    .detail
                    .as_deref()
                    .map(|d| format!(" — {d}"))
                    .unwrap_or_default()
            );
            for verdict in &script.verdicts {
                println!(
                    "      verdict {}: {}",
                    verdict.id,
                    if verdict.pass { "pass" } else { "fail" },
                );
                for assertion in &verdict.assertions {
                    println!(
                        "        [{}] {}",
                        if assertion.pass { "pass" } else { "fail" },
                        assertion.label,
                    );
                }
            }
            for output in &script.outputs {
                println!(
                    "      output {}: actual={}",
                    output.id, output.actual_present
                );
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

    // The verdict, last and on its own line, so an operator scrolled to the bottom of
    // a long pass and a CI log tail both read the same sentence. The faults are
    // repeated here in full rather than left to the body above: the body is the
    // evidence, and this is the finding.
    let faults = faults(&summary, test_case.test_type);
    if faults.is_empty() {
        println!("\nvalidation passed");
        return Ok(ExitCode::SUCCESS);
    }
    eprintln!("\nvalidation failed: {}", faults.join("; "));
    Ok(ExitCode::FAILURE)
}

/// Every reason this validation pass is a failure, phrased for the summary line, or
/// an empty vector when the tree satisfied everything the case declares.
///
/// The criteria are read off the fields that carry a pass/fail signal, and each one
/// is a fault the *tree* earned rather than a fact about the host or the case:
///
/// - [`loaded`](ValidationSummary::loaded) is false. The build did not build, serve
///   and render, which is the clearest negative signal validation produces.
/// - A required build step failed or was never reached, for a `test_type` whose
///   validation runs them at all. Only the [build
///   validator](test_cabinet_core::DispatchValidator) reports the install/build pair;
///   an adversarial or asset-generation case compiles or regenerates through its own
///   path and records both steps as `None`, so demanding them there would fail every
///   such pass.
/// - A declared check that could not be reached. The similarity a reached check
///   records is deliberately not a criterion: a
///   [`Check`](test_cabinet_core::test_case::Check) declares no threshold to compare it
///   against, so any cutoff here would be one this command invented.
/// - A declared proof-of-implementation artifact that is missing. A missing proof
///   never changes a *run's* recorded status, but this command answers a different
///   question — whether the tree in hand carries everything the case asked for — and a
///   proof the case declared and the tree does not have is exactly that gap.
/// - Any verdict a gating debug script decided against the build. This mirrors
///   [`automated_verdicts`](test_cabinet_core::comparison::automated_verdicts), the
///   scoring rule the run itself is graded by.
/// - A gating debug script that did not run, whatever the reason. Here the exit code
///   deliberately parts from the score. Scoring skips a script recorded
///   [inconclusive](test_cabinet_core::DebugScriptResult::precondition_unmet) because
///   it said nothing about the build, and a run must not lose points to a busy host
///   or a missing validator project. This command is not scoring a build: it is
///   answering whether the tree in hand satisfied everything the case declares, and a
///   unit that decided nothing has not been satisfied. Passing it would be an
///   all-clear issued by a broken environment — a produced tree with no vitest binary
///   once left every unit of a case inconclusive, and the command reported it as a
///   pass. The two are named apart so a host problem is not read as a build problem:
///   a contract failure is listed by verdict id, and an inconclusive unit is grouped
///   with the others of its [kind](Inconclusive) and reason (see
///   [`inconclusive_fault`]). Only a script whose backing point an erratum excluded
///   from scoring ([`gates`](test_cabinet_core::DebugScriptResult::gates) is false)
///   costs nothing, inconclusive or not.
/// - An adversarial match the submission forfeited. A forfeit is the submission
///   failing to present a playable controller — it did not build, exported no contract
///   entry, trapped, exhausted its fuel, or returned an invalid action — so it is a
///   contract failure wearing a match result's clothes. A loss or a draw is the real
///   thing: the submission played and was beaten, which validation has no business
///   calling a fault.
fn faults(summary: &ValidationSummary, test_type: TestType) -> Vec<String> {
    let mut faults = Vec::new();

    if !summary.loaded {
        let detail = summary.detail.as_deref().unwrap_or("no detail recorded");
        faults.push(format!("the implementation did not load ({detail})"));
    }

    if reports_build_steps(test_type) {
        faults.extend(step_fault("install", summary.install.as_ref()));
        faults.extend(step_fault("build", summary.build.as_ref()));
    }

    let unreached = named(
        summary
            .checks
            .iter()
            .filter(|c| !c.reached)
            .map(|c| &c.view),
    );
    if let Some(list) = unreached {
        faults.push(format!("declared check(s) not reached: {list}"));
    }

    let missing = named(summary.proofs.iter().filter(|p| !p.present).map(|p| &p.id));
    if let Some(list) = missing {
        faults.push(format!("declared proof(s) missing: {list}"));
    }

    // One pass over the scripts, classifying each exactly once, so a script that did
    // not run is not also counted through the failing verdict its contract failure
    // synthesizes. Inconclusive units are gathered by kind and reason rather than
    // listed, because the runner-failure case that produces them is every suite of a
    // case sharing one reason, and the reason is the finding. The key orders kinds as
    // `inconclusive_kind` ranks them and reasons alphabetically within a kind, so the
    // lines come out in a stable order.
    let mut not_run: Vec<String> = Vec::new();
    let mut inconclusive: BTreeMap<(usize, &'static str, String), Vec<String>> = BTreeMap::new();
    let mut failed: Vec<String> = Vec::new();
    for script in &summary.debug_scripts {
        if !script.gates {
            continue;
        }
        if !script.ran {
            if script.precondition_unmet {
                let (rank, label) = inconclusive_kind(script.inconclusive);
                let reason = script
                    .detail
                    .clone()
                    .unwrap_or_else(|| "no detail recorded".to_string());
                inconclusive
                    .entry((rank, label, reason))
                    .or_default()
                    .push(verdict_id(script));
            } else {
                not_run.push(verdict_id(script));
            }
            continue;
        }
        failed.extend(
            script
                .verdicts
                .iter()
                .filter(|verdict| !verdict.pass)
                .map(|verdict| verdict.id.clone()),
        );
    }
    if let Some(list) = named(not_run.iter()) {
        faults.push(format!("validator(s) did not run: {list}"));
    }
    for ((_, label, reason), ids) in &inconclusive {
        faults.push(inconclusive_fault(label, reason, ids));
    }
    if let Some(list) = named(failed.iter()) {
        faults.push(format!("{} verdict(s) failed: {list}", failed.len()));
    }

    if summary
        .adversarial
        .as_ref()
        .is_some_and(|match_| match_.outcome == AdversarialOutcome::Forfeit)
    {
        faults.push("the submission forfeited its adversarial match".to_string());
    }

    faults
}

/// Whether a case of this type has its dependency install and static build reported
/// as their own steps.
///
/// Only the end-to-end shapes build a servable tree through the manifest's `[build]`
/// pair; every other type reaches its output another way and records both steps as
/// `None`, which is an absence rather than a failure to reach them.
fn reports_build_steps(test_type: TestType) -> bool {
    matches!(
        test_type,
        TestType::EndToEnd | TestType::FullStack | TestType::GameJam
    )
}

/// The fault a required build step contributes: it ran and failed, or it was never
/// reached at all. `None` when the step succeeded.
fn step_fault(label: &str, step: Option<&StepResult>) -> Option<String> {
    match step {
        Some(step) if step.succeeded => None,
        Some(step) => Some(format!("the {label} step failed (`{}`)", step.command)),
        None => Some(format!("the {label} step was never reached")),
    }
}

/// The most verdict ids one inconclusive fault line names before it gives only their
/// count. The case the grouping exists for — every suite of a case left undecided by
/// one missing binary or one stopped run — is hundreds of units with one reason, and
/// a line that repeated every id would bury the reason that matters and that the
/// operator has to fix. Eight names every unit of a small case outright and still
/// reads on one line; past it, the ids are in the per-script body above the verdict.
const INCONCLUSIVE_IDS_LISTED: usize = 8;

/// The rank an inconclusive kind sorts under in the fault list and the label the fault
/// line quotes for it. The [`Inconclusive`] kinds that describe the environment — a
/// suite that could not be run, a run the host stopped — rank ahead of the check's own
/// decision that its precondition went unmet, so a host or tree problem is read
/// first, and a record from before the kinds were told apart (`None`) ranks last.
fn inconclusive_kind(kind: Option<Inconclusive>) -> (usize, &'static str) {
    match kind {
        Some(Inconclusive::NotRun) => (0, "not run"),
        Some(Inconclusive::TimedOut) => (1, "timed out"),
        Some(Inconclusive::PreconditionUnmet) => (2, "precondition unmet"),
        None => (3, "unknown kind"),
    }
}

/// The fault one group of inconclusive units contributes: how many, which kind (by
/// the `label` from [`inconclusive_kind`]), the one reason they share, and — when
/// there are no more than [`INCONCLUSIVE_IDS_LISTED`] of them — the verdict ids
/// themselves.
fn inconclusive_fault(label: &str, reason: &str, ids: &[String]) -> String {
    let count = ids.len();
    if count <= INCONCLUSIVE_IDS_LISTED {
        format!(
            "{count} validator(s) inconclusive ({label}): {} — {reason}",
            ids.join(", ")
        )
    } else {
        format!("{count} validator(s) inconclusive ({label}): {reason}")
    }
}

/// The verdict id a script backs — `<item>.<sub-item>` for a per-sub-item driver, or
/// the bare item id when the whole item is validated. This is the id the reviewer's
/// checklist, the run's score and this command's summary line all name the point by.
fn verdict_id(script: &DebugScriptResult) -> String {
    match &script.sub_item_id {
        Some(sub) => format!("{}.{sub}", script.item_id),
        None => script.item_id.clone(),
    }
}

/// Join names into the comma-separated list a fault quotes, or `None` when there are
/// none — which is what lets a caller decide there is no fault to report at all.
fn named<'a>(names: impl Iterator<Item = &'a String>) -> Option<String> {
    let joined = names.cloned().collect::<Vec<_>>().join(", ");
    (!joined.is_empty()).then_some(joined)
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

#[cfg(test)]
#[path = "validate.test.rs"]
mod tests;
