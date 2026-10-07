//! Tests for the `tcab analyze` report.
//!
//! The analyzer itself is tested in its own crate; what is tested here is the *report* — that
//! it is driven by the metric catalog rather than a hand-written list, that it names the
//! things a reader needs to act on, that it stays honest about what it could not measure, and
//! that it is a pure function of the document.

use std::fs;
use std::path::Path;

use test_cabinet_code_analysis::{AnalysisRequest, analyze};
use test_cabinet_core::CodeTreeBasis;

use super::*;

/// Lay a tree down on disk and analyse it, the way the command does.
fn analyse(
    files: &[(&str, &str)],
    seed_commit: Option<&str>,
) -> (tempfile::TempDir, CodeAnalysisDocument) {
    let root = tempfile::tempdir().expect("a temp dir");
    for (path, contents) in files {
        let full = root.path().join(path);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).expect("a parent directory");
        }
        fs::write(full, contents).expect("a written file");
    }
    let document = analyze(&AnalysisRequest {
        root: root.path(),
        seed_commit,
        tree_basis: CodeTreeBasis::PostValidation,
        // What the command itself passes: a checkout on disk carries no engine, so the
        // root-anchored floor is told nothing was seeded and removes nothing it is
        // unsure of.
        root_seeding: RootSeeding::default(),
    });
    (root, document)
}

/// A Rust tree with one deliberately gnarly function, so the complexity section has something
/// to name.
fn rust_tree() -> (tempfile::TempDir, CodeAnalysisDocument) {
    analyse(
        &[
            (
                "Cargo.toml",
                "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\n",
            ),
            (
                "src/lib.rs",
                r#"
pub fn tidy(value: u32) -> u32 {
    value + 1
}

pub fn gnarly(a: u32, b: u32, c: u32) -> u32 {
    let mut total = 0;
    if a > 1 { total += 1; }
    if a > 2 { total += 1; }
    if b > 1 { total += 1; }
    if b > 2 { total += 1; }
    if c > 1 { total += 1; }
    if c > 2 && a > 0 { total += 1; }
    for step in 0..a {
        if step % 2 == 0 { total += step; } else { total -= 1; }
    }
    while total > 100 { total -= 7; }
    match total {
        0 => total,
        1 => total + 1,
        _ => total,
    }
}
"#,
            ),
        ],
        None,
    )
}

fn report(document: &CodeAnalysisDocument) -> String {
    render_report("fixture", document, Duration::from_millis(120), 10, None)
}

#[test]
fn every_catalog_metric_that_resolves_is_rendered_as_a_labelled_row() {
    // The property the whole table rests on: rows come from `CODE_METRICS`, so a metric added
    // to the summary appears here with the right label, unit and approximate flag without
    // anyone editing this command. A hand-written list would silently omit it.
    let (_root, document) = rust_tree();
    let rendered = report(&document);
    let summary = serde_json::to_value(&document.summary).expect("a serialized summary");

    let mut checked = 0;
    for metric in CODE_METRICS {
        if lookup(&summary, metric.path).is_none() {
            continue;
        }
        assert!(
            rendered.contains(metric.label),
            "the report should carry a row for {} ({})",
            metric.path,
            metric.label,
        );
        checked += 1;
    }
    assert!(
        checked > 50,
        "a Rust tree should resolve most of the catalog, resolved {checked}",
    );
}

#[test]
fn a_language_the_tree_does_not_use_contributes_no_rows() {
    // The absent-block case: a pure-Rust tree has a null `typescript` summary, and printing
    // "TypeScript files: 0" for it would be noise dressed as a measurement.
    let (_root, document) = rust_tree();
    let rendered = report(&document);

    assert!(rendered.contains("rust discipline"), "{rendered}");
    assert!(
        !rendered.contains("typescript discipline"),
        "a pure-Rust tree should not render the TypeScript family:\n{rendered}",
    );
    assert!(!rendered.contains("null"), "{rendered}");
}

#[test]
fn the_worst_function_is_named_with_its_file_and_line() {
    // The reason the command exists rather than a summary dump: a mean tells you a tree is
    // fine, a named function tells you where to go.
    let (_root, document) = rust_tree();
    let rendered = report(&document);

    let section = rendered
        .split("most complex functions")
        .nth(1)
        .expect("a complexity section");
    let first_row = section.lines().nth(2).expect("a first data row");
    assert!(
        first_row.contains("gnarly"),
        "the most complex function should lead the section, got {first_row:?}",
    );
    assert!(
        first_row.contains("src/lib.rs:"),
        "each row should carry a path and line, got {first_row:?}",
    );
}

