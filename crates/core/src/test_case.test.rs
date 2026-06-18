//! Tests for manifest resolution, focused on the `[build]` command table.

use std::fs;

use super::{BuildCommands, TestCaseCatalog};

/// Write a minimal resolvable version (`prompt.hbs` + `test-case.toml`) under a
/// fresh catalog and return both the temp dir (kept alive) and the catalog rooted
/// at it. `manifest_extra` is spliced between the required
/// `name`/`difficulty`/`tags`/`prompt` header and the single `base` variant, so a
/// test can drop in a `[build]` table.
fn catalog_with_manifest(manifest_extra: &str) -> (tempfile::TempDir, TestCaseCatalog) {
    let dir = tempfile::tempdir().expect("temp dir");
    let version = dir.path().join("demo/v1.0.0");
    fs::create_dir_all(&version).expect("create version dir");
    fs::write(version.join("prompt.hbs"), "Build it.").expect("write prompt");
    let manifest = format!(
        "name = \"Demo\"\ndifficulty = \"easy\"\ntags = []\nprompt = \"prompt.hbs\"\n{manifest_extra}\n\
         [[variant]]\nslug = \"base\"\n"
    );
    fs::write(version.join("test-case.toml"), manifest).expect("write manifest");
    let catalog = TestCaseCatalog::new(dir.path());
    (dir, catalog)
}

#[test]
fn build_table_is_required() {
    // No `[build]` table at all: there are no defaults, so resolution fails.
    let (_dir, catalog) = catalog_with_manifest("");
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a missing [build] table is rejected");
    assert!(
        format!("{err}").contains("the [build] table is required"),
        "unexpected error: {err}"
    );
}

#[test]
fn build_table_sets_the_commands() {
    let (_dir, catalog) = catalog_with_manifest(
        "[build]\ninstall = \"pnpm install --frozen-lockfile\"\nbuild = \"pnpm build\"",
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert_eq!(
        version.build,
        BuildCommands {
            install: "pnpm install --frozen-lockfile".to_string(),
            build: "pnpm build".to_string(),
        }
    );
}

#[test]
fn partial_build_table_is_rejected() {
    // The table is present but omits `install`: both commands must be stated, so
    // there is no default to fall back to and resolution fails.
    let (_dir, catalog) = catalog_with_manifest("[build]\nbuild = \"make site\"");
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a [build] table missing a command is rejected");
    assert!(
        format!("{err}").contains("install"),
        "unexpected error: {err}"
    );
}

#[test]
fn empty_build_command_is_rejected() {
    let (_dir, catalog) =
        catalog_with_manifest("[build]\ninstall = \"  \"\nbuild = \"npm run build\"");
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a blank build command is rejected");
    assert!(
        format!("{err}").contains("build.install must not be empty"),
        "unexpected error: {err}"
    );
}

/// A `[build]` table plus the given trailing TOML, for review-item tests that
/// also declare their own `[[variant]]` (the helper still appends a `base`).
fn build_and(extra: &str) -> String {
    format!("[build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n{extra}")
}

#[test]
fn resolves_common_and_variant_review_items() {
    let (_dir, catalog) = catalog_with_manifest(&build_and(
        "[[review_item]]\n\
         id = \"ball-spin\"\n\
         text = \"Swinging a paddle imparts spin on the ball.\"\n\n\
         [[variant]]\n\
         slug = \"frenzy\"\n\
         review_item = [{ id = \"frenzy-escalation\", text = \"Ball speed escalates uncapped.\" }]",
    ));
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");

    // The common item ships to every variant; the variant's own is additive.
    assert_eq!(version.common_review_items.len(), 1);
    assert_eq!(version.common_review_items[0].id, "ball-spin");

    let frenzy = version.variant("frenzy").expect("frenzy variant");
    let frenzy_items = version.review_items_for(frenzy);
    let ids: Vec<&str> = frenzy_items.iter().map(|i| i.id.as_str()).collect();
    assert_eq!(ids, ["ball-spin", "frenzy-escalation"]);

    // The appended `base` variant sees only the common item.
    let base = version.variant("base").expect("base variant");
    assert_eq!(version.review_items_for(base).len(), 1);
}

#[test]
fn a_review_item_id_colliding_across_common_and_variant_is_rejected() {
    let (_dir, catalog) = catalog_with_manifest(&build_and(
        "[[review_item]]\n\
         id = \"dup\"\n\
         text = \"A common item.\"\n\n\
         [[variant]]\n\
         slug = \"frenzy\"\n\
         review_item = [{ id = \"dup\", text = \"Collides with the common id.\" }]",
    ));
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a colliding review-item id is rejected");
    assert!(
        format!("{err}").contains("two review items with the same id `dup`"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_review_item_with_empty_text_is_rejected() {
    let (_dir, catalog) =
        catalog_with_manifest(&build_and("[[review_item]]\nid = \"x\"\ntext = \"\""));
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("an empty review-item text is rejected");
    assert!(
        format!("{err}").contains("has empty `text`"),
        "unexpected error: {err}"
    );
}
