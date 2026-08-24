use std::sync::Arc;

use super::*;

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

#[test]
fn a_bare_program_over_gg_is_clean() {
    let text = "import { files } from \"gg\";\n\nfiles.write(\"src/main.ts\", \"...\");\n";
    assert_eq!(classify(text), "clean-program");
    assert!(is_clean(classify(text)));
}

#[test]
fn a_leading_comment_still_counts_as_code() {
    let text = "// set up the project\nimport { shell } from 'gg';\nshell.run(\"ls\");";
    assert_eq!(classify(text), "clean-program");
}

#[test]
fn prose_before_the_program_is_not_clean() {
    let text = "I'll start by reading the specs.\n\nimport { files } from \"gg\";\n";
    assert_eq!(classify(text), "prose+program");
}

#[test]
fn a_fenced_reply_is_fenced_even_when_the_program_is_right() {
    let text = "```ts\nimport { files } from \"gg\";\n```";
    assert_eq!(classify(text), "fenced");
}

#[test]
fn tool_token_markers_outrank_everything_else() {
    let text = "<|tool_call_begin|>files.write<|tool_call_end|>";
    assert_eq!(classify(text), "tool-token");
    assert!(is_tool_syntax(classify(text)));
}

#[test]
fn xml_pseudo_tool_markup_is_its_own_label() {
    let text = "<tool_call>\n{\"name\": \"write_file\"}\n</tool_call>";
    assert_eq!(classify(text), "xml-pseudo-tools");
    assert!(is_tool_syntax(classify(text)));
}

#[test]
fn leaked_chain_of_thought_is_labeled() {
    let text = "<think>the user wants a program</think>\nimport { files } from \"gg\";";
    assert_eq!(classify(text), "cot-leak");
}

#[test]
fn an_empty_reply_is_empty() {
    assert_eq!(classify("   \n  "), "empty");
}

#[test]
fn code_without_the_gg_import_is_flagged() {
    assert_eq!(classify("const x = 1;\nconsole.log(x);"), "program-no-gg");
}

#[test]
fn plain_prose_is_other() {
    assert_eq!(classify("I cannot help with that."), "other");
}

#[test]
fn a_native_tool_call_outranks_the_text_heuristics() {
    let reply = ProbeReply {
        tool_calls: 1,
        content: "import { files } from \"gg\";".to_string(),
        ..ProbeReply::default()
    };
    assert_eq!(label_reply(&reply), LABEL_NATIVE_TOOL_CALL);
    assert!(is_tool_syntax(label_reply(&reply)));
}

// ---------------------------------------------------------------------------
// The verdict reduction
// ---------------------------------------------------------------------------

fn calls_of(spec: &[(&str, &str, usize)]) -> Vec<ScoredCall> {
    spec.iter()
        .flat_map(|(condition, label, n)| {
            std::iter::repeat_with(|| ScoredCall {
                condition: condition.to_string(),
                label: Some(label.to_string()),
            })
            .take(*n)
        })
        .collect()
}

#[test]
fn clean_everywhere_is_ready() {
    let calls = calls_of(&[
        ("base", "clean-program", 3),
        ("no-tools", "clean-program", 3),
        ("notice", "clean-program", 3),
        ("combo", "clean-program", 3),
    ]);
    let reduction = reduce(&calls);
    assert_eq!(reduction.verdict, "ready");
    assert_eq!(reduction.base_clean_rate, Some(1.0));
    assert_eq!(reduction.best_variation_clean_rate, Some(1.0));
}

#[test]
fn a_variation_rescuing_a_dirty_base_is_ready_with_reminders() {
    let calls = calls_of(&[
        ("base", "prose+program", 3),
        ("no-tools", "prose+program", 3),
        ("notice", "clean-program", 3),
        ("combo", "clean-program", 3),
    ]);
    let reduction = reduce(&calls);
    assert_eq!(reduction.verdict, "ready-with-reminders");
    assert_eq!(reduction.base_clean_rate, Some(0.0));
    assert_eq!(reduction.best_variation_clean_rate, Some(1.0));
}

#[test]
fn tool_syntax_surviving_the_variations_is_overfit() {
    let calls = calls_of(&[
        ("base", "tool-token", 3),
        ("no-tools", "tool-token", 3),
        ("notice", "tool-token", 2),
        ("notice", "clean-program", 1),
        ("combo", "tool-token", 3),
    ]);
    assert_eq!(reduce(&calls).verdict, "tool-call-overfit");
}

#[test]
fn non_tool_failures_below_threshold_are_not_ready() {
    let calls = calls_of(&[
        ("base", "fenced", 3),
        ("no-tools", "fenced", 3),
        ("notice", "fenced", 3),
        ("combo", "prose+program", 3),
    ]);
    assert_eq!(reduce(&calls).verdict, "not-ready");
}

