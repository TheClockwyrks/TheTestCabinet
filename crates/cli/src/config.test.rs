use super::*;

/// A lookup over a fixed set of variables.
fn lookup(vars: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
    let vars: Vec<(String, String)> = vars
        .iter()
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect();
    move |key| {
        vars.iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.clone())
    }
}

#[test]
fn no_access_credential_sends_the_local_identity() {
    let credentials = Credentials::from_lookup(lookup(&[])).expect("nothing set is valid");
    assert_eq!(
        credentials.access(),
        vec![AccessCredential::LocalIdentity("dev@local".to_string())]
    );
    assert!(!credentials.has_access_service_token());
    assert!(!credentials.has_backend_service_token());
}

#[test]
fn the_service_token_pair_is_presented_in_place_of_the_local_identity() {
    let credentials = Credentials::from_lookup(lookup(&[
        (ACCESS_CLIENT_ID, "id.access"),
        (ACCESS_CLIENT_SECRET, "secret"),
    ]))
    .expect("a whole pair is valid");
    assert_eq!(
        credentials.access(),
        vec![AccessCredential::ServiceToken {
            client_id: "id.access".to_string(),
            client_secret: "secret".to_string(),
        }]
    );
    assert!(credentials.has_access_service_token());
}

#[test]
fn a_user_token_and_a_service_token_are_both_presented() {
    let credentials = Credentials::from_lookup(lookup(&[
        (ACCESS_TOKEN, "user"),
        (ACCESS_CLIENT_ID, "id"),
        (ACCESS_CLIENT_SECRET, "secret"),
    ]))
    .expect("valid");
    assert_eq!(
        credentials.access(),
        vec![
            AccessCredential::UserToken("user".to_string()),
            AccessCredential::ServiceToken {
                client_id: "id".to_string(),
                client_secret: "secret".to_string(),
            },
        ]
    );
}

#[test]
fn a_half_set_service_token_pair_is_an_error_naming_both_variables() {
    for vars in [
        &[(ACCESS_CLIENT_ID, "id")][..],
        &[(ACCESS_CLIENT_SECRET, "secret")][..],
    ] {
        let error = Credentials::from_lookup(lookup(vars)).expect_err("half a pair is refused");
        let message = error.to_string();
        assert!(message.contains(ACCESS_CLIENT_ID), "{message}");
        assert!(message.contains(ACCESS_CLIENT_SECRET), "{message}");
    }
}

#[test]
fn the_backend_service_token_does_not_replace_the_local_identity() {
    let credentials =
        Credentials::from_lookup(lookup(&[(BACKEND_SERVICE_TOKEN, "svc")])).expect("valid");
    assert!(credentials.has_backend_service_token());
    assert_eq!(
        credentials.access(),
        vec![AccessCredential::LocalIdentity(LOCAL_IDENTITY.to_string())]
    );
}

#[test]
fn debug_names_no_credential_value() {
    let credentials = Credentials::from_lookup(lookup(&[
        (ACCESS_TOKEN, "user-secret-value"),
        (ACCESS_CLIENT_ID, "id-value"),
        (ACCESS_CLIENT_SECRET, "secret-value"),
        (BACKEND_SERVICE_TOKEN, "svc-value"),
    ]))
    .expect("valid");
    let debug = format!("{credentials:?}");
    for value in ["user-secret-value", "id-value", "secret-value", "svc-value"] {
        assert!(!debug.contains(value), "{debug}");
    }
}
