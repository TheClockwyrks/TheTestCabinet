//! Tests for manifest resolution, focused on the `[build]` command table.

use std::fs;

use super::{BuildCommands, TestCaseCatalog};

/// Write a minimal resolvable version (`prompt.hbs` + `test-case.toml`) under a
/// fresh catalog and return both the temp dir (kept alive) and the catalog rooted
/// at it. `manifest_extra` is spliced between the required `name`/`prompt` header
/// and the single `base` variant, so a test can drop in a `[build]` table.
fn catalog_with_manifest(manifest_extra: &str) -> (tempfile::TempDir, TestCaseCatalog) {
    let dir = tempfile::tempdir().expect("temp dir");
    let version = dir.path().join("demo/v1.0.0");
    fs::create_dir_all(&version).expect("create version dir");
    fs::write(version.join("prompt.hbs"), "Build it.").expect("write prompt");
    let manifest = format!(
        "name = \"Demo\"\nprompt = \"prompt.hbs\"\n{manifest_extra}\n\
         [[variant]]\nslug = \"base\"\n"
    );
    fs::write(version.join("test-case.toml"), manifest).expect("write manifest");
    let catalog = TestCaseCatalog::new(dir.path());
    (dir, catalog)
}

#[test]
fn build_commands_default_to_npm_ci_and_run_build() {
    let (_dir, catalog) = catalog_with_manifest("");
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert_eq!(
        version.build,
        BuildCommands {
            install: "npm ci".to_string(),
            build: "npm run build".to_string(),
        }
    );
}

#[test]
fn build_table_overrides_the_commands() {
    let (_dir, catalog) = catalog_with_manifest(
        "[build]\ninstall = \"pnpm install --frozen-lockfile\"\nbuild = \"pnpm build\"",
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert_eq!(version.build.install, "pnpm install --frozen-lockfile");
    assert_eq!(version.build.build, "pnpm build");
}

#[test]
fn partial_build_table_inherits_the_other_default() {
    let (_dir, catalog) = catalog_with_manifest("[build]\nbuild = \"make site\"");
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    // `install` is omitted, so it falls back to the default while `build` wins.
    assert_eq!(version.build.install, "npm ci");
    assert_eq!(version.build.build, "make site");
}

#[test]
fn empty_build_command_is_rejected() {
    let (_dir, catalog) = catalog_with_manifest("[build]\ninstall = \"  \"");
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a blank build command is rejected");
    assert!(
        format!("{err}").contains("build.install must not be empty"),
        "unexpected error: {err}"
    );
}
