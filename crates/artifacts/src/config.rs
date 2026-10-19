//! Artifact-service configuration, sourced entirely from environment variables —
//! the same pattern the backend uses, so the service can be driven from a systemd
//! unit or a container with no config file.
//!
//! | Variable | Required | Purpose | Default |
//! | --- | --- | --- | --- |
//! | `TCAB_ARTIFACTS_BIND` | no | Address the Axum server binds. | `0.0.0.0:8790` |
//! | `TCAB_BACKEND_URL` | no | The backend the service forwards a driver's per-job token to for upload auth (the backend is the token authority). | `http://127.0.0.1:8787` |
//! | `TCAB_BACKEND_SERVICE_TOKEN` | no | The shared control-plane service token the backend's tree-management routes must present: `DELETE /runs/{id}/artifacts` (pruning a deleted run's tree) and `GET /runs` (listing stored trees for the reclamation sweep). Unset ⇒ tree management is disabled (both routes reject every caller). | _none_ |
//! | `TCAB_ACCESS_TEAM_DOMAIN` | no | The Access team domain whose certificates sign the `Cf-Access-Jwt-Assertion` every edge request carries. Set together with `TCAB_ACCESS_AUDIENCE`. | _none_ |
//! | `TCAB_ACCESS_AUDIENCE` | no | The audience tag of the Access application protecting the service's hostname. Set together with `TCAB_ACCESS_TEAM_DOMAIN`. | _none_ |
//! | `TCAB_ARTIFACTS_BLOB_ACCOUNT` | yes | The storage account holding the private run-tree container (`devstoreaccount1` against Azurite). | _none_ |
//! | `TCAB_ARTIFACTS_BLOB_CONTAINER` | yes | The private container the run trees are written to. | _none_ |
//! | `TCAB_ARTIFACTS_BLOB_ENDPOINT` | no | The account's Blob endpoint, for an emulator: Azurite's path-style `http://<host>:10000/devstoreaccount1`. Set together with `TCAB_ARTIFACTS_BLOB_KEY`. | `https://<account>.blob.core.windows.net` |
//! | `TCAB_ARTIFACTS_BLOB_KEY` | no | The account key (base64) requests are signed with by Shared Key, Azurite's well-known key locally. Set together with `TCAB_ARTIFACTS_BLOB_ENDPOINT`; unset, requests authenticate by workload identity. | _none_ |
//! | `TCAB_R2_ACCOUNT_ID`, `TCAB_R2_BUCKET`, `TCAB_R2_ACCESS_KEY_ID`, `TCAB_R2_SECRET_ACCESS_KEY` | one public store | The public dataset's Cloudflare R2 bucket and its S3 credentials; all four together. | _none_ |
//! | `TCAB_R2_ENDPOINT` | no | The R2 S3 endpoint, when not the account's own. | `https://<account-id>.r2.cloudflarestorage.com` |
//! | `TCAB_ARTIFACTS_PUBLIC_BLOB_CONTAINER` | one public store | A container of the run-tree account that stands in for the public bucket (the local stack's Azurite container). | _none_ |
//!
//! The run trees live in a private Azure Blob container. In a cluster the
//! service authenticates to it by workload identity: the pod's
//! `ServiceAccount` is federated to the environment's managed identity, and the
//! webhook projects `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and
//! `AZURE_FEDERATED_TOKEN_FILE` (see [`crate::blob::WorkloadIdentity`]). Against
//! Azurite it signs with Shared Key instead, which is what
//! `TCAB_ARTIFACTS_BLOB_ENDPOINT` and `TCAB_ARTIFACTS_BLOB_KEY` select; the two are
//! set together or not at all.
//!
//! The public dataset lives in exactly one public store
//! ([`PublicStoreConfig`]): the R2 bucket the `TCAB_R2_*` variables name, or,
//! on the local stack, the Azurite container
//! `TCAB_ARTIFACTS_PUBLIC_BLOB_CONTAINER` names. Both, neither, a partial
//! `TCAB_R2_*` set, or a public container that is the run-tree container itself
//! is a [`ConfigError`].
//!
//! The two `TCAB_ACCESS_*` variables are set together, so the service verifies
//! every edge request's assertion, or not at all, the local overlay's shape, in
//! which the service takes a person's identity from the
//! `Cf-Access-Authenticated-User-Email` header as presented. One without the other
//! is a [`ConfigError`], so a deployment that lost one fails to start rather than
//! trusting a header anyone can send. See [`crate::auth`].
//!
//! A bind on `0.0.0.0` is deliberate: unlike the backend (which defaults to
//! loopback for a single-box dev run), the artifact service is a data-plane peer
//! the driver reaches over the cluster network and the edge's tunnel forwards the
//! console's requests to, so it binds all interfaces.