#[test]
fn an_import_cycle_is_listed_with_its_members() {
    let (_root, document) = analyse(
        &[
            (
                "src/a.ts",
                "import { b } from './b';\nexport const a = () => b();\n",
            ),
            (
                "src/b.ts",
                "import { a } from './a';\nexport const b = () => a();\n",
            ),
        ],
        None,
    );
    let rendered = report(&document);

    assert_eq!(document.summary.graph.cycles, 1, "the fixture should cycle");
    assert!(rendered.contains("import cycles (1)"), "{rendered}");
    assert!(
        rendered.contains("src/a.ts → src/b.ts") || rendered.contains("src/b.ts → src/a.ts"),
        "{rendered}"
    );
    // And the headline mentions it, because a cycle is a fact a reader wants before any
    // per-family figure.
    assert!(rendered.contains("1 cycle"), "{rendered}");
}

#[test]
fn a_seed_commit_that_does_not_resolve_is_called_out() {
    // The one degradation the caller can actually fix. It silently changes what "authored"
    // means, so it is stated rather than left to be inferred from the provenance line.
    let (_root, document) = analyse(&[("src/lib.rs", "pub fn f() {}\n")], Some("deadbeef"));
    let rendered = render_report(
        "fixture",
        &document,
        Duration::from_millis(5),
        10,
        Some("deadbeef"),
    );

    assert!(rendered.contains("caveats"), "{rendered}");
    assert!(
        rendered.contains("--seed-commit did not resolve"),
        "{rendered}"
    );
    // Without the flag the same document says nothing about it: an ordinary source tree is
    // authored by definition and does not deserve a warning.
    assert!(!report(&document).contains("--seed-commit did not resolve"));
}

#[test]
fn truncation_and_skipped_files_are_reported_as_caveats() {
    let (_root, mut document) = rust_tree();
    document.summary.notes.truncated = true;
    document.summary.notes.truncated_by = Some(CodeTruncationCap::ParseBytes);
    document.summary.notes.files_skipped = 3;
    document.summary.notes.bytes_skipped = 2_097_152;

    let rendered = report(&document);
    assert!(
        rendered.contains("truncated — the parse-byte budget"),
        "{rendered}"
    );
    assert!(
        rendered.contains("3 files skipped as binary, generated or unreadable (2.0 MiB)"),
        "{rendered}",
    );
}

#[test]
fn the_approximate_marker_is_explained_only_when_one_was_printed() {
    let (_root, document) = rust_tree();
    let rendered = report(&document);

    // The graph family is approximate in both languages, so a tree with modules always shows
    // the marker and always explains it. The two must appear together or the marker reads as
    // a typo.
    let marked = rendered.lines().any(|line| line.ends_with(" ~"));
    assert_eq!(
        marked,
        rendered.contains("~ approximate: dynamic imports"),
        "the marker and its explanation must appear together:\n{rendered}",
    );
    assert!(
        marked,
        "a tree with modules should carry approximate figures"
    );
}

#[test]
fn an_empty_directory_says_so_rather_than_printing_a_page_of_zeros() {
    let (_root, document) = analyse(&[], None);
    let rendered = report(&document);

    assert_eq!(document.summary.size.files, 0);
    assert!(rendered.contains("No files were analysed"), "{rendered}");
}

#[test]
fn the_report_is_a_pure_function_of_the_document() {
    // Two renders of one document must be byte-identical: the outlier sorts carry total
    // tie-breaks precisely so equal-complexity functions cannot swap places.
    let (_root, document) = rust_tree();
    assert_eq!(report(&document), report(&document));
}

#[test]
fn top_limits_every_specific_section() {
    let (_root, document) = rust_tree();
    let rendered = render_report("fixture", &document, Duration::from_millis(1), 1, None);

    let section = rendered
        .split("most complex functions")
        .nth(1)
        .expect("a complexity section")
        .split("\n\n")
        .next()
        .expect("the section body");
    // Data rows lead with a figure; the heading, the column header and the style resets do
    // not.
    let rows = section
        .lines()
        .filter(|line| line.trim_start().starts_with(|c: char| c.is_ascii_digit()))
        .count();
    assert_eq!(
        rows, 1,
        "--top 1 should leave one data row under the column header:\n{section}",
    );
}

