//! Tests for the **streaming** model transport: the request shape it asks for, the
//! [`StreamAccumulator`] that assembles a server-sent-event reply, and what the
//! [stream-idle bound](DEFAULT_MODEL_STREAM_IDLE) counts as the model's progress.
//!
//! Split from `client.test.rs` — which is already past a thousand lines — rather than appended to
//! it, on the terms the coding policy allows: one file per subject, both ending in `.test.rs`.
//!
//! Everything here is **network-free**. The accumulator is fed `&[u8]` exactly as a socket would
//! feed it, which is the whole reason it takes bytes rather than a `Response`: the awkward parts of
//! SSE — a line split across reads, a UTF-8 sequence split across reads, tool-call arguments
//! arriving a few characters at a time, usage on a trailing chunk — are all reproducible by
//! choosing where to cut the transcript.

use super::*;
use crate::loopguard::LoopGuardConfig;
use crate::model::{FinishReason, Message, ToolDefinition};
use serde_json::json;
use test_cabinet_core::gg::{GgSlotBinding, PRIMARY_SLOT};

/// The detector an [`armed_declaration`] resolves to. An armed declaration writes all five knobs,
/// so a test about the binding has to state them; the figures are arbitrary and no assertion here
/// turns on which they are.
const ARMED_KNOBS: LoopGuardConfig = LoopGuardConfig {
    window_words: 256,
    repeat_threshold: 32,
    min_offenders: 2,
    min_saturated_run: 3_000,
    max_response_chars: 250_000,
};

/// A fully specified armed declaration — the shape a stored configuration carries once the detector
/// is switched on.
fn armed_declaration() -> GgLoopDetection {
    GgLoopDetection {
        enabled: true,
        window_words: Some(ARMED_KNOBS.window_words as u64),
        repeat_threshold: Some(u64::from(ARMED_KNOBS.repeat_threshold)),
        min_offenders: Some(ARMED_KNOBS.min_offenders as u64),
        min_saturated_run: Some(ARMED_KNOBS.min_saturated_run as u64),
        max_response_chars: Some(ARMED_KNOBS.max_response_chars as u64),
    }
}

// ---------------------------------------------------------------------------
// Transcript helpers
// ---------------------------------------------------------------------------

/// One `data:` event carrying `chunk`, terminated the way a provider terminates an event.
fn event(chunk: Value) -> String {
    format!("data: {chunk}\n\n")
}

/// A chunk carrying only assistant text.
fn text_chunk(content: &str) -> Value {
    json!({ "choices": [{ "index": 0, "delta": { "content": content } }] })
}

/// Feed a whole transcript in one read, returning the text the loop guard would have been shown.
fn feed(accumulator: &mut StreamAccumulator, transcript: &str) -> String {
    accumulator
        .push_bytes(transcript.as_bytes())
        .expect("the transcript is readable")
        .text
}

/// Feed a transcript one byte at a time — the cruellest split a socket can produce, and the one
/// that proves nothing in the reader depends on a read landing on a boundary of any kind.
fn feed_byte_by_byte(accumulator: &mut StreamAccumulator, transcript: &str) -> String {
    let mut delta = String::new();
    for byte in transcript.as_bytes() {
        delta.push_str(
            &accumulator
                .push_bytes(&[*byte])
                .expect("the transcript is readable")
                .text,
        );
    }
    delta
}

// ---------------------------------------------------------------------------
// Request shape
// ---------------------------------------------------------------------------

/// Every request asks for the event stream **and** for usage to ride the final chunk. The second
/// half is not optional: `usage: {include: true}` alone is answered on a non-streaming response,
/// and without `stream_options.include_usage` a streamed turn would account zero tokens and zero
/// cost while appearing to succeed.
#[test]
fn every_request_asks_for_the_stream_and_its_usage() {
    let body = build_request_body(
        "openai/gpt-5.6",
        &[Message::user("build it")],
        &[],
        None,
        None,
        CacheTtl::Standard,
    );

    assert_eq!(body["stream"], json!(true));
    assert_eq!(body["stream_options"]["include_usage"], json!(true));
    // The request's own usage flag is still sent — the two are different asks.
    assert_eq!(body["usage"]["include"], json!(true));
}

