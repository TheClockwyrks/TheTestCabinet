//! Tests proving the run record serializes to the camelCase JSON contract.

use serde_json::{Value, json};

use super::*;
use crate::metrics::{Cost, RunMetrics, TokenCounts};
use crate::validation::{CheckResult, ValidationSummary};

fn sample_record() -> RunRecord {
    RunRecord {
        id: "run-123".to_string(),
        started_at: "2026-06-14T10:00:00Z".to_string(),
        finished_at: "2026-06-14T10:05:00Z".to_string(),
        subject: RunSubject {
            test_case_slug: "pong".to_string(),
            test_case_version: "v1.0.0".to_string(),
            harness_slug: HarnessSlug::Claude,
            harness_version: Some("1.2.3".to_string()),
            model_id: "anthropic/claude-opus-4".to_string(),
        },
        environment: RunEnvironment {
            os: "Debian GNU/Linux 12 (bookworm)".to_string(),
            container_image: "test-cabinet/claude:latest".to_string(),
            node_version: Some("v22.11.0".to_string()),
        },
        metrics: RunMetrics {
            run_time_seconds: 300.0,
            tokens: TokenCounts {
                uncached_input: 1000,
                cached_input: 500,
                output: 200,
                reasoning: 50,
            },
            cost: Cost {
                comparable: 1.25,
                actual: 1.40,
            },
        },
        validation: ValidationSummary {
            loaded: true,
            detail: None,
            checks: vec![CheckResult {
                view: "title".to_string(),
                name: "Title".to_string(),
                reached: true,
                similarity: 0.92,
                detail: None,
            }],
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
            "harnessSlug": "claude",
            "harnessVersion": "1.2.3",
            "modelId": "anthropic/claude-opus-4"
        },
        "environment": {
            "os": "Debian GNU/Linux 12 (bookworm)",
            "containerImage": "test-cabinet/claude:latest",
            "nodeVersion": "v22.11.0"
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
            "checks": [
                { "view": "title", "name": "Title", "reached": true, "similarity": 0.92, "detail": null }
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
fn run_state_serializes_snake_case() {
    assert_eq!(
        serde_json::to_value(RunState::Unevaluable).unwrap(),
        json!("unevaluable")
    );
}
