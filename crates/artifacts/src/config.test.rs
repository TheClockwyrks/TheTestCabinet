//! Tests for the artifact service's configuration, resolved from its variables.

use std::collections::HashMap;

use super::{AccessConfig, BlobAuth, Config, ConfigError, PublicStoreConfig};

/// The variables every configuration needs: a run-tree container under
/// workload identity and a public container.
const REQUIRED: [(&str, &str); 3] = [
    ("TCAB_ARTIFACTS_BLOB_ACCOUNT", "tcabstagingruns"),
    ("TCAB_ARTIFACTS_BLOB_CONTAINER", "runs"),
    ("TCAB_ARTIFACTS_PUBLIC_BLOB_CONTAINER", "public"),
];

/// The four variables naming an R2 bucket.
const R2: [(&str, &str); 4] = [
    ("TCAB_R2_ACCOUNT_ID", "acct"),
    ("TCAB_R2_BUCKET", "snapshot"),
    ("TCAB_R2_ACCESS_KEY_ID", "id"),
    ("TCAB_R2_SECRET_ACCESS_KEY", "secret"),
];

/// Resolve a configuration from exactly `vars`.
fn exactly(vars: &[(&str, &str)]) -> Result<Config, ConfigError> {
    let vars: HashMap<String, String> = vars
        .iter()
        .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
        .collect();
    Config::from_lookup(|key| vars.get(key).cloned())
}

