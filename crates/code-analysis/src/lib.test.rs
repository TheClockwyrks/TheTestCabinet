//! End-to-end tests: a tree on disk in, a document out.

use std::fs;
use std::path::Path;

use test_cabinet_core::{CodeAuthoredBasis, CodeLanguage, CodeTreeBasis, CodeTruncationCap};

use super::*;

fn write(root: &Path, path: &str, contents: &str) {
    let full = root.join(path);
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).expect("a parent directory");
    }
    fs::write(full, contents).expect("a written file");
}

fn tree(files: &[(&str, &str)]) -> tempfile::TempDir {
    let root = tempfile::tempdir().expect("a temp dir");
    for (path, contents) in files {
        write(root.path(), path, contents);
    }
    root
}

fn analyse(root: &Path) -> CodeAnalysisDocument {
    analyze(&AnalysisRequest {
        root,
        seed_commit: None,
        tree_basis: CodeTreeBasis::PreValidation,
        // These fixtures are bare trees with no run behind them, which is exactly the
        // caller the default answers for: nothing is known to have been seeded, so the
        // root-anchored floor removes only the host's own `.vendor/`.
        root_seeding: crate::walk::RootSeeding::default(),
    })
}

/// A small bundler project, of the shape every end-to-end case in this corpus produces.
fn bundler_project() -> tempfile::TempDir {
    tree(&[
        (".gitignore", "generated/\n"),
        (
            "index.html",
            "<html><body><script type=\"module\" src=\"/src/main.ts\"></script></body></html>\n",
        ),
        ("package.json", "{ \"name\": \"game\" }\n"),
        ("README.md", "# game\n\nA game.\n"),
        (
            "src/main.ts",
            "import { start } from './game';\n\
             import { Ship } from './entities';\n\
             export function boot(canvas: HTMLCanvasElement): void {\n\
             \x20 const ship = new Ship();\n\
             \x20 if (canvas.width > 0 && canvas.height > 0) {\n\
             \x20   start(ship);\n\
             \x20 }\n\
             }\n",
        ),
        (
            "src/game.ts",
            "import type { Ship } from './entities';\n\
             export function start(ship: Ship): number {\n\
             \x20 let ticks = 0;\n\
             \x20 while (ticks < 100) {\n\
             \x20   ticks += 1;\n\
             \x20 }\n\
             \x20 return ticks;\n\
             }\n",
        ),
        ("src/entities/index.ts", "export * from './ship';\n"),
        (
            "src/entities/ship.ts",
            "export class Ship {\n\
             \x20 hull = 10;\n\
             \x20 damage(amount: any) { this.hull -= amount; }\n\
             }\n",
        ),
        (
            "src/abandoned.ts",
            "export function neverCalled(): number { return 1; }\n",
        ),
        ("dist/bundle.js", "console.log('built');\n"),
        ("node_modules/three/index.js", "module.exports = {};\n"),
        ("generated/atlas.ts", "export const atlas = [];\n"),
    ])
}

/// The document a realistic tree produces: the floor and the ignore file decide what is
/// measured, the front end decides what is parsed, and the graph finds the module nothing
/// reaches.
#[test]
fn a_bundler_project_is_measured_end_to_end() {
    let root = bundler_project();
    let document = analyse(root.path());
    let summary = &document.summary;

    let measured: Vec<&str> = document
        .files
        .iter()
        .map(|file| file.path.as_str())
        .collect();
    assert_eq!(
        measured,
        vec![
            ".gitignore",
            "README.md",
            "index.html",
            "package.json",
            "src/abandoned.ts",
            "src/entities/index.ts",
            "src/entities/ship.ts",
            "src/game.ts",
            "src/main.ts",
        ],
        "the floor removes `dist/` and `node_modules/`, and the tree's own ignore file \
         removes `generated/`"
    );

    assert_eq!(summary.languages, vec![CodeLanguage::TypeScript]);
    assert_eq!(summary.size.parsed_files, 5);
    assert!(summary.notes.gitignore_applied);
    assert!(!summary.notes.truncated);
    assert_eq!(summary.tree_basis, CodeTreeBasis::PreValidation);
    assert_eq!(
        summary.authored_basis,
        CodeAuthoredBasis::AllFiles,
        "an ad-hoc directory is not a seeded repository, and the basis says so"
    );

    assert!(summary.graph.nodes >= 5);
    assert_eq!(summary.graph.cycles, 0);
    assert_eq!(summary.graph.entry_points, 1, "the HTML names one entry");
    assert_eq!(
        summary.graph.orphans, 1,
        "`src/abandoned.ts` is reachable from nothing"
    );

    assert!(summary.complexity.functions >= 4);
    assert_eq!(
        summary
            .typescript
            .as_ref()
            .expect("a TypeScript block")
            .any_occurrences,
        1
    );
    assert!(summary.rust.is_none(), "there is no Rust in this tree");
}

