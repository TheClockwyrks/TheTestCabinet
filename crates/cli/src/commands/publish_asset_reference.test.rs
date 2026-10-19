use std::sync::{Arc, Mutex};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::*;
use crate::cli::DeployEnv;

/// A request the stub server received: its request line, its headers
/// (lower-cased names) and its body.
#[derive(Debug, Default, Clone)]
struct Received {
    line: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Received {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }
}

/// Serve one request on a local port, answering `response` verbatim, and return
/// the server's base URL with the slot the request is recorded in.
async fn stub(response: &'static str) -> (String, Arc<Mutex<Received>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let address = listener.local_addr().expect("address");
    let received = Arc::new(Mutex::new(Received::default()));
    let slot = Arc::clone(&received);
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.expect("accept");
        let mut buffer = Vec::new();
        let mut chunk = [0u8; 4096];
        let head_end = loop {
            let read = socket.read(&mut chunk).await.expect("read");
            assert!(read > 0, "the client hung up before its headers ended");
            buffer.extend_from_slice(&chunk[..read]);
            if let Some(at) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
                break at + 4;
            }
        };
        let head = String::from_utf8_lossy(&buffer[..head_end]).to_string();
        let mut lines = head.split("\r\n");
        let line = lines.next().unwrap_or_default().to_string();
        let headers: Vec<(String, String)> = lines
            .filter_map(|line| line.split_once(':'))
            .map(|(key, value)| (key.trim().to_ascii_lowercase(), value.trim().to_string()))
            .collect();
        let length: usize = headers
            .iter()
            .find(|(key, _)| key == "content-length")
            .and_then(|(_, value)| value.parse().ok())
            .unwrap_or(0);
        while buffer.len() < head_end + length {
            let read = socket.read(&mut chunk).await.expect("read");
            assert!(read > 0, "the client hung up before its body ended");
            buffer.extend_from_slice(&chunk[..read]);
        }
        *slot.lock().expect("slot") = Received {
            line,
            headers,
            body: buffer[head_end..head_end + length].to_vec(),
        };
        socket.write_all(response.as_bytes()).await.expect("write");
        socket.shutdown().await.ok();
    });
    (format!("http://{address}/artifacts"), received)
}

fn service_token() -> AccessCredential {
    AccessCredential::ServiceToken {
        client_id: "id.access".to_string(),
        client_secret: "secret".to_string(),
    }
}

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

#[test]
fn an_environment_is_written_through_its_origins_artifacts_path() {
    assert_eq!(
        artifacts_url(DeployEnv::Staging),
        "https://console.staging.testcabinet.ai/artifacts"
    );
    assert_eq!(
        artifacts_url(DeployEnv::Prod),
        "https://console.testcabinet.ai/artifacts"
    );
}

#[test]
fn the_reference_keys_sit_under_the_variants_frames_prefix() {
    let prefix = "media/references/sprite-knight/1.0.0/base/frames/";
    let image = reference_image_key("sprite-knight", "1.0.0", "base", 3);
    let actions = reference_actions_key("sprite-knight", "1.0.0", "base", 3);
    assert_eq!(image, format!("{prefix}3.png"));
    assert_eq!(actions, format!("{prefix}3.actions.json"));
    assert_eq!(
        format!(
            "{}/frames/",
            reference_prefix("sprite-knight", "1.0.0", "base")
        ),
        prefix
    );
}

#[test]
fn a_key_is_addressed_segment_by_segment_under_public() {
    let writer = PublicWriter::new(
        "https://console.staging.testcabinet.ai/artifacts/",
        service_token(),
    );
    assert_eq!(
        writer
            .url("media/references/knight/1.0.0/base/frames/0.png")
            .expect("url")
            .as_str(),
        "https://console.staging.testcabinet.ai/artifacts/public/media/references/knight/1.0.0/base/frames/0.png"
    );
    assert_eq!(
        writer.url("media/a b/c?.png").expect("url").as_str(),
        "https://console.staging.testcabinet.ai/artifacts/public/media/a%20b/c%3F.png"
    );
}

