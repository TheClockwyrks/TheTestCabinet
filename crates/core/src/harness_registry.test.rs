//! Tests for usage normalization across harness reporting shapes.

use super::*;
use crate::harness::HarnessRegistry;

/// Build an `ExecOutput` with the given stdout and a success exit code.
fn stdout(text: &str) -> ExecOutput {
    ExecOutput {
        exit_code: 0,
        stdout: text.to_string(),
        stderr: String::new(),
    }
}

fn shape_for(slug: HarnessSlug) -> UsageShape {
    // Reconstruct each descriptor purely to read its usage shape in tests.
    match slug {
        HarnessSlug::Claude => UsageShape {
            input: &["input_tokens"],
            cached: &["cache_read_input_tokens"],
            cache_creation: &["cache_creation_input_tokens"],
            output: &["output_tokens"],
            reasoning: &[],
            cost: &["total_cost_usd"],
            input_includes_cache: false,
            aggregation: Aggregation::Last,
        },
        HarnessSlug::Codex => UsageShape {
            input: &["input_tokens"],
            cached: &["cached_input_tokens"],
            cache_creation: &[],
            output: &["output_tokens"],
            reasoning: &["reasoning_output_tokens"],
            cost: &[],
            input_includes_cache: true,
            aggregation: Aggregation::Last,
        },
        HarnessSlug::Opencode => UsageShape {
            input: &["input"],
            cached: &["cache_read", "cacheRead"],
            cache_creation: &["cache_write", "cacheWrite"],
            output: &["output"],
            reasoning: &["reasoning"],
            cost: &[],
            input_includes_cache: false,
            aggregation: Aggregation::Sum,
        },
        _ => UsageShape::NONE,
    }
}

#[test]
fn claude_counts_cache_creation_as_uncached_input() {
    let line = r#"{"type":"result","usage":{"input_tokens":100,"cache_read_input_tokens":40,"cache_creation_input_tokens":10,"output_tokens":25}}"#;
    let usage = parse_usage(&stdout(line), shape_for(HarnessSlug::Claude));
    assert_eq!(usage.tokens.uncached_input, 110); // 100 input + 10 cache creation
    assert_eq!(usage.tokens.cached_input, 40);
    assert_eq!(usage.tokens.output, 25);
    assert_eq!(usage.tokens.reasoning, 0);
}

#[test]
fn codex_subtracts_cached_from_inclusive_input_and_keeps_reasoning() {
    let line = r#"{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":600,"output_tokens":200,"reasoning_output_tokens":80}}"#;
    let usage = parse_usage(&stdout(line), shape_for(HarnessSlug::Codex));
    assert_eq!(usage.tokens.uncached_input, 400); // 1000 - 600 cached
    assert_eq!(usage.tokens.cached_input, 600);
    assert_eq!(usage.tokens.output, 200);
    assert_eq!(usage.tokens.reasoning, 80);
}

#[test]
fn claude_takes_the_last_cumulative_event() {
    let stream = concat!(
        r#"{"type":"assistant","usage":{"input_tokens":10,"output_tokens":1}}"#,
        "\n",
        r#"{"type":"result","usage":{"input_tokens":100,"output_tokens":25}}"#,
    );
    let usage = parse_usage(&stdout(stream), shape_for(HarnessSlug::Claude));
    assert_eq!(usage.tokens.uncached_input, 100);
    assert_eq!(usage.tokens.output, 25);
}

#[test]
fn claude_reports_its_terminal_total_cost() {
    let stream = concat!(
        r#"{"type":"assistant","usage":{"input_tokens":10,"output_tokens":1}}"#,
        "\n",
        r#"{"type":"result","total_cost_usd":0.0153196,"usage":{"input_tokens":100,"output_tokens":25}}"#,
    );
    let cost = parse_reported_cost(&stdout(stream), shape_for(HarnessSlug::Claude));
    assert_eq!(cost, Some(0.0153196));
}

#[test]
fn harnesses_without_a_cost_field_report_no_cost() {
    let line = r#"{"type":"turn.completed","usage":{"input_tokens":1000,"output_tokens":200},"total_cost_usd":1.5}"#;
    // Codex declares no cost key, so even a stray cost-like field is ignored.
    let cost = parse_reported_cost(&stdout(line), shape_for(HarnessSlug::Codex));
    assert_eq!(cost, None);
}

#[test]
fn opencode_sums_per_step_deltas() {
    let stream = concat!(
        r#"{"type":"step_finish","tokens":{"input":50,"output":10}}"#,
        "\n",
        r#"{"type":"step_finish","tokens":{"input":30,"output":20}}"#,
    );
    let usage = parse_usage(&stdout(stream), shape_for(HarnessSlug::Opencode));
    assert_eq!(usage.tokens.uncached_input, 80);
    assert_eq!(usage.tokens.output, 30);
}

#[test]
fn registry_resolves_every_slug_and_marks_antigravity_keyless() {
    let registry = DefaultHarnessRegistry::new();
    for slug in HarnessSlug::ALL {
        let harness = registry.get(slug).expect("every slug is registered");
        assert_eq!(harness.slug(), slug);
        match slug {
            HarnessSlug::Antigravity => assert!(harness.api_key_env().is_none()),
            _ => assert!(harness.api_key_env().is_some()),
        }
    }
}

#[test]
fn parses_a_version_line() {
    assert_eq!(
        parse_version("claude 1.2.3 (build 9)"),
        Some("1.2.3".to_string())
    );
    assert_eq!(parse_version("v0.78.1\n"), Some("0.78.1".to_string()));
}
