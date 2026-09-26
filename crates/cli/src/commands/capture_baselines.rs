//! `tcab capture-baselines` — (re)generate a test-case version's committed
//! **baseline** validation media from its reference implementation(s).
//!
//! A case that declares [instrumentation] pairs each scripted review item with a
//! debug script. Per run, validation drives that script against the *model's*
//! build to capture the **actual** media; the **baseline** half of the reviewer's
//! side-by-side is the same script driven against the case's authored
//! **reference implementation**. Because the reference implementation is a fixed
//! property of the case version, its media is captured once, committed to the
//! cold-storage submodule under the version's mirrored
//! `validation-baseline/<engine>/<variant>/`, and served case-scoped — a run never
//! re-drives it.
//!
//! This command is that capture step, and nothing else:
//!
//! 1. Resolve the case at the requested version (newest when omitted) from the
//!    local catalog and select the targeted variants.
//! 2. For each targeted variant that declares a `reference_impl`, run the case's
//!    `[build]` *install* then *build* commands from the reference-impl directory,
//!    then drive every scripted review item against that build and write each
//!    declared output under the version's baseline directory in cold storage
//!    ([`ColdStorage::validation_baseline_dir`]), in `<engine>/<variant>/`.
//!
//! How each output is produced follows the case: a case shipping a validator
//! project for the engine has its baseline recorded by running THOSE suites against
//! the reference implementation, exactly as a run's own media is recorded by running
//! them against the model's build; a case shipping none has its reference build
//! served and driven in a browser. Either way the two panes a reviewer compares come
//! from the same scenario driven the same way.
//!
//! It needs only a browser and the case's own toolchain — no Cloudflare
//! credentials, no `--env`, no backend. Deploying the reference implementation
//! itself is the separate [`publish_reference`](super::publish_reference)
//! command, which performs this same capture as part of its build unless told to
//! `--skip-baselines`.
//!
//! [instrumentation]: https://docs.testcabinet.ai/testing/end-to-end/instrumentation/

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use test_cabinet_core::{
    COLD_STORAGE_DIR_ENV, ColdStorage, SystemCommandRunner, TestCaseCatalog, TestCaseVersion,
    Variant, capture_baseline_media, find_build_output,
};

use crate::cli::CaptureBaselinesArgs;

/// `tcab capture-baselines` — build the targeted variants' reference
/// implementations and (re)write their committed baseline validation media.
pub async fn execute(args: CaptureBaselinesArgs) -> Result<()> {
    let catalog = TestCaseCatalog::new(catalog_root());
    let cold = ColdStorage::for_catalog(catalog.root());
    let version = resolve_version(&catalog, &args.slug, args.version.as_deref())?;
    let test_case = catalog
        .resolve(&args.slug, &version)
        .with_context(|| format!("resolving {}@{}", args.slug, version))?;

    let targets = select_targets(
        &test_case,
        args.variant.as_deref(),
        args.engine.as_deref(),
        args.all_variants,
    )?;

    println!(
        "tcab capture-baselines: {}@{} ({} reference build(s))",
        test_case.slug,
        test_case.version,
        targets.len(),
    );

    if args.dry_run {
        println!("\n--dry-run: nothing was built or written.");
        for target in &targets {
            println!("  {} ", target.label());
            println!("    reference: {}", target.dir.display());
            println!(
                "    baseline:  {}",
                baseline_dir(&cold, &test_case, target.engine, &target.variant.slug)?.display()
            );
        }
        return Ok(());
    }

    ensure_cold_storage(&cold)?;
    let build = test_case
        .build
        .as_ref()
        .context("this case declares no [build] table")?;

    let runner = SystemCommandRunner;

    // One target's failure is reported and counted but does not abort the rest, so a
    // multi-target sweep still makes progress and the operator sees every fault in one
    // pass rather than one per re-run. The command exits non-zero if any failed. This
    // mirrors `publish-reference`, which shares these helpers.
    let mut failed: Vec<String> = Vec::new();
    for target in &targets {
        let result = async {
            let out = build_reference(&runner, *target, &build.install, &build.build).await?;
            capture_variant_baseline(&cold, &test_case, *target, &out)
        }
        .await;
        if let Err(err) = result {
            eprintln!("  {} — failed: {err:#}", target.label());
            failed.push(target.label());
        }
    }

    if let Some(summary) = sweep_summary(&failed, targets.len()) {
        bail!(summary);
    }
    Ok(())
}