/// A non-streaming request shape is gone with the buffered read: every request carries the
/// streaming keys, so there is no second shape for a provider or a proxy to treat differently.
///
/// The request keys are always **present rather than `false`**, which is the property that made
/// adding the stream safe in the first place and now holds unconditionally: a provider is free to
/// treat `"stream": false` and an absent key differently, and gg sends the one shape it reads.
#[test]
fn build_request_body_always_carries_the_streaming_keys() {
    let body = build_request_body(
        "openai/gpt-5.6",
        &[Message::user("build it")],
        &[],
        None,
        None,
        CacheTtl::Standard,
    );

    assert_eq!(body["stream"], json!(true), "the key is present, not false");
    assert_eq!(body["stream_options"]["include_usage"], json!(true));
}

/// A required-tool request streams too: the handoff summarizer runs on the agent's own model, and
/// a model that loops on a turn loops on a summary. The requirement itself is unaffected.
#[test]
fn a_required_tool_request_streams_like_any_other() {
    let tool = ToolDefinition::new("compact", "Summarize.", json!({ "type": "object" }));
    let body = build_required_tool_request_body(
        "openai/gpt-5.6",
        &[Message::user("summarize")],
        &tool,
        None,
        None,
        CacheTtl::Standard,
    );

    assert_eq!(body["stream"], json!(true));
    assert_eq!(body["tool_choice"]["function"]["name"], json!("compact"));
}

// ---------------------------------------------------------------------------
// The detector, and only the detector
// ---------------------------------------------------------------------------

/// Arming the detector decides **whether anything watches the stream**, and nothing else: an armed
/// client holds the detector its declaration describes, a disarmed one holds none, and both ask the
/// provider for the same streamed reply.
#[test]
fn arming_the_detector_decides_only_whether_anything_watches_the_stream() {
    let client = OpenRouterClient::new(
        "https://example.test/api/v1",
        reqwest::Client::new(),
        "openai/gpt-5.6",
        "sk-test",
        RetryPolicy::default(),
        None,
    );
    assert!(
        client.loop_guard.is_none(),
        "a fresh client watches nobody, as gg always did"
    );

    // An unarmed declaration is a no-op — which is what every stored configuration sends.
    let unarmed = client.with_loop_detection(GgLoopDetection::default());
    assert!(unarmed.loop_guard.is_none());

    let armed = unarmed.with_loop_detection(armed_declaration());
    assert_eq!(armed.loop_guard, Some(ARMED_KNOBS));
}

/// A declared knob reaches the detector the client will judge its replies with, rather than being
/// flattened into "on".
#[test]
fn a_declared_knob_reaches_the_clients_detector() {
    let client = OpenRouterClient::new(
        "https://example.test/api/v1",
        reqwest::Client::new(),
        "openai/gpt-5.6",
        "sk-test",
        RetryPolicy::default(),
        None,
    )
    .with_loop_detection(GgLoopDetection {
        min_saturated_run: Some(64),
        max_response_chars: Some(0),
        ..armed_declaration()
    });

    let config = client.loop_guard.expect("armed");
    assert_eq!(config.min_saturated_run, 64);
    // Zero is one of the two knobs whose zero means something: the backstop is off.
    assert_eq!(config.max_response_chars, 0);
    // And the knobs this case did not vary reach the detector as the declaration wrote them —
    // there is nothing else they could have come from.
    assert_eq!(config.window_words, ARMED_KNOBS.window_words);
}

/// The binding is how a per-agent lever reaches the client, exactly as it is for the prompt-cache
/// lifetime — so a profile that armed the detector produces a watched client and one that did not
/// produces an unwatched one, both of them streaming.
///
/// Each nextest test runs in its own process, so setting the credential here is isolated.
#[test]
fn a_binding_carries_its_agents_loop_detection_into_the_client() {
    let saved = std::env::var_os(API_KEY_ENV);
    // SAFETY: nextest isolates each test in its own process.
    unsafe {
        std::env::set_var(API_KEY_ENV, "sk-test");
    }

    let quiet = OpenRouterClient::from_binding(
        &GgSlotBinding::new(PRIMARY_SLOT, "openai/gpt-5.6"),
        &RoutingKey::mint(),
    );
    let watched = OpenRouterClient::from_binding(
        &GgSlotBinding::new(PRIMARY_SLOT, "openai/gpt-5.6").with_loop_detection(GgLoopDetection {
            window_words: Some(64),
            ..armed_declaration()
        }),
        &RoutingKey::mint(),
    );

    // Restore before asserting so a failure does not leave the process holding a fake credential.
    unsafe {
        match saved {
            Some(key) => std::env::set_var(API_KEY_ENV, key),
            None => std::env::remove_var(API_KEY_ENV),
        }
    }

    assert!(quiet.expect("a client").loop_guard.is_none());
    let watched = watched.expect("a client");
    assert_eq!(watched.loop_guard.expect("armed").window_words, 64);
}

