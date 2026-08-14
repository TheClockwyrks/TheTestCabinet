//! Tests for usage normalization across harness reporting shapes.

use super::*;
use crate::harness::HarnessRegistry;

/// Build an `ExecOutput` with the given stdout and a success exit code.
fn stdout(text: &str) -> ExecOutput {
    ExecOutput {
        exit_code: 0,
        stdout: text.to_string(),
        stderr: String::new(),
        idle_timed_out: false,
    }
}

fn shape_for(slug: HarnessSlug) -> UsageShape {
    // Read each harness's real usage shape straight from its adapter spec, so the
    // tests exercise the shapes the registry actually ships rather than a copy.
    adapter_spec(slug).usage
}

#[test]
fn claude_counts_cache_creation_as_uncached_input() {
    let line = r#"{"type":"result","usage":{"input_tokens":100,"cache_read_input_tokens":40,"cache_creation_input_tokens":10,"output_tokens":25}}"#;
    let usage = parse_usage(&stdout(line), shape_for(HarnessSlug::Claude));
    assert_eq!(usage.tokens.uncached_input, Some(110)); // 100 input + 10 cache creation
    assert_eq!(usage.tokens.cached_input, Some(40));
    assert_eq!(usage.tokens.output, Some(25));
    // Claude Code declares no reasoning key, so reasoning is unknown, not zero.
    assert_eq!(usage.tokens.reasoning, None);
}

#[test]
fn codex_subtracts_cached_from_inclusive_input_and_keeps_reasoning() {
    let line = r#"{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":600,"output_tokens":200,"reasoning_output_tokens":80}}"#;
    let usage = parse_usage(&stdout(line), shape_for(HarnessSlug::Codex));
    assert_eq!(usage.tokens.uncached_input, Some(400)); // 1000 - 600 cached
    assert_eq!(usage.tokens.cached_input, Some(600));
    assert_eq!(usage.tokens.output, Some(200));
    assert_eq!(usage.tokens.reasoning, Some(80));
}

#[test]
fn output_carrying_no_usage_event_reports_nothing_rather_than_zero() {
    // Codex reports usage only on its terminal `turn.completed`. A session whose
    // output was cut short before that event says nothing about its usage, so
    // every class is unknown. Reporting `Some(0)` here would assert a run that
    // used no tokens — and price it, confidently, at $0.00.
    let stream = concat!(
        r#"{"type":"thread.started","thread_id":"abc"}"#,
        "\n",
        r#"{"type":"item.completed","item":{"type":"agent_message","text":"working"}}"#,
    );
    let usage = parse_usage(&stdout(stream), shape_for(HarnessSlug::Codex));
    assert_eq!(usage.tokens.uncached_input, None);
    assert_eq!(usage.tokens.cached_input, None);
    assert_eq!(usage.tokens.output, None);
    assert_eq!(usage.tokens.reasoning, None);
    assert_eq!(usage.tokens.total(), None);
}

#[test]
fn a_reported_zero_stays_distinct_from_nothing_reported() {
    // A harness that does report usage, and reports zero for a class it declares,
    // records `Some(0)` — the genuine-zero case the unreported case must not be
    // confused with.
    let line = r#"{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":0,"output_tokens":200,"reasoning_output_tokens":0}}"#;
    let usage = parse_usage(&stdout(line), shape_for(HarnessSlug::Codex));
    assert_eq!(usage.tokens.uncached_input, Some(1000));
    assert_eq!(usage.tokens.cached_input, Some(0));
    assert_eq!(usage.tokens.reasoning, Some(0));
}

#[test]
fn a_truncated_incremental_stream_keeps_the_steps_that_arrived() {
    // A harness that reports per-step deltas (OpenCode sums `step_finish` events)
    // still has real usage in a session that was cut short: everything up to the
    // truncation counts, rather than the whole session being written off.
    let stream = concat!(
        r#"{"type":"step_finish","part":{"tokens":{"input":50,"output":10,"cache":{"read":500,"write":0}}}}"#,
        "\n",
        r#"{"type":"step_finish","part":{"tokens":{"input":20,"output":4,"cache":{"read":100,"write":0}}}}"#,
    );
    let usage = parse_usage(&stdout(stream), shape_for(HarnessSlug::Opencode));
    assert_eq!(usage.tokens.output, Some(14));
    assert_eq!(usage.tokens.cached_input, Some(600));
}

