//! `tcab publish-asset-reference` — publish an **asset-generation** case's reference.
//!
//! This is also the path `tcab publish-reference` takes when the case it is pointed
//! at is an asset-generation case, so either command publishes the same objects.
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
//!   seeded from the manifest (see [`test_cabinet_driver::asset_reference`]).
//! - **The artifact is data, not a page.** Frames and action logs are objects, so
//!   they go to the public bucket the site already reads, and the UI renders them
//!   natively instead of embedding an iframe. The CLI holds no bucket credential:
//!   each object is written through the environment's artifacts service
//!   (`PUT <origin>/artifacts/public/{key}`), crossing the edge with the Access
//!   service token (`TCAB_ACCESS_CLIENT_ID` and `TCAB_ACCESS_CLIENT_SECRET`). See
//!   <https://docs.testcabinet.ai/components/cli/overview/#reference-implementations-and-baselines>.
//! - **There is no lockfile.** Object keys are deterministic
//!   ([`reference_prefix`]), so the backend discovers published references by
//!   listing the prefix rather than ingesting a committed URL — nothing has to be
//!   committed to record where a reference went. It performs that listing at
//!   ingest, so a publish still ends with the same `tcab ingest --env` step the
//!   Pages path ends with; what it skips is the commit-and-push in between.
//!
//! Because the images are regenerated from the committed script rather than
//! committed themselves, republishing after editing a script is the whole update
//! path: run this command again and the objects are overwritten in place.

use anyhow::{Context, Result, anyhow, bail};
use reqwest::header::{CONTENT_TYPE, HeaderMap, HeaderValue, LOCATION};
use test_cabinet_backend_client::AccessCredential;
use test_cabinet_driver::{
    SystemCommandRunner, TestCaseVersion, TestType, Variant,
    asset_reference::{
        ASSET_REFERENCE_SCRIPT, build_asset_reference, reference_actions_key, reference_image_key,
        reference_prefix,
    },
};

use super::capture_baselines::{Target, resolve_version, select_targets};
use crate::cli::{DeployEnv, PublishAssetReferenceArgs};
use crate::config::{ACCESS_CLIENT_ID, ACCESS_CLIENT_SECRET, Credentials};

/// `tcab publish-asset-reference` — draw and upload the reference of an
/// asset-generation case's targeted variant(s).
///
/// The case is resolved the way `tcab publish-reference` resolves it, at the
/// requested version or its newest, from the local catalog. A case of any other
/// test type is refused before anything is drawn: its reference is a static site,
/// which `tcab publish-reference` builds and deploys.
pub async fn execute(args: PublishAssetReferenceArgs) -> Result<()> {
    let catalog = crate::catalog::catalog();
    let version = resolve_version(&catalog, &args.slug, args.version.as_deref())?;
    let test_case = catalog
        .resolve(&args.slug, &version)
        .with_context(|| format!("resolving {}@{}", args.slug, version))?;
    require_asset_generation(&test_case.slug, &test_case.version, test_case.test_type)?;

    // An asset reference is drawn once per variant, whatever engines the case
    // supports, so no engine narrows the selection.
    let targets = select_targets(&test_case, args.variant.as_deref(), None, args.all_variants)?;
    println!(
        "tcab publish-asset-reference: {}@{} -> object store ({} reference build(s))",
        test_case.slug,
        test_case.version,
        targets.len(),
    );
    publish(&test_case, &targets, args.env, false).await
}

/// Refuse a case that is not an asset-generation case, naming the command that
/// publishes its reference instead.
fn require_asset_generation(slug: &str, version: &str, test_type: TestType) -> Result<()> {
    if test_type != TestType::AssetGeneration {
        bail!(
            "{slug}@{version} is not an asset-generation case; its reference implementation \
             is a static site, published with `tcab publish-reference`"
        );
    }
    Ok(())
}