// ---------------------------------------------------------------------------
// What counts as the model's progress
// ---------------------------------------------------------------------------

/// A chunk carrying content, reasoning or a tool-call fragment **restarts the idle clock**, and the
/// framing of the stream — the keep-alive comment OpenRouter sends while a slow provider thinks,
/// blank lines, a bare `index` with nothing on it — does not.
///
/// This is the distinction the whole [stream-idle bound](DEFAULT_MODEL_STREAM_IDLE) rests on: a
/// provider that has stopped answering can send keep-alives forever, and a reader that mistook one
/// for progress would wait out the whole call ceiling on each.
#[test]
fn only_a_delta_from_the_model_counts_as_progress() {
    let mut accumulator = StreamAccumulator::new();

    // Framing: a keep-alive comment, a blank line, and a bookkeeping chunk whose delta names an
    // index and carries nothing at all.
    let framing = concat!(
        ": OPENROUTER PROCESSING\n",
        "\n",
        "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"\"}}]}\n\n",
        "data: {\"choices\":[{\"index\":0,\"delta\":{}}]}\n\n",
    );
    let delta = accumulator.push_bytes(framing.as_bytes()).expect("readable");
    assert!(!delta.progressed, "framing is not progress: {framing:?}");
    assert_eq!(delta.text, "");

    // The model's own output, in each of the three channels that carry it.
    let working = [
        event(text_chunk("working")),
        event(json!({ "choices": [{ "delta": { "reasoning": "thinking it through" } }] })),
        // DeepSeek's spelling of the same thing.
        event(json!({ "choices": [{ "delta": { "reasoning_content": "still thinking" } }] })),
        event(json!({ "choices": [{ "delta": { "tool_calls": [
            { "index": 0, "id": "call_a", "function": { "name": "write_file", "arguments": "{\"pa" } }
        ] } }] })),
    ]
    .concat();
    let delta = accumulator.push_bytes(working.as_bytes()).expect("readable");
    assert!(delta.progressed, "the model's output is progress");
    // Only `content` reaches the detector — reasoning is the model's working, not its answer.
    assert_eq!(delta.text, "working");

    // The terminal sentinel and the usage trailer are framing too: the reply is over.
    let trailer = format!(
        "{}data: [DONE]\n\n",
        event(json!({ "choices": [], "usage": { "prompt_tokens": 10, "completion_tokens": 5 } })),
    );
    let delta = accumulator.push_bytes(trailer.as_bytes()).expect("readable");
    assert!(!delta.progressed, "the trailer is not progress");
    assert!(accumulator.done());
}

/// The model can stream a long silence **as reasoning** and never be read as stalled: the
/// [stream-idle bound](DEFAULT_MODEL_STREAM_IDLE) measures the gap between deltas, and a model
/// that reasons for minutes produces reasoning deltas for the whole of that time when the provider
/// streams them.
#[test]
fn reasoning_deltas_count_as_progress() {
    let mut accumulator = StreamAccumulator::new();
    for tick in 0..3 {
        let delta = accumulator
            .push_bytes(
                event(json!({
                    "choices": [{ "delta": { "reasoning": format!("step {tick} of a long argument") } }]
                }))
                .as_bytes(),
            )
            .expect("readable");
        assert!(delta.progressed, "each reasoning delta restarts the idle clock");
        assert_eq!(delta.text, "", "and none of it becomes the reply");
    }

    // The assembled reply is the answer alone.
    accumulator
        .push_bytes(event(text_chunk("done")).as_bytes())
        .expect("readable");
    let response = accumulator.finish_after_stop();
    assert_eq!(response.text.as_deref(), Some("done"));
}

