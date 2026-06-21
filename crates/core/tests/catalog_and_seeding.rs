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
    // The case declares its own harness runtime cap, bounding a run by 30 minutes.
    assert_eq!(version.max_runtime_seconds, 1800);
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
/// reference (a prompt, one spec, and three reference mockups). Returns the
/// tempdir (kept alive by the caller) and a catalog rooted at it.
fn temp_catalog(manifest: &str) -> (tempfile::TempDir, TestCaseCatalog) {
    let dir = tempfile::tempdir().expect("temp dir");
    let version = dir.path().join("demo").join("v1.0.0");
    std::fs::create_dir_all(version.join("reference")).expect("create version dir");
    std::fs::write(version.join("test-case.toml"), manifest).expect("write manifest");
    std::fs::write(version.join("prompt.hbs"), "Build in {{workspace}}.").expect("write prompt");
    std::fs::write(version.join("overview.md"), "# Overview").expect("write spec");
    for name in ["menu-base.html", "menu-frenzy.html", "gameplay.html"] {
        std::fs::write(version.join("reference").join(name), "<html></html>").expect("write ref");
    }
    let catalog = TestCaseCatalog::new(dir.path().to_path_buf());
    (dir, catalog)
}

/// The shared head of the demo manifests: metadata, prompt, the required `[build]`
/// table, and one common spec.
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

#[test]
fn resolves_common_and_variant_specific_references() {
    // `gameplay` is common to both variants; `title` is variant-specific, with a
    // different mockup per variant.
    let manifest = format!(
        "{DEMO_HEAD}
[[variant]]
slug = \"base\"
reference = [{{ view = \"title\", path = \"reference/menu-base.html\" }}]
[[variant]]
slug = \"frenzy\"
reference = [{{ view = \"title\", path = \"reference/menu-frenzy.html\" }}]
[[reference]]
view = \"gameplay\"
path = \"reference/gameplay.html\"
[[check]]
view = \"title\"
reference = \"title\"
"
    );
    let (_dir, catalog) = temp_catalog(&manifest);
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
    // `DEMO_HEAD` declares no `max_runtime_seconds`, so resolution falls back to
    // the one-hour default rather than leaving the run unbounded.
    let manifest = format!("{DEMO_HEAD}[[variant]]\nslug = \"base\"\n");
    let (_dir, catalog) = temp_catalog(&manifest);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve demo");
    assert_eq!(version.max_runtime_seconds, 3600);
}

#[test]
fn rejects_a_zero_runtime_cap() {
    // A zero cap would stop every run instantly, so it is rejected rather than
    // silently accepted.
    // The cap key must precede `DEMO_HEAD`'s `[[spec]]` table so it parses as a
    // top-level field rather than an (ignored) key inside that table.
    let manifest = format!("max_runtime_seconds = 0\n{DEMO_HEAD}[[variant]]\nslug = \"base\"\n");
    let (_dir, catalog) = temp_catalog(&manifest);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a zero runtime cap must be rejected");
    assert!(
        err.to_string().contains("max_runtime_seconds"),
        "error should explain the invalid cap: {err}"
    );
}

#[test]
fn rejects_a_view_declared_both_commonly_and_by_a_variant() {
    // `title` cannot be both a common reference and one a variant declares: the
    // two would clobber each other when rendered and seeded together.
    let manifest = format!(
        "{DEMO_HEAD}
[[variant]]
slug = \"base\"
reference = [{{ view = \"title\", path = \"reference/menu-base.html\" }}]
[[reference]]
view = \"title\"
path = \"reference/gameplay.html\"
"
    );
    let (_dir, catalog) = temp_catalog(&manifest);
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
        "{DEMO_HEAD}
[[variant]]
slug = \"base\"
reference = [{{ view = \"title\", path = \"reference/menu-base.html\" }}]
[[variant]]
slug = \"frenzy\"
[[check]]
view = \"title\"
reference = \"title\"
"
    );
    let (_dir, catalog) = temp_catalog(&manifest);
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
    assert_eq!(contract.world, Path::new("schemas/world.json"));
    assert_eq!(contract.action, Path::new("schemas/action.json"));
    for dest in [&contract.world, &contract.action] {
        assert!(
            version.common_specs.iter().any(|spec| &spec.dest == dest),
            "the contract schema {} should be seeded as a common spec",
            dest.display()
        );
    }

    // The per-tick sandbox limits, the simulation loop, the match structure, and
    // the browser replay renderer all resolve.
    let sandbox = version.sandbox.expect("adversarial case has a [sandbox]");
    assert_eq!(sandbox.fuel_per_tick, 5_000_000);
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
