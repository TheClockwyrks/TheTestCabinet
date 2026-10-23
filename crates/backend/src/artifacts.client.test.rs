//! The artifact-service client against the stub service: each route's path, token,
//! body and status handling.

use reqwest::StatusCode;
use test_cabinet_suites::test_case::MediaKind;

use super::stub::{self, TOKEN};
use super::*;

fn client(url: &str) -> ArtifactsClient {
    ArtifactsClient::from_config(reqwest::Client::new(), Some(url), Some(TOKEN)).unwrap()
}

#[test]
fn a_client_needs_both_the_url_and_the_token() {
    let http = reqwest::Client::new();
    assert!(ArtifactsClient::from_config(http.clone(), None, Some(TOKEN)).is_none());
    assert!(ArtifactsClient::from_config(http.clone(), Some("http://a"), None).is_none());
    assert!(ArtifactsClient::from_config(http.clone(), Some("not a url"), Some(TOKEN)).is_none());
    assert!(ArtifactsClient::from_config(http, Some("http://a"), Some(TOKEN)).is_some());
}

#[tokio::test]
async fn a_match_replay_round_trips_through_its_route() {
    let stub = stub::spawn().await;
    let client = client(&stub.url);

    assert_eq!(client.match_replay("t1", "m1").await.unwrap(), None);
    client
        .put_match_replay("t1", "m1", br#"{"frames":[]}"#.to_vec())
        .await
        .unwrap();
    assert_eq!(
        client.match_replay("t1", "m1").await.unwrap().as_deref(),
        Some(&br#"{"frames":[]}"#[..])
    );
    assert_eq!(
        stub.held.requests(),
        [
            "GET /tournaments/t1/matches/m1/replay",
            "PUT /tournaments/t1/matches/m1/replay",
            "GET /tournaments/t1/matches/m1/replay",
        ]
    );
}

#[tokio::test]
async fn a_base_url_with_a_trailing_slash_or_a_prefix_keeps_its_path() {
    let stub = stub::spawn().await;
    client(&format!("{}/", stub.url))
        .put_match_replay("t1", "m1", b"{}".to_vec())
        .await
        .unwrap();
    assert_eq!(stub.held.replay("t1", "m1").as_deref(), Some(&b"{}"[..]));
}

#[tokio::test]
async fn a_segment_that_could_name_another_path_is_never_sent() {
    let stub = stub::spawn().await;
    let client = client(&stub.url);
    for (tournament, game) in [
        ("..", "m1"),
        ("t1", "../../public/x"),
        ("", "m1"),
        ("t1", "a\\b"),
    ] {
        let err = client
            .put_match_replay(tournament, game, b"{}".to_vec())
            .await
            .unwrap_err();
        assert!(matches!(err, ArtifactsError::BadSegment(_)), "{err}");
    }
    assert!(stub.held.requests().is_empty());
}

#[tokio::test]
async fn a_refusal_is_an_error_with_its_status() {
    let stub = stub::spawn().await;
    *stub.held.failing.lock().unwrap() = Some(StatusCode::INTERNAL_SERVER_ERROR);
    let client = client(&stub.url);
    assert!(matches!(
        client.put_match_replay("t1", "m1", b"{}".to_vec()).await,
        Err(ArtifactsError::Refused(StatusCode::INTERNAL_SERVER_ERROR))
    ));
    assert!(matches!(
        client.match_replay("t1", "m1").await,
        Err(ArtifactsError::Refused(StatusCode::INTERNAL_SERVER_ERROR))
    ));
}

#[tokio::test]
async fn a_wrong_token_is_refused_by_the_service() {
    let stub = stub::spawn().await;
    let client =
        ArtifactsClient::from_config(reqwest::Client::new(), Some(&stub.url), Some("wrong"))
            .unwrap();
    assert!(matches!(
        client.match_replay("t1", "m1").await,
        Err(ArtifactsError::Refused(StatusCode::UNAUTHORIZED))
    ));
}

#[tokio::test]
async fn an_unreachable_service_is_a_transport_error() {
    // A port bound and released: nothing listens there.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    assert!(matches!(
        client(&url).match_replay("t1", "m1").await,
        Err(ArtifactsError::Transport(_))
    ));
}

#[tokio::test]
async fn publish_media_answers_the_published_keys_and_none_for_a_run_without_a_tree() {
    let stub = stub::spawn().await;
    stub.held.published.lock().unwrap().insert(
        "r1".to_string(),
        serde_json::json!({
            "proofMedia": [{ "id": "rally", "kind": "video", "key": "media/runs/r1/proof/rally.mp4" }],
            "validationMedia": [{ "file": "spin__still.png", "key": "media/runs/r1/validation/spin__still.png" }],
            "assetMedia": [{ "file": "preview.png", "key": "media/runs/r1/asset/preview.png" }],
            "showcaseMedia": [{ "file": "clip.webm", "key": "media/runs/r1/showcase/clip.mp4" }],
        }),
    );
    let client = client(&stub.url);

    let media = client.publish_run_media("r1").await.unwrap().unwrap();
    assert_eq!(media.proof_media.len(), 1);
    assert_eq!(media.proof_media[0].id, "rally");
    assert_eq!(media.proof_media[0].kind, MediaKind::Video);
    assert_eq!(media.proof_media[0].key, "media/runs/r1/proof/rally.mp4");
    assert_eq!(media.validation_media[0].file, "spin__still.png");
    assert_eq!(media.asset_media[0].key, "media/runs/r1/asset/preview.png");
    assert_eq!(media.showcase_media[0].file, "clip.webm");
    assert_eq!(
        media.showcase_media[0].key,
        "media/runs/r1/showcase/clip.mp4"
    );

    assert!(client.publish_run_media("r2").await.unwrap().is_none());
    assert_eq!(
        stub.held.requests(),
        ["POST /runs/r1/publish-media", "POST /runs/r2/publish-media"]
    );
}

#[tokio::test]
async fn the_code_analysis_arrives_as_the_service_stores_it() {
    let stub = stub::spawn().await;
    let gzipped = {
        use std::io::Write as _;
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(b"{\"files\":1}").unwrap();
        encoder.finish().unwrap()
    };
    stub.held
        .code_analyses
        .lock()
        .unwrap()
        .insert("r1".to_string(), gzipped.clone());
    let client = client(&stub.url);

    // No content encoding is decoded on the way: the caller sniffs the gzip magic.
    assert_eq!(client.run_code_analysis("r1").await.unwrap(), Some(gzipped));
    assert_eq!(client.run_code_analysis("r2").await.unwrap(), None);
}
