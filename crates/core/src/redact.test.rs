use super::*;

/// A realistic Anthropic-shaped key (long body after the `sk-ant-` prefix).
const ANTHROPIC_KEY: &str = "sk-ant-api03-AbCdEf0123456789AbCdEf0123456789AbCdEf01";

#[test]
fn leaves_clean_text_borrowed() {
    let scrubber = SecretScrubber::new();
    // No allocation and identical content when there is nothing to redact.
    assert!(matches!(
        scrubber.scrub("nothing secret here, just prose with sk- and a dash"),
        Cow::Borrowed(_)
    ));
}

#[test]
fn redacts_anthropic_shaped_key() {
    let scrubber = SecretScrubber::new();
    let out = scrubber.scrub(ANTHROPIC_KEY);
    assert_eq!(out, PLACEHOLDER);
}

#[test]
fn redacts_provider_prefixes() {
    let scrubber = SecretScrubber::new();
    for key in [
        "sk-or-v1-00112233445566778899aabbccddeeff",
        "sk-proj-00112233445566778899aabbccddeeff",
        "sk-00112233445566778899AABBCCDDEEFF0011",
    ] {
        assert_eq!(scrubber.scrub(key), PLACEHOLDER, "should redact {key}");
    }
}

#[test]
fn redacts_key_inside_an_env_dump_line_keeping_surroundings() {
    let scrubber = SecretScrubber::new();
    let line = format!("ANTHROPIC_API_KEY={ANTHROPIC_KEY}\nNEXT=value");
    let out = scrubber.scrub(&line);
    assert_eq!(out, format!("ANTHROPIC_API_KEY={PLACEHOLDER}\nNEXT=value"));
}

#[test]
fn redacts_every_occurrence() {
    let scrubber = SecretScrubber::new();
    let text = format!("a {ANTHROPIC_KEY} b {ANTHROPIC_KEY} c");
    let out = scrubber.scrub(&text);
    assert_eq!(out, format!("a {PLACEHOLDER} b {PLACEHOLDER} c"));
}

#[test]
fn does_not_redact_short_sk_identifier() {
    let scrubber = SecretScrubber::new();
    // The container test fixtures and ordinary identifiers use short `sk-`
    // strings that are nowhere near key length; they must survive.
    for harmless in ["sk-test", "sk-1", "task-list", "risk-free"] {
        assert!(
            matches!(scrubber.scrub(harmless), Cow::Borrowed(_)),
            "should not redact {harmless}"
        );
    }
}

#[test]
fn does_not_redact_tail_of_a_longer_token() {
    let scrubber = SecretScrubber::new();
    // The `sk-` here is mid-token (preceded by a token byte), so it is not a
    // key boundary and must be left alone.
    let embedded = "xsk-ant-api03-AbCdEf0123456789AbCdEf0123456789AbCdEf01";
    assert!(matches!(scrubber.scrub(embedded), Cow::Borrowed(_)));
}

#[test]
fn redacts_exact_literals() {
    // A provider key that does not match the `sk-` shape is still redacted when
    // its exact value is known (the host-env path).
    let value = "opaque-token-0123456789abcdef".to_string();
    let scrubber = SecretScrubber::with_literals([value.clone()]);
    let text = format!("KEY={value} done");
    let out = scrubber.scrub(&text);
    assert_eq!(out, format!("KEY={PLACEHOLDER} done"));
}

#[test]
fn ignores_literals_below_the_length_floor() {
    // A short value would scrub far too much; it is dropped rather than honored.
    let scrubber = SecretScrubber::with_literals(["abc".to_string(), "  ".to_string()]);
    assert!(matches!(
        scrubber.scrub("abc and more abc"),
        Cow::Borrowed(_)
    ));
}

#[test]
fn scrub_json_recurses_and_reports_change() {
    let scrubber = SecretScrubber::new();
    let mut value = serde_json::json!({
        "kind": "command",
        "command": format!("env | grep KEY  # {ANTHROPIC_KEY}"),
        "nested": {
            "lines": ["clean", ANTHROPIC_KEY],
        },
        "count": 3,
    });
    assert!(scrubber.scrub_json(&mut value));
    assert_eq!(
        value["command"],
        serde_json::json!(format!("env | grep KEY  # {PLACEHOLDER}"))
    );
    assert_eq!(value["nested"]["lines"][1], serde_json::json!(PLACEHOLDER));
    // Untouched data is preserved, including non-string types.
    assert_eq!(value["nested"]["lines"][0], serde_json::json!("clean"));
    assert_eq!(value["count"], serde_json::json!(3));
}

#[test]
fn scrub_json_reports_no_change_for_clean_value() {
    let scrubber = SecretScrubber::new();
    let mut value = serde_json::json!({ "message": "all good", "n": 1 });
    assert!(!scrubber.scrub_json(&mut value));
}

#[test]
fn redacts_key_surrounded_by_multibyte_text() {
    let scrubber = SecretScrubber::new();
    // A non-ASCII character immediately before the key reads as a boundary, and
    // slicing must not split the multibyte character.
    let text = format!("日本語{ANTHROPIC_KEY}語");
    let out = scrubber.scrub(&text);
    assert_eq!(out, format!("日本語{PLACEHOLDER}語"));
}
