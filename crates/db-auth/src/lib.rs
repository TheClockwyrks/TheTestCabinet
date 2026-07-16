//! Microsoft Entra (Azure AD) authentication for Azure Database for PostgreSQL —
//! Flexible Server, for the backend and auth service.
//!
//! Both services normally connect to Postgres with a password embedded in
//! `TCAB_*_DATABASE_URL` (`postgres://user:password@host/db`). This crate is the
//! **passwordless** alternative: the pod authenticates as a user-assigned managed
//! identity via Azure Workload Identity, and the Postgres *password* is a
//! short-lived Entra **access token** minted for the
//! `https://ossrdbms-aad.database.windows.net` resource.
//!
//! The awkward part is lifetime. An Entra access token is valid for roughly an
//! hour, and Postgres only checks it when a connection is *established* — an
//! already-open connection keeps working past expiry. But a pooled service opens
//! *new* physical connections over its lifetime (after a transient drop, a server
//! failover, or pool growth), and each of those must present a *fresh* token or
//! the login is rejected. `sqlx`/SeaORM capture the password once when the pool is
//! built and offer no per-connection credential hook, so the only way to keep new
//! connections authenticating is to rebuild the pool with a new token before the
//! old one expires. [`AzureAdDb`] does exactly that: it holds the current
//! `DatabaseConnection` behind an [`RwLock`], and a background task periodically
//! mints a new token, builds a replacement pool, and swaps it in. Callers read the
//! current pool with [`AzureAdDb::connection`]; the previous pool is *not* forced
//! closed, so in-flight queries on it drain naturally before it is dropped.
//!
//! ## Environment
//!
//! Token acquisition uses the standard Azure Workload Identity projected values,
//! injected by the `azure-workload-identity` mutating webhook when the pod carries
//! the `azure.workload.identity/use: "true"` label and runs under a ServiceAccount
//! federated to the managed identity (see the `deployments/` runbook):
//!
//! - `AZURE_CLIENT_ID` — the managed identity's client id.
//! - `AZURE_TENANT_ID` — the directory (tenant) id.
//! - `AZURE_FEDERATED_TOKEN_FILE` — path to the projected SA token used as the
//!   client assertion in the federated client-credentials exchange.
//! - `AZURE_AUTHORITY_HOST` — the login authority (defaults to the public cloud).

use std::sync::{Arc, RwLock};
use std::time::Duration;

use sea_orm::{ConnectOptions, Database, DatabaseConnection};
use serde::Deserialize;

/// The resource (scope) an access token must be minted for to authenticate to
/// Azure Database for PostgreSQL. The `/.default` suffix requests the app's
/// statically-configured permissions, which is what the client-credentials flow
/// requires.
const OSSRDBMS_SCOPE: &str = "https://ossrdbms-aad.database.windows.net/.default";

/// The default login authority when `AZURE_AUTHORITY_HOST` is unset (Azure public
/// cloud). Sovereign clouds inject a different host.
const DEFAULT_AUTHORITY_HOST: &str = "https://login.microsoftonline.com/";

/// Refresh this long *before* the token's stated expiry, so a new pool is in place
/// well ahead of the old token lapsing (clock skew + build time headroom).
const REFRESH_SKEW: Duration = Duration::from_secs(5 * 60);
/// Never refresh more often than this, even if a token reports a very short life —
/// a floor that keeps a misconfigured lifetime from spinning the refresh loop.
const MIN_REFRESH: Duration = Duration::from_secs(60);
/// Rebuild the pool at least this often even if the token's stated life is longer,
/// so new connections rotate onto a fresh token on a predictable cadence.
const MAX_REFRESH: Duration = Duration::from_secs(30 * 60);
/// After a failed refresh, retry on this shorter cadence (the current pool keeps
/// serving in the meantime; its established connections outlive the old token).
const RETRY_REFRESH: Duration = Duration::from_secs(2 * 60);