#[test]
fn tool_syntax_only_under_base_does_not_make_the_verdict_overfit() {
    // The overfit signature is tool syntax the variations could not talk the
    // model out of; base-only tool syntax with dirty variations is `not-ready`.
    let calls = calls_of(&[
        ("base", "tool-token", 3),
        ("no-tools", "fenced", 3),
        ("notice", "fenced", 3),
        ("combo", "fenced", 3),
    ]);
    assert_eq!(reduce(&calls).verdict, "not-ready");
}

#[test]
fn the_threshold_is_eighty_percent_per_condition() {
    // 4/5 clean = 80% exactly, on every condition: ready.
    let calls = calls_of(&[
        ("base", "clean-program", 4),
        ("base", "fenced", 1),
        ("no-tools", "clean-program", 4),
        ("no-tools", "fenced", 1),
        ("notice", "clean-program", 4),
        ("notice", "fenced", 1),
        ("combo", "clean-program", 4),
        ("combo", "fenced", 1),
    ]);
    assert_eq!(reduce(&calls).verdict, "ready");
}

#[test]
fn errored_calls_are_excluded_from_the_rates() {
    let mut calls = calls_of(&[
        ("base", "clean-program", 2),
        ("no-tools", "clean-program", 1),
        ("notice", "clean-program", 1),
        ("combo", "clean-program", 1),
    ]);
    calls.push(ScoredCall {
        condition: "base".to_string(),
        label: None,
    });
    let reduction = reduce(&calls);
    assert_eq!(reduction.verdict, "ready");
    assert_eq!(reduction.base_clean_rate, Some(1.0));
}

// ---------------------------------------------------------------------------
// The fixture and the request
// ---------------------------------------------------------------------------

#[test]
fn the_fixture_builds_a_system_led_conversation() {
    let base = build_messages(&CONDITIONS[0], false);
    assert_eq!(base.first().map(|m| m.role.as_str()), Some("system"));
    assert!(base.len() >= 10, "the turn-1 replica has many messages");
    assert!(
        base.iter().any(|m| m.role == "assistant"),
        "the seeded example programs are present"
    );
}

#[test]
fn the_default_probe_trims_the_spec_views() {
    let trimmed = build_messages(&CONDITIONS[0], false);
    let full = build_messages(&CONDITIONS[0], true);
    let len = |msgs: &[ProbeMessage]| msgs.iter().map(|m| m.content.len()).sum::<usize>();
    assert!(
        len(&trimmed) < len(&full),
        "trimmed request is smaller than full-context"
    );
}

#[test]
fn the_variations_restate_the_contract() {
    let base = build_messages(&CONDITIONS[0], false);
    let no_tools = build_messages(&CONDITIONS[1], false);
    let notice = build_messages(&CONDITIONS[2], false);
    let combo = build_messages(&CONDITIONS[3], false);
    assert!(no_tools[0].content.ends_with(NO_TOOLS_CLAUSE));
    assert_eq!(no_tools.len(), base.len());
    assert_eq!(
        notice.last().map(|m| m.content.as_str()),
        Some(NOTICE_MESSAGE)
    );
    assert_eq!(notice.len(), base.len() + 1);
    assert!(combo[0].content.ends_with(NO_TOOLS_CLAUSE));
    assert_eq!(
        combo.last().map(|m| m.content.as_str()),
        Some(NOTICE_MESSAGE)
    );
}

#[test]
fn the_request_body_pins_a_provider_only_when_asked() {
    let messages = vec![ProbeMessage {
        role: "user".to_string(),
        content: "hi".to_string(),
    }];
    let default_route = request_body("a/b", &messages, 3500, None, "key-1");
    assert!(default_route.get("provider").is_none());
    assert!(default_route.get("tools").is_none(), "never a tools array");
    assert_eq!(default_route["max_tokens"], 3500);
    assert_eq!(default_route["usage"]["include"], true);

    let pinned = request_body("a/b", &messages, 3500, Some("Sail Research"), "key-2");
    assert_eq!(pinned["provider"]["order"][0], "Sail Research");
    assert_eq!(pinned["provider"]["allow_fallbacks"], false);
}

#[test]
fn a_gateway_reply_parses_into_the_recorded_parts() {
    let body = serde_json::json!({
        "provider": "Sail Research",
        "choices": [{
            "finish_reason": "stop",
            "native_finish_reason": "stop",
            "message": {
                "content": "import { files } from \"gg\";",
                "reasoning": "thinking...",
            },
        }],
        "usage": { "prompt_tokens": 6935, "completion_tokens": 459, "cost": 0.0239 },
    });
    let reply = parse_reply(&body).unwrap();
    assert_eq!(reply.provider.as_deref(), Some("Sail Research"));
    assert_eq!(reply.finish_reason.as_deref(), Some("stop"));
    assert_eq!(reply.content, "import { files } from \"gg\";");
    assert_eq!(reply.reasoning.as_deref(), Some("thinking..."));
    assert_eq!(reply.prompt_tokens, Some(6935));
    assert_eq!(reply.cost, Some(0.0239));
    assert_eq!(reply.tool_calls, 0);
}

