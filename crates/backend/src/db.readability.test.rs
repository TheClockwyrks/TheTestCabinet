//! The record-readability marker: how a stored run whose record this build can no
//! longer decode leaves every listing, how it is reached and deleted afterwards,
//! and how it comes back. Plus the pin that ties [`RUN_RECORD_FORMAT`] to the shape
//! of the contract it is a generation of.

use super::tests::{lifted, links, record, unpublished_filter};
use super::*;

/// Replace a stored run's record blob with one that cannot parse as a `RunRecord`,
/// standing in for a row written under an older, incompatible contract. The blob is
/// written directly so the row keeps its `record_readable` marker until something
/// re-decides it, which is exactly the state a contract change leaves behind.
async fn corrupt(db: &Db, id: &str) {
    run::Entity::update_many()
        .col_expr(
            run::Column::RecordJson,
            Expr::value(format!(
                r#"{{"id":"{id}","schema":"from-before-a-contract-change"}}"#
            )),
        )
        .filter(run::Column::Id.eq(id))
        .exec(&db.conn())
        .await
        .unwrap();
}

/// Mark a stored run's readability decision stale, as a build that bumped
/// `RUN_RECORD_FORMAT` leaves every row it has not re-decided.
async fn stale(db: &Db, id: &str) {
    run::Entity::update_many()
        .col_expr(run::Column::RecordFormat, Expr::value(0))
        .filter(run::Column::Id.eq(id))
        .exec(&db.conn())
        .await
        .unwrap();
}

#[tokio::test]
async fn list_summaries_total_equals_the_rows_it_serves() {
    // The defect this marker exists to close: the COUNT counted a row the page
    // could not serve, so the console's pager offered a page holding nothing.
    let db = Db::connect_in_memory().await.unwrap();
    for id in ["a", "b", "c"] {
        db.push(&record(id), &links(), None, None).await.unwrap();
    }
    corrupt(&db, "b").await;
    db.revalidate_run_records().await.unwrap();
    stale(&db, "b").await;
    db.revalidate_run_records().await.unwrap();

    let filter = unpublished_filter();
    let (runs, total) = db
        .list_summaries(
            &filter,
            SummarySort::Date,
            SortDir::Desc,
            &CaseNames::default(),
            50,
            0,
        )
        .await
        .unwrap();
    assert_eq!(runs.len(), 2);
    assert_eq!(total, 2);

    // The page past the served rows is empty and reports the same total, so a pager
    // sized from it never offers that page in the first place.
    let (runs, total) = db
        .list_summaries(
            &filter,
            SummarySort::Date,
            SortDir::Desc,
            &CaseNames::default(),
            50,
            2,
        )
        .await
        .unwrap();
    assert!(runs.is_empty());
    assert_eq!(total, 2);
}

#[tokio::test]
async fn assembling_a_row_whose_record_stopped_parsing_marks_it_unreadable() {
    // The lazy repair path: a build that changed the record contract without
    // bumping `RUN_RECORD_FORMAT` still converges for every row a listing visits.
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("r1"), &links(), None, None).await.unwrap();
    corrupt(&db, "r1").await;
    let before = lifted(&db, "r1").await;
    assert!(before.record_readable);

    let (runs, _) = db.list_for_review(50, None).await.unwrap();
    assert!(runs.is_empty());

    let after = lifted(&db, "r1").await;
    assert!(!after.record_readable);
    assert_eq!(after.record_format, RUN_RECORD_FORMAT as i32);
    // The marker records a fact about the build, not a change to the run, so it does
    // not stamp the mutation timestamp the gg document index reconciles against.
    assert_eq!(after.updated_at, before.updated_at);
}