/// The one-line verdict a finished sweep reports, or `None` when every target
/// captured cleanly.
///
/// The line names the targets rather than only counting them, because the per-target
/// detail is scattered through a log that is mostly install and build output. A CI
/// step's tail, or an operator glancing at the last line, has to be enough to know
/// which reference build to go and look at.
fn sweep_summary(failed: &[String], total: usize) -> Option<String> {
    (!failed.is_empty()).then(|| {
        format!(
            "{} of {total} reference build(s) failed to capture: {}",
            failed.len(),
            failed.join(", "),
        )
    })
}

/// Capture one variant's baseline media from its built reference implementation at
/// `out`, report what was written, and fail if any unit did not run clean against it.
/// Shared with `publish-reference`, which does this same capture inline before
/// deploying.
///
/// The reference implementation is the case's own answer, so a unit that could not be
/// driven clean against it is a fault in the case or its validators, not a result. It
/// is reported per unit and then failed as a whole, which is what keeps the two
/// commands honest about the same thing: `capture-baselines` counts this target as
/// failed and carries on with the rest of the sweep, and `publish-reference` skips
/// deploying a build whose baseline media it could not produce, rather than serving a
/// reviewer a side-by-side with half of it missing.
pub(super) fn capture_variant_baseline(
    cold: &ColdStorage,
    test_case: &TestCaseVersion,
    target: Target<'_>,
    out: &Path,
) -> Result<()> {
    let capture = generate_baseline(cold, test_case, target, out)?;
    if capture.written > 0 {
        println!(
            "  {} — wrote {} baseline media file(s) to {}",
            target.label(),
            capture.written,
            baseline_dir(cold, test_case, target.engine, &target.variant.slug)?.display()
        );
    } else {
        println!("  {} — nothing to capture", target.label());
    }
    if let Some(unclean) = capture_fault(&capture.unclean) {
        bail!(unclean);
    }
    Ok(())
}

/// What one target's baseline capture produced: how much media it wrote, and which of
/// its units the reference implementation did not answer clean.
///
/// The two travel together because neither alone is the outcome. A capture that wrote
/// every file it was asked for and left one unit unanswered is a failed capture with
/// output, and the operator needs the count to know what landed on disk and the ids to
/// know what to go and fix.
struct BaselineCapture {
    /// How many media files were written across every unit.
    written: usize,
    /// The review item ids whose script or suite did not run clean against the
    /// reference implementation, in the order the capture reported them.
    unclean: Vec<String>,
}

/// The fault a capture's unclean units amount to, or `None` when every unit ran clean.
///
/// `BaselineUnit::ran` is the only pass/fail signal a capture carries, and it means
/// "the script or suite executed to completion against a conformant build" — the
/// handle was installed, every call returned, and every declared output was produced.
/// It is deliberately not a verdict: a baseline decides nothing, because the reference
/// implementation is the answer rather than a submission, so the capture drops the
/// verdicts and assertions the same drive would carry on a run. `ran == false` is
/// therefore exactly the criterion available here, and exactly the right one — the
/// reference implementation failing its own case's debug-API contract is the fault
/// worth refusing.
fn capture_fault(unclean: &[String]) -> Option<String> {
    (!unclean.is_empty()).then(|| {
        format!(
            "{} baseline unit(s) did not run clean against the reference implementation: {}",
            unclean.len(),
            unclean.join(", "),
        )
    })
}

/// One thing to publish or capture: a variant's reference implementation **on one
/// engine**.
///
/// A variant's reference implementations are keyed by engine, because the build a
/// reference demonstrates genuinely differs under each — an engineless one carries
/// its own runtime, an engine-backed one hands the same surfaces to the engine it is
/// built on. So the unit both commands work in is the pair, not the variant: a case
/// supporting two engines has two reference builds per variant, each built and
/// deployed on its own, and the case's Reference tab lets a reader switch between
/// them.
#[derive(Debug, Clone, Copy)]
pub(super) struct Target<'a> {
    /// The variant this build implements.
    pub(super) variant: &'a Variant,
    /// The engine slug it is the answer for.
    pub(super) engine: &'a str,
    /// The buildable directory, inside the version folder.
    pub(super) dir: &'a Path,
}