#[test]
fn an_error_body_inside_a_200_is_an_error() {
    let body = serde_json::json!({ "error": { "message": "Provider returned error" } });
    assert!(
        parse_reply(&body)
            .unwrap_err()
            .contains("Provider returned error")
    );
}

// ---------------------------------------------------------------------------
// The runner, end to end against a fake gateway and an in-memory store
// ---------------------------------------------------------------------------

/// A local chat/completions stand-in answering every call with `body`.
async fn fake_gateway(body: serde_json::Value) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = axum::Router::new().route(
        "/chat/completions",
        axum::routing::post(move || {
            let body = body.clone();
            async move { axum::Json(body) }
        }),
    );
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}/chat/completions")
}

fn probe_row(samples: i32) -> test_cabinet_entities::model_probe::Model {
    test_cabinet_entities::model_probe::Model {
        id: "probe-1".to_string(),
        model_slug: "test-model".to_string(),
        openrouter_slug: "test/model".to_string(),
        provider: None,
        user_id: "user-1".to_string(),
        samples,
        max_tokens: 3500,
        full_context: false,
        request_json: "[]".to_string(),
        status: "running".to_string(),
        error: None,
        verdict: None,
        base_clean_rate: None,
        best_variation_clean_rate: None,
        spend: 0.0,
        created_at: "2026-08-23T00:00:00Z".to_string(),
        finished_at: None,
    }
}

#[tokio::test]
async fn a_clean_model_probes_to_ready_with_recorded_items_and_spend() {
    let endpoint = fake_gateway(serde_json::json!({
        "provider": "Fake Provider",
        "choices": [{
            "finish_reason": "stop",
            "message": { "content": "import { files } from \"gg\";\nfiles.list(\".\");" },
        }],
        "usage": { "prompt_tokens": 7000, "completion_tokens": 40, "cost": 0.001 },
    }))
    .await;
    let db = Arc::new(crate::db::Db::connect_in_memory().await.unwrap());
    let probe = probe_row(1);
    db.insert_model_probe(probe.clone()).await.unwrap();

    let runner = ProbeRunner {
        db: Arc::clone(&db),
        http: reqwest::Client::new(),
        endpoint,
        api_key: "test-key".to_string(),
    };
    runner.run(probe).await;

    let row = db.get_model_probe("probe-1").await.unwrap().unwrap();
    assert_eq!(row.status, "complete");
    assert_eq!(row.verdict.as_deref(), Some("ready"));
    assert_eq!(row.base_clean_rate, Some(1.0));
    assert!((row.spend - 0.004).abs() < 1e-9, "4 calls x 0.001");
    assert!(row.finished_at.is_some());

    let items = db.list_model_probe_items("probe-1").await.unwrap();
    assert_eq!(items.len(), CONDITIONS.len());
    assert!(items.iter().all(|i| i.clean));
    assert!(
        items
            .iter()
            .all(|i| i.provider.as_deref() == Some("Fake Provider"))
    );
    assert!(
        items
            .iter()
            .all(|i| i.response_text.contains("from \"gg\""))
    );
}

#[tokio::test]
async fn an_unreachable_gateway_fails_the_probe_with_the_fault_recorded() {
    let db = Arc::new(crate::db::Db::connect_in_memory().await.unwrap());
    let probe = probe_row(1);
    db.insert_model_probe(probe.clone()).await.unwrap();

    let runner = ProbeRunner {
        db: Arc::clone(&db),
        http: reqwest::Client::new(),
        endpoint: "http://127.0.0.1:1/chat/completions".to_string(),
        api_key: "test-key".to_string(),
    };
    runner.run(probe).await;

    let row = db.get_model_probe("probe-1").await.unwrap().unwrap();
    assert_eq!(row.status, "failed");
    assert!(row.verdict.is_none());
    assert!(row.error.unwrap().contains("every probe call failed"));
    let items = db.list_model_probe_items("probe-1").await.unwrap();
    assert_eq!(items.len(), CONDITIONS.len());
    assert!(items.iter().all(|i| i.label.is_none() && i.error.is_some()));
}

#[tokio::test]
async fn a_backend_restart_reaps_running_probes() {
    let db = Arc::new(crate::db::Db::connect_in_memory().await.unwrap());
    db.insert_model_probe(probe_row(1)).await.unwrap();
    let reaped = db
        .fail_running_model_probes("2026-08-23T01:00:00Z")
        .await
        .unwrap();
    assert_eq!(reaped, 1);
    let row = db.get_model_probe("probe-1").await.unwrap().unwrap();
    assert_eq!(row.status, "failed");
    assert!(row.error.unwrap().contains("restarted"));
}
