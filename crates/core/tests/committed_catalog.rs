//! Checks that hold every committed test case and game jam version to a rule.
//!
//! These read the catalog itself rather than copies of named versions, because
//! their subject is the whole catalog: every version resolves, every frozen version
//! still resolves, every version passes the engine gate for what it declares, and
//! so on. The catalog is read from `TCAB_DEFINITIONS_ROOT` (the directory holding
//! `test-cases/` and `game-jams/`, as the backend names it), defaulting to this
//! repository's root. A missing catalog fails every test here rather than skipping
//! it.

use std::path::{Path, PathBuf};

use test_cabinet_core::engine::{EngineCatalog, EngineSelection};
use test_cabinet_core::{TestCaseCatalog, TestType, ensure_engine_supported};

/// The directory holding the committed `test-cases/` and `game-jams/`:
/// `TCAB_DEFINITIONS_ROOT` when set, otherwise this repository's root.
fn definitions_root() -> PathBuf {
    let root = std::env::var_os("TCAB_DEFINITIONS_ROOT")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."));
    assert!(
        root.join("test-cases").is_dir(),
        "the committed catalog {} is missing",
        root.join("test-cases").display()
    );
    root
}

/// The committed `test-cases/` directory.
fn catalog_root() -> PathBuf {
    definitions_root().join("test-cases")
}

/// Every bundled case must resolve, and every one of its variants must resolve by
/// slug — a guard that the whole catalog stays valid as the manifest format
/// evolves (variants now live in their own `variants/*.toml` files, so a broken
/// list, a missing variant file, or a bad per-variant domain surfaces here).
#[test]
fn every_catalog_case_and_variant_resolves() {
    let catalog = TestCaseCatalog::new(catalog_root());
    let cases = catalog.list().expect("list catalog");
    assert!(!cases.is_empty(), "catalog should not be empty");
    for case in &cases {
        for version in &case.versions {
            let resolved = catalog
                .resolve(&case.slug, version)
                .unwrap_or_else(|err| panic!("resolve {}@{}: {err:?}", case.slug, version));
            assert!(
                !resolved.variants.is_empty(),
                "{}@{} declares no variants",
                case.slug,
                version
            );
            // Two types carry no per-domain reviewer rating, so the domain
            // assertions apply only to the domain-scored types. A game jam is graded
            // on categories plus a whole-game overall grade; a performance case is
            // graded automatically on correctness and fuel, with no human review at
            // all.
            let undomained = matches!(
                resolved.test_type,
                test_cabinet_core::TestType::GameJam | test_cabinet_core::TestType::Performance
            );
            assert!(
                undomained || !resolved.domains.is_empty(),
                "{}@{} declares no common domains",
                case.slug,
                version
            );
            for variant in &resolved.variants {
                resolved.variant(&variant.slug).unwrap_or_else(|err| {
                    panic!(
                        "{}@{} variant {}: {err:?}",
                        case.slug, version, variant.slug
                    )
                });
                // Every variant's effective domain set (common ∪ its own) is what a
                // reviewer rates, so it must be non-empty — except for the types
                // with no per-domain rating to give.
                assert!(
                    undomained || !resolved.domains_for(variant).is_empty(),
                    "{}@{} variant {} has no effective domains",
                    case.slug,
                    version,
                    variant.slug
                );
            }
        }
    }
}

#[test]
fn asset_generation_cases_are_reviewed_on_one_overall_rating() {
    // A produced asset is judged as a WHOLE against its brief — too subjective to
    // break into pass/fail checklist items — so every asset-generation case is
    // reviewed on a single `overall` scoring domain with no reviewer checklist at
    // all: the one rating the reviewer gives is the run's rating. Only each case's
    // LATEST version is held to this; a frozen version keeps whatever checklist the
    // runs recorded against it were judged by.
    let catalog = TestCaseCatalog::new(catalog_root());
    let mut checked = 0;
    for case in catalog.list().expect("list catalog") {
        let version = catalog
            .resolve_latest(&case.slug)
            .unwrap_or_else(|e| panic!("resolve {}: {e}", case.slug));
        if version.test_type != TestType::AssetGeneration {
            continue;
        }
        let domains: Vec<&str> = version.domains.iter().map(|d| d.id.as_str()).collect();
        assert_eq!(
            domains,
            ["overall"],
            "{} should declare the single `overall` domain",
            case.slug
        );
        assert!(
            version.common_review_items.is_empty(),
            "{} should declare no review items",
            case.slug
        );
        for variant in &version.variants {
            let effective = version.domains_for(variant);
            let domains: Vec<&str> = effective.iter().map(|d| d.id.as_str()).collect();
            assert_eq!(
                domains,
                ["overall"],
                "{} variant {} should be rated on `overall` alone",
                case.slug,
                variant.slug
            );
            assert!(
                version.review_items_for(variant).is_empty(),
                "{} variant {} should declare no review items",
                case.slug,
                variant.slug
            );
        }
        checked += 1;
    }
    assert!(
        checked > 100,
        "expected the bundled asset-generation catalog, checked only {checked} cases"
    );
}

