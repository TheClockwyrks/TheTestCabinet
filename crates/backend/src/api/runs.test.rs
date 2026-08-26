use super::*;

#[test]
fn parse_comma_list_splits_trims_and_drops_empties() {
    // The wire form (`versions`, `testCases`) is a comma-separated list;
    // whitespace around entries and stray separators are tolerated rather than
    // becoming phantom entries.
    assert_eq!(
        parse_comma_list(Some("v1.0.0,v1.1.0")),
        Some(vec!["v1.0.0".to_string(), "v1.1.0".to_string()])
    );
    assert_eq!(
        parse_comma_list(Some(" pong , meltdown ,")),
        Some(vec!["pong".to_string(), "meltdown".to_string()])
    );
}

#[test]
fn parse_comma_list_yields_none_for_absent_or_empty_input() {
    // No param, an empty string, and nothing-but-separators all mean "no filter",
    // so the store never sees an empty list it would have to special-case.
    assert_eq!(parse_comma_list(None), None);
    assert_eq!(parse_comma_list(Some("")), None);
    assert_eq!(parse_comma_list(Some(" , ,")), None);
}

// --- The validator-rated review gate ---------------------------------------------

use axum::http::StatusCode;
use test_cabinet_core::review::{AestheticRating, DomainAesthetic, VerdictStatus};
use test_cabinet_core::test_case::Domain;

fn effective_domains() -> Vec<Domain> {
    ["single-player", "versus"]
        .into_iter()
        .map(|id| Domain {
            id: id.to_string(),
            name: id.to_string(),
            description: String::new(),
        })
        .collect()
}

fn aesthetics(domains: &[&str]) -> Vec<DomainAesthetic> {
    domains
        .iter()
        .map(|domain| DomainAesthetic {
            domain: domain.to_string(),
            rating: AestheticRating::Good,
        })
        .collect()
}

fn request(aesthetics: Vec<DomainAesthetic>) -> ReviewRequest {
    ReviewRequest {
        ratings: vec![],
        aesthetics,
        writeup: "Looks fine.".to_string(),
        checklist: vec![],
        edit_note: None,
    }
}

#[test]
fn a_validator_rated_review_must_rate_every_domain_on_the_aesthetic_scale_and_nothing_else() {
    let domains = effective_domains();

    // Complete: one aesthetic per effective domain, nothing else.
    validate_validator_rated_review(&request(aesthetics(&["single-player", "versus"])), &domains)
        .expect("a complete aesthetic review is accepted");

    // A missing domain names itself.
    let err = validate_validator_rated_review(&request(aesthetics(&["single-player"])), &domains)
        .unwrap_err();
    assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(err.message.contains("versus"), "{}", err.message);

    // A domain the version does not declare is refused by name.
    let err = validate_validator_rated_review(
        &request(aesthetics(&["single-player", "versus", "co-op"])),
        &domains,
    )
    .unwrap_err();
    assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(err.message.contains("co-op"), "{}", err.message);

    // A functional rating is not the reviewer's to give.
    let mut with_rating = request(aesthetics(&["single-player", "versus"]));
    with_rating.ratings.push(DomainRating {
        domain: "single-player".to_string(),
        rating: Rating::Great,
    });
    let err = validate_validator_rated_review(&with_rating, &domains).unwrap_err();
    assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(err.message.contains("functional"), "{}", err.message);

    // Nor is the checklist: the validators decide it and there is no override.
    let mut with_verdict = request(aesthetics(&["single-player", "versus"]));
    with_verdict.checklist.push(ReviewVerdict {
        id: "serve".to_string(),
        status: VerdictStatus::Pass,
        note: None,
    });
    let err = validate_validator_rated_review(&with_verdict, &domains).unwrap_err();
    assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(err.message.contains("checklist"), "{}", err.message);
}

// --- The run detail's score and functional rating ---------------------------------