#[test]
fn claude_takes_the_last_cumulative_event() {
    let stream = concat!(
        r#"{"type":"assistant","usage":{"input_tokens":10,"output_tokens":1}}"#,
        "\n",
        r#"{"type":"result","usage":{"input_tokens":100,"output_tokens":25}}"#,
    );
    let usage = parse_usage(&stdout(stream), shape_for(HarnessSlug::Claude));
    assert_eq!(usage.tokens.uncached_input, Some(100));
    assert_eq!(usage.tokens.output, Some(25));
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
fn opencode_sums_per_step_deltas_and_reads_nested_cache() {
    // OpenCode reports per-step usage under `part.tokens`, with cache reads and
    // writes nested in a `cache` object. Usage is summed across `step_finish`
    // events, and the nested cache read is the cached-input class.
    let stream = concat!(
        r#"{"type":"step_finish","part":{"tokens":{"input":50,"output":10,"cache":{"read":500,"write":0}}}}"#,
        "\n",
        r#"{"type":"step_finish","part":{"tokens":{"input":30,"output":20,"cache":{"read":700,"write":0}}}}"#,
    );
    let usage = parse_usage(&stdout(stream), shape_for(HarnessSlug::Opencode));
    assert_eq!(usage.tokens.uncached_input, Some(80));
    assert_eq!(usage.tokens.cached_input, Some(1200));
    assert_eq!(usage.tokens.output, Some(30));
}

#[test]
fn kilo_sums_per_step_deltas_and_reads_nested_cache() {
    // Kilo Code runs on OpenCode's runtime, so it reports usage the same way:
    // per-step under `part.tokens` with cache reads/writes nested in a `cache`
    // object, plus a `reasoning` count. The nested `cache.read` is the cached
    // class — the prior flat `cacheReadTokens` keys never matched it, dropping
    // every cached-read token and undercounting the cost.
    let stream = concat!(
        r#"{"type":"step_start","part":{"type":"step-start"}}"#,
        "\n",
        r#"{"type":"step_finish","part":{"tokens":{"input":10973,"output":41,"reasoning":17,"cache":{"read":128,"write":0}},"cost":0.0033}}"#,
        "\n",
        r#"{"type":"step_finish","part":{"tokens":{"input":402,"output":378,"reasoning":0,"cache":{"read":70016,"write":0}},"cost":0.0047}}"#,
    );
    let usage = parse_usage(&stdout(stream), shape_for(HarnessSlug::Kilo));
    assert_eq!(usage.tokens.uncached_input, Some(11375)); // 10973 + 402
    assert_eq!(usage.tokens.cached_input, Some(70144)); // 128 + 70016
    assert_eq!(usage.tokens.output, Some(419)); // 41 + 378
    assert_eq!(usage.tokens.reasoning, Some(17));
}

#[test]
fn pi_sums_per_message_usage_and_ignores_restated_turn_totals() {
    // Pi reports per-message usage under `message.usage` on `message_end`, then
    // restates the same block on `turn_end`. Only `message_end` is summed, so the
    // restated turn total must not be double-counted, and `cacheRead` is the
    // cached-input class held separately from the uncached `input`.
    let stream = concat!(
        r#"{"type":"message_end","message":{"role":"assistant","usage":{"input":1000,"output":50,"cacheRead":4000,"cacheWrite":0,"totalTokens":5050}}}"#,
        "\n",
        r#"{"type":"turn_end","message":{"role":"assistant","usage":{"input":1000,"output":50,"cacheRead":4000,"cacheWrite":0,"totalTokens":5050}}}"#,
        "\n",
        r#"{"type":"message_end","message":{"role":"assistant","usage":{"input":200,"output":30,"cacheRead":6000,"cacheWrite":0,"totalTokens":6230}}}"#,
    );
    let usage = parse_usage(&stdout(stream), shape_for(HarnessSlug::Pi));
    assert_eq!(usage.tokens.uncached_input, Some(1200)); // 1000 + 200; turn_end ignored
    assert_eq!(usage.tokens.cached_input, Some(10000)); // 4000 + 6000
    assert_eq!(usage.tokens.output, Some(80));
    // Pi declares no reasoning key, so reasoning is unknown, not zero.
    assert_eq!(usage.tokens.reasoning, None);
}

#[test]
fn cline_subtracts_cache_reads_from_its_inclusive_input() {
    // Cline's `inputTokens` is cache-inclusive — it already contains
    // `cacheReadTokens` — so the cache reads are subtracted to recover the
    // uncached input rather than counted a second time. Numbers are from a real
    // run whose reported total cost ($1.86) only reconciles this way.
    let line = r#"{"type":"run_result","usage":{"inputTokens":3519925,"cacheReadTokens":3062974,"cacheWriteTokens":0,"outputTokens":79240,"totalCost":1.8580326}}"#;
    let usage = parse_usage(&stdout(line), shape_for(HarnessSlug::Cline));
    assert_eq!(usage.tokens.uncached_input, Some(456951)); // 3519925 - 3062974
    assert_eq!(usage.tokens.cached_input, Some(3062974));
    assert_eq!(usage.tokens.output, Some(79240));
    // Total input is the reported `inputTokens`, not inflated past it.
    assert_eq!(usage.tokens.total_input(), Some(3519925));
}

#[test]
fn goose_reports_neither_cache_nor_reasoning_as_unknown_not_zero() {
    // Goose's `complete` event carries only flat input/output totals; it declares
    // no cache or reasoning keys, so those classes are unknown (`None`) rather than
    // a misleading zero, while the reported classes are `Some`.
    let line =
        r#"{"type":"complete","input_tokens":368956,"output_tokens":20801,"total_tokens":389757}"#;
    let usage = parse_usage(&stdout(line), shape_for(HarnessSlug::Goose));
    assert_eq!(usage.tokens.uncached_input, Some(368956));
    assert_eq!(usage.tokens.output, Some(20801));
    assert_eq!(usage.tokens.cached_input, None);
    assert_eq!(usage.tokens.reasoning, None);
    // The unreported cache/reasoning classes are folded into the reported input
    // and output, so the totals still reflect them (Goose's `input_tokens` already
    // includes any cache reads; its `output_tokens` already includes reasoning).
    assert_eq!(usage.tokens.total_input(), Some(368956));
    assert_eq!(usage.tokens.total_output(), Some(20801));
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
fn codex_injects_the_key_as_codex_api_key_in_the_container() {
    let registry = DefaultHarnessRegistry::new();
    let codex = registry
        .get(HarnessSlug::Codex)
        .expect("codex is registered");
    // The user exports the conventional key on the host...
    assert_eq!(codex.api_key_env(), Some("OPENAI_API_KEY"));
    // ...but `codex exec` only reads CODEX_API_KEY, so that is what is set in
    // the container.
    assert_eq!(codex.container_key_env(), Some("CODEX_API_KEY"));
}

#[test]
fn other_harnesses_use_the_same_key_var_on_host_and_in_the_container() {
    let registry = DefaultHarnessRegistry::new();
    for slug in HarnessSlug::ALL {
        if slug == HarnessSlug::Codex {
            continue;
        }
        let harness = registry.get(slug).expect("every slug is registered");
        assert_eq!(
            harness.container_key_env(),
            harness.api_key_env(),
            "{slug:?} should inject its host key var unchanged"
        );
    }
}

// The model-id → OpenRouter price-lookup mapping (Codex's `openai/` prefix,
// OpenCode/Kilo's `openrouter/` strip, and `:free` tag handling) is now owned by
// `crate::model_id` and tested in `model_id.test.rs`.

#[test]
fn parses_a_version_line() {
    assert_eq!(
        parse_version("claude 1.2.3 (build 9)"),
        Some("1.2.3".to_string())
    );
    assert_eq!(parse_version("v0.78.1\n"), Some("0.78.1".to_string()));
}

#[test]
fn every_embedded_manifest_parses_and_matches_its_slug() {
    for slug in HarnessSlug::ALL {
        // `load_manifest` panics on a parse error or a slug that disagrees with
        // its directory, so this exercises every shipped `harness.toml`.
        let manifest = load_manifest(slug);
        assert_eq!(manifest.slug, slug);
        assert!(!manifest.name.trim().is_empty(), "{slug:?} name is empty");
        assert!(
            !manifest.binary.trim().is_empty(),
            "{slug:?} binary is empty"
        );
        assert!(
            !manifest.install.trim().is_empty(),
            "{slug:?} install is empty"
        );
    }
}

#[test]
fn every_harness_exposes_a_name_and_runtime_install_command() {
    let registry = DefaultHarnessRegistry::new();
    for slug in HarnessSlug::ALL {
        let harness = registry.get(slug).expect("every slug is registered");
        assert!(!harness.name().is_empty(), "{slug:?} should expose a name");
        // The CLI is installed at run time, so every harness carries an install
        // command rather than relying on a prebuilt per-harness image.
        assert!(
            harness
                .install_command()
                .is_some_and(|cmd| !cmd.trim().is_empty()),
            "{slug:?} should carry a non-empty install command",
        );
    }
}
