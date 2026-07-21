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
//!    `dist/`|`build/`|`out/` a run's build uses. Then synthesize the variant's
//!    committed **baseline** validation media from that build — driving the case's
//!    debug scripts against the reference implementation once and writing each
//!    output under `<version>/validation-baseline/<variant>/`. The baseline is a
//!    fixed property of the case version, so a run's validation only ever produces
//!    the *actual* media and never re-drives the reference implementation. Pass
//!    `--skip-baselines` when the committed media is already current to deploy
//!    without re-capturing it; to capture the media *without* deploying (the
//!    common authoring loop, needing no Cloudflare credentials) use the dedicated
//!    [`tcab capture-baselines`](super::capture_baselines) command instead.
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

use anyhow::{Context, Result, bail};
use test_cabinet_core::{
    SystemCommandRunner, TestCaseCatalog, TestCaseVersion, Variant, deploy_pages_build,
    reference_lock::{REFERENCE_LOCK_FILENAME, ReferenceLock},
};

use super::capture_baselines::{
    baseline_dir, build_reference, capture_variant_baseline, catalog_root, reference_dir,
    resolve_version, select_targets,
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
        println!(
            "    would record under env `{}` in {}",
            args.env.as_str(),
            lock_path.display()
        );
        for variant in &targets {
            println!("  {} ", variant.slug);
            println!("    reference: {}", reference_dir(variant).display());
            if args.skip_baselines {
                println!("    baseline:  (skipped: --skip-baselines)");
            } else {
                println!(
                    "    baseline:  {}",
                    baseline_dir(&test_case, &variant.slug).display()
                );
            }
            println!(
                "    branch:    {}",
                deploy_branch(&test_case.slug, &test_case.version, &variant.slug)
            );
        }
        return Ok(());
    }

    // The build commands come from the case's `[build]` table — the same install +
    // build a run's validator uses. A case without one (an asset-generation case,
    // say) cannot have a buildable reference implementation, so this is a hard error.
    let build = test_case.build.as_ref().context(
        "this case declares no [build] table, so its reference implementation cannot be built \
         (only end-to-end and full-stack cases have buildable references)",
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
            args.skip_baselines,
        )
        .await
        {
            Ok(url) => deployed.push((variant.slug.clone(), url)),
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

/// Build a single variant's reference implementation, refresh its committed
/// **baseline** validation media (unless `skip_baselines`), and deploy the build to
/// Cloudflare Pages — returning the served URL to record in the lockfile.
///
/// The build is the shared [`build_reference`], so this command and
/// `capture-baselines` produce their static output the same way; the baseline
/// capture is the shared [`capture_variant_baseline`], driven from that same built
/// output *before* the deploy so a failed capture never leaves a deployed build
/// paired with stale media. The deploy + URL read-back + secret scrub are the
/// shared [`deploy_pages_build`].
async fn publish_one(
    runner: &SystemCommandRunner,
    test_case: &TestCaseVersion,
    variant: &Variant,
    project: &str,
    install: &str,
    build: &str,
    skip_baselines: bool,
) -> Result<String> {
    let out = build_reference(runner, variant, install, build).await?;

    // Refresh the committed baseline validation media from the built reference
    // implementation — the *baseline* side of each debug script's proof media, a
    // fixed property of the case version, so a run's validation never re-drives the
    // reference implementation. `--skip-baselines` is the operator asserting the
    // committed media is already current for this build.
    if skip_baselines {
        println!(
            "  {} — skipping baseline capture (--skip-baselines)",
            variant.slug
        );
    } else {
        capture_variant_baseline(test_case, variant, &out)?;
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
    Ok(url)
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

#[cfg(test)]
#[path = "publish_reference.test.rs"]
mod tests;
