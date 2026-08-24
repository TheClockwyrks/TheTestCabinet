use std::sync::Arc;

use super::*;

// ---------------------------------------------------------------------------
// Classification of a submitted program string
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
fn a_fenced_program_is_fenced_even_when_the_code_inside_is_right() {
    // gg compiles the string exactly as sent, so a fence is part of the program.
    let text = "```ts\nimport { files } from \"gg\";\n```";
    assert_eq!(classify(text), "fenced");
}

#[test]
fn tool_token_markers_outrank_everything_else() {
    let text = "<|tool_call_begin|>files.write<|tool_call_end|>";
    assert_eq!(classify(text), "tool-token");
}

#[test]
fn xml_pseudo_tool_markup_is_its_own_label() {
    let text = "<tool_call>\n{\"name\": \"write_file\"}\n</tool_call>";
    assert_eq!(classify(text), "xml-pseudo-tools");
}

#[test]
fn leaked_chain_of_thought_is_labeled() {
    let text = "<think>the user wants a program</think>\nimport { files } from \"gg\";";
    assert_eq!(classify(text), "cot-leak");
}

#[test]
fn an_empty_program_is_empty() {
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

// ---------------------------------------------------------------------------
// Labeling a reply: the program when one arrived, the dodge when none did
// ---------------------------------------------------------------------------

#[test]
fn a_submitted_program_is_classified_and_commentary_is_ignored() {
    let reply = ProbeReply {
        content: "Let me start by exploring the workspace.".to_string(),
        tool_calls: 1,
        submit_calls: 1,
        program: Some("import { files } from \"gg\";\nfiles.list(\".\");".to_string()),
        ..ProbeReply::default()
    };
    assert_eq!(label_reply(&reply), LABEL_CLEAN);
}

#[test]
fn a_submit_call_without_a_program_string_is_no_program() {
    let reply = ProbeReply {
        tool_calls: 1,
        submit_calls: 1,
        program: None,
        ..ProbeReply::default()
    };
    assert_eq!(label_reply(&reply), LABEL_NO_PROGRAM);
}

#[test]
fn calls_that_never_name_submit_program_are_stray() {
    let reply = ProbeReply {
        tool_calls: 2,
        submit_calls: 0,
        program: None,
        ..ProbeReply::default()
    };
    assert_eq!(label_reply(&reply), LABEL_STRAY_TOOL_CALL);
}

#[test]
fn a_reply_with_no_call_at_all_is_no_submission() {
    let reply = ProbeReply {
        content: "import { files } from \"gg\";".to_string(),
        ..ProbeReply::default()
    };
    // Even code-shaped text is never classified: only a submitted program runs.
    assert_eq!(label_reply(&reply), LABEL_NO_SUBMISSION);
}

// ---------------------------------------------------------------------------
// The verdict reduction
// ---------------------------------------------------------------------------

fn calls_of(spec: &[(&str, usize)]) -> Vec<ScoredCall> {
    spec.iter()
        .flat_map(|(label, n)| {
            std::iter::repeat_with(|| ScoredCall {
                label: Some(label.to_string()),
            })
            .take(*n)
        })
        .collect()
}

#[test]
fn clean_everywhere_is_ready() {
    let reduction = reduce(&calls_of(&[("clean-program", 3)]));
    assert_eq!(reduction.verdict, "ready");
    assert_eq!(reduction.clean_rate, Some(1.0));
}

#[test]
fn the_threshold_is_eighty_percent() {
    // 4/5 clean = 80% exactly: ready.
    let reduction = reduce(&calls_of(&[("clean-program", 4), ("fenced", 1)]));
    assert_eq!(reduction.verdict, "ready");
    assert_eq!(reduction.clean_rate, Some(0.8));
}

#[test]
fn below_the_threshold_is_not_ready() {
    let reduction = reduce(&calls_of(&[
        ("clean-program", 1),
        ("prose+program", 1),
        ("no-submission", 1),
    ]));
    assert_eq!(reduction.verdict, "not-ready");
}

#[test]
fn errored_calls_are_excluded_from_the_rate() {
    let mut calls = calls_of(&[("clean-program", 2)]);
    calls.push(ScoredCall { label: None });
    let reduction = reduce(&calls);
    assert_eq!(reduction.verdict, "ready");
    assert_eq!(reduction.clean_rate, Some(1.0));
}

#[test]
fn no_scored_call_reduces_to_not_ready_with_no_rate() {
    let reduction = reduce(&[ScoredCall { label: None }]);
    assert_eq!(reduction.verdict, "not-ready");
    assert_eq!(reduction.clean_rate, None);
}

// ---------------------------------------------------------------------------
// The fixture and the request
// ---------------------------------------------------------------------------

#[test]
fn the_fixture_builds_a_system_led_conversation_in_the_call_shape() {
    let messages = build_messages(false);
    assert_eq!(messages.first().map(|m| m.role.as_str()), Some("system"));
    assert!(messages.len() >= 10, "the turn-1 replica has many messages");
    // The seeded example programs travel as synthesized `submit_program` calls, and every call
    // is answered by its own `tool` acknowledgement — the shape a provider requires.
    let submissions: Vec<&ProbeMessage> = messages
        .iter()
        .filter(|m| m.role == "assistant" && !m.tool_calls.is_empty())
        .collect();
    assert!(
        !submissions.is_empty(),
        "the seeded submissions are present"
    );
    for message in &submissions {
        for call in &message.tool_calls {
            assert_eq!(call.function.name, SUBMIT_PROGRAM_TOOL);
            let arguments: serde_json::Value =
                serde_json::from_str(&call.function.arguments).unwrap();
            assert!(
                arguments["program"].is_string(),
                "a seeded call carries its program string"
            );
            assert!(
                messages
                    .iter()
                    .any(|m| m.role == "tool" && m.tool_call_id.as_deref() == Some(&call.id)),
                "call `{}` is answered by a tool result",
                call.id
            );
        }
    }
    // The request ends on the trailing contract notice, as gg's own requests do.
    let last = messages.last().unwrap();
    assert_eq!(last.role, "system");
    assert!(
        last.content
            .as_deref()
            .is_some_and(|c| c.contains("submit_program")),
        "the trailing notice restates the call contract"
    );
}

#[test]
fn the_default_probe_trims_the_spec_views() {
    let len = |msgs: &[ProbeMessage]| {
        msgs.iter()
            .filter_map(|m| m.content.as_deref())
            .map(str::len)
            .sum::<usize>()
    };
    assert!(
        len(&build_messages(false)) < len(&build_messages(true)),
        "trimmed request is smaller than full-context"
    );
}

#[test]
fn the_request_body_offers_and_requires_submit_program() {
    let messages = vec![ProbeMessage {
        role: "user".to_string(),
        content: Some("hi".to_string()),
        tool_calls: Vec::new(),
        tool_call_id: None,
    }];
    let default_route = request_body("a/b", &messages, 3500, None, "key-1");
    assert!(default_route.get("provider").is_none());
    assert_eq!(default_route["max_tokens"], 3500);
    assert_eq!(default_route["usage"]["include"], true);
    let tools = default_route["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 1, "exactly the one tool");
    assert_eq!(tools[0]["function"]["name"], SUBMIT_PROGRAM_TOOL);
    assert_eq!(
        default_route["tool_choice"]["function"]["name"], SUBMIT_PROGRAM_TOOL,
        "the choice is forced, never `auto`"
    );

    let pinned = request_body("a/b", &messages, 3500, Some("Sail Research"), "key-2");
    assert_eq!(pinned["provider"]["order"][0], "Sail Research");
    assert_eq!(pinned["provider"]["allow_fallbacks"], false);
}

#[test]
fn a_gateway_reply_parses_into_the_recorded_parts() {
    let program = "import { files } from \"gg\";\nfiles.list(\".\");";
    let body = serde_json::json!({
        "provider": "Sail Research",
        "choices": [{
            "finish_reason": "tool_calls",
            "native_finish_reason": "tool_calls",
            "message": {
                "content": "Starting with a listing.",
                "reasoning": "thinking...",
                "tool_calls": [{
                    "id": "call-1",
                    "type": "function",
                    "function": {
                        "name": "submit_program",
                        "arguments": serde_json::json!({ "program": program }).to_string(),
                    },
                }],
            },
        }],
        "usage": { "prompt_tokens": 6935, "completion_tokens": 459, "cost": 0.0239 },
    });
    let reply = parse_reply(&body).unwrap();
    assert_eq!(reply.provider.as_deref(), Some("Sail Research"));
    assert_eq!(reply.finish_reason.as_deref(), Some("tool_calls"));
    assert_eq!(reply.content, "Starting with a listing.");
    assert_eq!(reply.reasoning.as_deref(), Some("thinking..."));
    assert_eq!(reply.tool_calls, 1);
    assert_eq!(reply.submit_calls, 1);
    assert_eq!(reply.program.as_deref(), Some(program));
    assert_eq!(reply.prompt_tokens, Some(6935));
    assert_eq!(reply.cost, Some(0.0239));
    assert_eq!(label_reply(&reply), LABEL_CLEAN);
}

#[test]
fn unparseable_arguments_leave_no_program() {
    let body = serde_json::json!({
        "choices": [{
            "message": {
                "tool_calls": [{
                    "id": "call-1",
                    "type": "function",
                    "function": { "name": "submit_program", "arguments": "not json" },
                }],
            },
        }],
    });
    let reply = parse_reply(&body).unwrap();
    assert_eq!(reply.submit_calls, 1);
    assert_eq!(reply.program, None);
    assert_eq!(label_reply(&reply), LABEL_NO_PROGRAM);
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
        clean_rate: None,
        spend: 0.0,
        created_at: "2026-08-23T00:00:00Z".to_string(),
        finished_at: None,
    }
}

#[tokio::test]
async fn a_clean_model_probes_to_ready_with_recorded_items_and_spend() {
    let program = "import { files } from \"gg\";\nfiles.list(\".\");";
    let endpoint = fake_gateway(serde_json::json!({
        "provider": "Fake Provider",
        "choices": [{
            "finish_reason": "tool_calls",
            "message": {
                "content": "",
                "tool_calls": [{
                    "id": "call-1",
                    "type": "function",
                    "function": {
                        "name": "submit_program",
                        "arguments": serde_json::json!({ "program": program }).to_string(),
                    },
                }],
            },
        }],
        "usage": { "prompt_tokens": 7000, "completion_tokens": 40, "cost": 0.001 },
    }))
    .await;
    let db = Arc::new(crate::db::Db::connect_in_memory().await.unwrap());
    let probe = probe_row(4);
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
    assert_eq!(row.clean_rate, Some(1.0));
    assert!((row.spend - 0.004).abs() < 1e-9, "4 calls x 0.001");
    assert!(row.finished_at.is_some());

    let items = db.list_model_probe_items("probe-1").await.unwrap();
    assert_eq!(items.len(), 4, "one item per sample");
    assert!(items.iter().all(|i| i.clean));
    assert!(
        items
            .iter()
            .all(|i| i.provider.as_deref() == Some("Fake Provider"))
    );
    assert!(
        items
            .iter()
            .all(|i| i.program_text.as_deref() == Some(program)),
        "the submitted program is recorded verbatim"
    );
}

#[tokio::test]
async fn an_unreachable_gateway_fails_the_probe_with_the_fault_recorded() {
    let db = Arc::new(crate::db::Db::connect_in_memory().await.unwrap());
    let probe = probe_row(2);
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
    assert_eq!(items.len(), 2);
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
