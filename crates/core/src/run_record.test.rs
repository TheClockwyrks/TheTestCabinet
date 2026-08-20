//! Tests proving the run record serializes to the camelCase JSON contract.

use std::collections::BTreeMap;

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
            engine_slug: "simple-2d".to_string(),
            engine_version: Some("1.0.0".to_string()),
            model_id: "anthropic/claude-opus-4".to_string(),
            gg_capability_set: None,
            gg_summary: None,
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
        tool_calls: BTreeMap::new(),
        game_jam_prior_entries: Vec::new(),
        seed_commit: None,
        code_analysis: None,
        toolchain: None,
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
            "engineSlug": "simple-2d",
            "engineVersion": "1.0.0",
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
fn prior_game_jam_entries_carry_the_seeded_readme() {
    // The entries are inputs to the run, so the record has to carry the README
    // body it was actually shown — not just a pointer to the run it came from,
    // which the Inputs tab could not render inline (and which may never publish).
    let mut record = sample_record();
    record.game_jam_prior_entries = vec![PriorGameJamEntry {
        run_id: "run-older".to_string(),
        finished_at: "2026-01-01T00:00:00Z".to_string(),
        readme: "# Space Miner\n\nDig for ore.".to_string(),
    }];

    let value = serde_json::to_value(&record).expect("serialize");

    assert_eq!(
        value["gameJamPriorEntries"],
        json!([{
            "runId": "run-older",
            "finishedAt": "2026-01-01T00:00:00Z",
            "readme": "# Space Miner\n\nDig for ore."
        }])
    );
    let parsed: RunRecord = serde_json::from_value(value).expect("deserialize");
    assert_eq!(parsed, record);
}

#[test]
fn tool_calls_round_trip_and_default_empty_for_older_records() {
    // A populated tally serializes under `toolCalls` and round-trips.
    let mut record = sample_record();
    record.tool_calls = BTreeMap::from([("todowrite".to_string(), 53), ("read".to_string(), 12)]);
    let value = serde_json::to_value(&record).expect("serialize");
    assert_eq!(value["toolCalls"]["todowrite"], 53);
    let parsed: RunRecord = serde_json::from_value(value).expect("deserialize");
    assert_eq!(parsed.tool_calls, record.tool_calls);

    // An empty tally is omitted from the wire, and a record written before the
    // field existed still deserializes to an empty map.
    let empty = serde_json::to_value(sample_record()).expect("serialize");
    assert!(empty.get("toolCalls").is_none());
    let parsed: RunRecord = serde_json::from_value(empty).expect("deserialize");
    assert!(parsed.tool_calls.is_empty());
}

#[test]
fn seed_commit_round_trips_and_is_absent_for_older_records() {
    // A recorded seed commit serializes under `seedCommit` and round-trips verbatim —
    // it is a git hash, so any normalization would break the tree lookups that use it.
    let mut record = sample_record();
    record.seed_commit = Some("9f1c0a3b2d4e5f60718293a4b5c6d7e8f9012345".to_string());
    let value = serde_json::to_value(&record).expect("serialize");
    assert_eq!(
        value["seedCommit"],
        json!("9f1c0a3b2d4e5f60718293a4b5c6d7e8f9012345")
    );
    let parsed: RunRecord = serde_json::from_value(value).expect("deserialize");
    assert_eq!(parsed.seed_commit, record.seed_commit);

    // A run with no seed commit writes no key at all, so nothing downstream can
    // mistake an empty string for a real hash…
    let absent = serde_json::to_value(sample_record()).expect("serialize");
    assert!(absent.get("seedCommit").is_none());

    // …and a record written before the field existed — every record in the corpus
    // today — still deserializes, with the field absent rather than failing the parse.
    let parsed: RunRecord = serde_json::from_value(absent).expect("deserialize");
    assert!(parsed.seed_commit.is_none());
}

