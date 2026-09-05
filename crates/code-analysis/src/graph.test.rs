//! Tests for import resolution, entry points and cycle detection.

use super::*;
use crate::facts::{FileFacts, ImportFacts};

/// A file as the graph sees it, without a front end in the way.
struct Fixture {
    path: String,
    role: FileRole,
    facts: FileFacts,
    source: String,
}

fn source(path: &str, language: CodeLanguage, imports: &[&str]) -> Fixture {
    Fixture {
        path: path.to_string(),
        role: FileRole::Source(language),
        facts: FileFacts {
            imports: imports
                .iter()
                .map(|specifier| ImportFacts {
                    specifier: (*specifier).to_string(),
                    reexport: false,
                })
                .collect(),
            ..FileFacts::default()
        },
        source: String::new(),
    }
}

fn other(path: &str, role: FileRole, text: &str) -> Fixture {
    Fixture {
        path: path.to_string(),
        role,
        facts: FileFacts::default(),
        source: text.to_string(),
    }
}

fn build_over(fixtures: &[Fixture]) -> ModuleGraph {
    let inputs: Vec<GraphInput<'_>> = fixtures
        .iter()
        .map(|fixture| GraphInput {
            path: &fixture.path,
            role: fixture.role,
            facts: matches!(fixture.role, FileRole::Source(_)).then_some(&fixture.facts),
            source: Some(fixture.source.as_str()),
        })
        .collect();
    build(&inputs)
}

/// The four TypeScript resolution shapes this corpus produces: relative, extensionless,
/// an `index` barrel, and the `.js`-for-`.ts` ESM convention.
#[test]
fn typescript_specifiers_resolve_the_way_the_corpus_writes_them() {
    let fixtures = vec![
        source(
            "src/main.ts",
            CodeLanguage::TypeScript,
            &["./game", "./entities/index.ts", "./render.js", "three"],
        ),
        source("src/game.ts", CodeLanguage::TypeScript, &[]),
        source("src/entities/index.ts", CodeLanguage::TypeScript, &[]),
        source("src/render.ts", CodeLanguage::TypeScript, &[]),
    ];
    let graph = build_over(&fixtures);
    assert_eq!(graph.edges.len(), 3, "{:?}", graph.edges);
    assert_eq!(graph.fan_out.get(&0).copied(), Some(3));
    assert_eq!(
        graph.external_packages.iter().collect::<Vec<_>>(),
        vec!["three"]
    );
}

/// A scoped package and a subpath import both name their package, not their path.
#[test]
fn external_packages_are_named_not_pathed() {
    let fixtures = vec![source(
        "src/main.ts",
        CodeLanguage::TypeScript,
        &["@clockwyrks/voxel-runtime", "three/examples/jsm/loader"],
    )];
    let graph = build_over(&fixtures);
    assert_eq!(
        graph.external_packages.iter().cloned().collect::<Vec<_>>(),
        vec!["@clockwyrks/voxel-runtime".to_string(), "three".to_string()]
    );
}

/// **The HTML pass.** Without it the entry module — and therefore the whole application —
/// reads as orphaned, which is the single most misleading result the graph could produce.
#[test]
fn an_html_entry_point_roots_the_graph() {
    let fixtures = vec![
        other(
            "index.html",
            FileRole::Html,
            "<html><body><script type=\"module\" src=\"/src/main.ts\"></script></body></html>",
        ),
        source("src/main.ts", CodeLanguage::TypeScript, &["./game"]),
        source("src/game.ts", CodeLanguage::TypeScript, &[]),
        source("src/abandoned.ts", CodeLanguage::TypeScript, &[]),
    ];
    let graph = build_over(&fixtures);
    assert_eq!(
        graph.entry_points.iter().copied().collect::<Vec<_>>(),
        vec![1]
    );
    assert_eq!(
        graph.orphans.iter().copied().collect::<Vec<_>>(),
        vec![3],
        "a module nothing reaches is the dead code the metric exists to name"
    );
    assert_eq!(graph.max_depth, 1);
}

