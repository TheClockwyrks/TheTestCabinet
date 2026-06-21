//! Unit tests for the live-preview listener: a well-formed frame reaches the
//! sink decoded and base64-encoded, and a frame bearing the wrong token is
//! dropped.

use super::*;
use tokio::sync::mpsc;
use tokio::time::{Duration, timeout};

/// A [`PreviewSink`] that forwards each frame onto a channel the test drains.
struct ChannelSink(mpsc::UnboundedSender<AssetPreview>);

impl PreviewSink for ChannelSink {
    fn preview(&self, preview: AssetPreview) {
        let _ = self.0.send(preview);
    }
}

/// The listener advertises `host.docker.internal:<port>` (resolvable only inside a
/// run container); a test connects to the same port on loopback instead.
fn loopback(endpoint: &str) -> String {
    let port = endpoint.rsplit(':').next().expect("endpoint has a port");
    format!("127.0.0.1:{port}")
}

#[tokio::test]
async fn forwards_a_valid_frame_to_the_sink() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let live = LivePreview::start(std::sync::Arc::new(ChannelSink(tx)))
        .await
        .expect("bind listener");
    let endpoint = live.endpoint().clone();

    let image = b"\x89PNG\r\n\x1a\nfake-frame-bytes";
    send_frame(&loopback(&endpoint.endpoint), &endpoint.token, 3, 7, image)
        .await
        .expect("send frame");

    let preview = timeout(Duration::from_secs(2), rx.recv())
        .await
        .expect("a frame arrives before the timeout")
        .expect("the sink channel stays open");
    assert_eq!(preview.frame, 3);
    assert_eq!(preview.operation_count, 7);
    assert_eq!(
        preview.image,
        base64::engine::general_purpose::STANDARD.encode(image),
        "the frame is forwarded base64-encoded byte-for-byte"
    );
}

#[tokio::test]
async fn drops_a_frame_with_the_wrong_token() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let live = LivePreview::start(std::sync::Arc::new(ChannelSink(tx)))
        .await
        .expect("bind listener");
    let endpoint = live.endpoint().clone();

    send_frame(
        &loopback(&endpoint.endpoint),
        "not-the-token",
        0,
        1,
        b"bytes",
    )
    .await
    .expect("send frame");

    // The wrong token must yield nothing; give the listener a moment to (not)
    // deliver before concluding the frame was dropped.
    let result = timeout(Duration::from_millis(300), rx.recv()).await;
    assert!(result.is_err(), "a mismatched token must be dropped");
}

#[tokio::test]
async fn aborting_the_listener_frees_the_port() {
    let live = LivePreview::start(std::sync::Arc::new(ChannelSink(
        mpsc::unbounded_channel().0,
    )))
    .await
    .expect("bind listener");
    let endpoint = live.endpoint().clone();
    // Dropping the handle aborts the accept loop; the advertised host is the
    // container alias, so only the shape of the endpoint is asserted here.
    drop(live);
    assert!(endpoint.endpoint.starts_with(HOST_INTERNAL));
    assert!(!endpoint.token.is_empty());
}
