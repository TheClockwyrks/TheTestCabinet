//! The Cloudflare Pages side of an idempotent playable-build deploy.
//!
//! See `components/backend/results.md`, "Repeating a step": the Pages deploy makes
//! one deployment per run. The publisher deploys with the digest of the scrubbed
//! build as the deployment's commit hash, and first looks up the run's branch for
//! a deployment carrying that digest; a deployment it finds is reused and its URL
//! reported. This module holds the two halves of that rule: [`build_digest`], the
//! digest of a build directory, and [`PagesApi::find_deployment`], the lookup over
//! the Cloudflare API.
//!
//! The lookup reads the project's preview deployments
//! (`GET /accounts/{account}/pages/projects/{project}/deployments?env=preview`).
//! The API has no branch filter and serves at most 25 deployments a page, newest
//! first, so the lookup pages through them until it finds a match or runs out.

use std::path::Path;
use std::time::Duration;

use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};

/// The Cloudflare API every deployment's lookup goes to.
pub const DEFAULT_CLOUDFLARE_API_BASE: &str = "https://api.cloudflare.com/client/v4";

/// The largest page the deployments listing serves (a larger `per_page` is
/// refused).
const DEPLOYMENTS_PER_PAGE: u32 = 25;

/// How long one request of the lookup may take before it fails.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// The digest of a build directory: the lowercase hex SHA-256 of every entry
/// under `dir`, in the byte order of their relative paths.
///
/// Each regular file contributes its relative path, a NUL, its length as a
/// little-endian `u64` and its contents; each symbolic link contributes its
/// relative path, a NUL and its target, under a distinct tag so a link and a file
/// never collide. Directories contribute only through what they hold, and links
/// are not followed. The digest is therefore a function of the tree's paths and
/// contents alone: the same tree hashes the same in any directory, at any time,
/// and any changed byte or path changes it. It is taken after the build is
/// scrubbed, so it digests exactly what is deployed.
pub fn build_digest(dir: &Path) -> Result<String> {
    let mut entries = Vec::new();
    collect_entries(dir, dir, &mut entries)?;
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    let mut hasher = Sha256::new();
    for (relative, entry) in &entries {
        match entry {
            Entry::File(path) => {
                let contents = std::fs::read(path).map_err(|e| {
                    Error::Publish(format!("reading {} to digest it: {e}", path.display()))
                })?;
                hasher.update(b"f");
                hasher.update(relative);
                hasher.update([0]);
                hasher.update((contents.len() as u64).to_le_bytes());
                hasher.update(&contents);
            }
            Entry::Link(target) => {
                hasher.update(b"l");
                hasher.update(relative);
                hasher.update([0]);
                hasher.update((target.len() as u64).to_le_bytes());
                hasher.update(target);
            }
        }
    }
    Ok(hex::encode(hasher.finalize()))
}

/// One digested entry of a build directory.
enum Entry {
    /// A regular file, at this path.
    File(std::path::PathBuf),
    /// A symbolic link, with this target.
    Link(Vec<u8>),
}

/// Collect every regular file and symbolic link under `dir`, keyed by its path
/// relative to `root` with `/` separators.
fn collect_entries(root: &Path, dir: &Path, entries: &mut Vec<(Vec<u8>, Entry)>) -> Result<()> {
    let listing = std::fs::read_dir(dir)
        .map_err(|e| Error::Publish(format!("reading build directory {}: {e}", dir.display())))?;
    for entry in listing {
        let entry =
            entry.map_err(|e| Error::Publish(format!("reading a build directory entry: {e}")))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|e| Error::Publish(format!("inspecting {}: {e}", path.display())))?;
        if file_type.is_dir() {
            collect_entries(root, &path, entries)?;
            continue;
        }
        let relative = relative_key(root, &path)?;
        if file_type.is_symlink() {
            let target = std::fs::read_link(&path)
                .map_err(|e| Error::Publish(format!("reading link {}: {e}", path.display())))?;
            entries.push((
                relative,
                Entry::Link(target.as_os_str().as_encoded_bytes().to_vec()),
            ));
        } else if file_type.is_file() {
            entries.push((relative, Entry::File(path)));
        }
    }
    Ok(())
}