/// A failure acquiring an Entra token or building the authenticated connection.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A required Workload Identity environment variable is unset — the pod is not
    /// configured for managed-identity auth (missing the SA federation / label).
    #[error(
        "Azure Workload Identity is not configured: environment variable `{0}` is unset \
         (the pod needs the `azure.workload.identity/use` label and a federated ServiceAccount)"
    )]
    MissingEnv(&'static str),
    /// The projected federated token file could not be read.
    #[error("failed to read federated token file `{path}`: {source}")]
    TokenFile {
        /// The path that failed (`AZURE_FEDERATED_TOKEN_FILE`).
        path: String,
        /// The underlying I/O error.
        source: std::io::Error,
    },
    /// The token endpoint call itself failed at the transport layer.
    #[error("Entra token request failed: {0}")]
    Http(#[source] reqwest::Error),
    /// The token endpoint returned a non-2xx status.
    #[error("Entra token endpoint returned HTTP {status}: {body}")]
    TokenEndpoint {
        /// The HTTP status code.
        status: u16,
        /// The response body (an Entra `error`/`error_description` JSON).
        body: String,
    },
    /// The database URL is not a `scheme://…` URL.
    #[error("database URL is not a valid `scheme://…` URL")]
    MalformedUrl,
    /// The database URL has no username. Azure AD auth needs the URL to name the
    /// Postgres role (the managed identity's mapped principal), e.g.
    /// `postgres://tcab-backend-db-staging@host:5432/tcab_backend?sslmode=require`.
    #[error(
        "database URL must include a username naming the Entra Postgres role \
         (e.g. `postgres://<role>@host:5432/db?sslmode=require`)"
    )]
    MissingUsername,
    /// Building the SeaORM connection failed (bad address, TLS, or a rejected
    /// login token).
    #[error(transparent)]
    Db(#[from] sea_orm::DbErr),
}

/// A minted access token and how long it is valid for.
struct AccessToken {
    /// The bearer token, used verbatim as the Postgres password.
    secret: String,
    /// Seconds until the token expires, as reported by the endpoint.
    lifetime: Duration,
}

/// The token endpoint's success response (a subset — we only need these two).
#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
}

/// Acquires Entra access tokens for the Postgres resource via Azure Workload
/// Identity (the federated client-credentials flow).
struct WorkloadIdentityCredential {
    client_id: String,
    tenant_id: String,
    token_file: String,
    authority_host: String,
    http: reqwest::Client,
}

impl WorkloadIdentityCredential {
    /// Read the Workload Identity configuration from the process environment.
    fn from_env() -> Result<Self, Error> {
        Ok(Self {
            client_id: require_env("AZURE_CLIENT_ID")?,
            tenant_id: require_env("AZURE_TENANT_ID")?,
            token_file: require_env("AZURE_FEDERATED_TOKEN_FILE")?,
            authority_host: std::env::var("AZURE_AUTHORITY_HOST")
                .ok()
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| DEFAULT_AUTHORITY_HOST.to_string()),
            http: reqwest::Client::new(),
        })
    }

    /// Mint a fresh access token for the Postgres resource. The projected SA token
    /// is presented as the `client_assertion`; the endpoint returns an Entra
    /// access token whose audience is the Postgres resource.
    async fn fetch_token(&self) -> Result<AccessToken, Error> {
        let assertion = tokio::fs::read_to_string(&self.token_file)
            .await
            .map_err(|source| Error::TokenFile {
                path: self.token_file.clone(),
                source,
            })?;
        let authority = self.authority_host.trim_end_matches('/');
        let url = format!("{authority}/{}/oauth2/v2.0/token", self.tenant_id);
        let response = self
            .http
            .post(url)
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("scope", OSSRDBMS_SCOPE),
                ("grant_type", "client_credentials"),
                (
                    "client_assertion_type",
                    "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                ),
                ("client_assertion", assertion.trim()),
            ])
            .send()
            .await
            .map_err(Error::Http)?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(Error::TokenEndpoint { status, body });
        }
        let token: TokenResponse = response.json().await.map_err(Error::Http)?;
        Ok(AccessToken {
            secret: token.access_token,
            lifetime: Duration::from_secs(token.expires_in),
        })
    }
}

