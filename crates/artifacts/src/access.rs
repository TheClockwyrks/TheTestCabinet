//! Verification of the Cloudflare Access assertion.
//!
//! Every request that crosses the edge carries `Cf-Access-Jwt-Assertion`, a JWT
//! the team's Access instance signs with RS256. [`AccessVerifier`] checks the three
//! things the [identity contract] names: the signature against the keys published
//! at `https://<team domain>/cdn-cgi/access/certs`, the `aud` claim against the
//! audience tag of the Access application the service sits behind, and the expiry.
//!
//! The keys are cached. A token naming a key id the cached set lacks refetches the
//! set, which is how a key rotation reaches a running service without a restart.
//! Refetches are serialized and spaced by [`MIN_REFETCH_INTERVAL`], so a stream of
//! forged tokens naming made-up key ids costs one fetch per interval rather than one
//! per request.
//!
//! The check is the backend's own, repeated here because the artifact service depends on
//! the `contracts` repository alone and never on the backend's crate.
//!
//! [identity contract]: https://docs.testcabinet.ai/components/auth/overview/#the-assertion

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Duration, Instant};

use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{Algorithm, DecodingKey, Validation};
use serde::Deserialize;

#[cfg(test)]
#[path = "access.test.rs"]
pub(crate) mod tests;

/// The header the edge carries the assertion in.
pub const ASSERTION_HEADER: &str = "cf-access-jwt-assertion";

/// The shortest gap between two refetches of the key set that an unknown key id
/// triggers. Cloudflare rotates its signing keys every few weeks and publishes the
/// next key before signing with it, so a service never waits on this interval for a
/// genuine token; it bounds what a forged one can make the service fetch.
pub const MIN_REFETCH_INTERVAL: Duration = Duration::from_secs(30);

/// The Access application a service verifies assertions against, resolved from
/// `TCAB_ACCESS_TEAM_DOMAIN` and `TCAB_ACCESS_AUDIENCE`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccessConfig {
    /// The Access team domain whose certificates sign the assertion, such as
    /// `shrill-term-5c16.cloudflareaccess.com`.
    pub team_domain: String,
    /// The audience tag of the Access application protecting the service's
    /// hostname.
    pub audience: String,
}

impl AccessConfig {
    /// The URL the team publishes its signing keys at.
    pub fn certs_url(&self) -> String {
        let domain = self
            .team_domain
            .trim()
            .trim_start_matches("https://")
            .trim_end_matches('/');
        format!("https://{domain}/cdn-cgi/access/certs")
    }
}

/// Who a verified assertion names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssertedIdentity {
    /// A person signed in through the identity provider, named by their `email`.
    Person(String),
    /// An Access service token, named by its `common_name`.
    ServiceToken(String),
}

/// Why an assertion was not accepted.
#[derive(Debug, thiserror::Error)]
pub enum AccessError {
    /// The assertion is malformed, signed by no key the team publishes, names
    /// another audience, has expired, or names no caller. The request is a `401`.
    #[error("{0}")]
    Rejected(String),
    /// The team's signing keys could not be fetched, so the assertion could not be
    /// checked at all. The request is a `502`, which a caller retries.
    #[error("{0}")]
    Unavailable(String),
}

/// The claims the service reads from a verified assertion. `aud` and `exp` are
/// checked by the [`Validation`] before these are read.
#[derive(Debug, Deserialize)]
struct Claims {
    /// A person's address; absent or empty on a service token's assertion.
    #[serde(default)]
    email: Option<String>,
    /// A service token's name; absent on a person's assertion.
    #[serde(default)]
    common_name: Option<String>,
}

/// Verifies Access assertions against one application's audience tag and the
/// team's published keys, caching the keys.
pub struct AccessVerifier {
    /// Where the team's key set is fetched from.
    certs_url: String,
    /// The validation every assertion passes: RS256, the audience, the expiry.
    validation: Validation,
    /// The client the key set is fetched with.
    http: reqwest::Client,
    /// The cached keys, by key id.
    keys: RwLock<HashMap<String, DecodingKey>>,
    /// When the key set was last fetched, held across a fetch so concurrent
    /// requests naming the same new key wait for one fetch rather than racing.
    fetched_at: tokio::sync::Mutex<Option<Instant>>,
    /// The shortest gap between two fetches an unknown key id triggers.
    min_refetch_interval: Duration,
}

impl std::fmt::Debug for AccessVerifier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AccessVerifier")
            .field("certs_url", &self.certs_url)
            .field("audience", &self.validation.aud)
            .finish_non_exhaustive()
    }
}

impl AccessVerifier {
    /// A verifier for `config`'s application, fetching the team's keys with `http`.
    pub fn new(config: &AccessConfig, http: reqwest::Client) -> Self {
        Self::with_certs_url(
            config.certs_url(),
            &config.audience,
            http,
            MIN_REFETCH_INTERVAL,
        )
    }