// ---------------------------------------------------------------------------
// Line buffering
// ---------------------------------------------------------------------------

/// An event straddling several reads is assembled once its line completes, and not before: the
/// bytes of a half-arrived event contribute nothing at all.
#[test]
fn an_event_split_across_reads_is_assembled_only_once_it_completes() {
    let mut accumulator = StreamAccumulator::new();
    let transcript = event(text_chunk("hello"));
    let (head, tail) = transcript.split_at(transcript.len() / 2);

    let first = accumulator.push_bytes(head.as_bytes()).expect("readable");
    assert_eq!(first.text, "", "half an event is not half a reply");
    assert!(!first.progressed, "and it carries no delta either");

    let second = accumulator.push_bytes(tail.as_bytes()).expect("readable");
    assert_eq!(second.text, "hello");
    assert!(second.progressed);
}

/// A read that cuts a multi-byte character in half does not corrupt the reply.
///
/// This is the reason the accumulator takes bytes rather than a `&str`. A reader that decoded each
/// read as it arrived would either fail on the split sequence or — far worse, with a lossy decoder —
/// substitute `U+FFFD` for half a character and hand the model's own words back changed.
#[test]
fn a_read_that_splits_a_utf8_sequence_does_not_corrupt_the_reply() {
    let content = "héllo — 世界 🎮";
    let transcript = event(text_chunk(content));

    // Find a cut that lands strictly inside a multi-byte sequence, so the test is asserting the
    // thing it claims to and not merely a lucky split.
    let cut = (1..transcript.len())
        .find(|&index| !transcript.is_char_boundary(index))
        .expect("the transcript contains a multi-byte character");
    let (head, tail) = transcript.as_bytes().split_at(cut);

    let mut accumulator = StreamAccumulator::new();
    assert_eq!(accumulator.push_bytes(head).expect("readable").text, "");
    assert_eq!(
        accumulator.push_bytes(tail).expect("readable").text,
        content
    );

    let response = accumulator.finish_after_stop();
    assert_eq!(response.text.as_deref(), Some(content));
}

/// Fed one byte at a time — every possible split at once — the whole reply still assembles, in
/// order, exactly once.
#[test]
fn a_reply_delivered_one_byte_at_a_time_still_assembles() {
    let transcript = format!(
        "{}{}{}data: [DONE]\n\n",
        event(text_chunk("const ")),
        event(text_chunk("game = ")),
        event(json!({ "choices": [{ "delta": {}, "finish_reason": "stop" }] })),
    );

    let mut accumulator = StreamAccumulator::new();
    let delta = feed_byte_by_byte(&mut accumulator, &transcript);

    assert_eq!(delta, "const game = ");
    assert!(accumulator.done());
    let response = accumulator.finish().expect("assembles");
    assert_eq!(response.text.as_deref(), Some("const game = "));
    assert_eq!(response.finish_reason, FinishReason::Stop);
}

/// A CRLF peer is read identically to an LF one — SSE permits either line ending, and a `\r` left
/// on the payload would make every chunk unparseable.
#[test]
fn a_crlf_peer_reads_the_same_as_an_lf_one() {
    let mut accumulator = StreamAccumulator::new();
    let transcript = format!(
        "data: {}\r\n\r\ndata: [DONE]\r\n\r\n",
        text_chunk("windows")
    );

    assert_eq!(feed(&mut accumulator, &transcript), "windows");
    assert!(accumulator.done());
}

// ---------------------------------------------------------------------------
// Framing that is not content
// ---------------------------------------------------------------------------

/// The framing of an event stream carries no reply: blank separators, the `:` comment OpenRouter
/// sends as a keep-alive while a slow provider thinks, other SSE fields, and the terminal sentinel.
///
/// The keep-alive matters more than it looks. It arrives repeatedly during a long silence, and a
/// reader that treated it as content would feed the *detector* the same words over and over — so a
/// model that was merely slow would be judged to be looping.
#[test]
fn framing_lines_carry_no_reply_and_the_sentinel_ends_the_stream() {
    let mut accumulator = StreamAccumulator::new();
    let transcript = concat!(
        ": OPENROUTER PROCESSING\n",
        "\n",
        ": OPENROUTER PROCESSING\n",
        "event: message\n",
        "id: 42\n",
        "retry: 1000\n",
        "\n",
    );

    assert_eq!(feed(&mut accumulator, transcript), "");
    assert!(!accumulator.done());

    assert_eq!(
        feed(&mut accumulator, &event(text_chunk("at last"))),
        "at last"
    );
    assert_eq!(feed(&mut accumulator, "data: [DONE]\n\n"), "");
    assert!(accumulator.done());
}