/// The sibling `game-jams/` directory. Discovery folds it into the same catalog as
/// `test-cases/` (see `TestCaseCatalog::case_folders`), so an audit of "every
/// committed case manifest" has to count it too.
fn jam_root() -> PathBuf {
    definitions_root().join("game-jams")
}

/// Directory names under a version that hold build output rather than definitions:
/// a reference implementation's installed dependencies and its bundle, the
/// git-ignored screenshot cache, and the per-build scratch directory. Every one is
/// git-ignored, holds no committed manifest, and is rewritten wholesale by any
/// build running beside the suite, so the walk stops at them and reads the
/// committed catalog alone.
const BUILD_OUTPUT_DIRS: [&str; 4] = ["node_modules", "dist", ".rendered", ".vendor"];

/// Every committed case manifest on disk: `test-case.toml` under `test-cases/`
/// and `game-jam.toml` under `game-jams/`, one per version directory.
///
/// Walked from the filesystem rather than from the catalog, so the two can be
/// compared: if discovery ever stops reaching a folder, the counts diverge here
/// instead of the catalog quietly shrinking.
///
/// Every filesystem error is a panic naming the path it happened on, and a
/// directory entry is classified by its own type rather than by following it. A
/// walk that skipped what it could not read would answer a short list, and the
/// callers that compare a count against it would report a catalog disagreeing with
/// itself while the read that actually failed went unnamed.
fn on_disk_manifests() -> Vec<PathBuf> {
    fn walk(dir: &Path, found: &mut Vec<PathBuf>) {
        let entries =
            std::fs::read_dir(dir).unwrap_or_else(|err| panic!("read {}: {err}", dir.display()));
        for entry in entries {
            let entry =
                entry.unwrap_or_else(|err| panic!("read an entry of {}: {err}", dir.display()));
            let path = entry.path();
            let file_type = entry
                .file_type()
                .unwrap_or_else(|err| panic!("type of {}: {err}", path.display()));
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            if file_type.is_dir() {
                if !BUILD_OUTPUT_DIRS.contains(&name) {
                    walk(&path, found);
                }
            } else if name == "test-case.toml" || name == "game-jam.toml" {
                found.push(path);
            }
        }
    }
    let mut found = Vec::new();
    walk(&catalog_root(), &mut found);
    walk(&jam_root(), &mut found);
    found.sort();
    found
}

/// Every version directory carrying a `.frozen` marker: the versions that have runs
/// recorded against them and so can never be edited again. Their manifests are the
/// backward-compatibility contract — whatever the manifest grammar grows, these
/// exact files must keep resolving.
fn frozen_version_dirs() -> Vec<PathBuf> {
    on_disk_manifests()
        .into_iter()
        .filter_map(|manifest| {
            let dir = manifest.parent()?.to_path_buf();
            dir.join(".frozen").exists().then_some(dir)
        })
        .collect()
}

/// The catalog walk must reach **every** committed manifest, not merely a
/// non-empty subset of them.
///
/// `every_catalog_case_and_variant_resolves` asserts the catalog is non-empty and
/// that what it lists resolves; on its own that would still pass if discovery
/// silently stopped reaching a whole folder. Comparing the number of resolved
/// `(case, version)` pairs against the number of manifest files on disk closes
/// that gap: exactly one manifest lives in each version directory, so the two
/// counts must be equal.
#[test]
fn the_catalog_walk_reaches_every_committed_manifest() {
    let catalog = TestCaseCatalog::new(catalog_root());
    let resolved: usize = catalog
        .list()
        .expect("list catalog")
        .iter()
        .map(|case| case.versions.len())
        .sum();

    let on_disk = on_disk_manifests();
    assert_eq!(
        resolved,
        on_disk.len(),
        "the catalog lists {resolved} case versions but {} manifests are committed \
         on disk — discovery is skipping one",
        on_disk.len()
    );
}

