use std::sync::Arc;

use test_cabinet_core::gg::GgProgramLanguage;

use super::*;

// ---------------------------------------------------------------------------
// The embedded fixtures and the plan
// ---------------------------------------------------------------------------

#[test]
fn the_fixtures_cover_every_registered_language() {
    let expected: Vec<&str> = GgProgramLanguage::ALL.iter().map(|l| l.id()).collect();
    assert_eq!(fixture_languages(), expected);
}

#[test]
fn every_fixture_carries_both_scenarios_and_at_least_three_prompts() {
    for language in fixture_languages() {
        let cases = plan_cases(Some(language)).unwrap();
        let scenarios: std::collections::BTreeSet<&str> =
            cases.iter().map(|case| case.scenario()).collect();
        assert!(scenarios.contains(SCENARIO_BASELINE), "{language}");
        assert!(scenarios.contains(SCENARIO_MISSING_DOCVIEW), "{language}");
        let prompts: std::collections::BTreeSet<&str> =
            cases.iter().map(|case| case.prompt()).collect();
        assert!(prompts.len() >= 3, "{language}: {prompts:?}");
    }
}

#[test]
fn planning_every_language_yields_every_fixture_case() {
    let all = plan_cases(None).unwrap();
    let one = plan_cases(Some("typescript")).unwrap();
    assert_eq!(all.len(), one.len() * fixture_languages().len());
    assert!(
        plan_cases(Some("cobol"))
            .unwrap_err()
            .contains("names no gg program language")
    );
}

#[test]
fn a_case_conversation_is_faithful_end_to_end() {
    for case in plan_cases(Some("typescript")).unwrap() {
        let messages = case.messages();
        assert_eq!(messages.first().map(|m| m.role.as_str()), Some("system"));
        // The seeded submissions travel as `submit_program` calls answered by their `ok`.
        let submissions: Vec<&ProbeMessage> = messages
            .iter()
            .filter(|m| m.role == "assistant" && !m.tool_calls.is_empty())
            .collect();
        assert!(!submissions.is_empty());
        for message in &submissions {
            for call in &message.tool_calls {
                assert_eq!(call.function.name, SUBMIT_PROGRAM_TOOL);
                assert!(
                    messages
                        .iter()
                        .any(|m| m.role == "tool" && m.tool_call_id.as_deref() == Some(&call.id))
                );
            }
        }
        // The file view is presented whole: its heading's range covers the body's line count —
        // the total-line-count heading, untrimmed.
        let file_view = messages
            .iter()
            .filter_map(|m| m.content.as_deref())
            .find(|c| c.starts_with("File: "))
            .expect("a file view is seeded");
        let (heading, body) = file_view.split_once("\n----\n").unwrap();
        let total = body.lines().count();
        assert!(
            heading.ends_with(&format!(":1-{total} of {total} lines")),
            "the heading `{heading}` covers the whole {total}-line body"
        );
        // The request ends on the seeded file view — nothing rides after the conversation.
        assert_eq!(messages.last().unwrap().role, "user");
    }
}

#[test]
fn probe_requests_address_every_case() {
    let requests = probe_requests(Some("rust")).unwrap();
    assert_eq!(requests.len(), plan_cases(Some("rust")).unwrap().len());
    assert!(requests.iter().all(|r| r.language == "rust"));
    assert!(requests.iter().all(|r| !r.messages.is_empty()));
}

// ---------------------------------------------------------------------------
// Call detection
// ---------------------------------------------------------------------------

#[test]
fn string_literal_contents_are_stripped_before_matching() {
    let stripped = strip_string_literals("views.openDocsView(\"gg.shell.shell\");");
    assert_eq!(stripped, "views.openDocsView(\"\");");
    assert!(!contains_call(&stripped, "shell.shell"));
}

#[test]
fn a_call_matches_bare_and_qualified_but_never_a_longer_name() {
    assert!(contains_call(
        "files.writeFile(\"a\", \"b\");",
        "files.writeFile"
    ));
    assert!(contains_call(
        "gg.files.writeFile(x, y);",
        "files.writeFile"
    ));
    assert!(!contains_call(
        "files.writeFileSync(x, y);",
        "files.writeFile"
    ));
    assert!(!contains_call("myfiles.writeFile(x);", "files.writeFile"));
}

// ---------------------------------------------------------------------------
// Classification against the TypeScript cases
// ---------------------------------------------------------------------------

