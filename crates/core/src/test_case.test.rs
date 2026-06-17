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
