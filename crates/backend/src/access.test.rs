//! The assertion check against a key set served from a local stand-in for the
//! team's certificates endpoint, so nothing here reaches Cloudflare.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use axum::routing::get;
use jsonwebtoken::{EncodingKey, Header};

use super::{AccessError, AccessVerifier, AssertedIdentity};

#[path = "access.keys.test.rs"]
pub(crate) mod keys;

use keys::{KEY_A, KEY_B, TestKey, epoch_in, key_set, person_claims, service_claims};

/// The audience tag the verifier under test checks for.
const AUDIENCE: &str = "test-audience-tag";

/// A stand-in for `/cdn-cgi/access/certs`: the key set it serves, which a test can
/// replace to rotate keys, and how many times it was fetched.
pub(crate) struct CertsStub {
    keys: Mutex<serde_json::Value>,
    fetches: AtomicUsize,
}

impl CertsStub {
    /// Publish `keys` from now on.
    pub(crate) fn publish(&self, keys: &[&TestKey]) {
        *self.keys.lock().unwrap() = key_set(keys);
    }

    /// How many times the key set was fetched.
    pub(crate) fn fetches(&self) -> usize {
        self.fetches.load(Ordering::SeqCst)
    }
}

/// Serve `keys` as a team's certificates and return the endpoint's URL beside the
/// stub.
pub(crate) async fn serve_certs(keys: &[&TestKey]) -> (String, Arc<CertsStub>) {
    let stub = Arc::new(CertsStub {
        keys: Mutex::new(key_set(keys)),
        fetches: AtomicUsize::new(0),
    });
    let app = Router::new().route(
        "/cdn-cgi/access/certs",
        get({
            let stub = Arc::clone(&stub);
            move || {
                let stub = Arc::clone(&stub);
                async move {
                    stub.fetches.fetch_add(1, Ordering::SeqCst);
                    axum::Json(stub.keys.lock().unwrap().clone())
                }
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{addr}/cdn-cgi/access/certs"), stub)
}

/// A verifier for [`AUDIENCE`] reading `url`, refetching on every unknown key id.
fn verifier(url: &str) -> AccessVerifier {
    AccessVerifier::with_certs_url(url, AUDIENCE, reqwest::Client::new(), Duration::ZERO)
}

/// The rejection message of a verification that must fail with a `401`.
async fn rejected(verifier: &AccessVerifier, assertion: &str) -> String {
    match verifier.verify(assertion).await {
        Err(AccessError::Rejected(message)) => message,
        other => panic!("expected a rejection, got {other:?}"),
    }
}

#[tokio::test]
async fn a_persons_assertion_names_their_email() {
    let (url, _) = serve_certs(&[&KEY_A]).await;
    let identity = verifier(&url)
        .verify(&KEY_A.sign(&person_claims("ada@example.com", AUDIENCE)))
        .await
        .unwrap();
    assert_eq!(identity, AssertedIdentity::Person("ada@example.com".into()));
}

#[tokio::test]
async fn a_service_tokens_assertion_names_its_common_name() {
    // Cloudflare mints a service token's assertion with an empty `email`, which must
    // not read as a person.
    let (url, _) = serve_certs(&[&KEY_A]).await;
    let identity = verifier(&url)
        .verify(&KEY_A.sign(&service_claims("tcab-automation-staging.access", AUDIENCE)))
        .await
        .unwrap();
    assert_eq!(
        identity,
        AssertedIdentity::ServiceToken("tcab-automation-staging.access".into())
    );
}

#[tokio::test]
async fn an_assertion_for_another_application_is_rejected() {
    let (url, _) = serve_certs(&[&KEY_A]).await;
    let message = rejected(
        &verifier(&url),
        &KEY_A.sign(&person_claims("ada@example.com", "another-application")),
    )
    .await;
    assert!(message.contains("invalid Access assertion"), "{message}");
}

#[tokio::test]
async fn an_assertion_without_an_audience_is_rejected() {
    let (url, _) = serve_certs(&[&KEY_A]).await;
    let mut claims = person_claims("ada@example.com", AUDIENCE);
    claims.as_object_mut().unwrap().remove("aud");
    rejected(&verifier(&url), &KEY_A.sign(&claims)).await;
}

#[tokio::test]
async fn an_expired_assertion_is_rejected() {
    let (url, _) = serve_certs(&[&KEY_A]).await;
    let mut claims = person_claims("ada@example.com", AUDIENCE);
    claims["exp"] = epoch_in(Duration::from_secs(3600), true).into();
    let message = rejected(&verifier(&url), &KEY_A.sign(&claims)).await;
    assert!(message.to_lowercase().contains("expired"), "{message}");
}

#[tokio::test]
async fn an_assertion_without_an_expiry_is_rejected() {
    let (url, _) = serve_certs(&[&KEY_A]).await;
    let mut claims = person_claims("ada@example.com", AUDIENCE);
    claims.as_object_mut().unwrap().remove("exp");
    rejected(&verifier(&url), &KEY_A.sign(&claims)).await;
}

#[tokio::test]
async fn a_signature_by_another_key_is_rejected() {
    // Signed by key B while naming key A, which the team publishes: the signature
    // is what fails.
    let (url, _) = serve_certs(&[&KEY_A]).await;
    let forged = KEY_B.sign_as(KEY_A.kid, &person_claims("ada@example.com", AUDIENCE));
    rejected(&verifier(&url), &forged).await;
}

#[tokio::test]
async fn a_tampered_payload_is_rejected() {
    let (url, _) = serve_certs(&[&KEY_A]).await;
    let genuine = KEY_A.sign(&person_claims("ada@example.com", AUDIENCE));
    let other = KEY_A.sign(&person_claims("mallory@example.com", AUDIENCE));
    let mut parts: Vec<&str> = genuine.split('.').collect();
    parts[1] = other.split('.').nth(1).unwrap();
    rejected(&verifier(&url), &parts.join(".")).await;
}

#[tokio::test]
async fn an_hmac_assertion_is_rejected() {
    // An HS256 token keyed with a public value is the classic algorithm confusion;
    // only RS256 is accepted.
    let (url, _) = serve_certs(&[&KEY_A]).await;
    let mut header = Header::new(jsonwebtoken::Algorithm::HS256);
    header.kid = Some(KEY_A.kid.to_string());
    let token = jsonwebtoken::encode(
        &header,
        &person_claims("ada@example.com", AUDIENCE),
        &EncodingKey::from_secret(b"anything"),
    )
    .unwrap();
    let message = rejected(&verifier(&url), &token).await;
    assert!(message.contains("RS256"), "{message}");
}

#[tokio::test]
async fn an_assertion_naming_no_key_is_rejected() {
    let (url, stub) = serve_certs(&[&KEY_A]).await;
    let mut header = Header::new(jsonwebtoken::Algorithm::RS256);
    header.kid = None;
    // The signature is never reached, so any bytes stand in for it.
    let unsigned = format!(
        "{}.{}",
        base64url(&serde_json::to_vec(&header).unwrap()),
        base64url(&serde_json::to_vec(&person_claims("ada@example.com", AUDIENCE)).unwrap())
    );
    let message = rejected(&verifier(&url), &format!("{unsigned}.c2ln")).await;
    assert!(message.contains("no key id"), "{message}");
    assert_eq!(stub.fetches(), 0, "a token naming no key fetches nothing");
}

#[tokio::test]
async fn an_assertion_naming_no_caller_is_rejected() {
    let (url, _) = serve_certs(&[&KEY_A]).await;
    let mut claims = person_claims("", AUDIENCE);
    claims.as_object_mut().unwrap().remove("email");
    let message = rejected(&verifier(&url), &KEY_A.sign(&claims)).await;
    assert!(
        message.contains("neither an email nor a common_name"),
        "{message}"
    );
}

#[tokio::test]
async fn keys_are_cached_across_assertions() {
    let (url, stub) = serve_certs(&[&KEY_A]).await;
    let verifier = verifier(&url);
    for email in ["ada@example.com", "grace@example.com", "edsger@example.com"] {
        verifier
            .verify(&KEY_A.sign(&person_claims(email, AUDIENCE)))
            .await
            .unwrap();
    }
    assert_eq!(stub.fetches(), 1, "the key set is fetched once and cached");
}

#[tokio::test]
async fn a_rotated_key_is_fetched_when_a_token_names_it() {
    let (url, stub) = serve_certs(&[&KEY_A]).await;
    let verifier = verifier(&url);
    verifier
        .verify(&KEY_A.sign(&person_claims("ada@example.com", AUDIENCE)))
        .await
        .unwrap();
    assert_eq!(stub.fetches(), 1);

    // The team rotates to key B. The first token signed with it names a key id the
    // cache lacks, which refetches the set.
    stub.publish(&[&KEY_A, &KEY_B]);
    let identity = verifier
        .verify(&KEY_B.sign(&person_claims("grace@example.com", AUDIENCE)))
        .await
        .unwrap();
    assert_eq!(
        identity,
        AssertedIdentity::Person("grace@example.com".into())
    );
    assert_eq!(stub.fetches(), 2, "the unknown key id refetched the set");

    // Key B is cached now.
    verifier
        .verify(&KEY_B.sign(&person_claims("edsger@example.com", AUDIENCE)))
        .await
        .unwrap();
    assert_eq!(stub.fetches(), 2);
}

#[tokio::test]
async fn unknown_key_ids_refetch_at_most_once_per_interval() {
    // A stream of forged tokens naming made-up key ids costs one fetch per
    // interval, not one per request.
    let (url, stub) = serve_certs(&[&KEY_A]).await;
    let verifier = AccessVerifier::with_certs_url(
        &url,
        AUDIENCE,
        reqwest::Client::new(),
        Duration::from_secs(3600),
    );
    verifier
        .verify(&KEY_A.sign(&person_claims("ada@example.com", AUDIENCE)))
        .await
        .unwrap();
    for kid in ["made-up-1", "made-up-2", "made-up-3"] {
        let message = rejected(
            &verifier,
            &KEY_A.sign_as(kid, &person_claims("ada@example.com", AUDIENCE)),
        )
        .await;
        assert!(message.contains("does not publish"), "{message}");
    }
    assert_eq!(stub.fetches(), 1, "no refetch inside the interval");
}

#[tokio::test]
async fn unreachable_certificates_are_unavailable_rather_than_rejected() {
    // Nothing listens on port 0 of loopback.
    let verifier = verifier("http://127.0.0.1:0/cdn-cgi/access/certs");
    match verifier
        .verify(&KEY_A.sign(&person_claims("ada@example.com", AUDIENCE)))
        .await
    {
        Err(AccessError::Unavailable(message)) => {
            assert!(
                message.contains("fetching the Access signing keys"),
                "{message}"
            );
        }
        other => panic!("expected the keys to be unavailable, got {other:?}"),
    }
}

/// Base64url without padding, the JWT segment encoding.
fn base64url(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}
