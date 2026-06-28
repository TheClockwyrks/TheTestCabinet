use super::*;

fn success_result() -> PublishResult {
    PublishResult {
        state: PublishState::Succeeded,
        source_repo: Some("https://github.com/x/y".to_string()),
        playable_build: Some("https://abc.pages.dev".to_string()),
        detail: None,
    }
}

/// Drain a publish NDJSON stream to its close, returning each non-empty line parsed
/// as JSON. A heartbeat-free publish stream closes promptly on the terminal result,
/// so this completes without a timeout.
async fn drain(
    stream: impl Stream<Item = Result<Bytes, Infallible>>,
) -> Vec<serde_json::Value> {
    let bytes: Vec<u8> = stream
        .map(|chunk| chunk.unwrap())
        .collect::<Vec<_>>()
        .await
        .concat();
    String::from_utf8(bytes)
        .unwrap()
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

/// Each stream item is tagged with a `type` discriminator so a subscriber tells a
/// progress line from the terminal result.
#[test]
fn encode_item_tags_progress_and_result() {
    let progress = encode_item(&PublishStreamItem::Progress(Box::new(PublishProgress {
        message: "creating repo".to_string(),
    })));
    let value: serde_json::Value = serde_json::from_slice(&progress).unwrap();
    assert_eq!(value["type"], "progress");
    assert_eq!(value["message"], "creating repo");

    let result = encode_item(&PublishStreamItem::Result(Box::new(success_result())));
    let value: serde_json::Value = serde_json::from_slice(&result).unwrap();
    assert_eq!(value["type"], "result");
    assert_eq!(value["state"], "succeeded");
    assert_eq!(value["sourceRepo"], "https://github.com/x/y");
}

/// A subscriber to a live publish receives the progress lines and the terminal
/// result as NDJSON, and the stream closes once the result is delivered.
#[tokio::test]
async fn publish_stream_replays_progress_then_result_then_closes() {
    let relay = crate::publish_relay::PublishRelay::new();
    let live = relay.live("p1");
    live.push_progress(PublishProgress {
        message: "creating repo".to_string(),
    });
    live.finish(success_result());

    // The publish is already terminal, so the backlog carries both items and the
    // stream closes after draining it (no persisted-terminal fallback needed).
    let lines = drain(publish_stream(live, None)).await;
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0]["type"], "progress");
    assert_eq!(lines[1]["type"], "result");
    assert_eq!(lines[1]["state"], "succeeded");
}

/// When the live buffer is lost (a fresh, empty relay) but the persisted row says
/// the publish finished, the synthesized terminal result is appended so the stream
/// still closes with the outcome.
#[tokio::test]
async fn publish_stream_synthesizes_a_terminal_result_when_the_buffer_is_lost() {
    let relay = crate::publish_relay::PublishRelay::new();
    let live = relay.live("p1");

    let lines = drain(publish_stream(live, Some(success_result()))).await;
    assert_eq!(lines.len(), 1, "just the synthesized terminal result");
    assert_eq!(lines[0]["type"], "result");
    assert_eq!(lines[0]["playableBuild"], "https://abc.pages.dev");
}

/// `terminal_from_row` reconstructs a succeeded result's links from a persisted
/// publish-job row, and maps any non-success terminal row to a failure carrying its
/// detail.
#[test]
fn terminal_from_row_reconstructs_succeeded_and_failed() {
    let succeeded = publish_job::Model {
        id: "p1".to_string(),
        state: "succeeded".to_string(),
        run_id: "r1".to_string(),
        job_token: "t".to_string(),
        source_repo: Some("https://github.com/x/y".to_string()),
        playable_build: Some("https://abc.pages.dev".to_string()),
        detail: None,
        created_at: "2026-06-27T00:00:00Z".to_string(),
        updated_at: "2026-06-27T00:01:00Z".to_string(),
    };
    let result = terminal_from_row(&succeeded);
    assert_eq!(result.state, PublishState::Succeeded);
    assert_eq!(result.source_repo.as_deref(), Some("https://github.com/x/y"));

    let failed = publish_job::Model {
        state: "failed".to_string(),
        source_repo: None,
        playable_build: None,
        detail: Some("wrangler exploded".to_string()),
        ..succeeded
    };
    let result = terminal_from_row(&failed);
    assert_eq!(result.state, PublishState::Failed);
    assert_eq!(result.detail.as_deref(), Some("wrangler exploded"));
}
