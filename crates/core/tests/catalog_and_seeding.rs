//! Integration tests over the real `test-cases/` catalog.
//!
//! These resolve the bundled Pong test case through the catalog and seed a fresh
//! repository from it, asserting the seeding contract: the selected variant's
//! specs and the rendered reference images are present, the reference *source* is
//! withheld, and the repository has a single initial commit.

use std::path::{Path, PathBuf};

use test_cabinet_core::{
    FsRepoSeeder, RenderedReference, RepoSeeder, SeedRequest, TestCaseCatalog, TestType,
};

/// The repository's `test-cases/` directory.
fn catalog_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../test-cases")
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
            assert!(
                !resolved.domains.is_empty(),
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
                // reviewer rates, so it must be non-empty.
                assert!(
                    !resolved.domains_for(variant).is_empty(),
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
fn resolves_pong_from_its_manifest() {
    let catalog = TestCaseCatalog::new(catalog_root());

    let cases = catalog.list().expect("list catalog");
    assert!(
        cases.iter().any(|c| c.slug == "pong"),
        "pong should be listed"
    );

    let version = catalog.resolve_latest("pong").expect("resolve latest pong");
    assert_eq!(version.slug, "pong");
    // The prompt template and the decomposed common specs are resolved from the
    // manifest. Every variant seeds the overview spec and the standard mode.
    assert!(version.prompt_path.ends_with("prompt.hbs"));
    assert!(
        version
            .common_specs
            .iter()
            .any(|spec| spec.dest == Path::new("specs/overview.md")),
        "the overview spec should be a common spec"
    );
    assert!(
        version
            .common_specs
            .iter()
            .any(|spec| spec.dest == Path::new("specs/modes/standard.md")),
        "the standard mode should be common to every variant"
    );
    // Site-facing metadata is surfaced from the manifest. Carom declares all of
    // it, including a site-facing description that is resolved but never seeded.
    assert_eq!(version.name, "Carom");
    assert_eq!(version.difficulty, "easy");
    assert_eq!(version.tags, ["arcade", "2d", "paddle", "physics"]);
    // The case declares its own harness runtime cap (1.5 hours), bounding a run by
    // 90 minutes.
    assert_eq!(version.max_runtime_seconds, 5400);
    assert!(
        version
            .description_path
            .as_ref()
            .is_some_and(|p| p.ends_with("description.md")),
        "the site-facing description should be resolved from the manifest"
    );
    // The short card summary is carried inline as plain text, distinct from the
    // file-backed description.
    assert!(
        version
            .summary
            .as_ref()
            .is_some_and(|s| s.contains("paddle duel")),
        "the inline site-facing summary should be surfaced from the manifest"
    );
    // Four variants are offered: base (standard only), frenzy, multi, and gyre.
    let variant_slugs: Vec<&str> = version.variants.iter().map(|v| v.slug.as_str()).collect();
    assert_eq!(variant_slugs, ["base", "frenzy", "multi", "gyre"]);
    // The frenzy variant adds the frenzy mode spec on top of the common specs.
    let frenzy = version.variant("frenzy").expect("frenzy variant");
    assert!(
        frenzy
            .specs
            .iter()
            .any(|spec| spec.dest == Path::new("specs/modes/frenzy.md")),
        "frenzy should add the frenzy mode spec"
    );
    // The `gameplay` and `game-over` views are common to every variant; the
    // `title` view is variant-specific because the main menu differs per variant,
    // so each variant declares its own `title` reference rather than the common
    // set carrying it.
    let common_views: Vec<&str> = version
        .common_references
        .iter()
        .map(|v| v.view.as_str())
        .collect();
    assert_eq!(common_views, ["gameplay", "game-over"]);
    assert!(
        frenzy.references.iter().any(|v| v.view == "title"),
        "frenzy should declare its own title reference"
    );
    // The full reference set for a variant is the common references plus its own,
    // so every variant still offers the three views — with its variant-specific
    // title menu.
    let frenzy_views: Vec<String> = version
        .references_for(frenzy)
        .iter()
        .map(|v| v.view.clone())
        .collect();
    assert_eq!(frenzy_views, ["gameplay", "game-over", "title"]);
    // Validation is opt-in: the manifest declares a single title check, with an
    // explicit display name. Its `title` baseline resolves per variant.
    assert_eq!(version.checks.len(), 1);
    assert_eq!(version.checks[0].view, "title");
    assert_eq!(version.checks[0].name, "Title Screen");
    assert_eq!(version.checks[0].reference_view, "title");
}

#[test]
fn seeding_includes_spec_and_reference_images_but_not_source() {
    let catalog = TestCaseCatalog::new(catalog_root());
    let version = catalog
        .resolve("pong", "v1.0.0")
        .expect("resolve pong v1.0.0");

    // Seed the base variant: the common specs and nothing mode-specific beyond
    // the standard mode.
    let base = version.variant("base").expect("base variant");
    let specs = version.seeded_specs(base);
    let workspace = version.workspace_for(base);

    // Stand in for a rendered reference screenshot. The seeder copies the file
    // verbatim, so its bytes do not need to be a real PNG for this contract test
    // — this keeps the test independent of a headless browser.
    let seed_base = tempfile::tempdir().expect("temp dir");
    let fake_image = seed_base.path().join("title-source.png");
    std::fs::write(&fake_image, b"not-a-real-png").expect("write fake image");
    let references = [RenderedReference {
        view: "title".to_string(),
        kind: test_cabinet_core::MediaKind::Image,
        media_path: fake_image,
    }];

    let seeder = FsRepoSeeder::new(seed_base.path());
    let seeded = seeder
        .seed(&SeedRequest {
            test_case: &version,
            variant: base,
            specs: &specs,
            workspace,
            references: &references,
            live_preview: None,
        })
        .expect("seed pong");

    // The run directory is named `{slug}-{version}-{timestamp}` so the newest
    // run sorts last in a listing.
    let dir_name = seeded
        .path
        .file_name()
        .and_then(|name| name.to_str())
        .expect("seeded run directory has a name");
    assert!(
        dir_name.starts_with("pong-v1.0.0-"),
        "run directory is named for the test case and version: {dir_name}"
    );

    // The starter workspace is seeded at the run root: Carom ships a
    // `package.json` for the model to build on.
    assert!(seeded.path.join("package.json").is_file());

    // The base variant's specs are seeded at their destination paths.
    assert!(seeded.path.join("specs/overview.md").is_file());
    assert!(seeded.path.join("specs/modes/standard.md").is_file());
    // The overview is seeded from a `.hbs` template, so it lands rendered at its
    // `.md` dest with real spec content and no Handlebars tags surviving. The
    // seeded overview deliberately carries no variant or seeding references, so
    // it must not name the variant it was rendered for.
    let overview = std::fs::read_to_string(seeded.path.join("specs/overview.md"))
        .expect("read seeded overview");
    assert!(
        overview.contains("# Carom"),
        "the rendered overview should carry the spec body: {overview}"
    );
    assert!(
        !overview.contains("{{"),
        "no unrendered Handlebars tags should remain in the seeded overview"
    );
    assert!(
        !overview.contains("**Base**"),
        "the seeded overview must not name the variant it was rendered for: {overview}"
    );
    // The base variant does not seed the frenzy mode spec.
    assert!(!seeded.path.join("specs/modes/frenzy.md").exists());
    // The rendered reference image is seeded as a visual target, with a notice.
    assert!(seeded.path.join("reference/title.png").is_file());
    assert!(seeded.path.join("reference/README.md").is_file());
    // The reference *source* mockup is never seeded (the base variant's title
    // menu source is `menu-base.html`).
    assert!(!seeded.path.join("reference/menu-base.html").exists());
    // A single initial commit exists, with no remote and a recorded hash.
    assert!(!seeded.initial_commit.is_empty());
    assert!(seeded.path.join(".git").is_dir());
}

/// Materialize a throwaway catalog holding a single `demo@v1.0.0` whose manifest
/// is `manifest`, alongside the handful of source files the manifests below
/// reference (a prompt, one spec, and three reference mockups). Each entry in
/// `variant_files` is written under `variants/` (a `(file_name, body)` pair), so a
/// manifest's `variants = [...]` list resolves. Returns the tempdir (kept alive by
/// the caller) and a catalog rooted at it.
fn temp_catalog(
    manifest: &str,
    variant_files: &[(&str, &str)],
) -> (tempfile::TempDir, TestCaseCatalog) {
    let dir = tempfile::tempdir().expect("temp dir");
    let version = dir.path().join("demo").join("v1.0.0");
    std::fs::create_dir_all(version.join("reference")).expect("create version dir");
    std::fs::create_dir_all(version.join("variants")).expect("create variants dir");
    std::fs::write(version.join("test-case.toml"), manifest).expect("write manifest");
    std::fs::write(version.join("prompt.hbs"), "Build in {{workspace}}.").expect("write prompt");
    std::fs::write(version.join("overview.md"), "# Overview").expect("write spec");
    for name in ["menu-base.html", "menu-frenzy.html", "gameplay.html"] {
        std::fs::write(version.join("reference").join(name), "<html></html>").expect("write ref");
    }
    for (name, body) in variant_files {
        std::fs::write(version.join("variants").join(name), body).expect("write variant");
    }
    let catalog = TestCaseCatalog::new(dir.path().to_path_buf());
    (dir, catalog)
}

/// The shared head of the demo manifests: metadata, prompt, the required `[build]`
/// table, one common spec, and one common domain. Variants live in their own
/// files under `variants/` and are listed by each test's `variants = [...]` key
/// (which, as a root key, is prepended before this head's `[build]` table).
const DEMO_HEAD: &str = r#"
name = "Demo"
difficulty = "easy"
tags = []
prompt = "prompt.hbs"
[build]
install = "npm ci"
build = "npm run build"
[[spec]]
source = "overview.md"
dest = "specs/overview.md"
[[domain]]
id = "gameplay"
description = "Core gameplay."
"#;

/// A `variants/base.toml` body declaring a `base` variant with a `title` mockup.
const VARIANT_BASE_TITLE: &str =
    "slug = \"base\"\nreference = [{ view = \"title\", path = \"reference/menu-base.html\" }]\n";
/// A `variants/frenzy.toml` body declaring a `frenzy` variant with a `title` mockup.
const VARIANT_FRENZY_TITLE: &str = "slug = \"frenzy\"\nreference = [{ view = \"title\", path = \"reference/menu-frenzy.html\" }]\n";

#[test]
fn resolves_common_and_variant_specific_references() {
    // `gameplay` is common to both variants; `title` is variant-specific, with a
    // different mockup per variant.
    let manifest = format!(
        "variants = [\"variants/base.toml\", \"variants/frenzy.toml\"]
{DEMO_HEAD}
[[reference]]
view = \"gameplay\"
path = \"reference/gameplay.html\"
[[check]]
view = \"title\"
reference = \"title\"
"
    );
    let (_dir, catalog) = temp_catalog(
        &manifest,
        &[
            ("base.toml", VARIANT_BASE_TITLE),
            ("frenzy.toml", VARIANT_FRENZY_TITLE),
        ],
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve demo");

    // The common references carry only `gameplay`; each variant supplies its own
    // `title`, and `references_for` chains them in order.
    let common: Vec<&str> = version
        .common_references
        .iter()
        .map(|r| r.view.as_str())
        .collect();
    assert_eq!(common, ["gameplay"]);
    let base = version.variant("base").expect("base variant");
    let base_views: Vec<String> = version
        .references_for(base)
        .iter()
        .map(|r| r.view.clone())
        .collect();
    assert_eq!(base_views, ["gameplay", "title"]);
    // The base and frenzy `title` references resolve to their own mockups.
    assert!(base.references[0].source_path.ends_with("menu-base.html"));
    let frenzy = version.variant("frenzy").expect("frenzy variant");
    assert!(
        frenzy.references[0]
            .source_path
            .ends_with("menu-frenzy.html")
    );
}

#[test]
fn defaults_the_runtime_cap_when_the_manifest_omits_it() {
    // `DEMO_HEAD` declares no `max_runtime_hours`, so resolution falls back to
    // the one-hour default rather than leaving the run unbounded.
    let manifest = format!("variants = [\"variants/base.toml\"]\n{DEMO_HEAD}");
    let (_dir, catalog) = temp_catalog(&manifest, &[("base.toml", "slug = \"base\"\n")]);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve demo");
    assert_eq!(version.max_runtime_seconds, 3600);
}

#[test]
fn rejects_a_zero_runtime_cap() {
    // A zero cap would stop every run instantly, so it is rejected rather than
    // silently accepted.
    // The cap key must precede `DEMO_HEAD`'s `[[spec]]` table so it parses as a
    // top-level field rather than an (ignored) key inside that table.
    let manifest =
        format!("max_runtime_hours = 0\nvariants = [\"variants/base.toml\"]\n{DEMO_HEAD}");
    let (_dir, catalog) = temp_catalog(&manifest, &[("base.toml", "slug = \"base\"\n")]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a zero runtime cap must be rejected");
    assert!(
        err.to_string().contains("max_runtime_hours"),
        "error should explain the invalid cap: {err}"
    );
}

#[test]
fn rejects_a_view_declared_both_commonly_and_by_a_variant() {
    // `title` cannot be both a common reference and one a variant declares: the
    // two would clobber each other when rendered and seeded together.
    let manifest = format!(
        "variants = [\"variants/base.toml\"]
{DEMO_HEAD}
[[reference]]
view = \"title\"
path = \"reference/gameplay.html\"
"
    );
    let (_dir, catalog) = temp_catalog(&manifest, &[("base.toml", VARIANT_BASE_TITLE)]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a view both common and variant-specific must be rejected");
    assert!(
        err.to_string().contains("same view `title`"),
        "error should explain the colliding view: {err}"
    );
}

#[test]
fn rejects_a_check_whose_view_a_variant_does_not_declare() {
    // Only `base` declares `title`; the check's baseline could not be rendered for
    // the `frenzy` variant, so resolution rejects the manifest.
    let manifest = format!(
        "variants = [\"variants/base.toml\", \"variants/frenzy.toml\"]
{DEMO_HEAD}
[[check]]
view = \"title\"
reference = \"title\"
"
    );
    let (_dir, catalog) = temp_catalog(
        &manifest,
        &[
            ("base.toml", VARIANT_BASE_TITLE),
            ("frenzy.toml", "slug = \"frenzy\"\n"),
        ],
    );
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a check unsatisfiable for some variant must be rejected");
    let message = err.to_string();
    assert!(
        message.contains("variant `frenzy` does not declare"),
        "error should name the variant missing the checked view: {err}"
    );
}

#[test]
fn resolves_adversarial_pacman_from_its_manifest() {
    // Foray (on-disk slug `adversarial-pacman`) is the first ADVERSARIAL case. It
    // must resolve through the real catalog under the adversarial validation: the
    // type discriminator selects the adversarial tables, and each
    // ([build].module / [contract] / [sandbox] / [simulation] / [match] / [replay])
    // resolves rather than being rejected as an end-to-end manifest would be.
    let catalog = TestCaseCatalog::new(catalog_root());

    // The case is listed alongside the end-to-end cases (the catalog list item
    // carries the slug and its versions; the type is surfaced once resolved).
    let cases = catalog.list().expect("list catalog");
    let listed = cases
        .iter()
        .find(|c| c.slug == "adversarial-pacman")
        .expect("adversarial-pacman should be listed");
    assert!(
        listed.versions.iter().any(|v| v == "v1.0.0"),
        "adversarial-pacman should list its v1.0.0 version"
    );

    let version = catalog
        .resolve("adversarial-pacman", "v1.0.0")
        .expect("resolve adversarial-pacman v1.0.0");
    assert_eq!(version.slug, "adversarial-pacman");
    // The in-fiction title is "Foray" while the on-disk slug stays
    // `adversarial-pacman`.
    assert_eq!(version.name, "Foray");
    assert_eq!(version.test_type, TestType::Adversarial);
    assert_eq!(version.difficulty, "hard");

    // The adversarial build emits a wasm controller module the validator loads as
    // the submission — `build.module` is resolved (it is rejected on other types).
    let build = version
        .build
        .as_ref()
        .expect("adversarial case has a build");
    assert_eq!(
        build.module.as_deref(),
        Some(Path::new(
            "target/wasm32-unknown-unknown/release/controller.wasm"
        )),
        "the wasm controller artifact path is resolved from [build].module"
    );

    // The controller contract resolves, and its `world`/`action` schemas are seeded
    // as common specs at the dests the contract names (so the model reads them
    // there).
    let contract = version
        .contract
        .as_ref()
        .expect("adversarial case has a [contract]");
    assert_eq!(contract.entry, "tick");
    let world = contract
        .world
        .as_ref()
        .expect("adversarial contract has a world schema");
    let action = contract
        .action
        .as_ref()
        .expect("adversarial contract has an action schema");
    assert_eq!(world, Path::new("schemas/world.json"));
    assert_eq!(action, Path::new("schemas/action.json"));
    for dest in [world, action] {
        assert!(
            version.common_specs.iter().any(|spec| &spec.dest == dest),
            "the contract schema {} should be seeded as a common spec",
            dest.display()
        );
    }

    // The per-tick sandbox limits, the simulation loop, the match structure, and
    // the browser replay renderer all resolve.
    let sandbox = version.sandbox.expect("adversarial case has a [sandbox]");
    assert_eq!(sandbox.fuel_per_tick, Some(50_000_000));
    assert_eq!(sandbox.fuel_limit, None);
    assert_eq!(sandbox.max_memory_bytes, 67_108_864);

    let simulation = version
        .simulation
        .expect("adversarial case has a [simulation]");
    assert_eq!(simulation.timestep_ms, 16);
    assert_eq!(simulation.max_ticks, 37_500);

    let r#match = version
        .r#match
        .as_ref()
        .expect("adversarial case has a [match]");
    assert_eq!(r#match.participants, 2);
    assert_eq!(r#match.structure, "round-robin");
    assert_eq!(r#match.rounds, 1);

    let replay = version
        .replay
        .as_ref()
        .expect("adversarial case has a [replay]");
    assert_eq!(replay.renderer, Path::new("replay/index.html"));

    // v1 ships a single `base` variant scored against the committed baseline.
    let variant_slugs: Vec<&str> = version.variants.iter().map(|v| v.slug.as_str()).collect();
    assert_eq!(variant_slugs, ["base"]);

    // An adversarial case carries no end-to-end/asset-generation tables.
    assert!(version.canvas.is_none());
    assert!(version.tool.is_none());
    assert!(version.output.is_none());
    // Its decisive signal is the recorded match, not a per-view check.
    assert!(version.checks.is_empty());
    // The single qualitative scoring domain a human review works through.
    let domain_ids: Vec<&str> = version.domains.iter().map(|d| d.id.as_str()).collect();
    assert_eq!(domain_ids, ["play"]);
}

#[test]
fn resolves_lattice_performance_from_its_manifest() {
    // Lattice (on-disk slug `performance-factorio`) is the first PERFORMANCE case.
    // It must resolve through the real catalog under the performance validation:
    // the type discriminator selects the performance tables ([build].module /
    // [contract] input+output / [sandbox] fuel_limit / the [[case]] scored set) and
    // forbids the adversarial loop tables, so a manifest that confused the two would
    // be rejected here.
    let catalog = TestCaseCatalog::new(catalog_root());

    let cases = catalog.list().expect("list catalog");
    let listed = cases
        .iter()
        .find(|c| c.slug == "performance-factorio")
        .expect("performance-factorio should be listed");
    assert!(
        listed.versions.iter().any(|v| v == "v1.0.0"),
        "performance-factorio should list its v1.0.0 version"
    );

    let version = catalog
        .resolve("performance-factorio", "v1.0.0")
        .expect("resolve performance-factorio v1.0.0");
    assert_eq!(version.slug, "performance-factorio");
    // The in-fiction title is "Lattice" while the on-disk slug stays
    // `performance-factorio`.
    assert_eq!(version.name, "Lattice");
    assert_eq!(version.test_type, TestType::Performance);
    assert_eq!(version.difficulty, "hard");

    // The performance build emits a wasm engine module the validator loads as the
    // submission — `build.module` is resolved (it is rejected on end-to-end types).
    let build = version
        .build
        .as_ref()
        .expect("performance case has a build");
    assert_eq!(
        build.module.as_deref(),
        Some(Path::new(
            "target/wasm32-unknown-unknown/release/engine.wasm"
        )),
        "the wasm engine artifact path is resolved from [build].module"
    );

    // The engine contract resolves with the once-per-scenario entry and the
    // `input`/`output` schemas (not the adversarial `world`/`action`), and the two
    // schemas are seeded as common specs at the dests the contract names.
    let contract = version
        .contract
        .as_ref()
        .expect("performance case has a [contract]");
    assert_eq!(contract.entry, "simulate");
    assert!(
        contract.world.is_none() && contract.action.is_none(),
        "a performance contract carries no world/action schemas"
    );
    let input = contract
        .input
        .as_ref()
        .expect("performance contract has an input schema");
    let output = contract
        .output
        .as_ref()
        .expect("performance contract has an output schema");
    assert_eq!(input, Path::new("schemas/scenario.json"));
    assert_eq!(output, Path::new("schemas/state.json"));
    for dest in [input, output] {
        assert!(
            version.common_specs.iter().any(|spec| &spec.dest == dest),
            "the contract schema {} should be seeded as a common spec",
            dest.display()
        );
    }

    // The per-scenario sandbox limits resolve: a `fuel_limit` (not a per-tick
    // budget) and a memory cap.
    let sandbox = version.sandbox.expect("performance case has a [sandbox]");
    assert_eq!(sandbox.fuel_limit, Some(5_000_000_000));
    assert_eq!(sandbox.fuel_per_tick, None);
    assert_eq!(sandbox.max_memory_bytes, 268_435_456);

    // The held-out scored set resolves: the three [[case]] entries, each an
    // input/expected pair that exists inside the version folder (and is NOT seeded).
    assert_eq!(version.cases.len(), 3, "small/medium/large scored cases");
    for case in &version.cases {
        assert!(
            case.input.is_file(),
            "scored case input {} should exist",
            case.input.display()
        );
        assert!(
            case.expected.is_file(),
            "scored case expected {} should exist",
            case.expected.display()
        );
        // The scored set is never seeded into a run (it is the held-out test half).
        let seeded_input = version
            .common_specs
            .iter()
            .any(|spec| spec.source_path == case.input);
        assert!(!seeded_input, "scored cases must not be seeded");
    }

    // A performance case carries none of the adversarial loop tables or the
    // end-to-end/asset-generation tables, and no per-view checks.
    assert!(version.simulation.is_none());
    assert!(version.r#match.is_none());
    assert!(version.replay.is_none());
    assert!(version.canvas.is_none());
    assert!(version.tool.is_none());
    assert!(version.output.is_none());
    assert!(version.checks.is_empty());

    // v1 ships a single `base` variant.
    let variant_slugs: Vec<&str> = version.variants.iter().map(|v| v.slug.as_str()).collect();
    assert_eq!(variant_slugs, ["base"]);

    // The single qualitative scoring domain a human review works through.
    let domain_ids: Vec<&str> = version.domains.iter().map(|d| d.id.as_str()).collect();
    assert_eq!(domain_ids, ["approach"]);
}

#[test]
fn resolves_sprite_sheet_cases_with_review_item_sequence_refs() {
    // The bundled sprite-sheet asset-generation cases resolve through the real
    // catalog, and their animation-centric review items name the sheet sequences
    // they are about so the reviewer UI can surface exactly those animations. Each
    // referenced slug must name a declared `[[sheet.sequence]]` — the resolution
    // that rejects an unknown slug is what makes this a real check of the manifests.
    let catalog = TestCaseCatalog::new(catalog_root());

    // (case, review item id, the sequence slugs it should reference).
    let expected: &[(&str, &str, &[&str])] = &[
        (
            "flarefish",
            "four-directions",
            &["walk-down", "walk-up", "walk-left", "walk-right"],
        ),
        (
            "gloamfin",
            "four-directions",
            &["walk-down", "walk-up", "walk-left", "walk-right"],
        ),
        (
            "lanternjaw",
            "four-directions",
            &["walk-down", "walk-up", "walk-left", "walk-right"],
        ),
        ("lanternjaw", "lure-bob-tell", &["lure-bob"]),
        (
            "glimmerfin",
            "four-directions",
            &["graze-down", "graze-up", "graze-left", "graze-right"],
        ),
        (
            "glimmerfin",
            "chomp",
            &["graze-down", "graze-up", "graze-left", "graze-right"],
        ),
        ("sonar-pulse", "expanding-wavefront", &["pulse"]),
        (
            "flare-bloom",
            "charge-to-bloom",
            &["flare-charge", "flare-bloom", "flare-fade"],
        ),
        (
            "trench-walls",
            "corners-junctions",
            &["corners", "junctions"],
        ),
    ];

    for (slug, item_id, sequences) in expected {
        let version = catalog
            .resolve_latest(slug)
            .unwrap_or_else(|e| panic!("resolve {slug}: {e}"));
        // The referenced items here are all common items, shared by every variant.
        let item = version
            .common_review_items
            .iter()
            .find(|item| &item.id == item_id)
            .unwrap_or_else(|| panic!("{slug} should declare review item `{item_id}`"));
        assert_eq!(
            item.sequences, *sequences,
            "{slug}/{item_id} should reference {sequences:?}"
        );
    }
}
