//! Tests for the artifact service's configuration, resolved from its variables.

use std::collections::HashMap;

use super::{AccessConfig, Config, ConfigError};

/// Resolve a configuration from exactly `vars`.
fn config(vars: &[(&str, &str)]) -> Result<Config, ConfigError> {
    let vars: HashMap<String, String> = vars
        .iter()
        .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
        .collect();
    Config::from_lookup(|key| vars.get(key).cloned())
}

#[test]
fn no_access_variables_take_the_local_identity_header() {
    let config = config(&[]).unwrap();
    assert_eq!(config.access, None);
    assert_eq!(config.bind, "0.0.0.0:8790");
    assert_eq!(config.backend_url, "http://127.0.0.1:8787");
    assert_eq!(config.service_token, None);
}

#[test]
fn both_access_variables_verify_assertions() {
    let config = config(&[
        (
            "TCAB_ACCESS_TEAM_DOMAIN",
            "shrill-term-5c16.cloudflareaccess.com",
        ),
        ("TCAB_ACCESS_AUDIENCE", "aud-tag"),
    ])
    .unwrap();
    assert_eq!(
        config.access,
        Some(AccessConfig {
            team_domain: "shrill-term-5c16.cloudflareaccess.com".into(),
            audience: "aud-tag".into(),
        })
    );
}

#[test]
fn one_access_variable_alone_is_refused() {
    for (set, unset) in [
        ("TCAB_ACCESS_TEAM_DOMAIN", "TCAB_ACCESS_AUDIENCE"),
        ("TCAB_ACCESS_AUDIENCE", "TCAB_ACCESS_TEAM_DOMAIN"),
    ] {
        match config(&[(set, "value")]) {
            Err(ConfigError::Unpaired { set: s, unset: u }) => {
                assert_eq!((s, u), (set, unset));
            }
            other => panic!("expected {set} alone to be refused, got {other:?}"),
        }
    }
}

#[test]
fn an_empty_access_variable_counts_as_unset() {
    let config = config(&[
        ("TCAB_ACCESS_TEAM_DOMAIN", ""),
        ("TCAB_ACCESS_AUDIENCE", ""),
    ])
    .unwrap();
    assert_eq!(config.access, None);
}

#[test]
fn the_service_token_and_backend_url_are_read() {
    let config = config(&[
        ("TCAB_BACKEND_SERVICE_TOKEN", "svc"),
        ("TCAB_BACKEND_URL", "http://backend:8787/"),
    ])
    .unwrap();
    assert_eq!(config.service_token.as_deref(), Some("svc"));
    assert_eq!(config.backend_url, "http://backend:8787");
}