/// Every frozen version directory must still resolve, by the folder name and
/// version string that name it on disk.
///
/// This is the backward-compatibility gate for the manifest grammar. A frozen
/// directory cannot be edited to keep up with a new field, so every one of them
/// declares the *old* spellings: the bare `engines = [...]` list (or no `engines`
/// key at all) rather than `[[engine]]` tables, and no `[toolchain]` table. Each
/// must therefore resolve to unbounded engine support and to no toolchain — the
/// two states that leave a frozen case behaving exactly as it did before either
/// feature existed.
#[test]
fn every_frozen_version_still_resolves_unchecked_and_ungated() {
    let catalog = TestCaseCatalog::new(catalog_root());

    let frozen = frozen_version_dirs();
    assert!(
        !frozen.is_empty(),
        "no frozen version directories found — the audit would prove nothing"
    );

    for dir in &frozen {
        let version_name = dir
            .file_name()
            .and_then(|name| name.to_str())
            .expect("version directory name");
        // The catalog accepts a folder name as an id, so a frozen directory can be
        // addressed exactly as it sits on disk without parsing its manifest first.
        let folder = dir
            .parent()
            .and_then(|parent| parent.file_name())
            .and_then(|name| name.to_str())
            .expect("case folder name");

        let version = catalog
            .resolve(folder, version_name)
            .unwrap_or_else(|err| panic!("resolve frozen {}: {err:?}", dir.display()));

        // No frozen manifest declares a `[toolchain]` table, so none of them is
        // toolchain-checked and none can be gated by one.
        assert!(
            version.toolchain.is_none(),
            "frozen {} resolved with a toolchain it cannot have declared",
            dir.display()
        );
        // Every engine a frozen manifest declares came from the bare list, which
        // carries no range — so the version half of the run gate short-circuits and
        // the case never consults the host package store.
        for engine in &version.engines {
            assert!(
                !engine.is_bounded(),
                "frozen {} declares a version range for `{}`, which the bare \
                 `engines` list cannot express",
                dir.display(),
                engine.slug
            );
        }
    }
}

/// Every case in the catalog must pass the real run gate for every engine it
/// declares — the same `ensure_engine_supported` a run applies before any
/// container work — and must refuse the engines it does not.
///
/// The engine catalogue is resolved with its **default** package store, which on a
/// host that has staged nothing holds no version for `simple-2d`. A case declaring
/// no version range must be admitted regardless, so a frozen bare-slug case still
/// runs on a machine that has never staged a package; a case declaring a RANGE is
/// checked against the staged version, and where the host has staged nothing that
/// half of the gate has nothing to answer with, which is not the case's fault and
/// is skipped here rather than asserted either way.
///
/// The engineless run is asserted per case rather than universally: a version that
/// declares no engine supports it, and a version built against a runtime does not
/// (its workspace `package.json` depends on a package an engineless run vendors
/// nothing into). Both halves are checked, so the gate is held to the resolved set
/// rather than to a blanket rule.
#[test]
fn every_catalog_version_passes_the_engine_gate_for_the_engines_it_declares() {
    let catalog = TestCaseCatalog::new(catalog_root());
    let engines = EngineCatalog::new();

    let mut checked = 0usize;
    for case in &catalog.list().expect("list catalog") {
        for version_name in &case.versions {
            let version = catalog
                .resolve(&case.slug, version_name)
                .unwrap_or_else(|err| panic!("resolve {}@{version_name}: {err:?}", case.slug));

            // The engineless run: admitted exactly when the resolved set carries it.
            let none = engines
                .resolve(&EngineSelection::none())
                .expect("resolve the engineless engine");
            let engineless = ensure_engine_supported(&version, &none);
            if version.supports_engine(test_cabinet_core::NONE_SLUG) {
                engineless.unwrap_or_else(|err| {
                    panic!(
                        "{}@{version_name} supports the engineless run but the gate \
                         refuses it: {err:?}",
                        case.slug
                    )
                });
            } else {
                assert!(
                    engineless.is_err(),
                    "{}@{version_name} does not support the engineless run, so the gate \
                     must refuse it",
                    case.slug
                );
            }

            for support in &version.engines {
                let engine = engines
                    .resolve(&EngineSelection::new(&support.slug))
                    .unwrap_or_else(|err| {
                        panic!(
                            "{}@{version_name} declares engine `{}`, which the catalogue \
                             cannot resolve: {err:?}",
                            case.slug, support.slug
                        )
                    });
                // A declared RANGE is answered from the host package store. Where the
                // host has staged nothing there is no version to compare, so the gate
                // reports the version as unknown — a property of this machine, not of
                // the manifest, and the half this walk cannot assert.
                if support.is_bounded() && engine.version().is_none() {
                    continue;
                }
                ensure_engine_supported(&version, &engine).unwrap_or_else(|err| {
                    panic!(
                        "{}@{version_name} declares engine `{}` but the run gate refuses \
                         it: {err:?}",
                        case.slug, support.slug
                    )
                });
            }
            checked += 1;
        }
    }

    assert_eq!(
        checked,
        on_disk_manifests().len(),
        "the engine gate was exercised over {checked} versions, but the repository \
         commits {} case manifests",
        on_disk_manifests().len()
    );
}

