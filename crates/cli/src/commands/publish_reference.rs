//! `tcab publish-reference` — build and deploy a test-case variant's **reference
//! implementation**, then record its URL in the committed reference-builds lockfile.
//!
//! A reference implementation is the authored, in-repo, *correct* static build of
//! a test-case variant — the case-variant analogue of a published run's
//! `run.links.playableBuild`. Unlike a run's build it is **never seeded** into a
//! run (the model must not see the answer); it is authored under the version
//! folder, declared by the variant manifest's optional `reference_implementation`
//! key (resolved onto [`Variant::reference_impl`]), built with the case's own
//! `[build]` commands, and hosted out-of-band. This command is that out-of-band
//! hosting step:
//!
//! 1. Resolve the case at the requested version (newest when omitted) from the
//!    local catalog and select the targeted variants.
//! 2. For each targeted variant that declares a `reference_impl`, run the case's
//!    `[build]` *install* then *build* commands **from the reference-impl
//!    directory** (not a seeded run repo), so the static site lands in the same
//!    `dist/`|`build/`|`out/` a run's build uses ([`find_build_output`]). Then
//!    synthesize the variant's committed **baseline** validation media from that
//!    build — driving the case's debug scripts against the reference implementation
//!    once and writing each output under `<version>/validation-baseline/<variant>/`
//!    (see [`capture_baseline_media`]). The baseline is a fixed property of the case
//!    version, so a run's validation only ever produces the *actual* media and never
//!    re-drives the reference implementation. `--baselines-only` stops here (no
//!    Cloudflare credentials needed); otherwise the deploy follows.
//! 3. Deploy that static output to the reference Cloudflare Pages project for the
//!    required `--env` (prod's `test-cabinet-references` or staging's
//!    `test-cabinet-references-staging`) under a per-variant branch alias,
//!    scrubbing any leaked secret from the built tree first and reading the served
//!    URL back out of `wrangler`'s output — never constructing it — via the shared
//!    [`deploy_pages_build`].
//! 4. Record each deployed URL in the committed reference-builds lockfile
//!    (`test-cases/reference-builds.lock.json`), under the `--env` key. This is the
//!    **pull** model: the backend is private (VPN-only) and cannot be pushed to, so
//!    it ingests this file from its own git checkout instead — commit the lockfile,
//!    push, and run `scripts/reingest-cluster.sh --env <env>` to have the backend
//!    reconcile its `case_reference_build` table (the site's Reference tab source).
//!
//! Building and deploying require `wrangler` (with `CLOUDFLARE_API_TOKEN`). This
//! command never talks to the backend — it only writes the lockfile — so it needs
//! no backend URL or login. `--dry-run` resolves and prints the plan without
//! building, deploying, or writing anything.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use test_cabinet_core::{
    CommandRunner, SystemCommandRunner, TestCaseCatalog, TestCaseVersion, VALIDATION_BASELINE_DIR,
    Variant, capture_baseline_media, deploy_pages_build, find_build_output,
    reference_lock::{REFERENCE_LOCK_FILENAME, ReferenceLock},
};

use crate::cli::{DeployEnv, PublishReferenceArgs};

/// The production Cloudflare Pages project reference implementations deploy to.
/// Each targeted variant is deployed under its own branch alias (see
/// [`deploy_branch`]); the served URL is read back from `wrangler`, never
/// constructed, exactly as the run publisher does for its per-run project.
const REFERENCES_PAGES_PROJECT_PROD: &str = "test-cabinet-references";

/// The staging Cloudflare Pages project, the pre-release mirror of prod. Selected
/// by `--env staging` so a reference can be vetted on staging before it lands in
/// front of the public gallery.
const REFERENCES_PAGES_PROJECT_STAGING: &str = "test-cabinet-references-staging";

/// The Cloudflare Pages project for a deployment environment. The environment is a
/// required flag (see [`DeployEnv`]) so a publish can never silently target prod.
fn references_pages_project(env: DeployEnv) -> &'static str {
    match env {
        DeployEnv::Prod => REFERENCES_PAGES_PROJECT_PROD,
        DeployEnv::Staging => REFERENCES_PAGES_PROJECT_STAGING,
    }
}

