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

/// The published schema root the generated contract schemas live under, relative to
/// this crate.
///
/// A schema is the contract's structural form: it is generated from the very types
/// this build deserializes stored records into, and CI regenerates and diffs it, so
/// a Rust change that has not reached it fails there rather than here.
const SCHEMA_ROOT: &str = "../../apps/docs/public/schema";

/// The run record's own schema, relative to [`SCHEMA_ROOT`]. The pin starts here and
/// follows every published schema it references.
const RECORD_SCHEMA: &str = "core/run-record.schema.json";

/// The base every cross-schema `$ref` in a published schema is written against. A
/// reference under it names a file under [`SCHEMA_ROOT`] by the same relative path.
const SCHEMA_BASE_URL: &str = "https://docs.testcabinet.ai/schema/";

/// The contract shape each [`RUN_RECORD_FORMAT`] generation was decided against, as
/// a digest of the record schema and every schema it references, with their prose
/// removed.
///
/// This is what makes the generation a fact about the contract. A change to the
/// contract's shape moves the digest and fails the test below, which leaves two
/// ways forward: record the new digest under the current generation, asserting that
/// stored records still deserialize against it, or add a generation and raise
/// [`RUN_RECORD_FORMAT`] to it, which makes every stored row re-decide its
/// readability at the next boot.
///
/// The referenced schemas are part of the shape because a stored record embeds what
/// they describe: a gg run's record carries its whole capability set, agent profiles
/// included, and a required field added there stops every gg record stored before it
/// from deserializing exactly as one added to `RunRecord` itself would.
///
/// Generation 3 is the toolchain summary's `ToolchainTests` gaining `tests` and
/// `testsTruncated` — the per-test entries beside the per-file rows. Neither is
/// optional or defaulted, so a record stored with a test report before this change
/// lacks both keys and no longer reads. Its digest last moved when the gg run
/// limits gained `maxModelRetries` and `modelRetryMaxDelaySecs`, the model-request
/// retry schedule: both are `Option`s that are absent on every record stored before
/// it and resolve to the defaults there, exactly as `modelCallTimeoutSecs` did, so
/// stored records go on reading and the generation does not move.
///
/// Generation 2 was the gg agent profile's `openingTurn` becoming required: every gg
/// record stored before it lacks the key and no longer reads. Its digest last moved
/// when the validation summary's `StepResult` gained `output` and `attempts` and the
/// toolchain's `ToolchainCommandResult` gained `attempts` (the verified, retried
/// dependency install), a change stored records survived because every new field is
/// an `Option` that is `None` on older records. Generation 1's digest last moved
/// when `DebugScriptResult` gained
/// [`inconclusive`](tcab_core::validation::Inconclusive), for the same reason.
const RECORD_SHAPES: &[(u32, &str)] = &[
    (
        1,
        "e78f2e3b68b2f1ae6a78b421f36a8c4c34adf1580a25f8afa7058749b57b64b2",
    ),
    (
        2,
        "9417274233742e26a223882d852690c729844f5c63cd05166f218176f648c879",
    ),
    (
        3,
        "4e75d98c2864d7d19341fbfe12c136b05616fb463268345d66a7a22b6c4b3f26",
    ),
];

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

/// Collect into `out` the relative path of every published schema `value` references
/// through a `$ref` under [`SCHEMA_BASE_URL`], fragment dropped. A `$ref` into the
/// schema's own definitions is not a file and is left alone.
fn referenced_schemas(value: &serde_json::Value, out: &mut std::collections::BTreeSet<String>) {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(serde_json::Value::String(target)) = map.get("$ref")
                && let Some(relative) = target.strip_prefix(SCHEMA_BASE_URL)
            {
                let file = relative.split('#').next().unwrap_or(relative);
                out.insert(file.to_string());
            }
            for nested in map.values() {
                referenced_schemas(nested, out);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                referenced_schemas(item, out);
            }
        }
        _ => {}
    }
}

/// The digest of the committed record schema's shape together with the shape of
/// every published schema it references, transitively.
///
/// Each schema is rendered canonically and keyed by its relative path, in path
/// order, so the digest depends on which schemas the record's tree spans and on
/// their shapes, and on nothing else.
fn record_shape_digest() -> String {
    use sha2::{Digest, Sha256};

    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(SCHEMA_ROOT);
    let mut pending = vec![RECORD_SCHEMA.to_string()];
    let mut shapes = std::collections::BTreeMap::new();
    while let Some(relative) = pending.pop() {
        if shapes.contains_key(&relative) {
            continue;
        }
        let path = root.join(&relative);
        let schema = std::fs::read_to_string(&path)
            .unwrap_or_else(|err| panic!("reading {}: {err}", path.display()));
        let schema: serde_json::Value = serde_json::from_str(&schema)
            .unwrap_or_else(|err| panic!("{relative} is not JSON: {err}"));
        let mut referenced = std::collections::BTreeSet::new();
        referenced_schemas(&schema, &mut referenced);
        pending.extend(referenced);
        let mut canonical = String::new();
        shape(&schema, &mut canonical);
        shapes.insert(relative, canonical);
    }

    let mut canonical = String::new();
    for (relative, rendered) in shapes {
        canonical.push_str(&relative);
        canonical.push('=');
        canonical.push_str(&rendered);
        canonical.push('\n');
    }
    hex::encode(Sha256::digest(canonical.as_bytes()))
}

#[test]
fn the_pin_spans_every_schema_the_record_references() {
    // The gap this closes: a required field added to a gg agent profile stopped every
    // stored gg record deserializing without moving the digest, because the profile
    // lives in the capability-set schema the record schema only references. The pin
    // has to see through that reference, and the others beside it.
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(SCHEMA_ROOT);
    let record: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(root.join(RECORD_SCHEMA)).expect("the record schema is committed"),
    )
    .expect("the record schema is JSON");
    let mut referenced = std::collections::BTreeSet::new();
    referenced_schemas(&record, &mut referenced);
    assert!(
        referenced.contains("gg/capability-set.schema.json"),
        "the record schema references the gg capability set; the pin follows that reference, \
         got {referenced:?}",
    );
    for relative in &referenced {
        assert!(
            root.join(relative).is_file(),
            "{relative} is referenced by the record schema but is not a published schema file",
        );
    }
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