#[test]
fn numbers_are_formatted_for_their_unit() {
    assert_eq!(number(66_258.0), "66,258");
    assert_eq!(number(2.4375), "2.4");
    assert_eq!(number(0.0), "0");
    assert_eq!(group(1_000), "1,000");
    assert_eq!(group(999), "999");
    assert_eq!(bytes(512), "512 B");
    assert_eq!(bytes(1_536), "1.5 KiB");

    let json = serde_json::json!({ "ratio": 0.615, "rate": 3.25, "flag": true, "size": 2048 });
    assert_eq!(
        format_value(&json["ratio"], CodeMetricUnit::Ratio).as_deref(),
        Some("61.5%"),
    );
    assert_eq!(
        format_value(&json["rate"], CodeMetricUnit::PerKiloLine).as_deref(),
        Some("3.2/kloc"),
    );
    assert_eq!(
        format_value(&json["flag"], CodeMetricUnit::Boolean).as_deref(),
        Some("yes"),
    );
    assert_eq!(
        format_value(&json["size"], CodeMetricUnit::Bytes).as_deref(),
        Some("2.0 KiB"),
    );
    // A value the unit cannot describe is dropped rather than printed at the reader.
    assert_eq!(format_value(&json["flag"], CodeMetricUnit::Bytes), None);
}

#[test]
fn lookup_treats_a_missing_key_and_an_explicit_null_alike() {
    let json = serde_json::json!({ "a": { "b": 1 }, "c": Value::Null });
    assert_eq!(lookup(&json, "a.b"), Some(&Value::from(1)));
    assert_eq!(lookup(&json, "a.z"), None);
    assert_eq!(lookup(&json, "c"), None);
    assert_eq!(lookup(&json, "c.d"), None);
}

#[tokio::test]
async fn a_path_that_is_not_a_directory_fails_with_a_usable_message() {
    let root = tempfile::tempdir().expect("a temp dir");
    let file = root.path().join("not-a-tree.txt");
    fs::write(&file, "hello").expect("a written file");

    let error = execute(AnalyzeArgs {
        path: file.display().to_string(),
        seed_commit: None,
        tree_basis: crate::cli::TreeBasisArg::PostValidation,
        top: 10,
        json: false,
    })
    .await
    .expect_err("a file is not a source tree");
    assert!(
        error.to_string().contains("is not a directory"),
        "got {error}",
    );
}

/// The command's own path used as a fixture: this repository's CLI crate, analysed by the
/// analyzer it hosts. It is the demo the milestone is verified with, so it is worth one
/// assertion that it produces a real report rather than an empty one.
#[test]
fn this_crate_analyses_to_a_populated_report() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let document = analyze(&AnalysisRequest {
        root,
        seed_commit: None,
        tree_basis: CodeTreeBasis::PostValidation,
        root_seeding: RootSeeding::default(),
    });
    let rendered = render_report(
        "crates/cli",
        &document,
        Duration::from_millis(900),
        10,
        None,
    );

    assert!(
        document.summary.size.files > 10,
        "{:?}",
        document.summary.size
    );
    assert!(document.summary.complexity.functions > 10);
    assert!(rendered.contains("rust discipline"), "{rendered}");
    assert!(rendered.contains("most complex functions"), "{rendered}");
    assert!(rendered.contains("largest files"), "{rendered}");
}

/// Neither heading may read as a measurement the analyzer does not make. `notes` is the
/// walk's diagnostics about the analysis, not code coverage — the analyzer executes nothing
/// and cannot measure coverage — and `tests` is a static count of test code the model wrote,
/// which sits on the same page as the executed test results the run record carries. Both
/// strings must also match the console's `familyHeading`, modulo the lowercasing.
#[test]
fn no_family_is_headed_as_a_measurement_the_analyzer_does_not_make() {
    assert_eq!(family_heading("notes"), "analysis notes");
    assert_eq!(family_heading("tests"), "test authorship");
    for metric in CODE_METRICS {
        assert_ne!(
            family_heading(metric.family),
            "coverage",
            "`{}` must not be headed as coverage",
            metric.family
        );
    }
}
