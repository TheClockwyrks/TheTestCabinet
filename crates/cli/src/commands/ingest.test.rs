use super::*;
use crate::config::ACCESS_TOKEN;

#[test]
fn an_ingested_version_names_its_rendered_references() {
    assert_eq!(
        version_state(true, 3, None, None),
        "ingested (3 reference image(s))"
    );
}

#[test]
fn a_skipped_version_names_the_reason_the_backend_gave() {
    assert_eq!(
        version_state(false, 0, Some("unchanged"), None),
        "skipped: unchanged"
    );
}

#[test]
fn a_skip_without_a_reason_is_one_the_store_already_held() {
    assert_eq!(
        version_state(false, 0, None, None),
        "skipped: already stored"
    );
}

#[test]
fn a_refused_version_names_the_problem_it_was_refused_for() {
    assert_eq!(
        version_state(false, 0, None, Some("`carom` does not validate")),
        "refused: `carom` does not validate"
    );
}

/// Credentials over a fixed set of variables.
fn credentials(vars: &[(&str, &str)]) -> Credentials {
    let vars: Vec<(String, String)> = vars
        .iter()
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect();
    Credentials::from_lookup(move |key| {
        vars.iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.clone())
    })
    .expect("valid credentials")
}

fn service_pair() -> Credentials {
    credentials(&[(ACCESS_CLIENT_ID, "id"), (ACCESS_CLIENT_SECRET, "secret")])
}

#[test]
fn an_environment_is_ingested_at_its_origins_api_path_with_a_refresh() {
    assert_eq!(
        target(Some(DeployEnv::Staging), None, &service_pair()).expect("staging resolves"),
        Target {
            url: "https://console.staging.testcabinet.ai/api".to_string(),
            refresh: true,
        }
    );
    assert_eq!(
        target(Some(DeployEnv::Prod), None, &service_pair())
            .expect("prod resolves")
            .url,
        "https://console.testcabinet.ai/api"
    );
}

#[test]
fn an_environment_without_the_service_token_pair_is_refused_naming_it() {
    for vars in [&[][..], &[(ACCESS_TOKEN, "user")][..]] {
        let error = target(Some(DeployEnv::Staging), None, &credentials(vars))
            .expect_err("no service token pair");
        let message = error.to_string();
        assert!(message.contains(ACCESS_CLIENT_ID), "{message}");
        assert!(message.contains(ACCESS_CLIENT_SECRET), "{message}");
    }
}

#[test]
fn the_backend_url_naming_the_environments_edge_is_the_edge_path() {
    let url = "https://console.testcabinet.ai/api".to_string();
    assert_eq!(
        target(Some(DeployEnv::Prod), Some(url.clone()), &service_pair()).expect("resolves"),
        Target { url, refresh: true }
    );
}

#[test]
fn the_backend_url_naming_the_other_environments_edge_is_refused() {
    let error = target(
        Some(DeployEnv::Prod),
        Some("https://console.staging.testcabinet.ai/api".to_string()),
        &service_pair(),
    )
    .expect_err("staging's edge is not prod");
    assert!(error.to_string().contains("staging"), "{error}");
}

#[test]
fn a_port_forwarded_environment_presents_the_backends_service_token() {
    let url = "http://127.0.0.1:8787".to_string();
    assert_eq!(
        target(
            Some(DeployEnv::Prod),
            Some(url.clone()),
            &credentials(&[(BACKEND_SERVICE_TOKEN, "svc")]),
        )
        .expect("a port-forward with the service token resolves"),
        Target { url, refresh: true }
    );
    let error = target(
        Some(DeployEnv::Prod),
        Some("http://127.0.0.1:8787".to_string()),
        &service_pair(),
    )
    .expect_err("the Access pair does not reach a port-forwarded backend");
    assert!(error.to_string().contains(BACKEND_SERVICE_TOKEN), "{error}");
}

#[test]
fn a_local_ingest_needs_the_backend_url_and_asks_no_refresh() {
    let url = "http://127.0.0.1:8787".to_string();
    assert_eq!(
        target(None, Some(url.clone()), &credentials(&[])).expect("local resolves"),
        Target {
            url,
            refresh: false,
        }
    );
    let error = target(None, None, &credentials(&[])).expect_err("no backend");
    assert!(error.to_string().contains(BACKEND_URL), "{error}");
}

#[test]
fn a_host_is_read_without_its_port_or_path() {
    assert_eq!(
        host_of("https://Console.TestCabinet.ai:443/api").as_deref(),
        Some("console.testcabinet.ai")
    );
    assert_eq!(
        host_of("http://127.0.0.1:8787").as_deref(),
        Some("127.0.0.1")
    );
    assert_eq!(host_of("console.testcabinet.ai"), None);
    assert_eq!(
        edge_of("https://console.testcabinet.ai.evil.example/api"),
        None
    );
}