/// Publish every targeted variant's asset reference to the object store through
/// `env`'s artifacts service, or with `dry_run` print what would be drawn and
/// where it would land.
///
/// Each variant is built and uploaded in turn; one variant's failure is reported
/// and counted but does not abort the rest, matching the Pages path's behaviour so
/// a multi-variant sweep still makes progress.
pub(super) async fn publish(
    test_case: &TestCaseVersion,
    targets: &[Target<'_>],
    env: DeployEnv,
    dry_run: bool,
) -> Result<()> {
    if dry_run {
        println!("\n--dry-run: nothing was built or uploaded.");
        for target in targets {
            println!("  {}", target.label());
            println!(
                "    script: {}",
                target.dir.join(ASSET_REFERENCE_SCRIPT).display()
            );
            println!(
                "    keys:   {}/frames/…",
                reference_prefix(&test_case.slug, &test_case.version, &target.variant.slug)
            );
        }
        return Ok(());
    }

    // The objects are written through the environment's artifacts service at its
    // edge, which a person's assertion may not write the public dataset through:
    // only the Access service token is presented. The target is echoed so a publish
    // into the wrong environment is visible before anything is drawn.
    let credential = service_credential(&Credentials::from_env()?)?;
    let uploader = PublicWriter::new(artifacts_url(env), credential);
    println!(
        "  uploading through `{}` (env `{}`)",
        uploader.base,
        env.as_str()
    );
    let runner = SystemCommandRunner;

    let mut published = 0usize;
    let mut failures = 0usize;
    for target in targets {
        let variant = target.variant;
        match publish_one(&runner, &uploader, test_case, variant).await {
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
        let env = env.as_str();
        println!("\npublished {published} asset reference(s).");
        // Unlike the Pages path there is no lockfile to commit: the keys are
        // deterministic, so the backend learns what exists by listing the prefix
        // rather than by ingesting a recorded URL. It does that listing at ingest,
        // so a publish still needs the same re-ingest step the Pages path ends with.
        println!("next: have the backend rediscover them from its own listing:");
        println!("  tcab ingest --env {env}");
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
    uploader: &PublicWriter,
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
            uploader
                .put(&key, bytes, content_type)
                .await
                .with_context(|| format!("uploading {key}"))?;
        }
    }

    Ok(build.frames.len())
}

/// The artifacts service's base URL at `env`'s edge: the origin's `/artifacts`
/// path.
fn artifacts_url(env: DeployEnv) -> String {
    format!("{}/artifacts", env.origin())
}

/// The Access service token a write of the public dataset presents, or an error
/// naming its two variables when the pair is not set.
fn service_credential(credentials: &Credentials) -> Result<AccessCredential> {
    credentials.access_service_token().ok_or_else(|| {
        anyhow!(
            "publishing an asset reference writes the public dataset through the \
             environment's edge, which takes the Access service token: set \
             {ACCESS_CLIENT_ID} and {ACCESS_CLIENT_SECRET} (the Key Vault secrets \
             `cloudflare-access-client-id` and `cloudflare-access-client-secret`)"
        )
    })
}

/// A writer of single public-dataset objects through the artifacts service's
/// `PUT /public/{key}`, presenting one Access credential on every request.
struct PublicWriter {
    /// The artifacts service's base URL, with no trailing slash.
    base: String,
    /// The credential every write presents.
    credential: AccessCredential,
    /// An HTTP client that does not follow redirects, so the edge's redirect to
    /// its sign-in page is reported as a refusal rather than followed into HTML.
    http: reqwest::Client,
}

impl PublicWriter {
    fn new(base: impl Into<String>, credential: AccessCredential) -> Self {
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("the HTTP client builds with the default TLS configuration");
        Self {
            base: base.into().trim_end_matches('/').to_string(),
            credential,
            http,
        }
    }

    /// The URL `key` is written at: `<base>/public/<key>`, each of the key's
    /// segments percent-encoded on its own so the service reads back the key as
    /// given.
    fn url(&self, key: &str) -> Result<reqwest::Url> {
        let mut url = reqwest::Url::parse(&self.base)
            .with_context(|| format!("the artifacts URL `{}` does not parse", self.base))?;
        url.path_segments_mut()
            .map_err(|()| anyhow!("the artifacts URL `{}` cannot carry a path", self.base))?
            .pop_if_empty()
            .push("public")
            .extend(key.split('/'));
        Ok(url)
    }

    /// Write `bytes` at `key`, labelled `content_type`, whole.
    async fn put(&self, key: &str, bytes: Vec<u8>, content_type: &'static str) -> Result<()> {
        let url = self.url(key)?;
        let mut headers = HeaderMap::new();
        self.credential.apply(&mut headers);
        headers.insert(CONTENT_TYPE, HeaderValue::from_static(content_type));
        let response = self
            .http
            .put(url.clone())
            .headers(headers)
            .body(bytes)
            .send()
            .await
            .with_context(|| format!("sending the write to `{url}`"))?;
        refusal(&url, response).await
    }
}

/// `Ok` for a successful write, or an error saying who refused it and why: the
/// edge (a redirect to its sign-in page, or a `401`/`403` of its own) or the
/// artifacts service (its error envelope's message).
async fn refusal(url: &reqwest::Url, response: reqwest::Response) -> Result<()> {
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    if status.is_redirection() {
        let location = response
            .headers()
            .get(LOCATION)
            .and_then(|value| value.to_str().ok())
            .map(|location| location.split(['?', '#']).next().unwrap_or(location))
            .map(|target| format!("`{target}`"))
            .unwrap_or_else(|| "an unnamed location".to_string());
        bail!(
            "the write to `{url}` was refused by the edge ({status}, redirected to \
             {location}): the request carried no Access credential the edge accepts"
        );
    }
    let body = response.text().await.unwrap_or_default();
    match serde_json::from_str::<ErrorEnvelope>(&body) {
        Ok(envelope) => bail!(
            "the artifacts service refused the write to `{url}` ({status}): {}",
            envelope.error.message
        ),
        Err(_) if matches!(status.as_u16(), 401 | 403) => bail!(
            "the write to `{url}` was refused by the edge ({status}): the request carried \
             no Access credential the edge accepts, or one its policy does not admit"
        ),
        Err(_) => bail!("the write to `{url}` failed ({status}): {}", body.trim()),
    }
}

/// The artifacts service's error envelope, `{ "error": { "code", "message" } }`.
#[derive(serde::Deserialize)]
struct ErrorEnvelope {
    error: ErrorBody,
}

/// The body of [`ErrorEnvelope`].
#[derive(serde::Deserialize)]
struct ErrorBody {
    message: String,
}

#[cfg(test)]
#[path = "publish_asset_reference.test.rs"]
mod tests;