impl Target<'_> {
    /// How a target is named in this command's output: `<variant>@<engine>`, which
    /// is the identity the lockfile, the deploy alias, and the reviewer's engine
    /// switch all agree on.
    pub(super) fn label(&self) -> String {
        format!("{}@{}", self.variant.slug, self.engine)
    }
}

/// Run the case's own install then build from the variant's reference-impl
/// directory and return the static output directory that produced.
///
/// The commands run from the reference-impl directory (not a seeded run repo), so a
/// project that declares a lockfile-pinned install (`npm ci`) and a static build
/// (`npm run build`) lands its `dist/`|`build/`|`out/` exactly where
/// [`find_build_output`] looks — the same contract a run's playable build follows.
pub(super) async fn build_reference(
    runner: &SystemCommandRunner,
    target: Target<'_>,
    install: &str,
    build: &str,
) -> Result<PathBuf> {
    let dir = target.dir;
    println!("  {} — building ({})", target.label(), dir.display());

    // Install runs first; if it fails the build never runs.
    run_build_step(runner, dir, install)
        .await
        .with_context(|| format!("installing dependencies for `{}`", target.label()))?;
    run_build_step(runner, dir, build)
        .await
        .with_context(|| format!("building `{}`", target.label()))?;

    find_build_output(dir).with_context(|| {
        format!(
            "the reference build for `{}` produced no dist/build/out directory in {}",
            target.label(),
            dir.display()
        )
    })
}

/// The cold-storage path one reference build's committed baseline validation media
/// lives under: the version's [`ColdStorage::validation_baseline_dir`] joined with
/// `<engine>/<variant>/`. Ingest copies it into the stored version, and the backend
/// serves it case-scoped from there.
///
/// Keyed by engine as well as variant because a variant has one reference
/// implementation per engine and the two are different builds: their captures are
/// not interchangeable, and a single directory would have each sweep overwrite the
/// last.
pub(super) fn baseline_dir(
    cold: &ColdStorage,
    test_case: &TestCaseVersion,
    engine: &str,
    variant: &str,
) -> Result<PathBuf> {
    let dir = cold
        .validation_baseline_dir(&test_case.root)
        .with_context(|| {
            format!(
                "{} is not inside the checkout that holds cold storage at {}",
                test_case.root.display(),
                cold.root().display()
            )
        })?;
    Ok(dir.join(engine).join(variant))
}

/// Refuse to capture into a cold-storage root that is not there to receive it.
///
/// The default root is the `cold-storage` submodule, and a checkout that never
/// initialized it still has the empty directory git leaves for it. Media written
/// there lands in no repository and is lost on the next submodule update, so the
/// default root must be a checked-out repository. A root named by
/// `TCAB_COLD_STORAGE_DIR` needs only to exist.
pub(super) fn ensure_cold_storage(cold: &ColdStorage) -> Result<()> {
    let root = cold.root();
    let overridden = std::env::var_os(COLD_STORAGE_DIR_ENV).is_some_and(|v| !v.is_empty());
    if !root.is_dir() {
        bail!(
            "cold storage {} does not exist; check out the submodule with \
             `git submodule update --init --depth 1 cold-storage`, or point \
             {COLD_STORAGE_DIR_ENV} at a directory",
            root.display()
        );
    }
    if !overridden && !root.join(".git").exists() {
        bail!(
            "the cold-storage submodule at {} is not checked out; run \
             `git submodule update --init --depth 1 cold-storage`, or point \
             {COLD_STORAGE_DIR_ENV} at a directory",
            root.display()
        );
    }
    Ok(())
}

