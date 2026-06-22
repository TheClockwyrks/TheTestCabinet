//! Tests proving the run record serializes to the camelCase JSON contract.

use serde_json::{Value, json};

use super::*;
use crate::metrics::{Cost, RunMetrics, TokenCounts};
use crate::test_case::MediaKind;
use crate::validation::{CheckResult, ProofResult, StepResult, ValidationSummary};

fn sample_record() -> RunRecord {
    RunRecord {
        id: "run-123".to_string(),
        started_at: "2026-06-14T10:00:00Z".to_string(),
        finished_at: "2026-06-14T10:05:00Z".to_string(),
        subject: RunSubject {
            test_case_slug: "pong".to_string(),
            test_case_version: "v1.0.0".to_string(),
            test_type: crate::test_case::TestType::EndToEnd,
            variant: "base".to_string(),
            harness_slug: HarnessSlug::Claude,
            harness_version: Some("1.2.3".to_string()),
            orchestrator_slug: "one-shot".to_string(),
            model_id: "anthropic/claude-opus-4".to_string(),
        },
        tooling: RunTooling {
            test_cabinet_commit: Some("0d60bc1deadbeef".to_string()),
        },
        environment: RunEnvironment {
            os: "Debian GNU/Linux 12 (bookworm)".to_string(),
            container_image: "test-cabinet/claude:latest".to_string(),
            node_version: Some("v22.11.0".to_string()),
            auth_mode: crate::run_record::AuthMode::ApiKey,
        },
        metrics: RunMetrics {
            run_time_seconds: 300.0,
            tokens: TokenCounts {
                uncached_input: Some(1000),
                cached_input: Some(500),
                output: Some(200),
                reasoning: Some(50),
            },
            cost: Cost {
                comparable: 1.25,
                actual: 1.40,
            },
        },
        validation: ValidationSummary {
            loaded: true,
            detail: None,
            install: Some(StepResult {
                command: "npm ci".to_string(),
                succeeded: true,
                detail: None,
            }),
            build: Some(StepResult {
                command: "npm run build".to_string(),
                succeeded: true,
                detail: None,
            }),
            checks: vec![CheckResult {
                view: "title".to_string(),
                name: "Title".to_string(),
                reached: true,
                similarity: 0.92,
                detail: None,
            }],
            proofs: vec![ProofResult {
                id: "title-screen".to_string(),
                name: "Title screen".to_string(),
                kind: MediaKind::Image,
                dest: "proof/title-screen.png".to_string(),
                present: true,
                detail: None,
            }],
            asset: None,
            adversarial: None,
            performance: None,
        },
        links: RunLinks {
            source_repo: Some("https://example.com/repo".to_string()),
            playable_build: None,
        },
        status: RunStatus {
            state: RunState::Completed,
            detail: None,
        },
    }
}

#[test]
fn serializes_to_camel_case_contract() {
    let value: Value = serde_json::to_value(sample_record()).expect("serialize");

    let expected = json!({
        "id": "run-123",
        "startedAt": "2026-06-14T10:00:00Z",
        "finishedAt": "2026-06-14T10:05:00Z",
        "subject": {
            "testCaseSlug": "pong",
            "testCaseVersion": "v1.0.0",
            "testType": "end-to-end",
            "variant": "base",
            "harnessSlug": "claude",
            "harnessVersion": "1.2.3",
            "orchestratorSlug": "one-shot",
            "modelId": "anthropic/claude-opus-4"
        },
        "tooling": {
            "testCabinetCommit": "0d60bc1deadbeef"
        },
        "environment": {
            "os": "Debian GNU/Linux 12 (bookworm)",
            "containerImage": "test-cabinet/claude:latest",
            "nodeVersion": "v22.11.0",
            "authMode": "apiKey"
        },
        "metrics": {
            "runTimeSeconds": 300.0,
            "tokens": {
                "uncachedInput": 1000,
                "cachedInput": 500,
                "output": 200,
                "reasoning": 50
            },
            "cost": {
                "comparable": 1.25,
                "actual": 1.40
            }
        },
        "validation": {
            "loaded": true,
            "detail": null,
            "install": { "command": "npm ci", "succeeded": true, "detail": null },
            "build": { "command": "npm run build", "succeeded": true, "detail": null },
            "checks": [
                { "view": "title", "name": "Title", "reached": true, "similarity": 0.92, "detail": null }
            ],
            "proofs": [
                { "id": "title-screen", "name": "Title screen", "kind": "image", "dest": "proof/title-screen.png", "present": true, "detail": null }
            ]
        },
        "links": {
            "sourceRepo": "https://example.com/repo",
            "playableBuild": null
        },
        "status": {
            "state": "completed",
            "detail": null
        }
    });

    assert_eq!(value, expected);
}

#[test]
fn round_trips_through_json() {
    let record = sample_record();
    let json = serde_json::to_string(&record).expect("serialize");
    let parsed: RunRecord = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(record, parsed);
}

#[test]
fn orchestrator_slug_defaults_to_one_shot_for_older_records() {
    // A record written before orchestrator selection existed omits the field;
    // it must still deserialize, defaulting the slug to the original behaviour.
    let mut value = serde_json::to_value(sample_record()).expect("serialize");
    value["subject"]
        .as_object_mut()
        .unwrap()
        .remove("orchestratorSlug");

    let parsed: RunRecord = serde_json::from_value(value).expect("deserialize");
    assert_eq!(parsed.subject.orchestrator_slug, "one-shot");
}

#[test]
fn run_state_serializes_snake_case() {
    assert_eq!(
        serde_json::to_value(RunState::Unevaluable).unwrap(),
        json!("unevaluable")
    );
}
