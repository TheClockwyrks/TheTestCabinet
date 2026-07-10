//! `tcab publish-reference` — build and deploy a test-case variant's **reference
//! implementation**, then record its URL on the backend.
//!
//! A reference implementation is the authored, in-repo, *correct* static build of
//! a test-case variant — the case-variant analogue of a published run's
//! `run.links.playableBuild`. Unlike a run's build it is **never seeded** into a
//! run (the model must not see the answer); it is authored under the version
//! folder, declared by the variant manifest's optional `reference_implementation`
//! key (resolved onto [`Variant::reference_impl`]), built with the case's own
//! `[build]` commands, and hosted out-of-band. This command is that out-of-band
//! hosting step, mirroring the run publisher (`crates/core/src/publish.rs`):
//!
//! 1. Resolve the case at the requested version (newest when omitted) from the
//!    local catalog and select the targeted variants.
//! 2. For each targeted variant that declares a `reference_impl`, run the case's
//!    `[build]` *install* then *build* commands **from the reference-impl
//!    directory** (not a seeded run repo), so the static site lands in the same
//!    `dist/`|`build/`|`out/` a run's build uses ([`find_build_output`]).
//! 3. Deploy that static output to the `test-cabinet-references` Cloudflare Pages
//!    project under a per-variant branch alias, scrubbing any leaked secret from
//!    the built tree first and reading the served URL back out of `wrangler`'s
//!    output — never constructing it — via the shared [`deploy_pages_build`].
//! 4. `PUT` the deployed URL to the backend's authenticated reference-build
//!    endpoint, which upserts the `case_reference_build` row the site's Reference
//!    tab reads from.
//!
//! Deploying and recording require `wrangler` (with `CLOUDFLARE_API_TOKEN`),
//! `TCAB_BACKEND_URL`, and a logged-in account (`tcab login`) — the same
//! environment the run publisher needs. `--dry-run` resolves and prints the plan
//! without any of them.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use test_cabinet_core::{
    CommandRunner, HttpBackendClient, SystemCommandRunner, TestCaseCatalog, TestCaseVersion,
    Variant, deploy_pages_build, find_build_output,
};

use crate::cli::PublishReferenceArgs;
use crate::config;

/// The Cloudflare Pages project every reference implementation deploys to. Each
/// targeted variant is deployed under its own branch alias (see
/// [`deploy_branch`]); the served URL is read back from `wrangler`, never
/// constructed, exactly as the run publisher does for its per-run project.
const REFERENCES_PAGES_PROJECT: &str = "test-cabinet-references";

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

    println!(
        "tcab publish-reference: {}@{} -> {} ({} variant(s))",
        test_case.slug,
        test_case.version,
        REFERENCES_PAGES_PROJECT,
        targets.len(),
    );

    if args.dry_run {
        println!("\n--dry-run: nothing was built, deployed, or recorded.");
        for variant in &targets {
            let dir = variant
                .reference_impl
                .as_ref()
                .expect("targets are pre-filtered to variants with a reference_impl");
            println!("  {} ", variant.slug);
            println!("    reference: {}", dir.display());
            println!(
                "    branch:    {}",
                deploy_branch(&test_case.slug, &test_case.version, &variant.slug)
            );
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

    let client = backend_client()?;
    let runner = SystemCommandRunner;

    // Publish each targeted variant in turn. One variant's failure is reported and
    // counted but does not abort the rest, so a multi-variant sweep still makes
    // progress; the command exits non-zero if any failed.
    let mut failures = 0usize;
    for variant in &targets {
        if let Err(err) = publish_one(
            &client,
            &runner,
            &test_case,
            variant,
            &build.install,
            &build.build,
        )
        .await
        {
            eprintln!("  {} — failed: {err:#}", variant.slug);
            failures += 1;
        }
    }
    if failures > 0 {
        bail!(
            "{failures} of {} reference implementation(s) failed to publish",
            targets.len()
        );
    }
    Ok(())
}

/// Build, deploy, and record the reference implementation for a single variant.
///
/// The install + build commands run **from the variant's reference-impl
/// directory**, so a project that declares a lockfile-pinned install (`npm ci`)
/// and a static build (`npm run build`) produces its `dist/`|`build/`|`out/`
/// exactly where [`find_build_output`] looks. The deploy + URL read-back + secret
/// scrub are the shared [`deploy_pages_build`]; the resulting URL is recorded
/// against `(slug, version, variant)` on the backend.
async fn publish_one(
    client: &HttpBackendClient,
    runner: &SystemCommandRunner,
    test_case: &TestCaseVersion,
    variant: &Variant,
    install: &str,
    build: &str,
) -> Result<()> {
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

    // Deploy to Cloudflare Pages under this variant's branch alias and read the
    // served URL back from wrangler (Cloudflare truncates long subdomains, so the
    // literal host is not constructible up front).
    let branch = deploy_branch(&test_case.slug, &test_case.version, &variant.slug);
    println!("  {} — deploying (branch {branch})", variant.slug);
    let url = deploy_pages_build(runner, &out, REFERENCES_PAGES_PROJECT, &branch)
        .await
        .with_context(|| {
            format!(
                "deploying the reference build for variant `{}`",
                variant.slug
            )
        })?;

    // Record the deployed URL on the backend (authenticated), where it surfaces on
    // the variant's `referenceBuild` field for the site's Reference tab.
    client
        .put_reference_build(&test_case.slug, &test_case.version, &variant.slug, &url)
        .await
        .with_context(|| {
            format!(
                "recording the reference build URL for variant `{}` on the backend",
                variant.slug
            )
        })?;

    println!("  {} — published", variant.slug);
    println!("    reference build: {url}");
    Ok(())
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

/// Build an [`HttpBackendClient`] for the configured backend, carrying the stored
/// login token. Errors clearly when the backend URL or login is missing — mirrors
/// `commands::publish::backend_client`.
fn backend_client() -> Result<HttpBackendClient> {
    let backend = config::backend_url().context(
        "TCAB_BACKEND_URL is not set; set it to the backend's address (for example \
         http://127.0.0.1:8787)",
    )?;
    let token = config::require_token()?;
    Ok(HttpBackendClient::new(backend).with_token(Some(token)))
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