/// A live SeaORM connection to Azure Database for PostgreSQL that authenticates
/// with a managed-identity Entra token, transparently rebuilt as the token
/// rotates. Clone-free to share: wrap in an `Arc` and call [`Self::connection`].
pub struct AzureAdDb {
    /// The current pool. Swapped out by the refresh task; read (cloned) by
    /// [`Self::connection`]. `DatabaseConnection` is cheap to clone (an `Arc` to
    /// the underlying `sqlx` pool), so the read lock is held only for the clone.
    current: Arc<RwLock<DatabaseConnection>>,
    /// The background refresh loop. Aborted on drop so the task does not outlive
    /// the connection it maintains.
    refresh: tokio::task::JoinHandle<()>,
}

impl Drop for AzureAdDb {
    fn drop(&mut self) {
        self.refresh.abort();
    }
}

impl AzureAdDb {
    /// Connect using a managed-identity Entra token as the Postgres password.
    ///
    /// `base_url` is the connection URL **without** a password — it must name the
    /// Postgres role (the managed identity's mapped principal) as the username,
    /// e.g. `postgres://tcab-backend-db-staging@host:5432/tcab_backend?sslmode=require`.
    /// The initial token is minted before returning, so a misconfiguration
    /// (missing federation, unmapped role) fails fast at startup.
    pub async fn connect(base_url: &str) -> Result<Self, Error> {
        let credential = Arc::new(WorkloadIdentityCredential::from_env()?);
        let token = credential.fetch_token().await?;
        let conn = build_connection(base_url, &token.secret).await?;
        let current = Arc::new(RwLock::new(conn));
        let refresh = spawn_refresher(
            Arc::clone(&credential),
            base_url.to_string(),
            Arc::clone(&current),
            token.lifetime,
        );
        Ok(Self { current, refresh })
    }

    /// The current pool, as a cheap clone. Grab this per unit of work (per request
    /// / transaction) rather than caching it, so work started after a refresh runs
    /// on the pool built with the fresh token.
    pub fn connection(&self) -> DatabaseConnection {
        self.current
            .read()
            .expect("Azure AD DB connection lock poisoned")
            .clone()
    }
}

/// Spawn the background loop that rebuilds the pool with a freshly-minted token
/// before the current one expires and swaps it into `current`.
fn spawn_refresher(
    credential: Arc<WorkloadIdentityCredential>,
    base_url: String,
    current: Arc<RwLock<DatabaseConnection>>,
    initial_lifetime: Duration,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut lifetime = initial_lifetime;
        loop {
            tokio::time::sleep(refresh_delay(lifetime)).await;
            match refresh_once(&credential, &base_url).await {
                Ok((conn, new_lifetime)) => {
                    // Swap in the new pool. The previous one is dropped here, but a
                    // `DatabaseConnection` is an `Arc` to the pool: any clone handed
                    // out by `connection()` and still in use keeps the old pool
                    // alive until its in-flight work finishes, so nothing is cut
                    // off mid-query. We deliberately do NOT call `.close()`.
                    let previous = {
                        let mut guard = current
                            .write()
                            .expect("Azure AD DB connection lock poisoned");
                        std::mem::replace(&mut *guard, conn)
                    };
                    drop(previous);
                    lifetime = new_lifetime;
                    tracing::debug!("rotated Azure AD Postgres connection onto a fresh token");
                }
                Err(err) => {
                    // Keep serving on the current pool (its established connections
                    // outlive the old token) and retry sooner.
                    tracing::warn!(
                        error = %err,
                        "failed to refresh Azure AD Postgres token; keeping current pool"
                    );
                    lifetime = RETRY_REFRESH.saturating_add(REFRESH_SKEW);
                }
            }
        }
    })
}

/// Mint a token and build a replacement pool from it.
async fn refresh_once(
    credential: &WorkloadIdentityCredential,
    base_url: &str,
) -> Result<(DatabaseConnection, Duration), Error> {
    let token = credential.fetch_token().await?;
    let conn = build_connection(base_url, &token.secret).await?;
    Ok((conn, token.lifetime))
}