/// The path of `path` relative to `root`, as bytes with `/` between components.
fn relative_key(root: &Path, path: &Path) -> Result<Vec<u8>> {
    let relative = path.strip_prefix(root).map_err(|_| {
        Error::Publish(format!(
            "{} is not inside the build directory {}",
            path.display(),
            root.display()
        ))
    })?;
    let mut key = Vec::new();
    for (index, component) in relative.components().enumerate() {
        if index > 0 {
            key.push(b'/');
        }
        key.extend_from_slice(component.as_os_str().as_encoded_bytes());
    }
    Ok(key)
}

/// The Cloudflare API the deployment lookup reads, with the account and token it
/// authenticates as.
///
/// The publisher holds the Cloudflare credential (`CLOUDFLARE_ACCOUNT_ID` and
/// `CLOUDFLARE_API_TOKEN`, which `wrangler` reads as well). The token never
/// appears in this type's `Debug` output.
#[derive(Clone)]
pub struct PagesApi {
    base_url: String,
    account_id: String,
    api_token: String,
    http: reqwest::Client,
}

impl std::fmt::Debug for PagesApi {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PagesApi")
            .field("base_url", &self.base_url)
            .field("account_id", &self.account_id)
            .field("api_token", &"<redacted>")
            .finish()
    }
}

impl PagesApi {
    /// An API client over `base_url` (the `…/client/v4` root, as
    /// [`DEFAULT_CLOUDFLARE_API_BASE`] is), authenticating as `account_id` with
    /// `api_token`. Tests point `base_url` at a stub.
    pub fn new(
        base_url: impl Into<String>,
        account_id: impl Into<String>,
        api_token: impl Into<String>,
    ) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            account_id: account_id.into(),
            api_token: api_token.into(),
            http: reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .build()
                .unwrap_or_default(),
        }
    }

    /// The API client every deployment uses: the Cloudflare API, authenticating
    /// with the `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` the publisher
    /// Job's `envFrom` injects. Both are required; a blank value is unset.
    pub fn from_env() -> Result<Self> {
        let var = |key: &str| {
            std::env::var(key)
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    Error::Publish(format!("required environment variable {key} is not set"))
                })
        };
        Ok(Self::new(
            DEFAULT_CLOUDFLARE_API_BASE,
            var("CLOUDFLARE_ACCOUNT_ID")?,
            var("CLOUDFLARE_API_TOKEN")?,
        ))
    }

    /// The URL of a successful deployment of `project` on `branch` whose commit
    /// hash is `commit_hash`, or `None` when the project has none.
    ///
    /// Pages through the project's preview deployments, newest first, stopping at
    /// the first match or after the last page. A deployment that did not finish
    /// its deploy stage successfully is never reused, so a deploy that was cut
    /// off is made again.
    pub async fn find_deployment(
        &self,
        project: &str,
        branch: &str,
        commit_hash: &str,
    ) -> Result<Option<String>> {
        let mut page: u32 = 1;
        loop {
            let listing = self.deployments_page(project, page).await?;
            let found = listing.result.iter().find(|deployment| {
                deployment.is_deployed()
                    && deployment.metadata().is_some_and(|metadata| {
                        metadata.branch.as_deref() == Some(branch)
                            && metadata.commit_hash.as_deref() == Some(commit_hash)
                    })
            });
            if let Some(deployment) = found {
                return Ok(Some(deployment.url.clone()));
            }
            let last = listing.result.len() < DEPLOYMENTS_PER_PAGE as usize
                || listing
                    .result_info
                    .and_then(|info| info.total_pages)
                    .is_some_and(|total| page >= total);
            if last {
                return Ok(None);
            }
            page += 1;
        }
    }

    /// One page of the project's preview deployments.
    async fn deployments_page(&self, project: &str, page: u32) -> Result<DeploymentsPage> {
        let mut url = reqwest::Url::parse(&self.base_url)
            .map_err(|e| api_error(None, format!("the API base `{}`: {e}", self.base_url)))?;
        url.path_segments_mut()
            .map_err(|()| api_error(None, format!("the API base `{}`", self.base_url)))?
            .pop_if_empty()
            .extend([
                "accounts",
                &self.account_id,
                "pages",
                "projects",
                project,
                "deployments",
            ]);
        url.query_pairs_mut()
            .append_pair("env", "preview")
            .append_pair("page", &page.to_string())
            .append_pair("per_page", &DEPLOYMENTS_PER_PAGE.to_string());

        let response = self
            .http
            .get(url)
            .bearer_auth(&self.api_token)
            .send()
            .await
            .map_err(|e| api_error(None, e.to_string()))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| api_error(Some(status.as_u16()), e.to_string()))?;
        if !status.is_success() {
            return Err(api_error(Some(status.as_u16()), excerpt(&body)));
        }
        let listing: DeploymentsPage = serde_json::from_str(&body).map_err(|e| {
            api_error(
                Some(status.as_u16()),
                format!("an unreadable deployments listing: {e}"),
            )
        })?;
        if !listing.success {
            return Err(api_error(Some(status.as_u16()), excerpt(&body)));
        }
        Ok(listing)
    }
}

