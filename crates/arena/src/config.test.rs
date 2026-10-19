//! Tests for the arena configuration's resolution from its variables.

use std::collections::HashMap;

use super::{AccessConfig, Config, ConfigError};

/// Resolve a configuration from exactly `vars`.
fn config(vars: &[(&str, &str)]) -> Config {
    try_config(vars).unwrap()
}

/// Resolve a configuration from exactly `vars`, or the error it is refused with.
fn try_config(vars: &[(&str, &str)]) -> Result<Config, ConfigError> {
    let vars: HashMap<String, String> = vars
        .iter()
        .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
        .collect();
    Config::from_lookup(|key| vars.get(key).cloned())
}

#[test]
fn the_backend_service_token_is_read_from_its_variable() {
    let config = config(&[("TCAB_BACKEND_SERVICE_TOKEN", "svc-token")]);
    assert_eq!(config.backend_service_token.as_deref(), Some("svc-token"));
}

#[test]
fn an_unset_or_empty_service_token_is_none() {
    assert_eq!(config(&[]).backend_service_token, None);
    assert_eq!(
        config(&[("TCAB_BACKEND_SERVICE_TOKEN", "")]).backend_service_token,
        None
    );
}

#[test]
fn every_other_variable_keeps_its_default() {
    let config = config(&[("TCAB_BACKEND_URL", "http://backend:8787/")]);
    assert_eq!(config.bind, "0.0.0.0:8791");
    assert_eq!(config.backend_url, "http://backend:8787");
    assert_eq!(config.max_concurrent_matches, 2);
}

#[test]
fn no_access_variables_take_the_local_identity_header() {
    assert_eq!(config(&[]).access, None);
    assert_eq!(
        config(&[
            ("TCAB_ACCESS_TEAM_DOMAIN", ""),
            ("TCAB_ACCESS_AUDIENCE", "")
        ])
        .access,
        None
    );
}

#[test]
fn both_access_variables_verify_assertions() {
    let config = config(&[
        (
            "TCAB_ACCESS_TEAM_DOMAIN",
            "shrill-term-5c16.cloudflareaccess.com",
        ),
        ("TCAB_ACCESS_AUDIENCE", "aud-tag"),
    ]);
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
        match try_config(&[(set, "value")]) {
            Err(ConfigError::Unpaired { set: s, unset: u }) => {
                assert_eq!((s, u), (set, unset));
            }
            other => panic!("expected {set} alone to be refused, got {other:?}"),
        }
    }
}
