//! `tcab capture-baselines` — (re)generate a test-case version's committed
//! **baseline** validation media from its reference implementation(s).
//!
//! A case that declares [instrumentation] pairs each scripted review item with a
//! debug script. Per run, validation drives that script against the *model's*
//! build to capture the **actual** media; the **baseline** half of the reviewer's
//! side-by-side is the same script driven against the case's authored
//! **reference implementation**. Because the reference implementation is a fixed
//! property of the case version, its media is captured once, committed under
//! `<version>/validation-baseline/<variant>/`, and served case-scoped — a run
//! never re-drives it.
//!
//! This command is that capture step, and nothing else:
//!
//! 1. Resolve the case at the requested version (newest when omitted) from the
//!    local catalog and select the targeted variants.
//! 2. For each targeted variant that declares a `reference_impl`, run the case's
//!    `[build]` *install* then *build* commands from the reference-impl directory,
//!    then drive every scripted review item against that build and write each
//!    declared output under `<version>/validation-baseline/<variant>/`.
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
    SystemCommandRunner, TestCaseCatalog, TestCaseVersion, VALIDATION_BASELINE_DIR, Variant,
    capture_baseline_media, find_build_output,
};

use crate::cli::CaptureBaselinesArgs;

/// `tcab capture-baselines` — build the targeted variants' reference
/// implementations and (re)write their committed baseline validation media.
pub async fn execute(args: CaptureBaselinesArgs) -> Result<()> {
    let catalog = TestCaseCatalog::new(catalog_root());
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
                baseline_dir(&test_case, &target.variant.slug).display()
            );
        }
        return Ok(());
    }

    let build = test_case.build.as_ref().context(
        "this case declares no [build] table, so its reference implementation cannot be built \
         (only end-to-end cases have buildable references)",
    )?;

    let runner = SystemCommandRunner;

    // One variant's failure is reported and counted but does not abort the rest, so
    // a multi-variant sweep still makes progress; the command exits non-zero if any
    // failed. This mirrors `publish-reference`, which shares these helpers.
    let mut failures = 0usize;
    for target in &targets {
        let result = async {
            let out = build_reference(&runner, *target, &build.install, &build.build).await?;
            capture_variant_baseline(&test_case, *target, &out)
        }
        .await;
        if let Err(err) = result {
            eprintln!("  {} — failed: {err:#}", target.label());
            failures += 1;
        }
    }

    if failures > 0 {
        bail!(
            "{failures} of {} reference build(s) failed to capture",
            targets.len()
        );
    }
    Ok(())
}

/// Capture one variant's baseline media from its built reference implementation at
/// `out` and report what was written. Shared with `publish-reference`, which does
/// this same capture inline before deploying.
pub(super) fn capture_variant_baseline(
    test_case: &TestCaseVersion,
    target: Target<'_>,
    out: &Path,
) -> Result<()> {
    let written = generate_baseline(test_case, target.variant, out)?;
    if written > 0 {
        println!(
            "  {} — wrote {written} baseline media file(s) to {}",
            target.label(),
            baseline_dir(test_case, &target.variant.slug).display()
        );
    } else {
        println!("  {} — nothing to capture", target.label());
    }
    Ok(())
}

/// One thing to publish or capture: a variant's reference implementation **on one
/// engine**.
///
/// A variant's reference implementations are keyed by engine, because the build a
/// reference demonstrates genuinely differs under each — an engineless one carries
/// its own runtime, an engine-backed one hands the same surfaces to the runtime it
/// vendors. So the unit both commands work in is the pair, not the variant: a case
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

/// The version-folder path a variant's committed baseline validation media lives
/// under: `<version>/validation-baseline/<variant>/`. Case-scoped and committed (the
/// same static-media precedent a `[[reference]] media = …` follows), served
/// case-scoped by the backend.
pub(super) fn baseline_dir(test_case: &TestCaseVersion, variant: &str) -> PathBuf {
    test_case.root.join(VALIDATION_BASELINE_DIR).join(variant)
}

/// Synthesize the variant's committed baseline validation media from its built
/// reference implementation at `out`, replacing any prior contents of its
/// `validation-baseline/<variant>/` directory. Returns the number of media files
/// written.
///
/// A case that declares no instrumentation, or a variant with no scripted review
/// items, has no baseline to produce (writes nothing, returns 0). A case that *does*
/// declare scripted items but whose reference implementation could not be driven (no
/// browser on the host) is an error — a silently missing baseline would leave the
/// reviewer with no expected-behavior media — surfaced so the operator installs a
/// browser and retries.
fn generate_baseline(test_case: &TestCaseVersion, variant: &Variant, out: &Path) -> Result<usize> {
    let baseline_dir = baseline_dir(test_case, &variant.slug);
    // Start clean so a renamed or removed output never lingers as a stale committed
    // file (the directory is regenerated wholesale, matching the reference build).
    if baseline_dir.exists() {
        std::fs::remove_dir_all(&baseline_dir)
            .with_context(|| format!("clearing {}", baseline_dir.display()))?;
    }

    match capture_baseline_media(test_case, variant, out, &baseline_dir) {
        Some(drives) => {
            // A reference implementation is supposed to be conformant, so a script
            // that did not run clean against it is worth surfacing — but it does not
            // abort the capture (the operator sees exactly which item is at fault).
            for drive in &drives {
                if !drive.ran {
                    eprintln!(
                        "    warning: baseline script for `{}` did not run clean{}",
                        drive.item_id,
                        drive
                            .detail
                            .as_deref()
                            .map(|d| format!(": {d}"))
                            .unwrap_or_default()
                    );
                }
            }
            Ok(drives
                .iter()
                .flat_map(|drive| &drive.outputs)
                .filter(|output| output.present)
                .count())
        }
        // `None` is either "nothing to do" (no instrumentation / no scripted items)
        // or "could not drive" (no browser). Distinguish: the former is fine, the
        // latter would leave the committed baseline incomplete, so it is an error.
        None => {
            // A validator declared PER ENGINE names a suite inside a vitest project
            // rather than a script a browser drives, and such a suite captures no
            // media at all — so a case whose points are all decided that way has no
            // baseline to produce and this is "nothing to do", not a failure. A case
            // with a browser script that could not be driven is the failure.
            let has_scripts = test_case.instrumentation.is_some()
                && test_case
                    .review_items_for(variant)
                    .iter()
                    .flat_map(|item| {
                        item.validation.iter().chain(
                            item.sub_items
                                .iter()
                                .filter_map(|sub| sub.validation.as_ref()),
                        )
                    })
                    .any(|validation| validation.script.is_some());
            if has_scripts {
                bail!(
                    "could not drive the reference implementation for variant `{}` to \
                     synthesize its baseline media (is a browser available?)",
                    variant.slug
                );
            }
            Ok(0)
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
                 `{engine}`; nothing to do",
                test_case.slug,
                test_case.version
            ),
            None => bail!(
                "no variant of {}@{} declares a `reference_implementation`; nothing to do",
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