/// Synthesize this target's committed baseline validation media from its built
/// reference implementation at `out`, replacing any prior contents of its
/// `validation-baseline/<engine>/<variant>/` directory. Returns what was written and
/// which units did not run clean.
///
/// A case that declares no instrumentation, or a variant with no scripted review
/// items, has no baseline to produce (writes nothing, reports nothing unclean). A case
/// that *does* declare scripted units but whose reference implementation could not be
/// driven at all — no browser on the host, or a validator project the runner could not
/// execute — is an error, because a silently missing baseline leaves every reviewer of
/// every run on this case with no expected-behavior media to compare against.
///
/// Every unit is driven before anything is decided, so one unclean unit does not hide
/// the ones behind it: the whole capture is attempted, each fault is printed as it
/// happens, and the caller fails the target once with all of them named.
fn generate_baseline(
    cold: &ColdStorage,
    test_case: &TestCaseVersion,
    target: Target<'_>,
    out: &Path,
) -> Result<BaselineCapture> {
    let variant = target.variant;
    let baseline_dir = baseline_dir(cold, test_case, target.engine, &variant.slug)?;
    // Start clean so a renamed or removed output never lingers as a stale committed
    // file (the directory is regenerated wholesale, matching the reference build).
    if baseline_dir.exists() {
        std::fs::remove_dir_all(&baseline_dir)
            .with_context(|| format!("clearing {}", baseline_dir.display()))?;
    }

    match capture_baseline_media(
        test_case,
        variant,
        target.engine,
        target.dir,
        out,
        &baseline_dir,
    ) {
        Some(units) => {
            // A reference implementation is supposed to be conformant, so a script that
            // did not run clean against it is a fault in the case: named here as it is
            // found, so the operator reads every one of them, and collected for the
            // caller to fail the target on once the whole capture has been attempted.
            let mut unclean = Vec::new();
            for unit in &units {
                if !unit.ran {
                    eprintln!(
                        "    baseline capture for `{}` did not run clean{}",
                        unit.item_id,
                        unit.detail
                            .as_deref()
                            .map(|d| format!(": {d}"))
                            .unwrap_or_default()
                    );
                    unclean.push(unit.item_id.clone());
                }
            }
            // Every unit failing to run is a fact about the host or the case rather
            // than about the reference implementation — a browser that is not there, a
            // validator project that would not execute — and it is the shape a broken
            // capture takes on the project path, where the runner reports per unit
            // instead of declining wholesale. Say so in its own words rather than
            // leaving the caller to report a per-unit fault for each, for the same
            // reason the `None` arm below refuses its own version of it.
            if !units.is_empty() && units.len() == unclean.len() {
                bail!(
                    "no validator ran against the reference implementation for `{}`",
                    target.label()
                );
            }
            Ok(BaselineCapture {
                written: units.iter().map(|unit| unit.outputs_present).sum(),
                unclean,
            })
        }
        // `None` is either "nothing to do" (no instrumentation / no scripted units)
        // or "could not drive" (the browser path with no browser). Distinguish: the
        // former is fine, the latter would leave the committed baseline incomplete,
        // so it is an error.
        None => {
            let has_units = test_case.instrumentation.is_some()
                && test_case
                    .review_items_for_engine(variant, target.engine)
                    .iter()
                    .any(|item| {
                        item.validation.is_some()
                            || item.sub_items.iter().any(|sub| sub.validation.is_some())
                    });
            if has_units {
                bail!(
                    "driving the reference implementation for `{}` needs a browser",
                    target.label()
                );
            }
            Ok(BaselineCapture {
                written: 0,
                unclean: Vec::new(),
            })
        }
    }
}

/// Run one build command string (`sh -c <command>`) from `dir` through the shared
/// [`CommandRunner`](test_cabinet_core::CommandRunner) seam, surfacing a failing
/// command's output as an error.
///
/// Build commands are authored as shell strings (`npm ci && npm run build`), so
/// they run under `sh -c` exactly as the validator's build steps do — but routed
/// through the same [`SystemCommandRunner`] the wrangler deploy uses, so the whole
/// command keeps a single execution seam.
async fn run_build_step(runner: &SystemCommandRunner, dir: &Path, command: &str) -> Result<()> {
    use test_cabinet_core::CommandRunner;

    let output = runner
        .run("sh", &["-c", command], Some(dir))
        .await
        .with_context(|| format!("running `{command}`"))?;
    if !output.success {
        let stderr = output.stderr.trim();
        let stdout = output.stdout.trim();
        let detail = match (stderr.is_empty(), stdout.is_empty()) {
            (true, true) => "(no output captured)".to_string(),
            (false, true) => stderr.to_string(),
            (true, false) => stdout.to_string(),
            (false, false) => format!("{stderr}\n{stdout}"),
        };
        bail!("`{command}` failed: {detail}");
    }
    Ok(())
}