/// A minimal completed `pong@v1.0.0` record on the `base` variant, with one decided
/// validator verdict per `(point, pass)` pair.
fn detail_record(verdicts: &[(&str, bool)]) -> RunRecord {
    use test_cabinet_core::validation::{AutoVerdict, DebugScriptResult};
    let mut record: RunRecord = serde_json::from_value(serde_json::json!({
        "id": "r1",
        "startedAt": "2026-06-17T20:40:00Z",
        "finishedAt": "2026-06-17T21:30:00Z",
        "subject": {
            "testCaseSlug": "pong",
            "testCaseVersion": "v1.0.0",
            "testType": "end-to-end",
            "variant": "base",
            "harnessSlug": "claude",
            "orchestratorSlug": "one-shot",
            "engineSlug": "simple-2d",
            "modelId": "claude-sonnet-4-5"
        },
        "environment": {
            "os": "Debian",
            "containerImage": "test-cabinet/claude:abcd",
            "authMode": "apiKey"
        },
        "metrics": {
            "runTimeSeconds": 0,
            "tokens": { "uncachedInput": 0 },
            "cost": { "comparable": 0, "actual": 0 }
        },
        "tooling": { "testCabinetCommit": null },
        "validation": { "loaded": true, "detail": null, "checks": [] },
        "links": { "sourceRepo": null, "playableBuild": null },
        "status": { "state": "completed" }
    }))
    .expect("a minimal record deserializes");
    record.validation.debug_scripts = verdicts
        .iter()
        .map(|(point, pass)| DebugScriptResult {
            item_id: point.to_string(),
            sub_item_id: None,
            title: point.to_string(),
            category_title: point.to_string(),
            script: format!("gameplay/{point}"),
            gates: true,
            ran: true,
            precondition_unmet: false,
            detail: None,
            verdicts: vec![AutoVerdict {
                id: point.to_string(),
                pass: *pass,
                assertions: vec![],
            }],
            outputs: vec![],
        })
        .collect();
    record
}

/// A `pong@v1.0.0` manifest on the engine format whose `base` variant scores two
/// validated points, `serve` (cap `broken`, single-player) and `hud` (cap `great`,
/// both domains), over the domains `single-player` (common) and `versus` (the
/// variant's own).
fn detail_manifest() -> StoredManifest {
    let point = |id: &str, cap: &str, domains: &[&str]| {
        serde_json::json!({
            "id": id,
            "title": id,
            "text": format!("The build satisfies {id}."),
            "weight": 1,
            "validation": { "script": format!("gameplay/{id}"), "per_engine": true },
            "failure_cap": cap,
            "domains": domains
        })
    };
    let domain = |id: &str| serde_json::json!({ "id": id, "name": id, "description": id });
    serde_json::from_value(serde_json::json!({
        "engine_format": true,
        "slug": "pong",
        "version": "v1.0.0",
        "name": "Carom",
        "difficulty": "easy",
        "tags": [],
        "summary": null,
        "description": null,
        "changelog": "Introduced.",
        "max_runtime_seconds": 1800,
        "test_type": "end-to-end",
        "engines": ["simple-2d"],
        "prompt_template": "build it",
        "common_specs": [],
        "assets": [],
        "common_references": [],
        "checks": [],
        "variants": [{
            "slug": "base",
            "name": "Base",
            "description": null,
            "specs": [],
            "references": [],
            "domains": [domain("versus")]
        }],
        "common_review_items": [
            point("serve", "broken", &["single-player"]),
            point("hud", "great", &["single-player", "versus"]),
        ],
        "domains": [domain("single-player")]
    }))
    .expect("a minimal manifest deserializes")
}

fn detail_run(record: RunRecord, validator_rated: bool) -> StoredRun {
    StoredRun {
        record,
        reviews: vec![],
        rating: None,
        aesthetic: None,
        validator_rated,
        links: Default::default(),
        published: false,
        published_at: None,
        events_json: None,
    }
}

#[test]
fn a_validator_rated_run_detail_carries_its_score_and_rating_from_the_record_alone() {
    // `hud` (cap great) failed, `serve` passed: 1 / 2 points, rated Great — with
    // zero reviews, the moment the run completes.
    let run = detail_run(detail_record(&[("serve", true), ("hud", false)]), true);
    let out = stored_run_out(&run, Some(&detail_manifest()));
    assert!(out.validator_rated);
    assert_eq!(out.rating, Some(Rating::Great));
    let score = out
        .score
        .expect("a validator-rated run is scored on completion");
    assert_eq!((score.earned, score.total, score.reviews), (1.0, 2, 0));
    assert!(out.aesthetic.is_none());
}

#[test]
fn a_run_detail_without_its_case_version_has_no_score_and_keeps_the_lifted_rating() {
    let mut run = detail_run(detail_record(&[("serve", false)]), true);
    run.rating = Some(Rating::Broken);
    let out = stored_run_out(&run, None);
    assert_eq!(out.rating, Some(Rating::Broken));
    assert!(out.score.is_none());
}

#[test]
fn the_run_detail_always_emits_its_rating_aesthetic_and_score_keys() {
    // The console's `StoredRun` type declares the three as `| null`, never
    // optional, so an unset channel is serialized as `null` rather than omitted.
    let run = detail_run(detail_record(&[]), false);
    let json = serde_json::to_value(stored_run_out(&run, None)).unwrap();
    assert_eq!(json["rating"], serde_json::Value::Null);
    assert_eq!(json["aesthetic"], serde_json::Value::Null);
    assert_eq!(json["score"], serde_json::Value::Null);
    assert_eq!(json["validatorRated"], false);
}