    /// A verifier reading its keys from `certs_url`, for the tests that serve a key
    /// set of their own, with the refetch spacing they choose.
    pub fn with_certs_url(
        certs_url: impl Into<String>,
        audience: &str,
        http: reqwest::Client,
        min_refetch_interval: Duration,
    ) -> Self {
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_audience(&[audience]);
        validation.set_required_spec_claims(&["exp", "aud"]);
        Self {
            certs_url: certs_url.into(),
            validation,
            http,
            keys: RwLock::new(HashMap::new()),
            fetched_at: tokio::sync::Mutex::new(None),
            min_refetch_interval,
        }
    }

    /// Verify `assertion` and return the caller it names.
    pub async fn verify(&self, assertion: &str) -> Result<AssertedIdentity, AccessError> {
        let header = jsonwebtoken::decode_header(assertion)
            .map_err(|err| AccessError::Rejected(format!("malformed Access assertion: {err}")))?;
        if header.alg != Algorithm::RS256 {
            return Err(AccessError::Rejected(format!(
                "Access assertion is signed with {:?}, not RS256",
                header.alg
            )));
        }
        let kid = header
            .kid
            .ok_or_else(|| AccessError::Rejected("Access assertion names no key id".into()))?;

        if !self.knows(&kid) {
            self.refetch_for(&kid).await?;
        }
        let claims = {
            let keys = self
                .keys
                .read()
                .unwrap_or_else(|poison| poison.into_inner());
            let key = keys.get(&kid).ok_or_else(|| {
                AccessError::Rejected(format!(
                    "Access assertion is signed by key `{kid}`, which the team does not publish"
                ))
            })?;
            jsonwebtoken::decode::<Claims>(assertion, key, &self.validation)
                .map_err(|err| AccessError::Rejected(format!("invalid Access assertion: {err}")))?
                .claims
        };

        if let Some(email) = claims.email.filter(|email| !email.trim().is_empty()) {
            return Ok(AssertedIdentity::Person(email));
        }
        if let Some(name) = claims.common_name.filter(|name| !name.trim().is_empty()) {
            return Ok(AssertedIdentity::ServiceToken(name));
        }
        Err(AccessError::Rejected(
            "Access assertion carries neither an email nor a common_name".into(),
        ))
    }

    /// Whether the cached set holds key `kid`.
    fn knows(&self, kid: &str) -> bool {
        self.keys
            .read()
            .unwrap_or_else(|poison| poison.into_inner())
            .contains_key(kid)
    }

    /// Refetch the key set because a token named `kid`, unless another request
    /// already fetched it while this one waited, or the last fetch is more recent
    /// than the refetch spacing allows.
    async fn refetch_for(&self, kid: &str) -> Result<(), AccessError> {
        let mut fetched_at = self.fetched_at.lock().await;
        if self.knows(kid) {
            return Ok(());
        }
        if let Some(at) = *fetched_at
            && at.elapsed() < self.min_refetch_interval
        {
            return Ok(());
        }
        let keys = self.fetch().await?;
        *fetched_at = Some(Instant::now());
        *self
            .keys
            .write()
            .unwrap_or_else(|poison| poison.into_inner()) = keys;
        Ok(())
    }

    /// Fetch and parse the team's key set, keeping each RSA key that names a key id.
    async fn fetch(&self) -> Result<HashMap<String, DecodingKey>, AccessError> {
        let unavailable = |err: String| {
            AccessError::Unavailable(format!(
                "fetching the Access signing keys from {}: {err}",
                self.certs_url
            ))
        };
        let response = self
            .http
            .get(&self.certs_url)
            .send()
            .await
            .map_err(|err| unavailable(err.to_string()))?;
        let status = response.status();
        if !status.is_success() {
            return Err(unavailable(format!("HTTP {status}")));
        }
        let set: JwkSet = response
            .json()
            .await
            .map_err(|err| unavailable(err.to_string()))?;
        let mut keys = HashMap::new();
        for jwk in &set.keys {
            let Some(kid) = jwk.common.key_id.clone() else {
                continue;
            };
            if !matches!(
                jwk.algorithm,
                jsonwebtoken::jwk::AlgorithmParameters::RSA(_)
            ) {
                continue;
            }
            match DecodingKey::from_jwk(jwk) {
                Ok(key) => {
                    keys.insert(kid, key);
                }
                Err(err) => {
                    tracing::warn!(kid, error = %err, "skipping an unreadable Access signing key");
                }
            }
        }
        if keys.is_empty() {
            return Err(unavailable("the key set holds no RSA key".into()));
        }
        Ok(keys)
    }
}