/// A failed lookup of the project's deployments.
fn api_error(status: Option<u16>, detail: String) -> Error {
    Error::PagesApi { status, detail }
}

/// The start of a response body, enough to say why a request failed.
fn excerpt(body: &str) -> String {
    const LIMIT: usize = 512;
    match body.char_indices().nth(LIMIT) {
        Some((end, _)) => format!("{}…", &body[..end]),
        None => body.to_string(),
    }
}

/// One page of `GET …/pages/projects/{project}/deployments`.
#[derive(Debug, Deserialize)]
struct DeploymentsPage {
    success: bool,
    #[serde(default)]
    result: Vec<Deployment>,
    #[serde(default)]
    result_info: Option<ResultInfo>,
}

/// The paging of a listing.
#[derive(Debug, Clone, Copy, Deserialize)]
struct ResultInfo {
    #[serde(default)]
    total_pages: Option<u32>,
}

/// The fields of a deployment the lookup reads.
#[derive(Debug, Deserialize)]
struct Deployment {
    /// The deployment's own URL, `https://<short id>.<project>.pages.dev`.
    url: String,
    #[serde(default)]
    latest_stage: Option<Stage>,
    #[serde(default)]
    deployment_trigger: Option<Trigger>,
}

impl Deployment {
    /// Whether the deployment finished its deploy stage successfully.
    fn is_deployed(&self) -> bool {
        self.latest_stage
            .as_ref()
            .is_some_and(|stage| stage.name == "deploy" && stage.status == "success")
    }

    /// The branch and commit hash the deployment was made with.
    fn metadata(&self) -> Option<&Metadata> {
        self.deployment_trigger.as_ref()?.metadata.as_ref()
    }
}

/// A deployment's latest stage.
#[derive(Debug, Deserialize)]
struct Stage {
    #[serde(default)]
    name: String,
    #[serde(default)]
    status: String,
}

/// What triggered a deployment.
#[derive(Debug, Deserialize)]
struct Trigger {
    #[serde(default)]
    metadata: Option<Metadata>,
}

/// The branch and commit a deployment was made with.
#[derive(Debug, Deserialize)]
struct Metadata {
    #[serde(default)]
    branch: Option<String>,
    #[serde(default)]
    commit_hash: Option<String>,
}

#[cfg(test)]
#[path = "pages.test.rs"]
pub(crate) mod tests;