/// The default address the Axum server binds when `TCAB_ARTIFACTS_BIND` is unset.
/// Binds all interfaces so the driver (upload) and the edge's tunnel (a console's
/// reads) reach it over the cluster network.
const DEFAULT_BIND: &str = "0.0.0.0:8790";
/// The default backend URL when `TCAB_BACKEND_URL` is unset: the backend's own
/// loopback default, so local dev works with both services up and no extra
/// configuration.
const DEFAULT_BACKEND_URL: &str = "http://127.0.0.1:8787";

pub use crate::access::AccessConfig;
pub use crate::blob::{BlobAuth, BlobConfig};
pub use crate::public::PublicStoreConfig;
use crate::r2::R2Config;

/// The `TCAB_R2_*` variables that name the public bucket, all required together.
const R2_REQUIRED: [&str; 4] = [
    "TCAB_R2_ACCOUNT_ID",
    "TCAB_R2_BUCKET",
    "TCAB_R2_ACCESS_KEY_ID",
    "TCAB_R2_SECRET_ACCESS_KEY",
];

/// The fully resolved artifact-service configuration.
#[derive(Debug, Clone)]
pub struct Config {
    /// Address the Axum server binds (`TCAB_ARTIFACTS_BIND`).
    pub bind: String,
    /// The backend base URL (`TCAB_BACKEND_URL`), without a trailing slash. The
    /// service forwards a driver's per-job token here
    /// (`POST /jobs/{id}/verify-token`) to authenticate an upload; the backend is
    /// the token authority.
    pub backend_url: String,
    /// The shared control-plane service token (`TCAB_BACKEND_SERVICE_TOKEN`) the
    /// backend's two tree-management routes must present: the run-tree delete and
    /// the `GET /runs` listing its reclamation sweep enumerates the stored trees with. It
    /// is the same secret the backend and dispatcher share, so only a trusted
    /// control-plane caller can enumerate or prune trees. `None` disables both routes
    /// entirely — they reject every caller — which is the safe default for a dev or
    /// single-box setup that never manages trees through the data plane.
    pub service_token: Option<String>,
    /// The Access application the service verifies an edge request's assertion
    /// against (`TCAB_ACCESS_TEAM_DOMAIN` and `TCAB_ACCESS_AUDIENCE`), or `None`
    /// when neither is set and the service takes the identity from the local
    /// identity header instead.
    pub access: Option<AccessConfig>,
    /// The private run-tree container and how the service authenticates to it
    /// (`TCAB_ARTIFACTS_BLOB_*`).
    pub blob: BlobConfig,
    /// The public dataset's store (`TCAB_R2_*` or
    /// `TCAB_ARTIFACTS_PUBLIC_BLOB_CONTAINER`).
    pub public_store: PublicStoreConfig,
}

/// A configuration the service refuses to start with.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// One of a pair of variables that are set together was set alone.
    #[error("`{set}` is set but `{unset}` is not: {hint}")]
    Unpaired {
        /// The variable that was set.
        set: &'static str,
        /// The variable that was not.
        unset: &'static str,
        /// What setting both, or neither, means.
        hint: &'static str,
    },
    /// A required variable is unset.
    #[error("`{0}` is required")]
    Missing(&'static str),
    /// `TCAB_ARTIFACTS_BLOB_KEY` is not base64.
    #[error("`TCAB_ARTIFACTS_BLOB_KEY` is not a base64 account key")]
    InvalidBlobKey,
    /// Both public stores, or neither, are configured.
    #[error(
        "configure exactly one public store: the `TCAB_R2_*` bucket or \
         `TCAB_ARTIFACTS_PUBLIC_BLOB_CONTAINER` ({0})"
    )]
    PublicStore(&'static str),
    /// Some `TCAB_R2_*` variables are set but not every required one.
    #[error("the R2 public store is configured partly: `{0}` is unset")]
    R2Incomplete(&'static str),
    /// The public container is the private run-tree container.
    #[error(
        "`TCAB_ARTIFACTS_PUBLIC_BLOB_CONTAINER` names the private run-tree container \
         `{0}`: the public dataset needs a container of its own"
    )]
    PublicIsPrivate(String),
}

impl Config {
    /// Resolve the configuration from the process environment. The run-tree
    /// container and one public store must be named; every other variable has a
    /// default. See the module docs for what is refused.
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// Resolve the configuration from `lookup`, which answers a variable's value
    /// or `None` when it is unset. An empty value counts as unset.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let var = |key: &str| lookup(key).filter(|v| !v.is_empty());
        Ok(Self {
            bind: var("TCAB_ARTIFACTS_BIND").unwrap_or_else(|| DEFAULT_BIND.to_string()),
            backend_url: var("TCAB_BACKEND_URL")
                .unwrap_or_else(|| DEFAULT_BACKEND_URL.to_string())
                .trim_end_matches('/')
                .to_string(),
            service_token: var("TCAB_BACKEND_SERVICE_TOKEN"),
            access: access_config(var("TCAB_ACCESS_TEAM_DOMAIN"), var("TCAB_ACCESS_AUDIENCE"))?,
            blob: blob_config(&var)?,
            public_store: public_store_config(&var, &lookup)?,
        })
    }
}