/// A provider that omits the space after `data:` is read the same way — the space is optional in
/// the format, and some proxies drop it.
#[test]
fn a_data_line_without_its_optional_space_is_read() {
    let mut accumulator = StreamAccumulator::new();
    assert_eq!(
        feed(
            &mut accumulator,
            &format!("data:{}\n\n", text_chunk("tight"))
        ),
        "tight"
    );
    feed(&mut accumulator, "data:[DONE]\n\n");
    assert!(accumulator.done());
}

// ---------------------------------------------------------------------------
// Tool calls
// ---------------------------------------------------------------------------

/// Tool calls are assembled **by their `index`**, with `id` and `name` taken from whichever
/// fragment carried them and `arguments` concatenated across every fragment that did.
///
/// The index is the only field a provider guarantees on every fragment, which is why it and not
/// arrival order is the key: this transcript deliberately opens the second call before the first
/// one's arguments have finished, and interleaves their fragments, exactly as a provider emitting
/// two calls does.
#[test]
fn tool_calls_are_assembled_by_index_across_interleaved_fragments() {
    let mut accumulator = StreamAccumulator::new();
    let transcript = [
        event(json!({ "choices": [{ "delta": { "tool_calls": [
            { "index": 0, "id": "call_a", "type": "function",
              "function": { "name": "write_file", "arguments": "" } }
        ] } }] })),
        event(json!({ "choices": [{ "delta": { "tool_calls": [
            { "index": 1, "id": "call_b", "type": "function",
              "function": { "name": "run_shell", "arguments": "{\"command\"" } }
        ] } }] })),
        event(json!({ "choices": [{ "delta": { "tool_calls": [
            { "index": 0, "function": { "arguments": "{\"path\":\"index" } }
        ] } }] })),
        event(json!({ "choices": [{ "delta": { "tool_calls": [
            { "index": 1, "function": { "arguments": ":\"npm test\"}" } }
        ] } }] })),
        event(json!({ "choices": [{ "delta": { "tool_calls": [
            { "index": 0, "function": { "arguments": ".html\"}" } }
        ] } }] })),
        event(json!({ "choices": [{ "delta": {}, "finish_reason": "tool_calls" }] })),
    ]
    .concat();

    let delta = feed(&mut accumulator, &transcript);
    assert_eq!(
        delta, "",
        "tool-call arguments are not assistant text and must never reach the detector"
    );

    let response = accumulator.finish().expect("assembles");
    assert_eq!(response.finish_reason, FinishReason::ToolCalls);
    assert_eq!(response.tool_calls.len(), 2);
    // Index order, not arrival order.
    assert_eq!(response.tool_calls[0].id, "call_a");
    assert_eq!(response.tool_calls[0].name, "write_file");
    assert_eq!(
        response.tool_calls[0].arguments,
        json!({ "path": "index.html" })
    );
    assert_eq!(response.tool_calls[1].id, "call_b");
    assert_eq!(response.tool_calls[1].name, "run_shell");
    assert_eq!(
        response.tool_calls[1].arguments,
        json!({ "command": "npm test" })
    );
}

/// A provider that emits its calls in descending index order still produces them in the order the
/// model asked for them — the property a positionally-indexed `Vec` would silently lose.
#[test]
fn tool_calls_come_back_in_index_order_whatever_order_they_arrived_in() {
    let mut accumulator = StreamAccumulator::new();
    let transcript = [
        event(json!({ "choices": [{ "delta": { "tool_calls": [
            { "index": 2, "id": "third", "function": { "name": "c", "arguments": "{}" } }
        ] } }] })),
        event(json!({ "choices": [{ "delta": { "tool_calls": [
            { "index": 0, "id": "first", "function": { "name": "a", "arguments": "{}" } }
        ] } }] })),
        event(json!({ "choices": [{ "delta": { "tool_calls": [
            { "index": 1, "id": "second", "function": { "name": "b", "arguments": "{}" } }
        ] } }] })),
    ]
    .concat();
    feed(&mut accumulator, &transcript);

    let response = accumulator.finish().expect("assembles");
    let ids: Vec<&str> = response
        .tool_calls
        .iter()
        .map(|call| call.id.as_str())
        .collect();
    assert_eq!(ids, ["first", "second", "third"]);
}