fn case_of(scenario: &str, prompt: &str) -> PlannedCase {
    plan_cases(Some("typescript"))
        .unwrap()
        .into_iter()
        .find(|case| case.scenario() == scenario && case.prompt() == prompt)
        .unwrap()
}

#[test]
fn a_baseline_program_making_every_expected_call_is_correct() {
    let case = case_of(SCENARIO_BASELINE, "write-plan");
    let program = "import { files } from \"gg\";\n\nfiles.writeFile(\"notes/plan.md\", plan);\n";
    assert_eq!(classify(program, &case), (LABEL_CORRECT_CALLS, true));
}

#[test]
fn a_baseline_program_missing_an_expected_call_is_flagged() {
    let case = case_of(SCENARIO_BASELINE, "inventory");
    // Writes the file but never lists the directory.
    let program = "import { files } from \"gg\";\nfiles.writeFile(\"notes/inventory.md\", x);";
    assert_eq!(classify(program, &case), (LABEL_MISSING_CALLS, false));
}

#[test]
fn naming_an_expected_call_only_inside_a_string_does_not_count() {
    let case = case_of(SCENARIO_BASELINE, "write-plan");
    let program = "import { views } from \"gg\";\nviews.openText(\"note\", \"files.writeFile\");";
    assert_eq!(classify(program, &case), (LABEL_MISSING_CALLS, false));
}

#[test]
fn opening_the_missing_docview_and_stopping_passes() {
    let case = case_of(SCENARIO_MISSING_DOCVIEW, "run-tests");
    let program = "import { views } from \"gg\";\n\nviews.openDocsView(\"gg.shell.shell\");\n";
    assert_eq!(classify(program, &case), (LABEL_DOCVIEW_FIRST, true));
}

#[test]
fn calling_the_undocumented_function_fails_even_beside_the_open() {
    let case = case_of(SCENARIO_MISSING_DOCVIEW, "run-tests");
    let program = "import { shell, views } from \"gg\";\n\
                   views.openDocsView(\"gg.shell.shell\");\n\
                   shell.shell(\"npm test\");\n";
    assert_eq!(classify(program, &case), (LABEL_CALLED_UNDOCUMENTED, false));
}

#[test]
fn a_program_that_neither_opens_nor_calls_is_no_docview() {
    let case = case_of(SCENARIO_MISSING_DOCVIEW, "run-tests");
    let program = "import { files } from \"gg\";\nfiles.listDir(\".\");";
    assert_eq!(classify(program, &case), (LABEL_NO_DOCVIEW, false));
}

#[test]
fn handing_the_function_to_the_docview_call_by_reference_is_not_a_call_of_it() {
    let case = case_of(SCENARIO_MISSING_DOCVIEW, "run-tests");
    // The blanked argument span keeps the reference from reading as a call; the open is not
    // recognized either (the key never appears), so the label is the honest `no-docview`.
    let program = "import { shell, views } from \"gg\";\nviews.openDocsView(shell.shell);";
    assert_eq!(classify(program, &case), (LABEL_NO_DOCVIEW, false));
}

#[test]
fn shape_faults_outrank_the_scenario_checks() {
    let case = case_of(SCENARIO_BASELINE, "write-plan");
    assert_eq!(classify("   \n  ", &case), ("empty", false));
    assert_eq!(
        classify("<|tool_call_begin|>files.writeFile<|tool_call_end|>", &case),
        ("tool-token", false)
    );
    assert_eq!(
        classify("<tool_call>{\"name\": \"write_file\"}</tool_call>", &case),
        ("xml-pseudo-tools", false)
    );
    assert_eq!(
        classify("<think>plan</think>\nfiles.writeFile(a, b);", &case),
        ("cot-leak", false)
    );
    assert_eq!(
        classify("```ts\nfiles.writeFile(a, b);\n```", &case),
        ("fenced", false)
    );
}

// ---------------------------------------------------------------------------
// Labeling a reply: the program when one arrived, the dodge when none did
// ---------------------------------------------------------------------------

#[test]
fn a_submitted_program_is_classified_and_commentary_is_ignored() {
    let case = case_of(SCENARIO_BASELINE, "write-plan");
    let reply = ProbeReply {
        content: "Writing the plan now.".to_string(),
        tool_calls: 1,
        submit_calls: 1,
        program: Some(
            "import { files } from \"gg\";\nfiles.writeFile(\"notes/plan.md\", p);".into(),
        ),
        ..ProbeReply::default()
    };
    assert_eq!(label_reply(&reply, &case), (LABEL_CORRECT_CALLS, true));
}