/// A resolved version's stored shape must stay byte-compatible with what the
/// definition store already holds.
///
/// The backend serializes a resolved `TestCaseVersion` into its definition store
/// and reads it back, so the two fields the manifest grammar grew have to be
/// invisible on the wire for every case that does not use them: an unbounded
/// `engines` entry must serialize as the plain slug string the case declared, and
/// `toolchain` must be absent rather than written as an explicit null.
/// A version that DOES use them is held to the round trip instead — what it wrote
/// must read back as what it was — so the new spellings are proved to survive the
/// store without pretending nothing in the catalog uses them. Serializing the real
/// catalog rather than a hand-built literal is what makes this a statement about
/// the definitions actually shipped.
#[test]
fn the_stored_shape_of_every_committed_version_is_unchanged() {
    let catalog = TestCaseCatalog::new(catalog_root());

    let mut checked = 0usize;
    for case in &catalog.list().expect("list catalog") {
        for version_name in &case.versions {
            let version = catalog
                .resolve(&case.slug, version_name)
                .unwrap_or_else(|err| panic!("resolve {}@{version_name}: {err:?}", case.slug));

            let stored = serde_json::to_value(&version).expect("serialize the resolved version");
            let object = stored
                .as_object()
                .expect("a version serializes to an object");

            // A version that declares no `[toolchain]` table must not gain the key at
            // all — a stored definition of an untouched case gains no field.
            assert_eq!(
                object.contains_key("toolchain"),
                version.toolchain.is_some(),
                "{}@{version_name} stores a `toolchain` key that does not match what it \
                 declared",
                case.slug
            );

            // An engine declared with no version range must still serialize as the
            // bare slug string the case declared; only a declared RANGE may widen
            // into an object.
            let engines = object
                .get("engines")
                .and_then(|value| value.as_array())
                .unwrap_or_else(|| panic!("{}@{version_name} stores no engines array", case.slug));
            assert_eq!(engines.len(), version.engines.len());
            for (entry, support) in engines.iter().zip(&version.engines) {
                assert_eq!(
                    entry.is_string(),
                    !support.is_bounded(),
                    "{}@{version_name} stores engine entry {entry} in a shape that does \
                     not match whether `{}` declared a version range",
                    case.slug,
                    support.slug
                );
            }

            // And the whole thing must read back as what it was.
            let round_tripped: test_cabinet_core::TestCaseVersion =
                serde_json::from_value(stored).expect("deserialize the stored version");
            assert_eq!(
                round_tripped.engines, version.engines,
                "{}@{version_name} does not survive the definition store round trip",
                case.slug
            );
            assert_eq!(
                round_tripped.toolchain.is_some(),
                version.toolchain.is_some(),
                "{}@{version_name} loses its toolchain across the definition store round \
                 trip",
                case.slug
            );
            checked += 1;
        }
    }

    assert_eq!(checked, on_disk_manifests().len());
}