/// A stream that produced tool calls but never a `finish_reason` is normalized to `ToolCalls`,
/// exactly as the buffering transport normalizes the same omission.
#[test]
fn tool_calls_without_a_finish_reason_normalize_the_way_the_buffered_transport_does() {
    let mut accumulator = StreamAccumulator::new();
    feed(
        &mut accumulator,
        &event(json!({ "choices": [{ "delta": { "tool_calls": [
            { "index": 0, "id": "c", "function": { "name": "t", "arguments": "" } }
        ] } }] })),
    );

    let response = accumulator.finish().expect("assembles");
    assert_eq!(response.finish_reason, FinishReason::ToolCalls);
    // Empty arguments become an empty object, via the same helper the buffered path uses.
    assert_eq!(response.tool_calls[0].arguments, json!({}));
}

/// Arguments that never became valid JSON are a parse failure naming the call, on the same terms
/// the buffering transport reports the same defect. A stream cut short mid-argument produces this,
/// and inventing an empty object for it would hand the model's tool a silently wrong call.
#[test]
fn arguments_that_never_became_json_are_a_parse_failure() {
    let mut accumulator = StreamAccumulator::new();
    feed(
        &mut accumulator,
        &event(json!({ "choices": [{ "delta": { "tool_calls": [
            { "index": 0, "id": "c", "function": { "name": "write_file", "arguments": "{\"path\":" } }
        ] } }] })),
    );

    let err = accumulator.finish().expect_err("unparseable arguments");
    let message = err.to_string();
    assert!(matches!(err, ModelError::Parse(_)), "{message}");
    assert!(message.contains("write_file"), "{message}");
}

// ---------------------------------------------------------------------------
// Usage, finish reason, and the empty reply
// ---------------------------------------------------------------------------

/// Usage arrives on the **final** chunk — the one carrying no choices at all — and is mapped by the
/// same function the buffered transport uses, cached input and reasoning subtracted and all.
///
/// Nothing before that chunk can be accounted, which is precisely why the streaming request has to
/// ask for `stream_options.include_usage`: without it this chunk never comes and the turn silently
/// bills nothing.
#[test]
fn usage_arriving_only_on_the_final_chunk_is_still_accounted() {
    let mut accumulator = StreamAccumulator::new();
    let transcript = [
        event(text_chunk("done")),
        event(json!({ "choices": [{ "delta": {}, "finish_reason": "stop" }] })),
        event(json!({
            "choices": [],
            "usage": {
                "prompt_tokens": 1000,
                "completion_tokens": 300,
                "total_tokens": 1300,
                "cost": 0.0123,
                "prompt_tokens_details": { "cached_tokens": 400 },
                "completion_tokens_details": { "reasoning_tokens": 120 }
            }
        })),
        "data: [DONE]\n\n".to_string(),
    ]
    .concat();
    feed(&mut accumulator, &transcript);

    let response = accumulator.finish().expect("assembles");
    assert_eq!(
        response.usage,
        TokenCounts {
            uncached_input: Some(600), // 1000 - 400 cached
            cached_input: Some(400),
            output: Some(180), // 300 - 120 reasoning
            reasoning: Some(120),
        }
    );
    assert_eq!(
        response.cost,
        Some(Cost {
            comparable: Some(0.0123),
            actual: Some(0.0123),
        })
    );
    // The trailing chunk carries no choice, so it must not disturb the finish reason.
    assert_eq!(response.finish_reason, FinishReason::Stop);
}

/// A stream with no usage chunk accounts nothing rather than guessing — the same all-unknown
/// counts the buffering transport reports for a response with no `usage` block.
#[test]
fn a_stream_without_usage_accounts_nothing() {
    let mut accumulator = StreamAccumulator::new();
    feed(&mut accumulator, &event(text_chunk("hi")));
    let response = accumulator.finish().expect("assembles");
    assert_eq!(response.usage, TokenCounts::default());
    assert!(response.cost.is_none());
}

