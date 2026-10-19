//! Workload identity: the Entra access token the service presents to Blob
//! storage in a cluster.
//!
//! The pod runs under a `ServiceAccount` federated to the environment's
//! user-assigned managed identity, and carries the
//! `azure.workload.identity/use: "true"` label, so the workload-identity webhook
//! projects the variables this reads: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
//! `AZURE_FEDERATED_TOKEN_FILE` and, optionally, `AZURE_AUTHORITY_HOST`. The
//! projected `ServiceAccount` token is exchanged for an access token scoped to
//! Azure Storage with the federated client-credentials grant, the same exchange
//! the backend's database identity makes (`crates/db-auth`).
//!
//! A token is cached and reused until shortly before it expires, then a fresh
//! one is minted on the next request. The token file is read on every exchange,
//! because the kubelet rotates the projected token.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde::Deserialize;

use super::BlobError;

/// The scope a token is requested for: Azure Storage, with the identity's
/// statically assigned roles (Storage Blob Data Contributor on the container).
const STORAGE_SCOPE: &str = "https://storage.azure.com/.default";

/// The login authority when `AZURE_AUTHORITY_HOST` is unset (Azure public cloud).
const DEFAULT_AUTHORITY_HOST: &str = "https://login.microsoftonline.com/";

/// How long before its stated expiry a cached token is replaced, so a request
/// never carries a token that lapses in flight. A token whose whole life is
/// shorter is replaced halfway through it instead.
const REFRESH_SKEW: Duration = Duration::from_secs(5 * 60);

/// The token endpoint's success response (the two fields used).
#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
}

/// A cached access token and the moment it is due for replacement.
struct CachedToken {
    secret: String,
    refresh_at: Instant,
}

/// Mints and caches Azure Storage access tokens through workload identity.
pub struct WorkloadIdentity {
    client_id: String,
    tenant_id: String,
    token_file: PathBuf,
    authority_host: String,
    http: reqwest::Client,
    cached: tokio::sync::Mutex<Option<CachedToken>>,
}

impl std::fmt::Debug for WorkloadIdentity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WorkloadIdentity")
            .field("client_id", &self.client_id)
            .field("tenant_id", &self.tenant_id)
            .field("token_file", &self.token_file)
            .field("authority_host", &self.authority_host)
            .finish_non_exhaustive()
    }
}

impl WorkloadIdentity {
    /// Read the projected workload-identity variables from `lookup`, which
    /// answers a variable's value or `None` when it is unset. An empty value
    /// counts as unset; a missing required one is a [`BlobError::MissingEnv`].
    pub fn from_lookup(
        lookup: impl Fn(&str) -> Option<String>,
        http: reqwest::Client,
    ) -> Result<Self, BlobError> {
        let var = |key: &str| lookup(key).filter(|value| !value.is_empty());
        let require = |key: &'static str| var(key).ok_or(BlobError::MissingEnv(key));
        Ok(Self::new(
            require("AZURE_CLIENT_ID")?,
            require("AZURE_TENANT_ID")?,
            PathBuf::from(require("AZURE_FEDERATED_TOKEN_FILE")?),
            var("AZURE_AUTHORITY_HOST").unwrap_or_else(|| DEFAULT_AUTHORITY_HOST.to_string()),
            http,
        ))
    }

    /// An identity from its parts: the managed identity's client id, the
    /// tenant, the projected token file and the login authority.
    pub fn new(
        client_id: String,
        tenant_id: String,
        token_file: PathBuf,
        authority_host: String,
        http: reqwest::Client,
    ) -> Self {
        Self {
            client_id,
            tenant_id,
            token_file,
            authority_host,
            http,
            cached: tokio::sync::Mutex::new(None),
        }
    }

    /// A current access token: the cached one while it is fresh, a newly
    /// minted one otherwise. Concurrent callers wait on one exchange rather
    /// than each making their own.
    pub async fn token(&self) -> Result<String, BlobError> {
        let mut cached = self.cached.lock().await;
        if let Some(token) = cached.as_ref()
            && Instant::now() < token.refresh_at
        {
            return Ok(token.secret.clone());
        }
        let (secret, lifetime) = self.fetch().await?;
        let early = REFRESH_SKEW.min(lifetime / 2);
        *cached = Some(CachedToken {
            secret: secret.clone(),
            refresh_at: Instant::now() + lifetime.saturating_sub(early),
        });
        Ok(secret)
    }

    /// Forget the cached token, so the next request mints a fresh one.
    pub async fn invalidate(&self) {
        *self.cached.lock().await = None;
    }

    /// Exchange the projected `ServiceAccount` token for a storage access token.
    async fn fetch(&self) -> Result<(String, Duration), BlobError> {
        let assertion = tokio::fs::read_to_string(&self.token_file)
            .await
            .map_err(|source| BlobError::TokenFile {
                path: self.token_file.display().to_string(),
                source,
            })?;
        let authority = self.authority_host.trim_end_matches('/');
        let url = format!("{authority}/{}/oauth2/v2.0/token", self.tenant_id);
        let response = self
            .http
            .post(url)
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("scope", STORAGE_SCOPE),
                ("grant_type", "client_credentials"),
                (
                    "client_assertion_type",
                    "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                ),
                ("client_assertion", assertion.trim()),
            ])
            .send()
            .await
            .map_err(|error| BlobError::Token(format!("the token request failed: {error}")))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(BlobError::Token(format!(
                "the token endpoint answered {status}: {body}"
            )));
        }
        let token: TokenResponse = response
            .json()
            .await
            .map_err(|error| BlobError::Token(format!("reading the token response: {error}")))?;
        Ok((token.access_token, Duration::from_secs(token.expires_in)))
    }
}