/// How long to wait before the next refresh: comfortably before the token expires,
/// but bounded so a new pool rotates in on a predictable cadence and a short or
/// missing lifetime cannot busy-loop.
fn refresh_delay(lifetime: Duration) -> Duration {
    lifetime
        .saturating_sub(REFRESH_SKEW)
        .clamp(MIN_REFRESH, MAX_REFRESH)
}

/// Build a SeaORM Postgres connection with `token` as the password. Keeps at least
/// one connection warm (`min_connections(1)`) so an already-authenticated
/// connection survives past token expiry and a bad token fails fast here.
async fn build_connection(base_url: &str, token: &str) -> Result<DatabaseConnection, Error> {
    let url = inject_password(base_url, token)?;
    let mut opts = ConnectOptions::new(url);
    opts.min_connections(1);
    Ok(Database::connect(opts).await?)
}

/// Rewrite `scheme://user[:pass]@hostport/tail` to carry `token` as the password.
/// Any existing password is replaced; a missing username is an error (Azure AD
/// needs the URL to name the Postgres role).
fn inject_password(base_url: &str, token: &str) -> Result<String, Error> {
    let (scheme, rest) = base_url.split_once("://").ok_or(Error::MalformedUrl)?;
    // The authority (`userinfo@hostport`) ends at the first `/` (path) or `?`
    // (query); everything from there on is copied through verbatim.
    let authority_end = rest.find(['/', '?']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(authority_end);
    let (userinfo, hostport) = authority.rsplit_once('@').ok_or(Error::MissingUsername)?;
    // userinfo is `user` or `user:password`; keep only the user.
    let user = userinfo.split_once(':').map_or(userinfo, |(u, _)| u);
    if user.is_empty() {
        return Err(Error::MissingUsername);
    }
    Ok(format!(
        "{scheme}://{user}:{}@{hostport}{tail}",
        percent_encode(token)
    ))
}

/// Percent-encode a token for safe placement in the URL userinfo. Entra tokens are
/// base64url JWTs (`[A-Za-z0-9._-]`), so nothing is normally encoded, but this
/// stays correct if the format ever varies.
fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Read a required environment variable, mapping an unset/empty value to a precise
/// [`Error::MissingEnv`].
fn require_env(key: &'static str) -> Result<String, Error> {
    std::env::var(key)
        .ok()
        .filter(|v| !v.is_empty())
        .ok_or(Error::MissingEnv(key))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn injects_token_as_password_preserving_query() {
        let url = inject_password(
            "postgres://role@host.postgres.database.azure.com:5432/db?sslmode=require",
            "aaa.bbb.ccc",
        )
        .unwrap();
        assert_eq!(
            url,
            "postgres://role:aaa.bbb.ccc@host.postgres.database.azure.com:5432/db?sslmode=require"
        );
    }

    #[test]
    fn replaces_an_existing_password() {
        let url = inject_password("postgres://role:oldpw@host:5432/db", "newtok").unwrap();
        assert_eq!(url, "postgres://role:newtok@host:5432/db");
    }

    #[test]
    fn requires_a_username() {
        assert!(matches!(
            inject_password("postgres://host:5432/db", "tok"),
            Err(Error::MissingUsername)
        ));
    }

    #[test]
    fn rejects_a_non_url() {
        assert!(matches!(
            inject_password("not-a-url", "tok"),
            Err(Error::MalformedUrl)
        ));
    }

    #[test]
    fn percent_encodes_reserved_bytes() {
        assert_eq!(percent_encode("ab/c d"), "ab%2Fc%20d");
        assert_eq!(percent_encode("aaa.bbb-_~"), "aaa.bbb-_~");
    }

    #[test]
    fn refresh_delay_is_bounded() {
        // Short lifetime clamps up to the floor.
        assert_eq!(refresh_delay(Duration::from_secs(30)), MIN_REFRESH);
        // Long lifetime clamps down to the ceiling.
        assert_eq!(refresh_delay(Duration::from_secs(3600)), MAX_REFRESH);
        // A mid lifetime refreshes REFRESH_SKEW early.
        assert_eq!(
            refresh_delay(Duration::from_secs(1200)),
            Duration::from_secs(1200) - REFRESH_SKEW
        );
    }
}