/// A model that legitimately answers with nothing is a real answer, not a failure — the buffering
/// transport already turns an empty `content` into `None`, and the two must agree.
#[test]
fn an_empty_reply_that_carried_a_finish_reason_is_a_legitimate_answer() {
    let mut accumulator = StreamAccumulator::new();
    feed(
        &mut accumulator,
        &event(json!({ "choices": [{ "delta": {}, "finish_reason": "stop" }] })),
    );

    let response = accumulator
        .finish()
        .expect("an empty reply is still a reply");
    assert!(response.text.is_none());
    assert!(response.tool_calls.is_empty());
    assert_eq!(response.finish_reason, FinishReason::Stop);
}

/// A stream that ended having said nothing at all — no text, no calls, no finish reason — was cut
/// off, and reporting it as an empty reply would hand the turn loop a silence the model never
/// produced.
#[test]
fn a_stream_that_ended_without_saying_anything_is_a_failure() {
    let err = StreamAccumulator::new()
        .finish()
        .expect_err("nothing was ever said");
    assert!(matches!(err, ModelError::Parse(_)), "{err}");
    assert!(err.to_string().contains("finish reason"), "{err}");
}

/// The first finish reason a chunk states is the one that stands. A provider states it once, on the
/// chunk that stops; anything after it is bookkeeping, and letting a later chunk overwrite it would
/// turn a `length` truncation into an ordinary stop.
#[test]
fn the_first_finish_reason_stated_is_the_one_that_stands() {
    let mut accumulator = StreamAccumulator::new();
    let transcript = [
        event(json!({ "choices": [{ "delta": { "content": "x" }, "finish_reason": null }] })),
        event(json!({ "choices": [{ "delta": {}, "finish_reason": "length" }] })),
        event(json!({ "choices": [{ "delta": {}, "finish_reason": "stop" }] })),
    ]
    .concat();
    feed(&mut accumulator, &transcript);

    let response = accumulator.finish().expect("assembles");
    assert_eq!(response.finish_reason, FinishReason::Length);
}

// ---------------------------------------------------------------------------
// Failures on the wire
// ---------------------------------------------------------------------------

