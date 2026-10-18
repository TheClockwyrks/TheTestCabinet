//! Tests for the arena configuration's resolution from its variables.

use std::collections::HashMap;

use super::Config;

/// Resolve a configuration from exactly `vars`.
fn config(vars: &[(&str, &str)]) -> Config {
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
