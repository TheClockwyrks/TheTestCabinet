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
                comparable: Some(1.25),
                actual: Some(1.40),
            },
        },
        validation: ValidationSummary {
            debug_scripts: Vec::new(),
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
            voxel: None,
            ui: None,
            material: None,
            particle: None,
            audio: None,
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
        game_jam_readme: None,
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
        serde_json::to_value(RunState::Catastrophic).unwrap(),
        json!("catastrophic")
    );
    assert_eq!(
        serde_json::to_value(RunState::ValidationError).unwrap(),
        json!("validation_error")
    );
    assert_eq!(
        serde_json::to_value(RunState::TimedOut).unwrap(),
        json!("timed_out")
    );
    assert_eq!(
        serde_json::to_value(RunState::HarnessError).unwrap(),
        json!("harness_error")
    );
    assert_eq!(
        serde_json::to_value(RunState::Infrastructure).unwrap(),
        json!("infrastructure")
    );
}

#[test]
fn family_openrouter_arm_matches_routing() {
    // The OpenRouter *family* must contain exactly the harnesses that route
    // through OpenRouter — the two are the same partition of the harness set, so
    // the run form's family filter and the pricing canonicalizer never disagree.
    for harness in HarnessSlug::ALL {
        assert_eq!(
            harness.family() == HarnessFamily::Openrouter,
            harness.routes_through_openrouter(),
            "family/routing mismatch for {harness:?}",
        );
    }
    // The three native harnesses map to their own distinct families.
    assert_eq!(HarnessSlug::Claude.family(), HarnessFamily::Claude);
    assert_eq!(HarnessSlug::Codex.family(), HarnessFamily::Codex);
    assert_eq!(
        HarnessSlug::Antigravity.family(),
        HarnessFamily::Antigravity
    );
}

#[test]
fn harness_family_wire_round_trips() {
    for family in HarnessFamily::ALL {
        assert_eq!(HarnessFamily::from_wire(family.as_str()), Some(family));
        // Serde and `as_str` agree on the wire form.
        assert_eq!(
            serde_json::to_value(family).unwrap(),
            Value::from(family.as_str()),
        );
    }
    assert_eq!(HarnessFamily::from_wire("nope"), None);
}

#[test]
fn run_state_publishability() {
    assert!(RunState::Completed.is_publishable());
    assert!(RunState::Catastrophic.is_publishable());
    assert!(RunState::ValidationError.is_publishable());
    assert!(RunState::TimedOut.is_publishable());
    assert!(RunState::HarnessError.is_publishable());
    assert!(!RunState::Infrastructure.is_publishable());

    assert!(!RunState::Completed.is_publishable_failure());
    assert!(RunState::Catastrophic.is_publishable_failure());
    assert!(RunState::ValidationError.is_publishable_failure());
    assert!(RunState::TimedOut.is_publishable_failure());
    assert!(RunState::HarnessError.is_publishable_failure());
    assert!(!RunState::Infrastructure.is_publishable_failure());
}

#[test]
fn only_a_loadable_build_is_playable() {
    // The distinction the Play tab hangs off: a validation error built, loaded, and
    // served — only its *validation* failed — so it still has a build to host. A
    // catastrophic run never loaded one, and a timeout never got that far.
    assert!(RunState::Completed.has_playable_build());
    assert!(RunState::ValidationError.has_playable_build());
    assert!(!RunState::Catastrophic.has_playable_build());
    assert!(!RunState::TimedOut.has_playable_build());
    assert!(!RunState::HarnessError.has_playable_build());
    assert!(!RunState::Infrastructure.has_playable_build());

    // A state that has a playable build must also release it at publish, or the
    // build would exist but never reach the gallery.
    for state in RunState::ALL {
        assert!(
            !state.has_playable_build() || state.publishes_artifacts(),
            "{state:?} has a playable build but does not publish artifacts",
        );
    }
}

#[test]
fn all_covers_every_state() {
    // `ALL` is what the backend derives its wire-string lists from, so a new state
    // missing from it would silently drop out of those queries.
    assert_eq!(RunState::ALL.len(), 6);
    for state in RunState::ALL {
        assert!(
            RunState::ALL.iter().filter(|s| **s == state).count() == 1,
            "{state:?} appears in ALL more than once",
        );
    }
}

#[test]
fn run_state_publishes_artifacts() {
    // The code-carrying states release their produced source (and a build when
    // one exists) at publish.
    assert!(RunState::Completed.publishes_artifacts());
    assert!(RunState::Catastrophic.publishes_artifacts());
    assert!(RunState::ValidationError.publishes_artifacts());
    assert!(RunState::TimedOut.publishes_artifacts());
    // A harness error is recorded only as a per-model statistic — nothing is
    // released — and infrastructure failures never publish at all.
    assert!(!RunState::HarnessError.publishes_artifacts());
    assert!(!RunState::Infrastructure.publishes_artifacts());
}

#[test]
fn classify_failure_only_runtime_cap_is_a_timeout() {
    assert_eq!(
        RunState::classify_failure(&crate::Error::RunTimedOut {
            slug: "claude".to_string(),
            seconds: 1800,
        }),
        RunState::TimedOut
    );
    // The harness (or its orchestrator runner) exiting non-zero is a harness
    // error — the model drove it to exit early — not an infrastructure fault.
    assert_eq!(
        RunState::classify_failure(&crate::Error::HarnessInvocation {
            slug: "claude".to_string(),
            detail: "harness exited with code 1".to_string(),
        }),
        RunState::HarnessError
    );
    // A harness install timeout is the Test Cabinet's plumbing, not the model.
    assert_eq!(
        RunState::classify_failure(&crate::Error::HarnessInstallTimedOut {
            slug: "claude".to_string(),
            seconds: 60,
        }),
        RunState::Infrastructure
    );
    assert_eq!(
        RunState::classify_failure(&crate::Error::ContainerRuntime("boom".to_string())),
        RunState::Infrastructure
    );
}