/// Resolve the run-tree container and its authentication. The endpoint and key
/// together select Shared Key (Azurite); neither selects workload identity
/// against the account's public-cloud endpoint.
fn blob_config(var: &impl Fn(&str) -> Option<String>) -> Result<BlobConfig, ConfigError> {
    use base64::Engine as _;

    let account = var("TCAB_ARTIFACTS_BLOB_ACCOUNT")
        .ok_or(ConfigError::Missing("TCAB_ARTIFACTS_BLOB_ACCOUNT"))?;
    let container = var("TCAB_ARTIFACTS_BLOB_CONTAINER")
        .ok_or(ConfigError::Missing("TCAB_ARTIFACTS_BLOB_CONTAINER"))?;
    const HINT: &str = "set both to sign with Shared Key against an emulator, or neither to \
                        authenticate by workload identity";
    let (endpoint, auth) = match (
        var("TCAB_ARTIFACTS_BLOB_ENDPOINT"),
        var("TCAB_ARTIFACTS_BLOB_KEY"),
    ) {
        (Some(endpoint), Some(key)) => {
            let key = base64::engine::general_purpose::STANDARD
                .decode(key.trim())
                .map_err(|_| ConfigError::InvalidBlobKey)?;
            (
                endpoint.trim_end_matches('/').to_string(),
                BlobAuth::SharedKey(key),
            )
        }
        (None, None) => (
            BlobConfig::default_endpoint(&account),
            BlobAuth::WorkloadIdentity,
        ),
        (Some(_), None) => {
            return Err(ConfigError::Unpaired {
                set: "TCAB_ARTIFACTS_BLOB_ENDPOINT",
                unset: "TCAB_ARTIFACTS_BLOB_KEY",
                hint: HINT,
            });
        }
        (None, Some(_)) => {
            return Err(ConfigError::Unpaired {
                set: "TCAB_ARTIFACTS_BLOB_KEY",
                unset: "TCAB_ARTIFACTS_BLOB_ENDPOINT",
                hint: HINT,
            });
        }
    };
    Ok(BlobConfig {
        account,
        container,
        endpoint,
        auth,
    })
}

/// Resolve the one public store: the R2 bucket or the stand-in container.
fn public_store_config(
    var: &impl Fn(&str) -> Option<String>,
    lookup: &impl Fn(&str) -> Option<String>,
) -> Result<PublicStoreConfig, ConfigError> {
    let r2_named = R2_REQUIRED
        .iter()
        .chain(&["TCAB_R2_ENDPOINT"])
        .any(|key| var(key).is_some());
    let container = var("TCAB_ARTIFACTS_PUBLIC_BLOB_CONTAINER");
    match (r2_named, container) {
        (true, Some(_)) => Err(ConfigError::PublicStore("both are set")),
        (false, None) => Err(ConfigError::PublicStore("neither is set")),
        (true, None) => {
            if let Some(missing) = R2_REQUIRED.into_iter().find(|key| var(key).is_none()) {
                return Err(ConfigError::R2Incomplete(missing));
            }
            R2Config::from_lookup(lookup)
                .map(PublicStoreConfig::R2)
                .ok_or(ConfigError::R2Incomplete(R2_REQUIRED[0]))
        }
        (false, Some(container)) => {
            if var("TCAB_ARTIFACTS_BLOB_CONTAINER").as_deref() == Some(container.as_str()) {
                return Err(ConfigError::PublicIsPrivate(container));
            }
            Ok(PublicStoreConfig::Blob { container })
        }
    }
}

/// What setting both `TCAB_ACCESS_*` variables, or neither, means.
const ACCESS_HINT: &str = "set both to verify Access assertions, or neither to take the identity \
                           from Cf-Access-Authenticated-User-Email";

/// Resolve the Access application from the two variables naming it. Both set is a
/// service that verifies assertions, both unset one that takes the local identity
/// header, and one without the other is refused.
fn access_config(
    team_domain: Option<String>,
    audience: Option<String>,
) -> Result<Option<AccessConfig>, ConfigError> {
    match (team_domain, audience) {
        (Some(team_domain), Some(audience)) => Ok(Some(AccessConfig {
            team_domain,
            audience,
        })),
        (None, None) => Ok(None),
        (Some(_), None) => Err(ConfigError::Unpaired {
            set: "TCAB_ACCESS_TEAM_DOMAIN",
            unset: "TCAB_ACCESS_AUDIENCE",
            hint: ACCESS_HINT,
        }),
        (None, Some(_)) => Err(ConfigError::Unpaired {
            set: "TCAB_ACCESS_AUDIENCE",
            unset: "TCAB_ACCESS_TEAM_DOMAIN",
            hint: ACCESS_HINT,
        }),
    }
}

#[cfg(test)]
#[path = "config.test.rs"]
mod tests;