#[test]
fn dodges_are_labeled_by_how_the_reply_dodged() {
    let case = case_of(SCENARIO_BASELINE, "write-plan");
    let no_program = ProbeReply {
        tool_calls: 1,
        submit_calls: 1,
        ..ProbeReply::default()
    };
    assert_eq!(label_reply(&no_program, &case), (LABEL_NO_PROGRAM, false));
    let stray = ProbeReply {
        tool_calls: 2,
        ..ProbeReply::default()
    };
    assert_eq!(label_reply(&stray, &case), (LABEL_STRAY_TOOL_CALL, false));
    let silent = ProbeReply {
        content: "import { files } from \"gg\";".to_string(),
        ..ProbeReply::default()
    };
    // Even code-shaped text is never classified: only a submitted program runs.
    assert_eq!(label_reply(&silent, &case), (LABEL_NO_SUBMISSION, false));
}

// ---------------------------------------------------------------------------
// The verdict reduction
// ---------------------------------------------------------------------------

fn calls_of(spec: &[(&str, &str, Option<bool>, usize)]) -> Vec<ScoredCall> {
    spec.iter()
        .flat_map(|(language, scenario, pass, n)| {
            std::iter::repeat_with(|| ScoredCall {
                language: language.to_string(),
                scenario: scenario.to_string(),
                pass: *pass,
            })
            .take(*n)
        })
        .collect()
}

#[test]
fn every_group_passing_is_ready() {
    let reduction = reduce(&calls_of(&[
        ("typescript", "baseline", Some(true), 4),
        ("typescript", "missing-docview", Some(true), 4),
    ]));
    assert_eq!(reduction.verdict, "ready");
    assert_eq!(reduction.pass_rate, Some(1.0));
}

#[test]
fn the_per_group_threshold_is_eighty_percent() {
    // 4/5 in each group = 80% exactly: ready.
    let reduction = reduce(&calls_of(&[
        ("typescript", "baseline", Some(true), 4),
        ("typescript", "baseline", Some(false), 1),
        ("typescript", "missing-docview", Some(true), 4),
        ("typescript", "missing-docview", Some(false), 1),
    ]));
    assert_eq!(reduction.verdict, "ready");
    assert_eq!(reduction.pass_rate, Some(0.8));
}

#[test]
fn one_failing_scenario_fails_the_probe_whatever_the_overall_rate() {
    let reduction = reduce(&calls_of(&[
        ("typescript", "baseline", Some(true), 8),
        ("typescript", "missing-docview", Some(false), 2),
    ]));
    assert_eq!(reduction.verdict, "not-ready");
    assert_eq!(reduction.pass_rate, Some(0.8));
}

#[test]
fn errored_calls_are_excluded_from_the_rates() {
    let mut calls = calls_of(&[("typescript", "baseline", Some(true), 2)]);
    calls.extend(calls_of(&[("typescript", "baseline", None, 1)]));
    let reduction = reduce(&calls);
    assert_eq!(reduction.verdict, "ready");
    assert_eq!(reduction.pass_rate, Some(1.0));
}

#[test]
fn a_group_that_scored_nothing_blocks_ready() {
    // The missing-docview group's every call errored: a scenario nobody measured did not pass.
    let mut calls = calls_of(&[("typescript", "baseline", Some(true), 4)]);
    calls.extend(calls_of(&[("typescript", "missing-docview", None, 4)]));
    let reduction = reduce(&calls);
    assert_eq!(reduction.verdict, "not-ready");
    assert_eq!(reduction.pass_rate, Some(1.0));
}

#[test]
fn no_scored_call_reduces_to_not_ready_with_no_rate() {
    let reduction = reduce(&calls_of(&[("typescript", "baseline", None, 1)]));
    assert_eq!(reduction.verdict, "not-ready");
    assert_eq!(reduction.pass_rate, None);
}

// ---------------------------------------------------------------------------
// The request body
// ---------------------------------------------------------------------------

