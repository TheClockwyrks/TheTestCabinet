use super::*;

use serde_json::json;

const MODEL: &str = "z-ai/glm-5.3";

fn roster() -> ProviderRoster {
    ProviderRoster::new(BTreeMap::from([(
        MODEL.to_string(),
        vec![
            GgProviderCandidate::new("Z.AI", "fp8"),
            GgProviderCandidate::new("Baidu", "fp8"),
        ],
    )]))
}

/// A move is compare-and-move: the first request to leave a candidate moves the run, a second
/// request leaving the same one finds it already moved, and the last candidate has nowhere to go.
#[test]
fn leaving_a_candidate_moves_the_run_once() {
    let roster = roster();
    let first = roster.in_force(MODEL).expect("listed");
    assert_eq!(first.index, 0);
    assert_eq!(first.candidate.provider, "Z.AI");
    assert!(first.has_next);

    assert_eq!(
        roster.leave(MODEL, 0),
        Move::Moved {
            from: "Z.AI".to_string(),
            to: "Baidu".to_string()
        }
    );
    assert_eq!(roster.leave(MODEL, 0), Move::AlreadyMoved);
    let second = roster.in_force(MODEL).expect("listed");
    assert_eq!(second.candidate.provider, "Baidu");
    assert!(!second.has_next);
    assert_eq!(roster.leave(MODEL, 1), Move::Last);
    assert_eq!(roster.in_force("x-ai/grok-4.7"), None);
}

/// Misses are held against the candidate in force and start again on the next one; a miss
/// reported against a candidate the run has left is not held.
#[test]
fn misses_are_held_against_the_candidate_in_force() {
    let roster = roster();
    assert_eq!(roster.record_miss(MODEL, 0), Some(1));
    assert_eq!(roster.record_miss(MODEL, 0), Some(2));
    roster.leave(MODEL, 0);
    assert_eq!(roster.record_miss(MODEL, 0), None);
    assert_eq!(roster.record_miss(MODEL, 1), Some(1));
}

/// The body names the candidate as OpenRouter's `provider` object with fallbacks refused.
#[test]
fn a_stamped_body_names_one_provider_and_one_level() {
    let mut body = json!({ "model": MODEL, "provider": { "only": ["old"] } });
    stamp_candidate(&mut body, &GgProviderCandidate::new("Baidu", "fp8"));
    assert_eq!(
        body["provider"],
        json!({ "only": ["Baidu"], "quantizations": ["fp8"], "allow_fallbacks": false })
    );
}

/// A system prompt big enough that its tokens dominate the prefix.
fn thread(turns: usize) -> Vec<Message> {
    let mut messages = vec![Message::system("s".repeat(40_000))];
    for turn in 0..turns {
        messages.push(Message::user(format!("turn {turn}")));
    }
    messages
}

fn body() -> Value {
    json!({ "tools": [{ "type": "function", "function": { "name": "read" } }] })
}

/// A reply that reads far less than the previous request left, within the window, on the same
/// provider, repeating the previous request, is a miss; one that reads most of it is not.
#[test]
fn a_reply_reading_under_half_the_shared_prefix_is_a_miss() {
    let trace = CacheTrace::default();
    let start = tokio::time::Instant::now();
    // The first request has nothing to be measured against.
    assert!(!trace.observe(
        "Z.AI",
        start,
        RequestShape::of(&body(), &thread(1)),
        Some(0),
        10_000
    ));
    // The next repeats it and reads most of it: a hit.
    assert!(!trace.observe(
        "Z.AI",
        start + Duration::from_secs(30),
        RequestShape::of(&body(), &thread(2)),
        Some(9_000),
        10_100,
    ));
    // The next repeats that one and reads nothing: a miss.
    assert!(trace.observe(
        "Z.AI",
        start + Duration::from_secs(60),
        RequestShape::of(&body(), &thread(3)),
        Some(0),
        10_200,
    ));
    // Unreported cached tokens are never a miss.
    assert!(!trace.observe(
        "Z.AI",
        start + Duration::from_secs(90),
        RequestShape::of(&body(), &thread(4)),
        None,
        10_300,
    ));
}

/// A cold read is expected, and so not a miss, after the cache lifetime, on another provider,
/// when the tools changed, or when the shared prefix is too small to cache.
#[test]
fn a_cold_read_is_not_a_miss_when_no_warm_prefix_was_owed() {
    let start = tokio::time::Instant::now();
    let warmed = || {
        let trace = CacheTrace::default();
        trace.observe(
            "Z.AI",
            start,
            RequestShape::of(&body(), &thread(1)),
            Some(0),
            10_000,
        );
        trace
    };

    let late = warmed();
    assert!(!late.observe(
        "Z.AI",
        start + CACHE_MISS_WINDOW,
        RequestShape::of(&body(), &thread(2)),
        Some(0),
        10_100,
    ));

    let moved = warmed();
    assert!(!moved.observe(
        "Baidu",
        start + Duration::from_secs(30),
        RequestShape::of(&body(), &thread(2)),
        Some(0),
        10_100,
    ));

    let retooled = warmed();
    assert!(!retooled.observe(
        "Z.AI",
        start + Duration::from_secs(30),
        RequestShape::of(&json!({ "tools": [] }), &thread(2)),
        Some(0),
        10_100,
    ));

    let small = CacheTrace::default();
    small.observe(
        "Z.AI",
        start,
        RequestShape::of(&body(), &thread(1)),
        Some(0),
        2_000,
    );
    assert!(!small.observe(
        "Z.AI",
        start + Duration::from_secs(30),
        RequestShape::of(&body(), &thread(2)),
        Some(0),
        2_100,
    ));
}

/// A request that drops the previous request's last message, as the trailing context signal is
/// re-rendered every turn, still shares everything before it, and the share is apportioned by
/// bytes.
#[test]
fn the_shared_prefix_is_apportioned_by_the_bytes_repeated() {
    let start = tokio::time::Instant::now();
    let trace = CacheTrace::default();
    let mut first = thread(1);
    first.push(Message::user("x".repeat(40_000)));
    trace.observe(
        "Z.AI",
        start,
        RequestShape::of(&body(), &first),
        Some(0),
        20_000,
    );
    // About half the previous request is repeated (the system prompt), so about 10,000 tokens
    // are owed: 6,000 cached is a hit, 4,000 a miss.
    let mut second = thread(1);
    second.push(Message::user("y"));
    let hit = CacheTrace::default();
    hit.observe(
        "Z.AI",
        start,
        RequestShape::of(&body(), &first),
        Some(0),
        20_000,
    );
    assert!(!hit.observe(
        "Z.AI",
        start + Duration::from_secs(30),
        RequestShape::of(&body(), &second),
        Some(6_000),
        10_100,
    ));
    assert!(trace.observe(
        "Z.AI",
        start + Duration::from_secs(30),
        RequestShape::of(&body(), &second),
        Some(4_000),
        10_100,
    ));
}