/// A provider error delivered as a chunk is a parse failure worded exactly as the buffering
/// transport words the same object in a `2xx` envelope — one failure, one sentence, whichever
/// transport met it.
#[test]
fn a_provider_error_object_mid_stream_is_a_parse_failure() {
    let mut accumulator = StreamAccumulator::new();
    feed(&mut accumulator, &event(text_chunk("starting")));

    let err = accumulator
        .push_bytes(event(json!({ "error": { "message": "rate limited" } })).as_bytes())
        .expect_err("a provider error is not a reply");

    assert!(matches!(err, ModelError::Parse(_)), "{err}");
    let message = err.to_string();
    assert!(
        message.contains("provider returned an error object"),
        "{message}"
    );
    assert!(message.contains("rate limited"), "{message}");
    // The same sentence the buffered transport produces for the same object.
    let buffered = parse_response(r#"{ "error": { "message": "rate limited" } }"#)
        .expect_err("a provider error is not a reply");
    assert_eq!(message, buffered.to_string());
}

/// A `data:` line that is not readable JSON is a failure rather than something to skip. A chunk gg
/// cannot read is a piece of the reply gg does not have, and assembling the rest would produce a
/// confidently wrong answer.
#[test]
fn an_unreadable_chunk_is_a_parse_failure() {
    let mut accumulator = StreamAccumulator::new();
    let err = accumulator
        .push_bytes(b"data: {not json at all\n\n")
        .expect_err("an unreadable chunk");
    assert!(matches!(err, ModelError::Parse(_)), "{err}");
}

/// A peer that sends bytes and never a line break is refused rather than buffered without limit.
/// Lines are only recognised at a newline, so this is the one growth an SSE reader cannot otherwise
/// bound — the detector never sees a delta, because no line ever completes.
#[test]
fn a_line_that_never_ends_is_refused_rather_than_buffered_forever() {
    let mut accumulator = StreamAccumulator::new();
    let filler = vec![b'x'; 1024 * 1024];
    let mut err = None;
    for _ in 0..16 {
        if let Err(failure) = accumulator.push_bytes(&filler) {
            err = Some(failure);
            break;
        }
    }
    let err = err.expect("an unterminated line is refused");
    assert!(matches!(err, ModelError::Parse(_)), "{err}");
    assert!(err.to_string().contains("no line break"), "{err}");
}

// ---------------------------------------------------------------------------
// Equivalence with the buffering transport
// ---------------------------------------------------------------------------

/// **The test that keeps the two transports honest.**
///
/// The same completion, delivered two ways: once as the single JSON document the buffering
/// transport reads, and once as a server-sent-event transcript whose deltas concatenate to exactly
/// that content. The two [`ModelResponse`]s must be *equal* — same text, same tool call with the
/// same parsed arguments, same finish reason, same token counts.
///
/// Without this, the transports could drift apart in any of a dozen small ways — a normalization
/// applied on one path and not the other, arguments parsed differently, usage mapped differently —
/// and the only symptom would be that a run behaves differently depending on a setting that is
/// supposed to change nothing but *when* gg stops reading.
#[test]
fn a_streamed_completion_equals_the_buffered_one_it_was_split_from() {
    // The buffering fixture, verbatim from `client.test.rs`'s parse tests.
    let buffered = parse_response(
        r#"{
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "Creating the file.",
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": {
                            "name": "write_file",
                            "arguments": "{\"path\":\"index.html\",\"contents\":\"<html></html>\"}"
                        }
                    }]
                },
                "finish_reason": "tool_calls"
            }],
            "usage": { "prompt_tokens": 1200, "completion_tokens": 180, "total_tokens": 1380 }
        }"#,
    )
    .expect("the buffered fixture parses");

    // The same completion, cut into deltas the way a provider streams one: the text a few words at
    // a time, the tool call's identity first and its arguments in fragments, the finish reason on
    // its own chunk, usage on the trailer, then the sentinel.
    let transcript = [
        event(text_chunk("Creating ")),
        event(text_chunk("the file.")),
        event(json!({ "choices": [{ "delta": { "tool_calls": [
            { "index": 0, "id": "call_1", "type": "function",
              "function": { "name": "write_file", "arguments": "" } }
        ] } }] })),
        event(json!({ "choices": [{ "delta": { "tool_calls": [
            { "index": 0, "function": { "arguments": "{\"path\":\"index.html\"," } }
        ] } }] })),
        event(json!({ "choices": [{ "delta": { "tool_calls": [
            { "index": 0, "function": { "arguments": "\"contents\":\"<html></html>\"}" } }
        ] } }] })),
        event(json!({ "choices": [{ "delta": {}, "finish_reason": "tool_calls" }] })),
        event(json!({
            "choices": [],
            "usage": { "prompt_tokens": 1200, "completion_tokens": 180, "total_tokens": 1380 }
        })),
        "data: [DONE]\n\n".to_string(),
    ]
    .concat();

    // Fed one byte at a time, so the equality survives every possible split of the transcript.
    let mut accumulator = StreamAccumulator::new();
    let delta = feed_byte_by_byte(&mut accumulator, &transcript);
    assert!(accumulator.done());
    let streamed = accumulator.finish().expect("the transcript assembles");

    assert_eq!(
        delta,
        buffered.text.clone().expect("the fixture has text"),
        "the detector is shown exactly the assistant text and nothing else"
    );
    assert_eq!(streamed, buffered);
}

// ---------------------------------------------------------------------------
// Test-only conveniences
// ---------------------------------------------------------------------------

impl StreamAccumulator {
    /// [`finish`](Self::finish) after a synthetic `stop`, for the tests whose subject is the text
    /// assembly rather than the finish reason — an accumulator that was only ever given content
    /// would otherwise be rejected as a stream that never said anything.
    fn finish_after_stop(mut self) -> ModelResponse {
        let mut delta = Delta::default();
        self.push_line(
            &format!(
                "data: {}",
                json!({ "choices": [{ "finish_reason": "stop" }] })
            ),
            &mut delta,
        )
        .expect("a synthetic stop is readable");
        assert!(!delta.progressed, "a synthetic stop is framing, not a delta");
        self.finish().expect("assembles")
    }
}