/// Resolve the version to target: the explicit `<version>` when given, else the
/// case's newest version. Errors clearly when the case has no versions at all.
pub(super) fn resolve_version(
    catalog: &TestCaseCatalog,
    slug: &str,
    requested: Option<&str>,
) -> Result<String> {
    if let Some(version) = requested {
        return Ok(version.to_string());
    }
    let versions = catalog
        .versions(slug)
        .with_context(|| format!("listing versions for {slug}"))?;
    versions.into_iter().next().with_context(|| {
        format!("test case `{slug}` has no versions; pass an explicit <version> to target one")
    })
}

/// Select the variants to target and validate the selection.
///
/// - `--variant X`: exactly `X`, which must exist and declare a reference
///   implementation (an explicit target with none is an error the operator wants
///   surfaced, not silently skipped).
/// - `--all-variants` or the default: every variant that declares a reference
///   implementation. Empty is an error — there is nothing to do.
///
/// The two selectors are mutually exclusive at the clap layer, so at most one is
/// set here.
pub(super) fn select_targets<'a>(
    test_case: &'a TestCaseVersion,
    variant: Option<&str>,
    engine: Option<&str>,
    _all_variants: bool,
) -> Result<Vec<Target<'a>>> {
    // The variants in play: the one named, or every variant of the case. A named
    // variant with no reference implementation at all is an explicit error, because
    // the operator asked for something that does not exist.
    let variants: Vec<&Variant> = match variant {
        Some(slug) => {
            let selected = test_case
                .variant(slug)
                .with_context(|| format!("selecting variant `{slug}`"))?;
            if selected.reference_impls.is_empty() {
                bail!(
                    "variant `{slug}` of {}@{} declares no `reference_implementation`",
                    test_case.slug,
                    test_case.version
                );
            }
            vec![selected]
        }
        None => test_case.variants.iter().collect(),
    };

    // Each variant contributes one target per engine it declares a reference for,
    // narrowed by `--engine` when one is named. An engine the case does not support
    // is a typo worth refusing by name rather than resolving to an empty sweep.
    if let Some(engine) = engine
        && !test_case.supports_engine(engine)
    {
        bail!(
            "{}@{} does not support engine `{engine}` (supported: {})",
            test_case.slug,
            test_case.version,
            test_case.engine_slugs().join(", ")
        );
    }
    let mut targets = Vec::new();
    for selected in variants {
        for slug in test_case.engine_slugs() {
            if engine.is_some_and(|wanted| wanted != slug) {
                continue;
            }
            if let Some(dir) = test_case.reference_impl_for(selected, &slug) {
                targets.push(Target {
                    variant: selected,
                    // Borrowed from the variant's own key so the target outlives this
                    // loop's copy of the slug.
                    engine: selected
                        .reference_impls
                        .get_key_value(&slug)
                        .map(|(key, _)| key.as_str())
                        .unwrap_or_default(),
                    dir,
                });
            }
        }
    }
    if targets.is_empty() {
        match engine {
            Some(engine) => bail!(
                "no variant of {}@{} declares a `reference_implementation` for engine \
                 `{engine}`",
                test_case.slug,
                test_case.version
            ),
            None => bail!(
                "no variant of {}@{} declares a `reference_implementation`",
                test_case.slug,
                test_case.version
            ),
        }
    }
    Ok(targets)
}

/// Locate the test case catalog root (see `tcab run`/`tcab seed`).
pub(super) fn catalog_root() -> PathBuf {
    std::env::var_os("TCAB_TEST_CASES_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("test-cases"))
}

#[cfg(test)]
#[path = "capture_baselines.test.rs"]
mod tests;