/// `tcab publish-reference` — build, deploy, and record the reference
/// implementation(s) for a case's targeted variant(s).
pub async fn execute(args: PublishReferenceArgs) -> Result<()> {
    // Resolve the case at the requested version — or its newest version when the
    // positional `<version>` is omitted — from the local catalog.
    let catalog = TestCaseCatalog::new(catalog_root());
    let version = resolve_version(&catalog, &args.slug, args.version.as_deref())?;
    let test_case = catalog
        .resolve(&args.slug, &version)
        .with_context(|| format!("resolving {}@{}", args.slug, version))?;

    // Select the targeted variants and keep only those that actually declare a
    // reference implementation. A `--variant` naming one that has no reference is
    // an explicit error; `--all-variants`/the default over a case with none is
    // likewise an error (there is nothing to publish).
    let targets = select_targets(&test_case, args.variant.as_deref(), args.all_variants)?;

    // The required `--env` selects the Pages project; there is no default, so a
    // publish can never silently land in prod.
    let project = references_pages_project(args.env);

    println!(
        "tcab publish-reference: {}@{} -> {} ({} variant(s))",
        test_case.slug,
        test_case.version,
        project,
        targets.len(),
    );

    let lock_path = catalog_root().join(REFERENCE_LOCK_FILENAME);

    if args.dry_run {
        println!("\n--dry-run: nothing was built, deployed, or recorded.");
        if !args.baselines_only {
            println!(
                "    would record under env `{}` in {}",
                args.env.as_str(),
                lock_path.display()
            );
        }
        for variant in &targets {
            let dir = variant
                .reference_impl
                .as_ref()
                .expect("targets are pre-filtered to variants with a reference_impl");
            println!("  {} ", variant.slug);
            println!("    reference: {}", dir.display());
            println!(
                "    baseline:  {}",
                baseline_dir(&test_case, &variant.slug).display()
            );
            if !args.baselines_only {
                println!(
                    "    branch:    {}",
                    deploy_branch(&test_case.slug, &test_case.version, &variant.slug)
                );
            }
        }
        return Ok(());
    }

    // The build commands come from the case's `[build]` table — the same install +
    // build a run's validator uses. A case without one (any non-end-to-end type)
    // cannot have a buildable reference implementation, so this is a hard error.
    let build = test_case.build.as_ref().context(
        "this case declares no [build] table, so its reference implementation cannot be built \
         (only end-to-end cases have buildable references)",
    )?;

    let runner = SystemCommandRunner;

    // Deploy each targeted variant in turn, collecting the `(variant, served URL)` of
    // each success. One variant's failure is reported and counted but does not abort
    // the rest, so a multi-variant sweep still makes progress; the command exits
    // non-zero if any failed.
    let mut deployed: Vec<(String, String)> = Vec::new();
    let mut failures = 0usize;
    for variant in &targets {
        match publish_one(
            &runner,
            &test_case,
            variant,
            project,
            &build.install,
            &build.build,
            args.baselines_only,
        )
        .await
        {
            // A deploy records its served URL; a baselines-only run records nothing.
            Ok(Some(url)) => deployed.push((variant.slug.clone(), url)),
            Ok(None) => {}
            Err(err) => {
                eprintln!("  {} — failed: {err:#}", variant.slug);
                failures += 1;
            }
        }
    }

    // Record every successful deploy into the committed reference-builds lockfile —
    // the pull-model source of truth the backend ingests. Written once, after the
    // deploys, so a partial sweep still records what it managed to deploy. Existing
    // entries (other envs, cases, or versions) are preserved.
    if !deployed.is_empty() {
        let env = args.env.as_str();
        let mut lock = ReferenceLock::load(&lock_path)
            .with_context(|| format!("reading {}", lock_path.display()))?
            .unwrap_or_default();
        for (variant, url) in &deployed {
            lock.set(env, &test_case.slug, &test_case.version, variant, url);
        }
        lock.save(&lock_path)
            .with_context(|| format!("writing {}", lock_path.display()))?;

        println!(
            "\nwrote {} ({} variant(s) under env `{env}`)",
            lock_path.display(),
            deployed.len(),
        );
        println!("next: commit it, push, then refresh the backend from its own checkout:");
        println!("  scripts/reingest-cluster.sh --env {env}");
    }

    if failures > 0 {
        bail!(
            "{failures} of {} reference implementation(s) failed to publish",
            targets.len()
        );
    }
    Ok(())
}