#[test]
fn a_publish_without_the_service_token_names_its_two_variables() {
    for vars in [&[][..], &[(crate::config::ACCESS_TOKEN, "user")][..]] {
        let error = service_credential(&credentials(vars)).expect_err("no pair is refused");
        let message = error.to_string();
        assert!(message.contains(ACCESS_CLIENT_ID), "{message}");
        assert!(message.contains(ACCESS_CLIENT_SECRET), "{message}");
    }
    assert_eq!(
        service_credential(&credentials(&[
            (crate::config::ACCESS_TOKEN, "user"),
            (ACCESS_CLIENT_ID, "id.access"),
            (ACCESS_CLIENT_SECRET, "secret"),
        ]))
        .expect("the pair is offered"),
        service_token()
    );
}

#[tokio::test]
async fn a_write_presents_the_service_token_and_its_content_type() {
    let (base, received) = stub(
        "HTTP/1.1 201 Created\r\ncontent-type: application/json\r\ncontent-length: 2\r\n\
         connection: close\r\n\r\n{}",
    )
    .await;
    let writer = PublicWriter::new(base, service_token());
    writer
        .put(
            "media/references/knight/1.0.0/base/frames/0.png",
            b"png bytes".to_vec(),
            "image/png",
        )
        .await
        .expect("the write lands");
    let received = received.lock().expect("slot").clone();
    assert_eq!(
        received.line,
        "PUT /artifacts/public/media/references/knight/1.0.0/base/frames/0.png HTTP/1.1"
    );
    assert_eq!(received.header("cf-access-client-id"), Some("id.access"));
    assert_eq!(received.header("cf-access-client-secret"), Some("secret"));
    assert_eq!(received.header("content-type"), Some("image/png"));
    assert_eq!(received.header("cf-access-token"), None);
    assert_eq!(received.header("cf-access-authenticated-user-email"), None);
    assert_eq!(received.body, b"png bytes");
}

#[tokio::test]
async fn a_redirect_to_the_sign_in_page_is_the_edges_refusal() {
    let (base, _) = stub(
        "HTTP/1.1 302 Found\r\nlocation: https://team.cloudflareaccess.com/cdn-cgi/access/login/\
         console.staging.testcabinet.ai?kid=abc&redirect_url=%2F\r\ncontent-length: 0\r\n\
         connection: close\r\n\r\n",
    )
    .await;
    let error = PublicWriter::new(base, service_token())
        .put("index.json", b"{}".to_vec(), "application/json")
        .await
        .expect_err("a redirect is refused");
    let message = error.to_string();
    assert!(
        message.contains("refused by the edge (302 Found"),
        "{message}"
    );
    assert!(
        message.contains(
            "`https://team.cloudflareaccess.com/cdn-cgi/access/login/console.staging.testcabinet.ai`"
        ),
        "{message}"
    );
    assert!(!message.contains("kid="), "{message}");
}

#[tokio::test]
async fn an_edge_403_page_is_reported_without_its_markup() {
    let (base, _) = stub(
        "HTTP/1.1 403 Forbidden\r\ncontent-type: text/html\r\ncontent-length: 20\r\n\
         connection: close\r\n\r\n<html>denied</html>\n",
    )
    .await;
    let error = PublicWriter::new(base, service_token())
        .put("index.json", b"{}".to_vec(), "application/json")
        .await
        .expect_err("a 403 is refused");
    let message = error.to_string();
    assert!(
        message.contains("refused by the edge (403 Forbidden)"),
        "{message}"
    );
    assert!(!message.contains("<html>"), "{message}");
}

#[tokio::test]
async fn the_services_own_refusal_carries_its_message() {
    let body =
        r#"{"error":{"code":"bad_request","message":"key `x/`: the key has an empty segment"}}"#;
    let response: &'static str = Box::leak(
        format!(
            "HTTP/1.1 400 Bad Request\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\
             connection: close\r\n\r\n{body}",
            body.len()
        )
        .into_boxed_str(),
    );
    let (base, _) = stub(response).await;
    let error = PublicWriter::new(base, service_token())
        .put("x/y", b"{}".to_vec(), "application/json")
        .await
        .expect_err("a 400 is refused");
    let message = error.to_string();
    assert!(
        message.contains("the artifacts service refused the write"),
        "{message}"
    );
    assert!(
        message.contains("the key has an empty segment"),
        "{message}"
    );
}
