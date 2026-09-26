use super::*;

use axum::http::StatusCode;

#[test]
fn an_unlimited_query_is_capped_at_the_row_ceiling() {
    // `GgQuery::limit` is optional so a caller *can* ask for the whole corpus, which
    // makes imposing the ceiling this side's job. An uncapped document query against
    // tens of thousands of runs would serialize the entire index into one response.
    let capped = capped(GgQuery::default());
    assert_eq!(capped.limit, Some(GG_QUERY_MAX_ROWS));
}

#[test]
fn a_limit_under_the_ceiling_is_left_alone_and_one_over_it_is_lowered() {
    // The clamp is a ceiling, not a rewrite: a modest limit — the common case, a
    // top-10 table — must survive untouched, or a dashboard's row counts would all
    // silently become 1000.
    assert_eq!(
        capped(GgQuery {
            limit: Some(10),
            ..GgQuery::default()
        })
        .limit,
        Some(10),
    );
    // Lowering an over-ambitious one is safe to do silently only because the
    // evaluator reports `truncated` whenever rows were cut, so the clamp shows up in
    // the response rather than only here.
    assert_eq!(
        capped(GgQuery {
            limit: Some(GG_QUERY_MAX_ROWS * 10),
            ..GgQuery::default()
        })
        .limit,
        Some(GG_QUERY_MAX_ROWS),
    );
}

#[test]
fn a_batch_at_the_cap_is_accepted_and_one_over_it_is_rejected() {
    // A hard rejection rather than a silent truncation: a dropped panel renders as an
    // empty chart, which reads as "no data" rather than as "you asked for too much".
    assert!(ensure_batch_fits(0).is_ok());
    assert!(ensure_batch_fits(GG_QUERY_MAX_BATCH).is_ok());

    let err = ensure_batch_fits(GG_QUERY_MAX_BATCH + 1).unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
    // The message names both numbers, so the caller can see by how much it overshot.
    assert!(
        err.message.contains(&GG_QUERY_MAX_BATCH.to_string())
            && err.message.contains(&(GG_QUERY_MAX_BATCH + 1).to_string()),
        "unexpected message: {}",
        err.message,
    );
}

#[test]
fn the_batch_envelope_round_trips_through_its_wire_form() {
    // The envelope is what a dashboard sends, so its field names are contract. A
    // rename here would break every saved board with no compile error anywhere.
    let json = serde_json::json!({ "queries": [{}, { "limit": 5 }] });
    let batch: GgQueryBatch = serde_json::from_value(json).expect("the batch parses");
    assert_eq!(batch.queries.len(), 2);
    assert_eq!(batch.queries[1].limit, Some(5));

    // An omitted `queries` is an empty batch rather than a parse failure, which keeps
    // an empty dashboard from erroring.
    let empty: GgQueryBatch =
        serde_json::from_value(serde_json::json!({})).expect("an empty batch parses");
    assert!(empty.queries.is_empty());
}