/// Build a single variant's reference implementation, synthesize its committed
/// **baseline** validation media, and (unless `baselines_only`) deploy the build to
/// Cloudflare Pages — returning the served URL to record in the lockfile, or `None`
/// on the baselines-only path (nothing is deployed or recorded).
///
/// The install + build commands run **from the variant's reference-impl
/// directory**, so a project that declares a lockfile-pinned install (`npm ci`)
/// and a static build (`npm run build`) produces its `dist/`|`build/`|`out/`
/// exactly where [`find_build_output`] looks. The baseline media is driven from that
/// same built output before any deploy, so it is generated even on the
/// `--baselines-only` path (no Cloudflare credentials needed). The deploy + URL
/// read-back + secret scrub are the shared [`deploy_pages_build`].
async fn publish_one(
    runner: &SystemCommandRunner,
    test_case: &TestCaseVersion,
    variant: &Variant,
    project: &str,
    install: &str,
    build: &str,
    baselines_only: bool,
) -> Result<Option<String>> {
    let dir = variant
        .reference_impl
        .as_ref()
        .expect("targets are pre-filtered to variants with a reference_impl");
    println!("  {} — building ({})", variant.slug, dir.display());

    // The case's own install then build, run from the reference-impl directory
    // through the same command seam the wrangler deploy uses. Install runs first;
    // if it fails the build never runs.
    run_build_step(runner, dir, install)
        .await
        .with_context(|| format!("installing dependencies for variant `{}`", variant.slug))?;
    run_build_step(runner, dir, build)
        .await
        .with_context(|| format!("building variant `{}`", variant.slug))?;

    // Locate the produced static output (dist/build/out), the same contract a
    // run's playable build follows.
    let out = find_build_output(dir).with_context(|| {
        format!(
            "the reference build for variant `{}` produced no dist/build/out directory in {}",
            variant.slug,
            dir.display()
        )
    })?;

    // Synthesize the committed baseline validation media from the built reference
    // implementation. This is the ingest-time home of the *baseline* side of each
    // debug script's proof media — a fixed property of the case version — so a run's
    // validation never re-drives the reference implementation.
    let written = generate_baseline(test_case, variant, &out)?;
    if written > 0 {
        println!(
            "  {} — wrote {written} baseline media file(s) to {}",
            variant.slug,
            baseline_dir(test_case, &variant.slug).display()
        );
    }

    if baselines_only {
        return Ok(None);
    }

    // Deploy to Cloudflare Pages under this variant's branch alias and read the
    // served URL back from wrangler (Cloudflare truncates long subdomains, so the
    // literal host is not constructible up front).
    let branch = deploy_branch(&test_case.slug, &test_case.version, &variant.slug);
    println!("  {} — deploying (branch {branch})", variant.slug);
    let url = deploy_pages_build(runner, &out, project, &branch)
        .await
        .with_context(|| {
            format!(
                "deploying the reference build for variant `{}`",
                variant.slug
            )
        })?;

    println!("  {} — deployed", variant.slug);
    println!("    reference build: {url}");
    Ok(Some(url))
}

/// The version-folder path a variant's committed baseline validation media lives
/// under: `<version>/validation-baseline/<variant>/`. Case-scoped and committed (the
/// same static-media precedent a `[[reference]] media = …` follows), served
/// case-scoped by the backend.
fn baseline_dir(test_case: &TestCaseVersion, variant: &str) -> PathBuf {
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
            // abort the publish (the operator sees exactly which item is at fault).
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
            let has_scripts = test_case.instrumentation.is_some()
                && test_case
                    .review_items_for(variant)
                    .iter()
                    .any(|item| item.validation.is_some());
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
/// [`CommandRunner`] seam, surfacing a failing command's output as an error.
///
/// Build commands are authored as shell strings (`npm ci && npm run build`), so
/// they run under `sh -c` exactly as the validator's build steps do — but routed
/// through the same [`SystemCommandRunner`] the wrangler deploy uses, so the whole
/// command keeps a single execution seam.
async fn run_build_step(runner: &SystemCommandRunner, dir: &Path, command: &str) -> Result<()> {
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

/// Resolve the version to publish for: the explicit `<version>` when given, else
/// the case's newest version. Errors clearly when the case has no versions at all.
fn resolve_version(
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

/// Select the variants to publish and validate the selection.
///
/// - `--variant X`: exactly `X`, which must exist and declare a reference
///   implementation (an explicit target with none is an error the operator wants
///   surfaced, not silently skipped).
/// - `--all-variants` or the default: every variant that declares a reference
///   implementation. Empty is an error — there is nothing to publish.
///
/// The two selectors are mutually exclusive at the clap layer, so at most one is
/// set here.
fn select_targets<'a>(
    test_case: &'a TestCaseVersion,
    variant: Option<&str>,
    _all_variants: bool,
) -> Result<Vec<&'a Variant>> {
    if let Some(slug) = variant {
        let selected = test_case
            .variant(slug)
            .with_context(|| format!("selecting variant `{slug}`"))?;
        if selected.reference_impl.is_none() {
            bail!(
                "variant `{slug}` of {}@{} declares no `reference_implementation`",
                test_case.slug,
                test_case.version
            );
        }
        return Ok(vec![selected]);
    }

    let targets: Vec<&Variant> = test_case
        .variants
        .iter()
        .filter(|v| v.reference_impl.is_some())
        .collect();
    if targets.is_empty() {
        bail!(
            "no variant of {}@{} declares a `reference_implementation`; nothing to publish",
            test_case.slug,
            test_case.version
        );
    }
    Ok(targets)
}

/// The Cloudflare Pages branch alias a variant's reference build deploys under:
/// `<slug>-<version-with-dots-as-dashes>-<variant>` (for example,
/// `carom-v1-0-1-base`).
///
/// Dots are replaced with dashes because a Pages branch alias becomes a DNS
/// subdomain label, where dots would split it into multiple labels. The alias is
/// only how the deploy is *addressed*; the served URL is always read back from
/// wrangler's output rather than derived from this string (Cloudflare
/// sanitizes/truncates long aliases).
fn deploy_branch(slug: &str, version: &str, variant: &str) -> String {
    let version = version.replace('.', "-");
    format!("{slug}-{version}-{variant}")
}

/// Locate the test case catalog root (see `tcab run`/`tcab seed`).
fn catalog_root() -> PathBuf {
    std::env::var_os("TCAB_TEST_CASES_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("test-cases"))
}

#[cfg(test)]
#[path = "publish_reference.test.rs"]
mod tests;
