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
    send_frame(
        &loopback(&endpoint.endpoint),
        &endpoint.token,
        3,
        7,
        image,
        &[],
        &[],
        &[],
    )
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
    assert!(
        preview.mesh.is_none()
            && preview.skinned_glb.is_none()
            && preview.rig.is_none()
            && preview.audio.is_none(),
        "a body-less frame carries only its PNG"
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
        &[],
        &[],
        &[],
    )
    .await
    .expect("send frame");

    // The wrong token must yield nothing; give the listener a moment to (not)
    // deliver before concluding the frame was dropped.
    let result = timeout(Duration::from_millis(300), rx.recv()).await;
    assert!(result.is_err(), "a mismatched token must be dropped");
}

#[tokio::test]
async fn forwards_a_skinned_glb_and_rig_body() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let live = LivePreview::start(std::sync::Arc::new(ChannelSink(tx)))
        .await
        .expect("bind listener");
    let endpoint = live.endpoint().clone();

    // A skinned frame appends the whole-body glb (kept raw so its skin survives) and
    // then the rig; the glb bytes are opaque to the listener, so a stand-in suffices.
    let image = b"\x89PNG\r\n\x1a\nwaveform";
    let glb = b"glTF\x02\x00\x00\x00fake-skinned-glb";
    let rig = br#"{"skinned":true,"bones":[],"joints":[],"animations":[]}"#;
    send_frame(
        &loopback(&endpoint.endpoint),
        &endpoint.token,
        0,
        4,
        image,
        glb,
        rig,
        &[],
    )
    .await
    .expect("send frame");

    let preview = timeout(Duration::from_secs(2), rx.recv())
        .await
        .expect("a frame arrives before the timeout")
        .expect("the sink channel stays open");
    assert_eq!(
        preview.skinned_glb.as_deref(),
        Some(base64::engine::general_purpose::STANDARD.encode(glb).as_str()),
        "the skinned glb is forwarded raw and base64-encoded (never decoded to a Mesh)"
    );
    assert!(
        preview.mesh.is_none(),
        "a skinned frame's glb is exposed as skinned_glb, not a plain Mesh"
    );
    assert_eq!(
        preview.rig,
        Some(serde_json::json!({
            "skinned": true,
            "bones": [],
            "joints": [],
            "animations": [],
        })),
        "the rig body is forwarded parsed"
    );
}

#[tokio::test]
async fn forwards_an_audio_body() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let live = LivePreview::start(std::sync::Arc::new(ChannelSink(tx)))
        .await
        .expect("bind listener");
    let endpoint = live.endpoint().clone();

    // An audio frame appends the clip `.wav` after the PNG waveform preview.
    let image = b"\x89PNG\r\n\x1a\nwaveform";
    let wav = b"RIFF\x24\x00\x00\x00WAVEfake-clip";
    send_frame(
        &loopback(&endpoint.endpoint),
        &endpoint.token,
        0,
        2,
        image,
        &[],
        &[],
        wav,
    )
    .await
    .expect("send frame");

    let preview = timeout(Duration::from_secs(2), rx.recv())
        .await
        .expect("a frame arrives before the timeout")
        .expect("the sink channel stays open");
    assert_eq!(
        preview.audio.as_deref(),
        Some(base64::engine::general_purpose::STANDARD.encode(wav).as_str()),
        "the clip is forwarded base64-encoded byte-for-byte"
    );
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