/// A Rust workspace: crate roots come from the manifest, module paths resolve through the
/// module tree, and the discipline counters read the shapes they name.
#[test]
fn a_rust_crate_is_measured_end_to_end() {
    let root = tree(&[
        (
            "Cargo.toml",
            "[package]\nname = \"engine\"\nversion = \"0.1.0\"\n",
        ),
        (
            "src/lib.rs",
            "pub mod render;\n\
             pub mod entities;\n\
             use crate::render::draw;\n\
             pub fn boot(width: u32) -> u32 {\n\
             \x20   let value = Some(width).unwrap();\n\
             \x20   draw(value)\n\
             }\n",
        ),
        (
            "src/render.rs",
            "use crate::entities::Ship;\n\
             pub fn draw(width: u32) -> u32 {\n\
             \x20   let ship = Ship { hull: 1 };\n\
             \x20   if width > 0 { ship.hull } else { 0 }\n\
             }\n",
        ),
        (
            "src/entities.rs",
            "pub struct Ship { pub hull: u32 }\n\
             #[allow(dead_code)]\n\
             fn hidden() {}\n",
        ),
    ]);
    let summary = analyse(root.path()).summary;

    assert_eq!(summary.languages, vec![CodeLanguage::Rust]);
    let rust = summary.rust.as_ref().expect("a Rust block");
    assert_eq!(rust.files, 3);
    assert_eq!(rust.unwrap_calls, 1);
    assert_eq!(rust.suppressed_lints, 1);
    assert!(rust.public_ratio > 0.0 && rust.public_ratio < 1.0);
    assert!(summary.typescript.is_none());
    assert_eq!(summary.graph.entry_points, 1, "the crate root is the entry");
    assert!(summary.graph.edges >= 2, "{:?}", summary.graph);
}

/// **The deliberate reversal.** A file too large to parse is still counted for size. A
/// 300 KB god-file is precisely the interesting case; dropping it would bias every size
/// metric against the worst outcomes.
#[test]
fn a_file_too_large_to_parse_is_still_counted_for_size() {
    let filler = "export const padding = 'x';\n".repeat(caps::MAX_PARSED_FILE_BYTES / 20);
    assert!(filler.len() > caps::MAX_PARSED_FILE_BYTES);
    let root = tree(&[
        ("src/small.ts", "export const a = 1;\n"),
        ("src/god.ts", &filler),
    ]);
    let document = analyse(root.path());

    let god = document
        .files
        .iter()
        .find(|file| file.path == "src/god.ts")
        .expect("the oversized file is in the document");
    assert_eq!(god.size_only_reason.as_deref(), Some("over-parse-cap"));
    assert_eq!(god.language, None);
    assert!(god.code_lines > 1_000, "its lines are still counted");

    assert_eq!(document.summary.size.files, 2);
    assert_eq!(document.summary.size.parsed_files, 1);
    assert_eq!(document.summary.size.size_only_files, 1);
    assert_eq!(
        document.summary.size.max_file_code_lines, god.code_lines,
        "the god-file must dominate the size tail, not vanish from it"
    );
}