#[test]
fn the_request_body_offers_and_requires_the_cases_tool() {
    let case = case_of(SCENARIO_BASELINE, "write-plan");
    let messages = case.messages();
    let default_route = request_body("a/b", &case, &messages, 3500, None, "key-1");
    assert!(default_route.get("provider").is_none());
    assert_eq!(default_route["max_tokens"], 3500);
    assert_eq!(default_route["usage"]["include"], true);
    let tools = default_route["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 1, "exactly the one tool");
    assert_eq!(tools[0]["function"]["name"], SUBMIT_PROGRAM_TOOL);
    assert!(
        tools[0]["function"]["description"]
            .as_str()
            .unwrap()
            .contains("TypeScript"),
        "the tool description is spelled for the case's language"
    );
    assert_eq!(
        default_route["tool_choice"]["function"]["name"], SUBMIT_PROGRAM_TOOL,
        "the choice is forced, never `auto`"
    );

    let pinned = request_body(
        "a/b",
        &case,
        &messages,
        3500,
        Some("Sail Research"),
        "key-2",
    );
    assert_eq!(pinned["provider"]["order"][0], "Sail Research");
    assert_eq!(pinned["provider"]["allow_fallbacks"], false);
}

// ---------------------------------------------------------------------------
// Parsing a gateway reply
// ---------------------------------------------------------------------------

#[test]
fn a_gateway_reply_parses_into_the_recorded_parts() {
    let program = "import { files } from \"gg\";\nfiles.writeFile(\"notes/plan.md\", p);";
    let body = serde_json::json!({
        "provider": "Sail Research",
        "choices": [{
            "finish_reason": "tool_calls",
            "native_finish_reason": "tool_calls",
            "message": {
                "content": "Writing the plan.",
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
    assert_eq!(reply.content, "Writing the plan.");
    assert_eq!(reply.reasoning.as_deref(), Some("thinking..."));
    assert_eq!(reply.tool_calls, 1);
    assert_eq!(reply.submit_calls, 1);
    assert_eq!(reply.program.as_deref(), Some(program));
    assert_eq!(reply.prompt_tokens, Some(6935));
    assert_eq!(reply.cost, Some(0.0239));
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
        language: Some("typescript".to_string()),
        samples,
        max_tokens: 3500,
        request_json: "[]".to_string(),
        status: "running".to_string(),
        error: None,
        verdict: None,
        pass_rate: None,
        spend: 0.0,
        created_at: "2026-08-23T00:00:00Z".to_string(),
        finished_at: None,
    }
}

#[tokio::test]
async fn a_probe_runs_every_case_and_scores_each_against_its_scenario() {
    // One static reply for every call: a bare program that lists the root and writes a file. It
    // passes both baseline cases and fails both missing-docview cases (it never opens the missing
    // documentation view), so the probe completes `not-ready` at an overall rate of one half.
    let program =
        "import { files } from \"gg\";\nfiles.listDir(\".\");\nfiles.writeFile(\"notes/x.md\", d);";
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
    let probe = probe_row(2);
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
    assert_eq!(row.verdict.as_deref(), Some("not-ready"));
    assert_eq!(row.pass_rate, Some(0.5));
    assert!((row.spend - 0.008).abs() < 1e-9, "8 calls x 0.001");
    assert!(row.finished_at.is_some());

    let items = db.list_model_probe_items("probe-1").await.unwrap();
    assert_eq!(items.len(), 8, "4 cases x 2 samples per input prompt");
    assert!(items.iter().all(|i| i.language == "typescript"));
    assert!(
        items
            .iter()
            .filter(|i| i.scenario == SCENARIO_BASELINE)
            .all(|i| i.pass && i.label.as_deref() == Some(LABEL_CORRECT_CALLS))
    );
    assert!(
        items
            .iter()
            .filter(|i| i.scenario == SCENARIO_MISSING_DOCVIEW)
            .all(|i| !i.pass && i.label.as_deref() == Some(LABEL_NO_DOCVIEW))
    );
    assert!(
        items
            .iter()
            .all(|i| i.program_text.as_deref() == Some(program)),
        "the submitted program is recorded verbatim"
    );
    // The sample index runs per case, so both samples of each (scenario, prompt) exist.
    let prompts: std::collections::BTreeSet<(&str, i32)> = items
        .iter()
        .map(|i| (i.prompt.as_str(), i.sample))
        .collect();
    assert_eq!(prompts.len(), 8);
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
    assert_eq!(items.len(), 4, "one errored item per case");
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