#[test]
fn code_analysis_is_absent_rather_than_empty_when_a_run_was_never_analysed() {
    // The distinction the `Option` exists for: "this run was never analysed" must not be
    // representable as "this run measured an empty tree", which would read as a model
    // that wrote nothing. So a run with no analysis writes no key at all…
    let absent = serde_json::to_value(sample_record()).expect("serialize");
    assert!(absent.get("codeAnalysis").is_none());

    // …and every record in the corpus today — all written before the field existed —
    // still deserializes, with the field absent rather than failing the parse.
    let parsed: RunRecord = serde_json::from_value(absent).expect("deserialize");
    assert!(parsed.code_analysis.is_none());
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
fn engine_slug_defaults_to_none_for_older_records() {
    // A record written before engine selection existed omits both fields. It must
    // still deserialize, and the default has to be the truth about such a run: it
    // was built against no runtime, which is exactly what `none` names.
    let mut value = serde_json::to_value(sample_record()).expect("serialize");
    let subject = value["subject"].as_object_mut().unwrap();
    subject.remove("engineSlug");
    subject.remove("engineVersion");

    let parsed: RunRecord = serde_json::from_value(value).expect("deserialize");
    assert_eq!(parsed.subject.engine_slug, crate::engine::NONE_SLUG);
    assert!(parsed.subject.engine_version.is_none());
}

#[test]
fn an_engine_selection_round_trips() {
    // Both halves of the selection survive a write/read cycle: the slug says which
    // engine, the version says which build of it, and a comparison between two runs
    // is only meaningful when both agree.
    let parsed: RunRecord =
        serde_json::from_value(serde_json::to_value(sample_record()).expect("serialize"))
            .expect("deserialize");

    assert_eq!(parsed.subject.engine_slug, "simple-2d");
    assert_eq!(parsed.subject.engine_version.as_deref(), Some("1.0.0"));
}

#[test]
fn an_engine_without_a_runtime_writes_no_version() {
    // `none` vendors no package, so there is no version to read at seed time. The
    // key is omitted rather than written as null: a null would read as "an engine
    // whose version could not be determined", which is a different claim.
    let mut record = sample_record();
    record.subject.engine_slug = crate::engine::NONE_SLUG.to_string();
    record.subject.engine_version = None;

    let value = serde_json::to_value(&record).expect("serialize");
    assert_eq!(value["subject"]["engineSlug"], json!("none"));
    assert!(value["subject"].get("engineVersion").is_none());
}

#[test]
fn run_state_serializes_snake_case() {
    assert_eq!(
        serde_json::to_value(RunState::Catastrophic).unwrap(),
        json!("catastrophic")
    );
    assert_eq!(
        serde_json::to_value(RunState::TimedOut).unwrap(),
        json!("timed_out")
    );
    assert_eq!(
        serde_json::to_value(RunState::HarnessError).unwrap(),
        json!("harness_error")
    );
    assert_eq!(serde_json::to_value(RunState::Hung).unwrap(), json!("hung"));
    assert_eq!(
        serde_json::to_value(RunState::Infrastructure).unwrap(),
        json!("infrastructure")
    );
    assert_eq!(
        serde_json::to_value(RunState::Canceled).unwrap(),
        json!("canceled")
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
fn gg_is_a_first_class_subject_excluded_from_the_cli_catalog() {
    // gg is a run subject with a stable wire slug and serde round-trip, exactly
    // like the CLI harnesses.
    assert_eq!(HarnessSlug::Gg.as_str(), "gg");
    assert_eq!(
        serde_json::to_value(HarnessSlug::Gg).unwrap(),
        json!("gg"),
        "gg serde form must match its wire slug",
    );
    let parsed: HarnessSlug = serde_json::from_value(json!("gg")).unwrap();
    assert_eq!(parsed, HarnessSlug::Gg);

    // But it is deliberately not part of the CLI-harness catalog.
    assert!(
        !HarnessSlug::ALL.contains(&HarnessSlug::Gg),
        "gg must not be in ALL (the third-party CLI catalog)",
    );

    // `from_wire` resolves every ALL slug and gg; ALL-only lookup would miss gg.
    for slug in HarnessSlug::ALL {
        assert_eq!(HarnessSlug::from_wire(slug.as_str()), Some(slug));
    }
    assert_eq!(HarnessSlug::from_wire("gg"), Some(HarnessSlug::Gg));
    assert_eq!(HarnessSlug::from_wire("nope"), None);
}

#[test]
fn gg_routes_through_openrouter_consistently() {
    // For Phase 0 gg reaches its model through OpenRouter, so its family and
    // routing must agree just as they do for the routed CLI harnesses — otherwise
    // the pricing canonicalizer and the family filter would disagree for gg.
    assert!(HarnessSlug::Gg.routes_through_openrouter());
    assert_eq!(HarnessSlug::Gg.family(), HarnessFamily::Openrouter);
    // gg's client addresses OpenRouter with the bare `provider/model` id, so it
    // never gains the CLI-only `openrouter/` launch prefix.
    assert!(!HarnessSlug::Gg.uses_provider());
}

#[test]
fn run_state_publishability() {
    assert!(RunState::Completed.is_publishable());
    assert!(RunState::Catastrophic.is_publishable());
    assert!(RunState::TimedOut.is_publishable());
    assert!(RunState::HarnessError.is_publishable());
    assert!(RunState::Hung.is_publishable());
    assert!(!RunState::Infrastructure.is_publishable());
    // An operator kill is a deliberate stop, not an outcome: nothing about the model
    // can be concluded from it, so it is never publishable.
    assert!(!RunState::Canceled.is_publishable());

    assert!(!RunState::Completed.is_publishable_failure());
    assert!(RunState::Catastrophic.is_publishable_failure());
    assert!(RunState::TimedOut.is_publishable_failure());
    assert!(RunState::HarnessError.is_publishable_failure());
    // A hang is real, reportable model signal just like a harness error.
    assert!(RunState::Hung.is_publishable_failure());
    assert!(!RunState::Infrastructure.is_publishable_failure());
    assert!(!RunState::Canceled.is_publishable_failure());
}

#[test]
fn only_a_loadable_build_is_playable() {
    // The distinction the Play tab hangs off: a completed run built, loaded, and
    // served — however badly it validated — so it has a build to host. A catastrophic
    // run never loaded one, and a timeout never got that far.
    assert!(RunState::Completed.has_playable_build());
    assert!(!RunState::Catastrophic.has_playable_build());
    assert!(!RunState::TimedOut.has_playable_build());
    assert!(!RunState::HarnessError.has_playable_build());
    assert!(!RunState::Hung.has_playable_build());
    assert!(!RunState::Infrastructure.has_playable_build());
    assert!(!RunState::Canceled.has_playable_build());

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
    assert_eq!(RunState::ALL.len(), 7);
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
    assert!(RunState::TimedOut.publishes_artifacts());
    // A harness error and a hang are recorded only as per-model statistics —
    // nothing is released — and infrastructure failures never publish at all.
    assert!(!RunState::HarnessError.publishes_artifacts());
    assert!(!RunState::Hung.publishes_artifacts());
    assert!(!RunState::Infrastructure.publishes_artifacts());
    // A killed run releases nothing either: it never reached an outcome.
    assert!(!RunState::Canceled.publishes_artifacts());
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
    // A harness killed by the idle watchdog neither finished nor failed: it is a
    // hang, distinct from both the non-zero exit above and the runtime cap.
    assert_eq!(
        RunState::classify_failure(&crate::Error::HarnessHung {
            slug: "opencode".to_string(),
            seconds: 1800,
        }),
        RunState::Hung
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