/// Rust module paths resolve through the crate's own manifest — never by shelling out to
/// `cargo`, which would need the registry.
#[test]
fn rust_module_paths_resolve_through_the_manifest() {
    let fixtures = vec![
        other(
            "Cargo.toml",
            FileRole::Manifest,
            "[package]\nname = \"game-engine\"\n",
        ),
        source(
            "src/lib.rs",
            CodeLanguage::Rust,
            &["crate::render::draw", "crate::entities", "serde::Serialize"],
        ),
        source(
            "src/render/mod.rs",
            CodeLanguage::Rust,
            &["super::entities"],
        ),
        source("src/entities.rs", CodeLanguage::Rust, &[]),
    ];
    let graph = build_over(&fixtures);
    assert!(
        graph.entry_points.contains(&1),
        "a crate root is an entry point"
    );
    assert!(graph.edges.contains(&(1, 2)), "{:?}", graph.edges);
    assert!(graph.edges.contains(&(1, 3)), "{:?}", graph.edges);
    assert_eq!(
        graph.external_packages.iter().cloned().collect::<Vec<_>>(),
        vec!["serde".to_string()],
        "`std` is the language, and the tree's own crate is not external"
    );
}

/// **Import cycles.** The clearest "did not think about layering" signal there is, and
/// invisible to every other metric.
#[test]
fn a_cycle_is_reported_as_one_component() {
    let fixtures = vec![
        source("src/a.ts", CodeLanguage::TypeScript, &["./b"]),
        source("src/b.ts", CodeLanguage::TypeScript, &["./c"]),
        source("src/c.ts", CodeLanguage::TypeScript, &["./a"]),
        source("src/leaf.ts", CodeLanguage::TypeScript, &[]),
    ];
    let graph = build_over(&fixtures);
    assert_eq!(graph.cycles, vec![vec![0, 1, 2]]);
}

/// Two independent cycles are two components, not one.
#[test]
fn independent_cycles_stay_independent() {
    let fixtures = vec![
        source("src/a.ts", CodeLanguage::TypeScript, &["./b"]),
        source("src/b.ts", CodeLanguage::TypeScript, &["./a"]),
        source("src/c.ts", CodeLanguage::TypeScript, &["./d"]),
        source("src/d.ts", CodeLanguage::TypeScript, &["./c"]),
    ];
    let graph = build_over(&fixtures);
    assert_eq!(graph.cycles, vec![vec![0, 1], vec![2, 3]]);
}

/// An acyclic graph reports no cycles, however long its chain — and the **iterative**
/// Tarjan is what lets that chain be arbitrarily long without a stack overflow, which in
/// this crate is `SIGABRT` rather than a catchable panic.
#[test]
fn a_long_acyclic_chain_has_no_cycles_and_does_not_overflow() {
    const LENGTH: usize = 5_000;
    let mut fixtures = Vec::with_capacity(LENGTH);
    for index in 0..LENGTH {
        let imports: Vec<String> = if index + 1 < LENGTH {
            vec![format!("./m{}", index + 1)]
        } else {
            Vec::new()
        };
        let specifiers: Vec<&str> = imports.iter().map(String::as_str).collect();
        fixtures.push(source(
            &format!("src/m{index}.ts"),
            CodeLanguage::TypeScript,
            &specifiers,
        ));
    }
    let graph = build_over(&fixtures);
    assert!(graph.cycles.is_empty());
    assert_eq!(graph.edges.len(), LENGTH - 1);
}

/// A self-import is a resolution artifact, never a layering fact, so it is not an edge and
/// certainly not a one-node cycle.
#[test]
fn a_self_import_is_not_an_edge() {
    let fixtures = vec![source(
        "src/index.ts",
        CodeLanguage::TypeScript,
        &["./index.ts"],
    )];
    let graph = build_over(&fixtures);
    assert!(graph.edges.is_empty());
    assert!(graph.cycles.is_empty());
}

