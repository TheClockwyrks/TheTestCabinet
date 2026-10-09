use super::*;

// The body serializes to the bytes the client sent when it built it as a JSON map:
// the keys in order, an absent field left out.
#[test]
fn the_body_serializes_in_key_order() {
    let body = ingest_body(&["carom@v1.0.0".to_owned()], true, IngestMode::Changed);
    assert_eq!(
        serde_json::to_string(&body).expect("the body serializes"),
        r#"{"force":true,"mode":"changed","testCases":["carom@v1.0.0"]}"#
    );
    assert_eq!(
        serde_json::to_string(&ingest_body(&[], false, IngestMode::Absent))
            .expect("the body serializes"),
        r#"{"force":false}"#
    );
}

// Every field may be omitted, and `mode` takes `changed` and nothing else.
#[test]
fn the_body_reads_what_the_server_accepts() {
    let body: IngestBody = serde_json::from_str("{}").expect("an empty body parses");
    assert_eq!(body, IngestBody::default());
    assert_eq!(IngestBodyMode::scan_mode(body.mode), IngestMode::Absent);
    let body: IngestBody =
        serde_json::from_str(r#"{"mode":"changed","catalogVersion":"abc"}"#).expect("parses");
    assert_eq!(IngestBodyMode::scan_mode(body.mode), IngestMode::Changed);
    assert_eq!(body.catalog_version.as_deref(), Some("abc"));
    assert!(serde_json::from_str::<IngestBody>(r#"{"mode":"sometimes"}"#).is_err());
}

// A feed line round-trips, and one without a reason or problem carries neither key.
#[test]
fn a_feed_line_round_trips() {
    let line = IngestProgress::Version {
        index: 1,
        total: 2,
        slug: "carom".to_owned(),
        version: "v1.0.0".to_owned(),
        ingested: true,
        rendered_references: 3,
        reason: None,
        problem: None,
    };
    let text = serde_json::to_string(&line).expect("the line serializes");
    assert_eq!(
        text,
        r#"{"event":"version","index":1,"total":2,"slug":"carom","version":"v1.0.0","ingested":true,"renderedReferences":3}"#
    );
    assert_eq!(parse_ingest_line(&text), Some(line));
    let done = IngestProgress::Done {
        total: 2,
        ingested: 1,
        skipped: 1,
        refused_prunes: Vec::new(),
    };
    assert_eq!(
        serde_json::to_string(&done).expect("the line serializes"),
        r#"{"event":"done","total":2,"ingested":1,"skipped":1}"#
    );
    assert_eq!(
        parse_ingest_line(r#"{"event":"done","total":2,"ingested":1,"skipped":1}"#),
        Some(done),
        "a backend that refused nothing omits the list, and a summary without it reads"
    );
}

// A refused prune rides the closing line under `refusedPrunes`.
#[test]
fn a_refused_prune_rides_the_closing_line() {
    let done = IngestProgress::Done {
        total: 0,
        ingested: 0,
        skipped: 0,
        refused_prunes: vec!["kept 3 stored authored version(s)".to_owned()],
    };
    let text = serde_json::to_string(&done).expect("the line serializes");
    assert_eq!(
        text,
        r#"{"event":"done","total":0,"ingested":0,"skipped":0,"refusedPrunes":["kept 3 stored authored version(s)"]}"#
    );
    assert_eq!(parse_ingest_line(&text), Some(done));
}

// The default report's keys and the omission of an absent reason or problem.
#[test]
fn the_report_serializes_in_its_wire_shape() {
    let report = IngestResponse {
        test_case_versions: vec![IngestResponseVersion {
            slug: "carom".to_owned(),
            version: "v1.0.0".to_owned(),
            ingested: false,
            rendered_references: 0,
            reason: Some("unchanged".to_owned()),
            problem: None,
        }],
        test_suites: vec![IngestResponseSuite {
            slug: "pinball".to_owned(),
            version: "v1.0.0".to_owned(),
            ingested: true,
            reason: None,
            problem: None,
        }],
        refused_prunes: Vec::new(),
    };
    assert_eq!(
        serde_json::to_string(&report).expect("the report serializes"),
        r#"{"testCaseVersions":[{"slug":"carom","version":"v1.0.0","ingested":false,"renderedReferences":0,"reason":"unchanged"}],"testSuites":[{"slug":"pinball","version":"v1.0.0","ingested":true}]}"#
    );
}

// A refused prune rides the default report under `refusedPrunes`.
#[test]
fn a_refused_prune_rides_the_report() {
    let report = IngestResponse {
        refused_prunes: vec!["kept the 2 stored test-case group(s)".to_owned()],
        ..IngestResponse::default()
    };
    let text = serde_json::to_string(&report).expect("the report serializes");
    assert_eq!(
        text,
        r#"{"testCaseVersions":[],"testSuites":[],"refusedPrunes":["kept the 2 stored test-case group(s)"]}"#
    );
    assert_eq!(
        serde_json::from_str::<IngestResponse>(&text).expect("the report reads"),
        report
    );
}