#[tokio::test]
async fn revalidate_run_records_re_decides_only_stale_rows() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("good"), &links(), None, None)
        .await
        .unwrap();
    db.push(&record("broken"), &links(), None, None)
        .await
        .unwrap();
    db.push(&record("current"), &links(), None, None)
        .await
        .unwrap();
    corrupt(&db, "broken").await;
    stale(&db, "good").await;
    stale(&db, "broken").await;

    // Exactly the two stale rows are re-decided, each onto the right marker.
    assert_eq!(db.revalidate_run_records().await.unwrap(), 2);
    assert!(lifted(&db, "good").await.record_readable);
    assert!(!lifted(&db, "broken").await.record_readable);
    assert!(lifted(&db, "current").await.record_readable);
    for id in ["good", "broken", "current"] {
        assert_eq!(
            lifted(&db, id).await.record_format,
            RUN_RECORD_FORMAT as i32
        );
    }

    // The steady state costs nothing: every row already carries this build's stamp.
    assert_eq!(db.revalidate_run_records().await.unwrap(), 0);
}

#[tokio::test]
async fn a_repushed_run_becomes_readable_again() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("r1"), &links(), None, None).await.unwrap();
    corrupt(&db, "r1").await;
    assert!(db.list_for_review(50, None).await.unwrap().0.is_empty());
    assert!(!lifted(&db, "r1").await.record_readable);

    // A re-push writes a record this build serialized, so the run returns to the
    // listings rather than needing an operator to clear the marker by hand.
    db.push(&record("r1"), &links(), None, None).await.unwrap();
    let row = lifted(&db, "r1").await;
    assert!(row.record_readable);
    assert_eq!(row.record_format, RUN_RECORD_FORMAT as i32);
    assert_eq!(db.list_for_review(50, None).await.unwrap().0.len(), 1);
}

#[tokio::test]
async fn a_cursor_listing_keeps_its_next_cursor_across_an_unreadable_row() {
    // The cursor path's own form of the defect: the `limit + 1` overfetch used to
    // lose a row in assembly, so the page came back short of `limit` and the walk
    // ended early, stranding every run behind the unreadable one.
    let db = Db::connect_in_memory().await.unwrap();
    for n in 0..4 {
        let mut r = record(&format!("r{n}"));
        r.finished_at = format!("2026-06-17T2{n}:30:00Z");
        db.push(&r, &links(), None, None).await.unwrap();
    }
    corrupt(&db, "r2").await;
    db.revalidate_run_records().await.unwrap();
    stale(&db, "r2").await;
    db.revalidate_run_records().await.unwrap();

    let mut seen: Vec<String> = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let (runs, next) = db.list_unpublished(1, cursor.as_deref()).await.unwrap();
        seen.extend(runs.iter().map(|run| run.record.id.clone()));
        match next {
            Some(next) => cursor = Some(next),
            None => break,
        }
    }
    seen.sort();
    assert_eq!(seen, ["r0", "r1", "r3"]);
}

#[tokio::test]
async fn list_unreadable_runs_reports_the_row_and_its_error() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("good"), &links(), None, None)
        .await
        .unwrap();
    db.push(&record("broken"), &links(), None, None)
        .await
        .unwrap();
    corrupt(&db, "broken").await;
    stale(&db, "broken").await;
    db.revalidate_run_records().await.unwrap();

    let (runs, total) = db.list_unreadable_runs(50, 0).await.unwrap();
    assert_eq!(total, 1);
    assert_eq!(runs.len(), 1);
    let row = &runs[0];
    assert_eq!(row.id, "broken");
    assert_eq!(row.test_case_slug, "pong");
    assert_eq!(row.test_case_version, "v1.0.0");
    assert_eq!(row.variant, "base");
    assert_eq!(row.harness_slug, "claude");
    assert_eq!(row.model_id, "claude-sonnet-4-5");
    assert_eq!(row.run_state, "completed");
    assert!(!row.published);
    assert_eq!(row.review_count, 0);
    // The error is what tells an operator why the run is here, so it has to be the
    // real decode failure rather than a placeholder.
    assert!(!row.error.is_empty());
    assert!(row.error.contains("missing field"), "{}", row.error);
}

