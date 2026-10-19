//! CLI configuration, from the environment as the other components are
//! configured: the backend URL and the credentials every backend request presents.
//!
//! A deployed environment is reached through its edge, which admits a request
//! carrying an Access credential: a person's user token (`TCAB_ACCESS_TOKEN`) or
//! the service token pair (`TCAB_ACCESS_CLIENT_ID` and `TCAB_ACCESS_CLIENT_SECRET`).
//! The local stack has no edge and records the identity a request names in
//! `Cf-Access-Authenticated-User-Email`, which is sent as [`LOCAL_IDENTITY`] when
//! no Access credential is set. A backend reached directly, through a
//! port-forward or as a bare process, takes its shared service token
//! (`TCAB_BACKEND_SERVICE_TOKEN`) as a bearer. See
//! <https://docs.testcabinet.ai/components/cli/overview/#authentication>.

use anyhow::{Result, bail};
use test_cabinet_backend_client::{AccessCredential, HttpBackendClient};

/// The variable carrying the backend's base URL.
pub const BACKEND_URL: &str = "TCAB_BACKEND_URL";
/// The variable carrying a person's Access user token.
pub const ACCESS_TOKEN: &str = "TCAB_ACCESS_TOKEN";
/// The variable carrying the Access service token's client id.
pub const ACCESS_CLIENT_ID: &str = "TCAB_ACCESS_CLIENT_ID";
/// The variable carrying the Access service token's client secret.
pub const ACCESS_CLIENT_SECRET: &str = "TCAB_ACCESS_CLIENT_SECRET";
/// The variable carrying the backend's shared service token.
pub const BACKEND_SERVICE_TOKEN: &str = "TCAB_BACKEND_SERVICE_TOKEN";

/// The identity the local stack records a call under when no Access credential
/// is set.
pub const LOCAL_IDENTITY: &str = "dev@local";

/// The backend base URL from `TCAB_BACKEND_URL`, or `None` when unset/blank.
pub fn backend_url() -> Option<String> {
    nonempty_env(BACKEND_URL)
}

/// The credentials a backend request presents, read from the environment.
///
/// No value reaches [`Debug`]: the Access credentials redact themselves and the
/// service token is printed only as present or absent.
#[derive(Clone, PartialEq, Eq)]
pub struct Credentials {
    /// The person's Access user token, when `TCAB_ACCESS_TOKEN` is set.
    user_token: Option<String>,
    /// The Access service token pair, when both of its variables are set.
    service_pair: Option<(String, String)>,
    /// The backend's shared service token, when `TCAB_BACKEND_SERVICE_TOKEN` is set.
    service_token: Option<String>,
}

impl std::fmt::Debug for Credentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Credentials")
            .field("user_token", &self.user_token.is_some())
            .field("service_pair", &self.service_pair.is_some())
            .field("service_token", &self.service_token.is_some())
            .finish()
    }
}

impl Credentials {
    /// Read the credentials from the process environment.
    ///
    /// Errors when only one half of the Access service token pair is set, naming
    /// both variables, rather than sending a request the edge would refuse.
    pub fn from_env() -> Result<Self> {
        Self::from_lookup(nonempty_env)
    }

    /// Read the credentials through `lookup`, which answers a variable's non-empty,
    /// trimmed value.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self> {
        let service_pair = match (lookup(ACCESS_CLIENT_ID), lookup(ACCESS_CLIENT_SECRET)) {
            (Some(id), Some(secret)) => Some((id, secret)),
            (None, None) => None,
            (Some(_), None) | (None, Some(_)) => bail!(
                "{ACCESS_CLIENT_ID} and {ACCESS_CLIENT_SECRET} are the two halves of one \
                 Access service token: set both, or neither"
            ),
        };
        Ok(Self {
            user_token: lookup(ACCESS_TOKEN),
            service_pair,
            service_token: lookup(BACKEND_SERVICE_TOKEN),
        })
    }

    /// Whether the Access service token pair is set.
    pub fn has_access_service_token(&self) -> bool {
        self.service_pair.is_some()
    }

    /// Whether the backend's shared service token is set.
    pub fn has_backend_service_token(&self) -> bool {
        self.service_token.is_some()
    }

    /// The Access service token, when its pair is set: the one credential a
    /// write of the public dataset through the edge takes, since the artifacts
    /// service refuses a person's assertion there.
    pub fn access_service_token(&self) -> Option<AccessCredential> {
        self.service_pair
            .as_ref()
            .map(
                |(client_id, client_secret)| AccessCredential::ServiceToken {
                    client_id: client_id.clone(),
                    client_secret: client_secret.clone(),
                },
            )
    }

    /// The headers' credentials: every Access credential that is set, or the
    /// local identity when none is.
    pub fn access(&self) -> Vec<AccessCredential> {
        let mut access = Vec::new();
        if let Some(token) = &self.user_token {
            access.push(AccessCredential::UserToken(token.clone()));
        }
        if let Some((client_id, client_secret)) = &self.service_pair {
            access.push(AccessCredential::ServiceToken {
                client_id: client_id.clone(),
                client_secret: client_secret.clone(),
            });
        }
        if access.is_empty() {
            access.push(AccessCredential::LocalIdentity(LOCAL_IDENTITY.to_string()));
        }
        access
    }

    /// A backend client for `base_url` presenting these credentials on every
    /// request: the Access credentials (or the local identity) and, when set, the
    /// backend's service token as a bearer.
    pub fn client(&self, base_url: impl Into<String>) -> HttpBackendClient {
        HttpBackendClient::new(base_url)
            .with_access(self.access())
            .with_token(self.service_token.clone())
    }
}

/// Read a non-empty environment variable, trimmed.
fn nonempty_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
#[path = "config.test.rs"]
mod tests;