/// A tree the model nested past the prescan's bound is refused by the front end and counted
/// for size, exactly like an oversized one.
#[test]
fn a_pathologically_nested_file_is_refused_and_counted() {
    let nested = format!(
        "export const a = {}1{};\n",
        "(".repeat(caps::MAX_BRACKET_NESTING as usize + 5),
        ")".repeat(caps::MAX_BRACKET_NESTING as usize + 5)
    );
    let root = tree(&[("src/deep.ts", &nested)]);
    let document = analyse(root.path());
    assert_eq!(
        document.files[0].size_only_reason.as_deref(),
        Some("over-nesting-cap")
    );
    assert_eq!(document.summary.size.files, 1);
}

/// **Determinism.** The analysis is a pure function of the tree's bytes. There is no
/// wall-clock budget anywhere in this path, precisely so this assertion means something: a
/// time cutoff would make the output a function of machine speed and load, and this test
/// would pass while proving nothing.
#[test]
fn analysing_the_same_tree_twice_gives_the_same_document() {
    let root = bundler_project();
    assert_eq!(analyse(root.path()), analyse(root.path()));
}

fn analyse_within(root: &Path, budgets: caps::TreeBudgets) -> CodeAnalysisDocument {
    analyze_within(
        &AnalysisRequest {
            root,
            seed_commit: None,
            tree_basis: CodeTreeBasis::PreValidation,
            root_seeding: crate::walk::RootSeeding::default(),
        },
        &budgets,
    )
}

/// The production bounds are what [`analyze`] runs under. A change to any of them is a
/// definition change that bumps the analyzer version, so the values are pinned here rather
/// than left implied by the constants.
#[test]
fn the_default_budgets_are_the_production_caps() {
    assert_eq!(
        caps::TreeBudgets::default(),
        caps::TreeBudgets {
            max_files: 20_000,
            max_total_parse_bytes: 64 * 1024 * 1024,
            max_symbols: 200_000,
        }
    );
}

/// **Determinism under truncation**, which is the half that could plausibly fail. Files are
/// visited in sorted order, so *which* files a cap drops is a function of the tree rather
/// than of directory order — and a truncated result says so, because a partial figure that
/// looks complete is worse than a missing one. The cap is set to ten so the tree that
/// exceeds it is fifteen files; the mechanism is the same one the production cap uses.
#[test]
fn a_truncated_analysis_is_deterministic_and_says_so() {
    let budgets = caps::TreeBudgets {
        max_files: 10,
        ..caps::TreeBudgets::default()
    };
    let root = tempfile::tempdir().expect("a temp dir");
    // Written in reverse so creation order and sorted order disagree.
    for index in (0..15).rev() {
        write(root.path(), &format!("notes/n{index:02}.md"), "# note\n");
    }

    let first = analyse_within(root.path(), budgets);
    assert!(first.summary.notes.truncated);
    assert_eq!(
        first.summary.notes.truncated_by,
        Some(CodeTruncationCap::FileCount)
    );
    assert_eq!(first.summary.size.files, 10);
    assert_eq!(
        first.files.last().expect("a last file").path,
        "notes/n09.md",
        "the sort is what makes the dropped set a function of the tree"
    );

    assert_eq!(first, analyse_within(root.path(), budgets));
}

/// A tree that exactly fills the file cap is not truncated: the cap drops files past it, and
/// a flag raised on a complete tree would exclude a result that is whole.
#[test]
fn a_tree_that_exactly_fills_the_file_cap_is_not_truncated() {
    let root = tempfile::tempdir().expect("a temp dir");
    for index in 0..10 {
        write(root.path(), &format!("notes/n{index:02}.md"), "# note\n");
    }
    let document = analyse_within(
        root.path(),
        caps::TreeBudgets {
            max_files: 10,
            ..caps::TreeBudgets::default()
        },
    );
    assert!(!document.summary.notes.truncated);
    assert_eq!(document.summary.size.files, 10);
}