#[tokio::test]
async fn delete_run_removes_a_run_whose_record_no_longer_deserializes() {
    // Deletion reads the row, not the record, so the one surface an unreadable run
    // is reachable from can also get rid of it.
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("r1"), &links(), None, None).await.unwrap();
    corrupt(&db, "r1").await;
    stale(&db, "r1").await;
    db.revalidate_run_records().await.unwrap();

    db.delete_run("r1").await.unwrap();
    assert!(db.get_run_row("r1").await.unwrap().is_none());
    assert_eq!(db.list_unreadable_runs(50, 0).await.unwrap().1, 0);
}

#[tokio::test]
async fn run_count_counts_only_readable_published_runs() {
    // The snapshot holds assembled runs, so its count has to agree with what
    // `all_published` can actually put in it.
    let db = Db::connect_in_memory().await.unwrap();
    for id in ["a", "b"] {
        db.push(&record(id), &links(), None, None).await.unwrap();
        db.add_review(
            id,
            &super::tests::review_by("u1", Rating::Great),
            None,
            None,
        )
        .await
        .unwrap();
        db.publish(id, "2026-06-18T00:00:00Z").await.unwrap();
    }
    corrupt(&db, "b").await;
    stale(&db, "b").await;
    db.revalidate_run_records().await.unwrap();

    assert_eq!(db.run_count().await.unwrap(), 1);
    assert_eq!(db.all_published().await.unwrap().len(), 1);
}

#[tokio::test]
async fn the_unreadable_listing_pages_and_counts_every_row_it_can_serve() {
    // The listing this page exists to serve is itself a listing, so it holds the
    // same invariant: `total` counts the rows the pages hold between them, and the
    // page past the last one is empty rather than absent from the count.
    let db = Db::connect_in_memory().await.unwrap();
    for n in 0..3 {
        let id = format!("r{n}");
        let mut r = record(&id);
        r.finished_at = format!("2026-06-17T2{n}:30:00Z");
        db.push(&r, &links(), None, None).await.unwrap();
        corrupt(&db, &id).await;
        stale(&db, &id).await;
    }
    db.revalidate_run_records().await.unwrap();

    let mut seen: Vec<String> = Vec::new();
    for offset in [0, 2] {
        let (runs, total) = db.list_unreadable_runs(2, offset).await.unwrap();
        assert_eq!(total, 3);
        seen.extend(runs.into_iter().map(|run| run.id));
    }
    seen.sort();
    assert_eq!(seen, ["r0", "r1", "r2"]);

    let (runs, total) = db.list_unreadable_runs(2, 3).await.unwrap();
    assert!(runs.is_empty());
    assert_eq!(total, 3);
}

#[tokio::test]
async fn a_published_run_this_build_cannot_read_is_deletable() {
    // The publication guard protects a run the snapshot and gallery carry. An
    // unreadable run is in neither, so the guard would only make it permanent.
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("r1"), &links(), None, None).await.unwrap();
    db.add_review(
        "r1",
        &super::tests::review_by("u1", Rating::Great),
        None,
        None,
    )
    .await
    .unwrap();
    db.publish("r1", "2026-06-18T00:00:00Z").await.unwrap();

    // While the record still reads, the run is public and the guard holds.
    let refused = db.delete_run("r1").await.unwrap_err();
    assert!(
        matches!(refused, crate::error::BackendError::Unprocessable(_)),
        "{refused:?}"
    );

    corrupt(&db, "r1").await;
    stale(&db, "r1").await;
    db.revalidate_run_records().await.unwrap();
    assert_eq!(db.all_published().await.unwrap().len(), 0);

    db.delete_run("r1").await.unwrap();
    assert!(db.get_run_row("r1").await.unwrap().is_none());
}

// ---------------------------------------------------------------------------
// The generation's pin to the contract
// ---------------------------------------------------------------------------

