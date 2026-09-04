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
fn list_params_bind_the_gg_configuration_filter_from_its_wire_name() {
    // The struct carries no `rename_all`, so each camelCase param needs its own rename.
    // Without one the filter binds nothing and a coverage cell's link quietly widens to
    // every run of the model.
    let uri: axum::http::Uri = "/runs?fields=summary&offset=0&ggConfigId=cfg-a"
        .parse()
        .unwrap();
    let Query(params) = Query::<ListParams>::try_from_uri(&uri).unwrap();
    assert_eq!(params.gg_config_id.as_deref(), Some("cfg-a"));
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
use test_cabinet_core::review::VerdictStatus;
use test_cabinet_core::test_case::SubReviewItem;

/// The run's effective checklist for the gate tests: `serve` graded as a whole
/// and a `combat` category with two sub-points (`hit`, `block`), so both plain
/// and composite verdict ids are declared.
fn declared_items() -> Vec<test_cabinet_core::ReviewItem> {
    let item = |id: &str, sub_items: Vec<SubReviewItem>| test_cabinet_core::ReviewItem {
        id: id.to_string(),
        title: id.to_string(),
        text: format!("The build satisfies {id}."),
        reference: None,
        proof: None,
        sequences: vec![],
        frames: vec![],
        weight: 1,
        graded: false,
        domain: None,
        sub_items,
        scored: true,
        validation: None,
        failure_cap: None,
        domains: vec![],
    };
    let sub = |id: &str| SubReviewItem {
        id: id.to_string(),
        title: id.to_string(),
        description: None,
        weight: 1,
        reference: None,
        proof: None,
        scored: true,
        validation: None,
        failure_cap: None,
        domains: vec![],
    };
    vec![
        item("serve", vec![]),
        item("combat", vec![sub("hit"), sub("block")]),
    ]
}

fn request(aesthetic: Option<AestheticRating>) -> ReviewRequest {
    ReviewRequest {
        ratings: vec![],
        aesthetic,
        writeup: "Looks fine.".to_string(),
        checklist: vec![],
        edit_note: None,
    }
}

fn verdict(id: &str, status: VerdictStatus) -> ReviewVerdict {
    ReviewVerdict {
        id: id.to_string(),
        status,
        note: None,
    }
}

#[test]
fn a_validator_rated_review_requires_the_run_wide_aesthetic_and_no_ratings() {
    let items = declared_items();

    // Complete: one run-wide aesthetic tier, nothing else.
    validate_validator_rated_review(&request(Some(AestheticRating::Good)), &items)
        .expect("a run-wide aesthetic review is accepted");

    // No aesthetic tier at all is refused.
    let err = validate_validator_rated_review(&request(None), &items).unwrap_err();
    assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(err.message.contains("aesthetic"), "{}", err.message);

    // A functional rating is not the reviewer's to give.
    let mut with_rating = request(Some(AestheticRating::Good));
    with_rating.ratings.push(DomainRating {
        domain: "single-player".to_string(),
        rating: Rating::Great,
    });
    let err = validate_validator_rated_review(&with_rating, &items).unwrap_err();
    assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(err.message.contains("functional"), "{}", err.message);
}

#[test]
fn a_validator_rated_review_accepts_a_partial_checklist_of_binary_overrides() {
    let items = declared_items();

    // A partial checklist of declared points — a plain id and a composite one,
    // with an optional note — is accepted; unlisted points keep the validators'
    // verdicts, so nothing demands completeness.
    let mut with_overrides = request(Some(AestheticRating::Good));
    with_overrides
        .checklist
        .push(verdict("serve", VerdictStatus::Fail));
    with_overrides.checklist.push(ReviewVerdict {
        id: "combat.hit".to_string(),
        status: VerdictStatus::Pass,
        note: Some("lands despite the broken probe".to_string()),
    });
    validate_validator_rated_review(&with_overrides, &items)
        .expect("a partial override checklist is accepted");

    // An id the version does not declare is refused by name.
    let mut unknown = request(Some(AestheticRating::Good));
    unknown
        .checklist
        .push(verdict("smash", VerdictStatus::Pass));
    let err = validate_validator_rated_review(&unknown, &items).unwrap_err();
    assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(err.message.contains("smash"), "{}", err.message);

    // A graded tier is refused: an override is binary.
    let mut graded = request(Some(AestheticRating::Good));
    graded
        .checklist
        .push(verdict("serve", VerdictStatus::Great));
    let err = validate_validator_rated_review(&graded, &items).unwrap_err();
    assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(err.message.contains("binary"), "{}", err.message);
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
fn a_validator_rated_run_detail_folds_a_reviews_overrides_into_its_figures() {
    // The same failing `hud` as above, but a reviewer waved it through: the
    // detail's rating and score are the review's effective figures, and the
    // run-wide aesthetic surfaces on both the run and its review.
    let mut run = detail_run(detail_record(&[("serve", true), ("hud", false)]), true);
    run.reviews.push(StoredReview {
        reviewer: Reviewer {
            user_id: "u1".to_string(),
            username: "ada".to_string(),
            display_name: "Ada L.".to_string(),
        },
        ratings: vec![],
        aesthetics: vec![],
        aesthetic: Some(AestheticRating::Amazing),
        writeup: "Fails only the probe.".to_string(),
        checklist: vec![verdict("hud", VerdictStatus::Pass)],
        reviewed_at: "2026-06-17T22:00:00Z".to_string(),
        edited_at: None,
        revisions: Vec::new(),
    });
    let out = stored_run_out(&run, Some(&detail_manifest()));
    assert_eq!(out.rating, Some(Rating::Flawless));
    let score = out.score.as_ref().expect("still scored");
    assert_eq!((score.earned, score.total, score.reviews), (2.0, 2, 1));
    assert_eq!(out.aesthetic, Some(AestheticRating::Amazing));
    let json = serde_json::to_value(&out).unwrap();
    assert_eq!(json["reviews"][0]["aesthetic"], "amazing");
    assert!(json["reviews"][0].get("aesthetics").is_none());
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

#[test]
fn an_unreadable_run_carries_its_lifted_identity_and_its_error_onto_the_wire() {
    // The row has no readable record, so everything a console shows has to come off
    // the lifted columns; the error is the field that tells an operator why the run
    // is on this listing at all.
    let run = crate::db::UnreadableRun {
        id: "r1".to_string(),
        started_at: "2026-06-17T20:40:00Z".to_string(),
        finished_at: "2026-06-17T21:30:00Z".to_string(),
        test_case_slug: "pong".to_string(),
        test_case_version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        engine_slug: Some("simple-2d".to_string()),
        harness_slug: "claude".to_string(),
        model_id: "claude-sonnet-4-5".to_string(),
        gg_preset: None,
        test_type: "end-to-end".to_string(),
        run_state: "completed".to_string(),
        published: false,
        review_count: 2,
        error: "missing field `interp`".to_string(),
    };

    let json = serde_json::to_value(unreadable_run_out(&run)).unwrap();
    assert_eq!(json["id"], "r1");
    assert_eq!(json["testCaseSlug"], "pong");
    assert_eq!(json["testCaseVersion"], "v1.0.0");
    assert_eq!(json["variant"], "base");
    assert_eq!(json["engineSlug"], "simple-2d");
    assert_eq!(json["harnessSlug"], "claude");
    assert_eq!(json["modelId"], "claude-sonnet-4-5");
    assert_eq!(json["ggPreset"], serde_json::Value::Null);
    assert_eq!(json["testType"], "end-to-end");
    // The run's terminal state travels as `state`, matching the summary card's key
    // rather than the column's name.
    assert_eq!(json["state"], "completed");
    assert_eq!(json["published"], false);
    assert_eq!(json["reviewCount"], 2);
    assert_eq!(json["error"], "missing field `interp`");
}