/// The tree-wide parse budget is spent in sorted order: the file that no longer fits is
/// counted for size, recorded as over budget, and the result names the cap that fired.
#[test]
fn a_spent_parse_budget_leaves_the_later_files_size_only_and_says_so() {
    let source = "export const a = 1;\n";
    let root = tree(&[("src/a.ts", source), ("src/b.ts", source)]);
    let document = analyse_within(
        root.path(),
        caps::TreeBudgets {
            max_total_parse_bytes: source.len() as u64,
            ..caps::TreeBudgets::default()
        },
    );
    assert_eq!(
        document.summary.notes.truncated_by,
        Some(CodeTruncationCap::ParseBytes)
    );
    let reasons: Vec<_> = document
        .files
        .iter()
        .map(|file| (file.path.as_str(), file.size_only_reason.as_deref()))
        .collect();
    assert_eq!(
        reasons,
        [("src/a.ts", None), ("src/b.ts", Some("budget-exhausted"))]
    );
}

/// The symbol budget is spent by the functions a parsed file declares; once it is gone, the
/// next source file is not parsed and the result names the cap that fired.
#[test]
fn a_spent_symbol_budget_leaves_the_later_files_size_only_and_says_so() {
    let root = tree(&[
        (
            "src/a.ts",
            "export function one() {}\nexport function two() {}\n",
        ),
        ("src/b.ts", "export function three() {}\n"),
    ]);
    let document = analyse_within(
        root.path(),
        caps::TreeBudgets {
            max_symbols: 2,
            ..caps::TreeBudgets::default()
        },
    );
    assert_eq!(
        document.summary.notes.truncated_by,
        Some(CodeTruncationCap::SymbolBudget)
    );
    let reasons: Vec<_> = document
        .files
        .iter()
        .map(|file| (file.path.as_str(), file.size_only_reason.as_deref()))
        .collect();
    assert_eq!(
        reasons,
        [("src/a.ts", None), ("src/b.ts", Some("budget-exhausted"))]
    );
}

/// An empty tree produces a document, not a divide-by-zero: every mean and ratio goes
/// through one guard, because `NaN` does not survive JSON at all.
#[test]
fn an_empty_tree_produces_a_document_of_zeros() {
    let root = tempfile::tempdir().expect("a temp dir");
    let document = analyse(root.path());
    assert_eq!(document.summary.size.files, 0);
    assert!(document.summary.languages.is_empty());
    let json = serde_json::to_string(&document).expect("the document serializes");
    assert!(
        !json.contains("null,"),
        "no field may serialize as NaN: {json}"
    );
    assert!(!json.contains("NaN"));
}

/// The whole document survives JSON, because that is how it is served.
///
/// The assertion is that the encoding reaches a **fixed point**, not that the first parse
/// reproduces the computed value bit-for-bit. The workspace's `serde_json` is built without
/// its `float_roundtrip` feature, so its float *parser* is not an exact inverse of its
/// writer and a ratio can shift by one unit in the last place on the way in. That is a
/// property of every `f64` on the run-record path, not of this document, and asserting
/// exact equality here would encode a workspace-wide dependency choice into this crate's
/// suite. What matters for a served artifact is that reading it and writing it again is
/// stable, and that nothing structural is lost.
#[test]
fn the_document_survives_a_json_round_trip() {
    let root = bundler_project();
    let document = analyse(root.path());
    let json = serde_json::to_string(&document).expect("the document serializes");

    let once: CodeAnalysisDocument = serde_json::from_str(&json).expect("the document parses");
    let again: CodeAnalysisDocument =
        serde_json::from_str(&serde_json::to_string(&once).expect("it re-serializes"))
            .expect("it parses again");
    assert_eq!(once, again, "the encoding must reach a fixed point");

    assert_eq!(once.files, document.files);
    assert_eq!(once.symbols, document.symbols);
    assert_eq!(once.imports, document.imports);
    assert_eq!(once.summary.size.files, document.summary.size.files);
    assert_eq!(once.summary.languages, document.summary.languages);
    assert_eq!(once.summary.notes, document.summary.notes);
}

/// Nothing in the analysis executes what it measures: a tree whose every file is a script
/// that would fail loudly if run produces figures, not side effects.
#[test]
fn the_analysis_executes_nothing_it_measures() {
    let root = tree(&[(
        "src/boom.ts",
        "throw new Error('this must never run');\nexport const a = 1;\n",
    )]);
    let document = analyse(root.path());
    assert_eq!(document.summary.size.parsed_files, 1);
}