/// A tree that declares no entry point has none — it is not given a guessed one. Its
/// unimported root still roots the depth walk, so the graph's shape is measured rather than
/// reported as flat.
#[test]
fn a_tree_with_no_declared_entry_point_has_none() {
    let fixtures = vec![
        source("src/api.ts", CodeLanguage::TypeScript, &["./impl"]),
        source("src/impl.ts", CodeLanguage::TypeScript, &["./detail"]),
        source("src/detail.ts", CodeLanguage::TypeScript, &[]),
    ];
    let graph = build_over(&fixtures);
    assert!(graph.entry_points.is_empty());
    assert_eq!(
        graph.orphans.iter().copied().collect::<Vec<_>>(),
        vec![0],
        "the library's own root is imported by nothing, and nothing declares it"
    );
    assert_eq!(
        graph.max_depth, 2,
        "depth is measured from the roots it has"
    );
}

/// **The failure the orphan definition exists to avoid.** One stray HTML file must not turn
/// a library into a tree of dead code.
///
/// Under a transitive-reachability definition a single fixture page naming one module makes
/// every *other* module unreachable, and a healthy library reports almost all of itself as
/// dead — measured at 396 of 402 files on this repository's own `packages/ui`. "Nothing
/// imports this, and nothing declares it" means the same thing in a bundler project and in a
/// library, which is what a cross-case metric needs.
#[test]
fn a_stray_html_file_does_not_orphan_a_whole_library() {
    let fixtures = vec![
        other(
            "fixtures/page.html",
            FileRole::Html,
            "<script src=\"/src/fixture.ts\"></script>",
        ),
        source("src/fixture.ts", CodeLanguage::TypeScript, &[]),
        source("src/api.ts", CodeLanguage::TypeScript, &["./impl"]),
        source("src/impl.ts", CodeLanguage::TypeScript, &[]),
    ];
    let graph = build_over(&fixtures);
    assert_eq!(
        graph.orphans.iter().copied().collect::<Vec<_>>(),
        vec![2],
        "only the module nothing imports and nothing declares is an orphan"
    );
}

/// A `mod name;` is the edge that builds a Rust module tree, and `#[path = "…"]` resolves
/// against the declaring file's directory rather than its module directory — which is what
/// makes this repository's sibling `foo.test.rs` convention resolve at all.
///
/// Without these edges the graph sees only the files a `use crate::…` happens to name:
/// measured on `crates/gg`, 136 of 144 modules read as orphaned instead of 13.
#[test]
fn module_declarations_are_edges() {
    let fixtures = vec![
        other(
            "Cargo.toml",
            FileRole::Manifest,
            "[package]\nname = \"e\"\n",
        ),
        source("src/lib.rs", CodeLanguage::Rust, &["self::agent"]),
        source(
            "src/agent.rs",
            CodeLanguage::Rust,
            &["self::state", "agent.test.rs"],
        ),
        source("src/agent/state.rs", CodeLanguage::Rust, &[]),
        source("src/agent.test.rs", CodeLanguage::Rust, &[]),
    ];
    let graph = build_over(&fixtures);
    assert!(graph.edges.contains(&(1, 2)), "{:?}", graph.edges);
    assert!(
        graph.edges.contains(&(2, 3)),
        "`mod state;` in `agent.rs` names `agent/state.rs`: {:?}",
        graph.edges
    );
    assert!(
        graph.edges.contains(&(2, 4)),
        "`#[path]` is relative to the declaring file's directory: {:?}",
        graph.edges
    );
    assert!(graph.orphans.is_empty(), "{:?}", graph.orphans);
}

/// A barrel edge is tracked separately, because a name re-exported by a barrel is
/// referenced by it without the barrel ever writing the name down.
#[test]
fn a_barrel_edge_is_recorded_as_a_re_export() {
    let mut barrel = source("src/index.ts", CodeLanguage::TypeScript, &[]);
    barrel.facts.imports.push(ImportFacts {
        specifier: "./entities".to_string(),
        reexport: true,
    });
    let fixtures = vec![
        barrel,
        source("src/entities.ts", CodeLanguage::TypeScript, &[]),
    ];
    let graph = build_over(&fixtures);
    assert_eq!(
        graph.reexport_edges.iter().copied().collect::<Vec<_>>(),
        vec![(0, 1)]
    );
}
