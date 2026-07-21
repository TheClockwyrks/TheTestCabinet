//! The **asset-generation** half of `tcab publish-reference`.
//!
//! An end-to-end or full-stack reference implementation is a static site: it is
//! built with the case's `[build]` commands, deployed to Cloudflare Pages, and
//! addressed by a URL that has to be read back out of `wrangler` and committed to
//! a lockfile (Cloudflare truncates long subdomains, so the served host is not
//! constructible up front).
//!
//! An asset reference works differently on every one of those points, which is
//! why it lives in its own module:
//!
//! - **There is nothing to build.** The case declares no `[build]` table. The
//!   reference is a `draw.sh` of drawing-binary calls, run against a workspace
//!   seeded from the manifest (see [`test_cabinet_core::asset_reference`]).
//! - **The artifact is data, not a page.** Frames and action logs are objects, so
//!   they go to the public snapshot bucket the site already reads, and the UI
//!   renders them natively instead of embedding an iframe.
//! - **There is no lockfile.** Object keys are deterministic
//!   ([`reference_prefix`]), so the backend discovers published references by
//!   listing the prefix rather than ingesting a committed URL — nothing has to be
//!   committed to record where a reference went. It performs that listing at
//!   ingest, so a publish still ends with the same `reingest-cluster.sh` step the
//!   Pages path ends with; what it skips is the commit-and-push in between.
//!
//! Because the images are regenerated from the committed script rather than
//! committed themselves, republishing after editing a script is the whole update
//! path: run this command again and the objects are overwritten in place.

use anyhow::{Context, Result, bail};
use test_cabinet_core::{
    SystemCommandRunner, TestCaseVersion, Variant,
    asset_reference::{
        ASSET_REFERENCE_SCRIPT, build_asset_reference, reference_actions_key, reference_image_key,
        reference_prefix,
    },
    r2::{R2Client, R2Config},
};

use crate::cli::PublishReferenceArgs;

/// Publish every targeted variant's asset reference to the object store.
///
/// Each variant is built and uploaded in turn; one variant's failure is reported
/// and counted but does not abort the rest, matching the Pages path's behaviour so
/// a multi-variant sweep still makes progress.
pub(super) async fn execute(
    test_case: &TestCaseVersion,
    targets: &[&Variant],
    args: &PublishReferenceArgs,
) -> Result<()> {
    if args.dry_run {
        println!("\n--dry-run: nothing was built or uploaded.");
        for variant in targets {
            let dir = variant
                .reference_impl
                .as_ref()
                .expect("targets are pre-filtered to variants with a reference_impl");
            println!("  {}", variant.slug);
            println!("    script: {}", dir.join(ASSET_REFERENCE_SCRIPT).display());
            println!(
                "    keys:   {}/frames/…",
                reference_prefix(&test_case.slug, &test_case.version, &variant.slug)
            );
        }
        return Ok(());
    }

    // The bucket comes from the ordinary `TCAB_R2_*` environment — the same one
    // the backend writes the snapshot with. `--env` selects which deployment is
    // being published to, so the operator supplies that environment's credentials;
    // the bucket is echoed below so a publish into the wrong one is visible
    // immediately rather than after the site fails to show the reference.
    let config = R2Config::from_env().context(
        "publishing an asset-generation reference needs the R2 credentials for the target \
         environment (TCAB_R2_ACCOUNT_ID, TCAB_R2_BUCKET, TCAB_R2_ACCESS_KEY_ID, \
         TCAB_R2_SECRET_ACCESS_KEY)",
    )?;
    println!(
        "  uploading to bucket `{}` (env `{}`)",
        config.bucket,
        args.env.as_str()
    );
    let client = R2Client::new(config);
    let runner = SystemCommandRunner;

    let mut published = 0usize;
    let mut failures = 0usize;
    for variant in targets {
        match publish_one(&runner, &client, test_case, variant).await {
            Ok(frames) => {
                println!("  {} — published {frames} frame(s)", variant.slug);
                published += 1;
            }
            Err(err) => {
                eprintln!("  {} — failed: {err:#}", variant.slug);
                failures += 1;
            }
        }
    }

    if published > 0 {
        let env = args.env.as_str();
        println!("\npublished {published} asset reference(s).");
        // Unlike the Pages path there is no lockfile to commit: the keys are
        // deterministic, so the backend learns what exists by listing the prefix
        // rather than by ingesting a recorded URL. It does that listing at ingest,
        // so a publish still needs the same re-ingest step the Pages path ends with.
        println!("next: have the backend rediscover them from its own listing:");
        println!("  scripts/reingest-cluster.sh --env {env}");
    }

    if failures > 0 {
        bail!(
            "{failures} of {} asset reference(s) failed to publish",
            targets.len()
        );
    }
    Ok(())
}

/// Build one variant's reference sheet and upload every frame's image and action
/// log, returning the number of frames published.
///
/// The build happens in a temporary workspace that is discarded afterwards: the
/// produced bytes are derived from the committed script, so keeping them would
/// only invite them being edited by hand and drifting from it.
async fn publish_one(
    runner: &SystemCommandRunner,
    client: &R2Client,
    test_case: &TestCaseVersion,
    variant: &Variant,
) -> Result<usize> {
    let workspace = tempfile::tempdir().context("creating a temporary reference workspace")?;

    println!("  {} — drawing", variant.slug);
    let build = build_asset_reference(runner, test_case, variant, workspace.path())
        .await
        .with_context(|| format!("building the reference for variant `{}`", variant.slug))?;

    for frame in &build.frames {
        // The image and the log are uploaded as a pair. The log is what the case
        // actually scores a run on, so publishing the picture without it would show
        // a reference that cannot be checked the way a submission is.
        for (path, key, content_type) in [
            (
                &frame.image,
                reference_image_key(
                    &test_case.slug,
                    &test_case.version,
                    &variant.slug,
                    frame.index,
                ),
                "image/png",
            ),
            (
                &frame.actions,
                reference_actions_key(
                    &test_case.slug,
                    &test_case.version,
                    &variant.slug,
                    frame.index,
                ),
                "application/json",
            ),
        ] {
            let bytes =
                std::fs::read(path).with_context(|| format!("reading {}", path.display()))?;
            client
                .put_object(&key, bytes, content_type)
                .await
                .with_context(|| format!("uploading {key}"))?;
        }
    }

    Ok(build.frames.len())
}