/// The generated JSON Schema of the run record contract, relative to this crate.
///
/// The schema is the contract's structural form: it is generated from the very
/// `RunRecord` this build deserializes stored records into, and CI regenerates and
/// diffs it, so a Rust change that has not reached it fails there rather than here.
const RECORD_SCHEMA: &str = "../../apps/docs/public/schema/core/run-record.schema.json";

/// The contract shape each [`RUN_RECORD_FORMAT`] generation was decided against, as
/// a digest of that schema with its prose removed.
///
/// This is what makes the generation a fact about the contract. A change to the
/// contract's shape moves the digest and fails the test below, which leaves two
/// ways forward: record the new digest under the current generation, asserting that
/// stored records still deserialize against it, or add a generation and raise
/// [`RUN_RECORD_FORMAT`] to it, which makes every stored row re-decide its
/// readability at the next boot.
/// Generation 1's digest last moved when `DebugScriptResult` gained
/// [`inconclusive`](tcab_core::validation::Inconclusive), which tells the
/// inconclusive outcomes apart instead of reporting them all as one boolean. The
/// generation did NOT rise with it, because a record stored before the change still
/// deserializes: `precondition_unmet` is still carried and still `#[serde(default)]`,
/// and the new field is an `Option` that is `None` on exactly those older records.
const RECORD_SHAPES: &[(u32, &str)] = &[(
    1,
    "e78f2e3b68b2f1ae6a78b421f36a8c4c34adf1580a25f8afa7058749b57b64b2",
)];

/// Render `value` canonically with its prose removed: object keys in sorted order,
/// and every schema `description` dropped, so a rustdoc edit leaves the digest
/// alone while a field, a type or a requirement never can.
///
/// A `description` whose value is an object is a struct field of that name rather
/// than prose, and stays.
fn shape(value: &serde_json::Value, out: &mut String) {
    match value {
        serde_json::Value::Object(map) => {
            let mut keys: Vec<&String> = map
                .keys()
                .filter(|key| key.as_str() != "description" || !map[key.as_str()].is_string())
                .collect();
            keys.sort();
            out.push('{');
            for key in keys {
                out.push_str(key);
                out.push(':');
                shape(&map[key.as_str()], out);
                out.push(',');
            }
            out.push('}');
        }
        serde_json::Value::Array(items) => {
            out.push('[');
            for item in items {
                shape(item, out);
                out.push(',');
            }
            out.push(']');
        }
        other => out.push_str(&other.to_string()),
    }
}

/// The digest of the committed schema's shape.
fn record_shape_digest() -> String {
    use sha2::{Digest, Sha256};

    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(RECORD_SCHEMA);
    let schema = std::fs::read_to_string(&path)
        .unwrap_or_else(|err| panic!("reading {}: {err}", path.display()));
    let schema: serde_json::Value = serde_json::from_str(&schema).expect("the schema is JSON");
    let mut canonical = String::new();
    shape(&schema, &mut canonical);
    hex::encode(Sha256::digest(canonical.as_bytes()))
}

#[test]
fn the_record_format_generation_is_pinned_to_the_contract_shape() {
    let expected = RECORD_SHAPES
        .iter()
        .find(|(generation, _)| *generation == RUN_RECORD_FORMAT)
        .map(|(_, digest)| *digest)
        .unwrap_or_else(|| {
            panic!("RUN_RECORD_FORMAT is {RUN_RECORD_FORMAT}, which RECORD_SHAPES has no entry for")
        });
    assert_eq!(
        record_shape_digest(),
        expected,
        "the run record contract's shape has changed; the digest it now has is the `left` \
         value below.\n\
         If a record stored by an earlier build still deserializes against the new contract, \
         record that digest under generation {RUN_RECORD_FORMAT} in RECORD_SHAPES.\n\
         If it can stop deserializing, add a generation carrying that digest and raise \
         RUN_RECORD_FORMAT to it, so every stored row re-decides its readability at the next boot."
    );
}