/// Resolve a configuration from the required variables plus `vars`, which
/// override them.
fn config(vars: &[(&str, &str)]) -> Result<Config, ConfigError> {
    let mut all: Vec<(&str, &str)> = REQUIRED
        .iter()
        .filter(|(key, _)| !vars.iter().any(|(k, _)| k == key))
        .copied()
        .collect();
    all.extend_from_slice(vars);
    exactly(&all)
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
            Err(ConfigError::Unpaired {
                set: s, unset: u, ..
            }) => {
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

#[test]
fn no_blob_endpoint_or_key_authenticates_by_workload_identity() {
    let config = config(&[]).unwrap();
    assert_eq!(config.blob.account, "tcabstagingruns");
    assert_eq!(config.blob.container, "runs");
    assert_eq!(
        config.blob.endpoint,
        "https://tcabstagingruns.blob.core.windows.net"
    );
    assert_eq!(config.blob.auth, BlobAuth::WorkloadIdentity);
    assert_eq!(
        config.public_store,
        PublicStoreConfig::Blob {
            container: "public".into()
        }
    );
}

#[test]
fn an_endpoint_and_key_sign_with_shared_key() {
    let config = config(&[
        ("TCAB_ARTIFACTS_BLOB_ACCOUNT", "devstoreaccount1"),
        (
            "TCAB_ARTIFACTS_BLOB_ENDPOINT",
            "http://azurite:10000/devstoreaccount1/",
        ),
        ("TCAB_ARTIFACTS_BLOB_KEY", "a2V5"),
    ])
    .unwrap();
    assert_eq!(
        config.blob.endpoint,
        "http://azurite:10000/devstoreaccount1"
    );
    assert_eq!(config.blob.auth, BlobAuth::SharedKey(b"key".to_vec()));
}

#[test]
fn an_endpoint_or_key_alone_is_refused() {
    for (set, unset) in [
        ("TCAB_ARTIFACTS_BLOB_ENDPOINT", "TCAB_ARTIFACTS_BLOB_KEY"),
        ("TCAB_ARTIFACTS_BLOB_KEY", "TCAB_ARTIFACTS_BLOB_ENDPOINT"),
    ] {
        match config(&[(set, "a2V5")]) {
            Err(ConfigError::Unpaired {
                set: s, unset: u, ..
            }) => assert_eq!((s, u), (set, unset)),
            other => panic!("expected {set} alone to be refused, got {other:?}"),
        }
    }
}

#[test]
fn a_key_that_is_not_base64_is_refused() {
    assert!(matches!(
        config(&[
            (
                "TCAB_ARTIFACTS_BLOB_ENDPOINT",
                "http://azurite:10000/devstoreaccount1"
            ),
            ("TCAB_ARTIFACTS_BLOB_KEY", "not base64!"),
        ]),
        Err(ConfigError::InvalidBlobKey)
    ));
}

#[test]
fn the_run_tree_container_is_required() {
    for missing in [
        "TCAB_ARTIFACTS_BLOB_ACCOUNT",
        "TCAB_ARTIFACTS_BLOB_CONTAINER",
    ] {
        let vars: Vec<(&str, &str)> = REQUIRED
            .iter()
            .filter(|(key, _)| *key != missing)
            .copied()
            .collect();
        match exactly(&vars) {
            Err(ConfigError::Missing(name)) => assert_eq!(name, missing),
            other => panic!("expected {missing} to be required, got {other:?}"),
        }
    }
}

#[test]
fn r2_variables_name_the_public_bucket() {
    let mut vars = vec![REQUIRED[0], REQUIRED[1]];
    vars.extend_from_slice(&R2);
    let config = exactly(&vars).unwrap();
    match config.public_store {
        PublicStoreConfig::R2(r2) => {
            assert_eq!(r2.bucket, "snapshot");
            assert_eq!(r2.endpoint, "https://acct.r2.cloudflarestorage.com");
        }
        other => panic!("expected the R2 bucket, got {other:?}"),
    }
}

#[test]
fn exactly_one_public_store_is_accepted() {
    // Neither.
    assert!(matches!(
        exactly(&[REQUIRED[0], REQUIRED[1]]),
        Err(ConfigError::PublicStore(_))
    ));
    // Both.
    let mut both = REQUIRED.to_vec();
    both.extend_from_slice(&R2);
    assert!(matches!(exactly(&both), Err(ConfigError::PublicStore(_))));
    // Only an endpoint override still names R2, and with a container is both.
    assert!(matches!(
        config(&[("TCAB_R2_ENDPOINT", "https://example.invalid")]),
        Err(ConfigError::PublicStore(_))
    ));
}

#[test]
fn a_partial_r2_set_names_what_is_missing() {
    let vars = [REQUIRED[0], REQUIRED[1], R2[0], R2[1], R2[3]];
    match exactly(&vars) {
        Err(ConfigError::R2Incomplete(name)) => assert_eq!(name, "TCAB_R2_ACCESS_KEY_ID"),
        other => panic!("expected a partial R2 set to be refused, got {other:?}"),
    }
}

#[test]
fn the_public_container_cannot_be_the_private_one() {
    assert!(matches!(
        config(&[("TCAB_ARTIFACTS_PUBLIC_BLOB_CONTAINER", "runs")]),
        Err(ConfigError::PublicIsPrivate(name)) if name == "runs"
    ));
}

/// The variables of an Azurite endpoint signed with Shared Key.
const AZURITE: [(&str, &str); 3] = [
    ("TCAB_ARTIFACTS_BLOB_ACCOUNT", "devstoreaccount1"),
    (
        "TCAB_ARTIFACTS_BLOB_ENDPOINT",
        "http://tcab-azurite:10000/devstoreaccount1",
    ),
    ("TCAB_ARTIFACTS_BLOB_KEY", "a2V5"),
];

#[test]
fn an_emulator_creates_the_run_tree_and_public_containers() {
    let config = config(&AZURITE).unwrap();
    assert_eq!(config.emulator_containers(), vec!["runs", "public"]);
}

#[test]
fn an_emulator_with_r2_creates_only_the_run_tree_container() {
    let mut vars: Vec<(&str, &str)> = AZURITE.to_vec();
    vars.push(("TCAB_ARTIFACTS_BLOB_CONTAINER", "runs"));
    vars.extend_from_slice(&R2);
    let config = exactly(&vars).unwrap();
    assert_eq!(config.emulator_containers(), vec!["runs"]);
}

#[test]
fn workload_identity_creates_no_container() {
    let config = config(&[]).unwrap();
    assert!(config.emulator_containers().is_empty());
}
