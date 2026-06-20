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
         [[variant]]\nslug = \"base\"\n\
         [[domain]]\nid = \"gameplay\"\ndescription = \"Core gameplay.\"\n"
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
         title = \"Paddle spin\"\n\
         text = \"Swinging a paddle imparts spin on the ball.\"\n\
         weight = 1\n\n\
         [[variant]]\n\
         slug = \"frenzy\"\n\
         review_item = [{ id = \"frenzy-escalation\", title = \"Frenzy escalation\", text = \"Ball speed escalates uncapped.\", weight = 1 }]",
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
         title = \"A common item\"\n\
         text = \"A common item.\"\n\
         weight = 1\n\n\
         [[variant]]\n\
         slug = \"frenzy\"\n\
         review_item = [{ id = \"dup\", title = \"Collides\", text = \"Collides with the common id.\", weight = 1 }]",
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
    let (_dir, catalog) = catalog_with_manifest(&build_and(
        "[[review_item]]\nid = \"x\"\ntitle = \"X\"\ntext = \"\"\nweight = 1",
    ));
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("an empty review-item text is rejected");
    assert!(
        format!("{err}").contains("has empty `text`"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_review_item_with_empty_title_is_rejected() {
    let (_dir, catalog) = catalog_with_manifest(&build_and(
        "[[review_item]]\nid = \"x\"\ntitle = \"\"\ntext = \"Some prose.\"\nweight = 1",
    ));
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("an empty review-item title is rejected");
    assert!(
        format!("{err}").contains("has empty `title`"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_review_item_with_zero_weight_is_rejected() {
    let (_dir, catalog) = catalog_with_manifest(&build_and(
        "[[review_item]]\nid = \"x\"\ntitle = \"X\"\ntext = \"Some prose.\"\nweight = 0",
    ));
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a zero-weight review item is rejected");
    assert!(
        format!("{err}").contains("`weight` greater than zero"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_review_item_naming_an_undeclared_domain_is_rejected() {
    let (_dir, catalog) = catalog_with_manifest(&build_and(
        "[[review_item]]\nid = \"x\"\ntitle = \"X\"\ntext = \"Some prose.\"\nweight = 1\ndomain = \"nope\"",
    ));
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("an undeclared domain reference is rejected");
    assert!(
        format!("{err}").contains("names domain `nope`"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_case_with_no_domains_is_rejected() {
    // `catalog_with_files` supplies the whole manifest, so we can omit domains.
    let manifest = format!(
        "name = \"Demo\"\ndifficulty = \"easy\"\ntags = []\nprompt = \"prompt.hbs\"\n\
         [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         [[variant]]\nslug = \"base\"\n"
    );
    let (_dir, catalog) = catalog_with_files(&manifest, &[]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a case with no domains is rejected");
    assert!(
        format!("{err}").contains("at least one [[domain]]"),
        "unexpected error: {err}"
    );
}

#[test]
fn resolves_domains_with_humanized_default_names() {
    let manifest = format!(
        "name = \"Demo\"\ndifficulty = \"easy\"\ntags = []\nprompt = \"prompt.hbs\"\n\
         [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         [[variant]]\nslug = \"base\"\n\
         [[domain]]\nid = \"single-player\"\ndescription = \"Solo play.\"\n\
         [[domain]]\nid = \"versus\"\nname = \"Versus Mode\"\ndescription = \"Two-player play.\"\n"
    );
    let (_dir, catalog) = catalog_with_files(&manifest, &[]);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert_eq!(version.domains.len(), 2);
    // The first domain has no `name`, so it is humanized from its id.
    assert_eq!(version.domains[0].id, "single-player");
    assert_eq!(version.domains[0].name, "Single Player");
    // The second supplies an explicit name.
    assert_eq!(version.domains[1].name, "Versus Mode");
}

/// Write a `demo/v1.0.0` version with the given manifest and supporting files
/// (relative path -> contents), returning the temp dir (kept alive) and a
/// catalog rooted at it. Unlike [`catalog_with_manifest`], the caller supplies
/// the whole manifest, so it can place top-level keys (`workspace`, `init`)
/// before the `[build]` table, and can seed the workspace directory the manifest
/// points at.
fn catalog_with_files(
    manifest: &str,
    files: &[(&str, &str)],
) -> (tempfile::TempDir, TestCaseCatalog) {
    let dir = tempfile::tempdir().expect("temp dir");
    let version = dir.path().join("demo/v1.0.0");
    fs::create_dir_all(&version).expect("create version dir");
    fs::write(version.join("prompt.hbs"), "Build it.").expect("write prompt");
    for (path, contents) in files {
        let full = version.join(path);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(full, contents).expect("write file");
    }
    fs::write(version.join("test-case.toml"), manifest).expect("write manifest");
    let catalog = TestCaseCatalog::new(dir.path());
    (dir, catalog)
}

/// The required header plus a `[build]` table, with `body` (top-level keys and
/// tables) spliced in between so a test can declare `workspace`/`init` before the
/// build table and append variants/specs after it.
fn manifest_with(body: &str, after_build: &str) -> String {
    format!(
        "name = \"Demo\"\ndifficulty = \"easy\"\ntags = []\nprompt = \"prompt.hbs\"\n\
         {body}\
         [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         {after_build}\n\
         [[domain]]\nid = \"gameplay\"\ndescription = \"Core gameplay.\"\n"
    )
}

#[test]
fn workspace_files_resolve_with_run_relative_dests_and_init() {
    let manifest = manifest_with(
        "workspace = \"workspaces/base\"\ninit = \"npm install\"\n",
        "[[variant]]\nslug = \"base\"\n",
    );
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[
            ("workspaces/base/package.json", "{}"),
            ("workspaces/base/src/main.ts", "// entry"),
        ],
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");

    // The init command is carried through verbatim.
    assert_eq!(version.init.as_deref(), Some("npm install"));
    // Each workspace file's dest is its path relative to the workspace dir, so it
    // seeds at the run root.
    let dests: Vec<String> = version
        .common_workspace
        .iter()
        .map(|f| f.dest.display().to_string())
        .collect();
    assert!(dests.contains(&"package.json".to_string()), "{dests:?}");
    assert!(dests.contains(&"src/main.ts".to_string()), "{dests:?}");
    // A variant with no override inherits the common workspace.
    let base = version.variant("base").expect("base");
    assert_eq!(version.workspace_for(base).len(), 2);
}

#[test]
fn workspace_dotfiles_are_not_seeded() {
    // A dotfile in the workspace is skipped (matching how the backend copies a
    // version into its store), so it is not listed as a seeded workspace file.
    let manifest = manifest_with(
        "workspace = \"workspaces/base\"\n",
        "[[variant]]\nslug = \"base\"\n",
    );
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[
            ("workspaces/base/package.json", "{}"),
            ("workspaces/base/.gitignore", "node_modules/"),
        ],
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let dests: Vec<String> = version
        .common_workspace
        .iter()
        .map(|f| f.dest.display().to_string())
        .collect();
    assert_eq!(
        dests,
        ["package.json"],
        "dotfiles must be skipped: {dests:?}"
    );
}

#[test]
fn a_variant_workspace_overrides_the_common_one() {
    let manifest = manifest_with(
        "workspace = \"workspaces/base\"\n",
        "[[variant]]\nslug = \"base\"\n\
         [[variant]]\nslug = \"special\"\nworkspace = \"workspaces/special\"\n",
    );
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[
            ("workspaces/base/package.json", "{\"name\":\"base\"}"),
            ("workspaces/special/package.json", "{\"name\":\"special\"}"),
            ("workspaces/special/extra.txt", "x"),
        ],
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let base = version.variant("base").expect("base");
    let special = version.variant("special").expect("special");

    // The override replaces the common workspace rather than layering on it.
    assert_eq!(version.workspace_for(base).len(), 1);
    let special_dests: Vec<String> = version
        .workspace_for(special)
        .iter()
        .map(|f| f.dest.display().to_string())
        .collect();
    assert!(
        special_dests.contains(&"extra.txt".to_string()),
        "{special_dests:?}"
    );
    assert!(!special_dests.contains(&"package.json".to_string()) || special_dests.len() == 2);
}

#[test]
fn a_workspace_file_colliding_with_a_spec_dest_is_rejected() {
    // The workspace ships a file at the same dest a spec seeds to; the two would
    // clobber each other, so resolution rejects it.
    let manifest = manifest_with(
        "workspace = \"workspaces/base\"\n",
        "[[spec]]\nsource = \"overview.md\"\ndest = \"specs/overview.md\"\n\
         [[variant]]\nslug = \"base\"\n",
    );
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[
            ("overview.md", "# Overview"),
            ("workspaces/base/specs/overview.md", "clobber"),
        ],
    );
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a workspace/spec dest collision is rejected");
    assert!(
        format!("{err}").contains("same dest"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_blank_init_command_is_rejected() {
    let manifest = manifest_with("init = \"   \"\n", "[[variant]]\nslug = \"base\"\n");
    let (_dir, catalog) = catalog_with_files(&manifest, &[]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a blank init command is rejected");
    assert!(
        format!("{err}").contains("init must not be empty"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_missing_workspace_directory_is_rejected() {
    let manifest = manifest_with(
        "workspace = \"workspaces/base\"\n",
        "[[variant]]\nslug = \"base\"\n",
    );
    // The manifest points at a workspace dir that was never created.
    let (_dir, catalog) = catalog_with_files(&manifest, &[]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a missing workspace directory is rejected");
    assert!(
        format!("{err}").contains("workspace"),
        "unexpected error: {err}"
    );
}
