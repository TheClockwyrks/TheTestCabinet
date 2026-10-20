use std::path::Path;

use super::{
    FsRepoSeeder, check_vendored_versions, init_repo, reserve_unique_dir, run_timestamp,
    seed_prior_game_jam_entries,
};
use crate::engine::{EngineSelection, ResolvedEngine};
use crate::run_record::PriorGameJamEntry;

/// The run timestamp is a fixed-width `YYYYMMDD-HHMMSS` stamp: eight digits, a
/// dash, then six digits, all numeric. This is what makes a directory listing
/// sort chronologically, so the shape is part of the contract.
#[test]
fn run_timestamp_is_a_fixed_width_sortable_stamp() {
    let stamp = run_timestamp();

    let (date, time) = stamp.split_once('-').expect("a date-time separator");
    assert_eq!(date.len(), 8, "date is YYYYMMDD: {stamp}");
    assert_eq!(time.len(), 6, "time is HHMMSS: {stamp}");
    assert!(
        stamp.chars().all(|c| c.is_ascii_digit() || c == '-'),
        "only digits and the separator: {stamp}"
    );
}

/// With no existing directory, the stem is reserved verbatim — no tiebreaker is
/// appended in the common case.
#[test]
fn reserve_unique_dir_uses_the_bare_stem_when_free() {
    let base = tempfile::tempdir().expect("temp dir");

    let reserved = reserve_unique_dir(base.path(), "pong-v1.0.0-20260615-120000")
        .expect("reserve a free name");

    assert_eq!(reserved, base.path().join("pong-v1.0.0-20260615-120000"));
    assert!(reserved.is_dir(), "the reserved directory is created");
}

/// When the bare stem and earlier tiebreakers are taken, reservation walks
/// `-1`, `-2`, … until it finds a free name and creates exactly that directory.
#[test]
fn reserve_unique_dir_appends_a_tiebreaker_on_collision() {
    let base = tempfile::tempdir().expect("temp dir");
    let stem = "pong-v1.0.0-20260615-120000";

    let first = reserve_unique_dir(base.path(), stem).expect("first reservation");
    let second = reserve_unique_dir(base.path(), stem).expect("second reservation");
    let third = reserve_unique_dir(base.path(), stem).expect("third reservation");

    assert_eq!(first, base.path().join(stem));
    assert_eq!(second, base.path().join(format!("{stem}-1")));
    assert_eq!(third, base.path().join(format!("{stem}-2")));
    for dir in [&first, &second, &third] {
        assert!(dir.is_dir(), "{} is created", dir.display());
    }
}

/// A game jam's earlier entries are written into `previous-entries/` — an index
/// plus one numbered file per entry, oldest first — carrying each prior README's
/// content.
#[test]
fn seed_prior_game_jam_entries_writes_an_indexed_folder() {
    let repo = tempfile::tempdir().expect("temp dir");
    let entries = vec![
        PriorGameJamEntry {
            run_id: "run-a".to_string(),
            finished_at: "2026-01-01T00:00:00Z".to_string(),
            readme: "# Space Miner\n\nDig for ore.".to_string(),
        },
        PriorGameJamEntry {
            run_id: "run-b".to_string(),
            finished_at: "2026-02-02T00:00:00Z".to_string(),
            readme: "# Tide Pool\n\nTend a pool.".to_string(),
        },
    ];

    seed_prior_game_jam_entries(repo.path(), &entries).expect("seed prior entries");

    let dir = repo.path().join("previous-entries");
    let index = std::fs::read_to_string(dir.join("README.md")).expect("index written");
    assert!(index.contains("entry-01.md"));
    assert!(index.contains("entry-02.md"));

    let first = std::fs::read_to_string(dir.join("entry-01.md")).expect("first entry");
    assert!(first.contains("Space Miner"), "oldest entry is first");
    let second = std::fs::read_to_string(dir.join("entry-02.md")).expect("second entry");
    assert!(second.contains("Tide Pool"));
}

/// The previous-entries folder is reference material, not part of the submission:
/// `init_repo` git-ignores it (via `.git/info/exclude`) so the seed commit does not
/// track it, while the files stay on disk for the model to read.
#[test]
fn init_repo_excludes_the_previous_entries_folder_from_git() {
    let repo = tempfile::tempdir().expect("temp dir");
    // A normal seeded file that must be committed.
    std::fs::write(repo.path().join("package.json"), "{}\n").expect("write package.json");
    seed_prior_game_jam_entries(
        repo.path(),
        &[PriorGameJamEntry {
            run_id: "run-a".to_string(),
            finished_at: "2026-01-01T00:00:00Z".to_string(),
            readme: "# Space Miner".to_string(),
        }],
    )
    .expect("seed prior entries");

    init_repo(repo.path()).expect("init repo");

    let tracked = std::process::Command::new("git")
        .args(["-C", repo.path().to_str().expect("utf-8 path"), "ls-files"])
        .output()
        .expect("git ls-files");
    let tracked = String::from_utf8_lossy(&tracked.stdout);
    assert!(
        tracked.contains("package.json"),
        "normal files are committed"
    );
    assert!(
        !tracked.contains("previous-entries"),
        "the previous-entries folder must not be tracked: {tracked}",
    );
    // The files remain on disk for the model to read during the run.
    assert!(repo.path().join("previous-entries/entry-01.md").exists());
}

/// gg's `.gg/` dotdir is excluded unconditionally, and — unlike the previous-entries
/// folder — it does not exist at seed time: the capture journal is created and grows
/// *while the session runs*, inside the model's working tree. So the property that
/// matters is that a seeded repository never reports it as a change, no matter when it
/// appears. If it ever did, the transcript would ride a speculation judge's diff, an
/// issue reviewer's diff stat, and the model's own `git add -A` into the public per-run
/// repository.
#[test]
fn init_repo_excludes_ggs_dotdir_from_git() {
    let repo = tempfile::tempdir().expect("temp dir");
    std::fs::write(repo.path().join("package.json"), "{}\n").expect("write package.json");

    init_repo(repo.path()).expect("init repo");

    // Everything gg writes under its dotdir, appearing *after* the seed commit.
    let gg = repo.path().join(crate::gg::GG_WORKSPACE_DIR);
    std::fs::create_dir_all(gg.join("skills")).expect("create .gg/skills");
    std::fs::write(gg.join("replay.ndjson"), "{\"type\":\"header\"}\n").expect("write journal");
    std::fs::write(gg.join("replay.json"), "{}\n").expect("write sidecar");
    std::fs::write(gg.join("skills").join("draw.md"), "# Draw\n").expect("write skill");
    // A file the model really did write, to prove the exclusion is not just "git sees
    // nothing at all".
    std::fs::write(repo.path().join("index.html"), "<!doctype html>\n").expect("write index.html");

    let status = git_stdout(repo.path(), &["status", "--porcelain"]);
    assert!(
        !status.contains(".gg"),
        "`git status --porcelain` must never list .gg/: {status}",
    );
    assert!(
        status.contains("index.html"),
        "the model's own new files are still reported: {status}",
    );

    // The model's own `git add -A` cannot pick it up either — the exclusion is what
    // keeps a verbatim transcript out of the published repository.
    git_stdout(repo.path(), &["add", "--all"]);
    let tracked = git_stdout(repo.path(), &["ls-files"]);
    assert!(
        !tracked.contains(".gg"),
        "`git add -A` must not stage .gg/: {tracked}",
    );
    assert!(tracked.contains("index.html"), "but does stage real work");
}

/// The exclusion in `init_repo` is anchored at the repository root and written from
/// [`crate::gg::GG_WORKSPACE_DIR`], so the journal path gg actually writes has to live
/// under that same directory or the exclusion silently stops covering it.
#[test]
fn the_replay_journal_lives_under_the_excluded_dotdir() {
    assert!(
        crate::gg_session_journal::GG_SESSION_JOURNAL_PATH
            .starts_with(&format!("{}/", crate::gg::GG_WORKSPACE_DIR)),
        "journal path {} must sit under {}",
        crate::gg_session_journal::GG_SESSION_JOURNAL_PATH,
        crate::gg::GG_WORKSPACE_DIR,
    );
}

// ---------------------------------------------------------------------------
// Engine seeding
// ---------------------------------------------------------------------------

/// A fake host package store holding the `simple-2d` engine package and the
/// `@clockwyrks` sibling it depends on, laid out exactly as
/// `scripts/stage-tcab-packages.mjs` stages them: each package under its scoped
/// name, siblings referenced by a relative `file:` path, build output in `dist/`.
///
/// `version` is what the engine package declares, since that is the value a run
/// records; `docs` controls whether the package carries the documentation
/// directory its manifest promises, so the missing-docs failure can be exercised.
fn fake_engine_store(version: &str, docs: bool) -> tempfile::TempDir {
    let store = tempfile::tempdir().expect("store dir");
    let engine = store.path().join("@clockwyrks/simple-2d");
    let dep = store.path().join("@clockwyrks/asset-contract");
    std::fs::create_dir_all(engine.join("dist")).expect("engine dist");
    std::fs::create_dir_all(dep.join("dist")).expect("dep dist");
    std::fs::write(
        engine.join("package.json"),
        format!(
            r#"{{
  "name": "@clockwyrks/simple-2d",
  "version": "{version}",
  "dependencies": {{ "@clockwyrks/asset-contract": "file:../asset-contract" }}
}}
"#
        ),
    )
    .expect("engine manifest");
    std::fs::write(engine.join("dist/index.js"), "// engine").expect("engine dist file");
    if docs {
        std::fs::create_dir_all(engine.join("docs")).expect("engine docs");
        std::fs::write(engine.join("docs/frame.md"), "# Frame\n").expect("engine docs file");
    }
    std::fs::write(
        dep.join("package.json"),
        r#"{"name":"@clockwyrks/asset-contract","version":"0.0.0"}"#,
    )
    .expect("dep manifest");
    std::fs::write(dep.join("dist/index.js"), "// types").expect("dep dist file");
    store
}

/// The `simple-2d` engine, resolved from the real embedded catalogue rather than
/// hand-built, so these tests fail if the shipped manifest stops naming a package
/// or a docs directory.
fn simple_2d() -> ResolvedEngine {
    crate::engine::built_in_catalog()
        .resolve(&EngineSelection::new("simple-2d"))
        .expect("simple-2d is a built-in engine")
}

/// A seeder that vendors out of `store`. The base directory is irrelevant to
/// vendoring — these tests drive it against a repository they created themselves,
/// rather than one `seed` reserved.
fn seeder_for(store: &tempfile::TempDir) -> (tempfile::TempDir, FsRepoSeeder) {
    let base = tempfile::tempdir().expect("seed base");
    let seeder = FsRepoSeeder::with_package_store(base.path(), store.path());
    (base, seeder)
}

/// The test case `vendor_engine` and the version check name in their failures.
const CASE: &str = "carom@v3.0.0";

/// Where an engine workspace declares the engine today, and where a version
/// written before lockfiles still declares it.
const VENDORED: &str = "file:./.vendor/packages/@clockwyrks/simple-2d";
const LEGACY: &str = "file:./.vendor/engine/@clockwyrks/simple-2d";

/// The engine workspace `package.json` a case ships, declaring the engine as
/// `spec`. Its keys are deliberately not in alphabetical order and it is indented
/// as its author left it, so any rewrite at all would show in a byte comparison.
fn shipped_package_json(spec: &str) -> String {
    format!(
        r#"{{
  "name": "carom",
  "private": true,
  "scripts": {{
    "build": "vite build"
  }},
  "dependencies": {{
    "vite": "^5.0.0",
    "@clockwyrks/simple-2d": "{spec}"
  }},
  "devDependencies": {{
    "typescript": "^5.0.0"
  }}
}}
"#
    )
}

/// The lockfile npm writes for [`shipped_package_json`] of `spec`, linking the
/// engine (locked at `engine`) and its sibling `asset-contract` (locked at
/// `contract`) at the vendored paths the spec names.
fn shipped_lockfile(spec: &str, engine: &str, contract: &str) -> String {
    let path = spec.strip_prefix("file:./").expect("an in-repo file: spec");
    let sibling = path.replace("simple-2d", "asset-contract");
    serde_json::to_string_pretty(&serde_json::json!({
        "name": "carom",
        "lockfileVersion": 3,
        "requires": true,
        "packages": {
            "": {
                "name": "carom",
                "dependencies": { "vite": "^5.0.0", "@clockwyrks/simple-2d": spec },
                "devDependencies": { "typescript": "^5.0.0" }
            },
            path: {
                "name": "@clockwyrks/simple-2d",
                "version": engine,
                "dependencies": { "@clockwyrks/asset-contract": "file:../asset-contract" }
            },
            sibling: { "name": "@clockwyrks/asset-contract", "version": contract },
            // What the install places below a vendored package is not a vendored
            // copy, so its version is never compared with anything.
            format!("{path}/node_modules/ts-essentials"): { "version": "10.0.0" },
            "node_modules/@clockwyrks/simple-2d": { "resolved": path, "link": true },
            "node_modules/vite": { "version": "5.0.0" },
            "node_modules/typescript": { "version": "5.0.0", "dev": true }
        }
    }))
    .expect("render the lockfile")
        + "\n"
}

/// A run repository holding the workspace `package.json` a case ships.
fn workspace_with_package_json(contents: &str) -> tempfile::TempDir {
    let repo = tempfile::tempdir().expect("repo dir");
    std::fs::write(repo.path().join("package.json"), contents).expect("write package.json");
    repo
}

/// The whole engine delivery in one pass: the package *and its transitive
/// `@clockwyrks` closure* land at the path the workspace declares, under
/// `.vendor/packages/`, the engine's own documentation lands at `engine/`, the
/// staged version comes back to be recorded on the run, and the workspace
/// `package.json` is byte-for-byte the file the case shipped.
#[test]
fn vendor_engine_vendors_the_closure_and_the_docs_at_the_declared_path() {
    let store = fake_engine_store("1.4.2", true);
    let (_base, seeder) = seeder_for(&store);
    let shipped = shipped_package_json(VENDORED);
    let repo = workspace_with_package_json(&shipped);

    let version = seeder
        .vendor_engine(repo.path(), &simple_2d(), CASE)
        .expect("vendor the engine");

    assert_eq!(
        version.as_deref(),
        Some("1.4.2"),
        "the recorded version is the one the staged package declares"
    );
    let vendored = repo.path().join(".vendor/packages/@clockwyrks");
    assert!(
        vendored.join("simple-2d/dist/index.js").is_file(),
        "the engine package is vendored at the declared path, build output included"
    );
    assert!(
        vendored.join("asset-contract/package.json").is_file(),
        "the transitive @clockwyrks dependency is vendored beside it, so the staged \
         package's relative `file:` link still resolves"
    );
    assert!(
        !repo.path().join(".vendor/engine").exists(),
        "nothing lands at a path the workspace does not declare"
    );
    assert_eq!(
        std::fs::read_to_string(repo.path().join("engine/frame.md")).expect("seeded engine docs"),
        "# Frame\n",
        "the engine's documentation is seeded where the prompt points the build"
    );
    assert_eq!(
        std::fs::read_to_string(repo.path().join("package.json")).expect("read package.json"),
        shipped,
        "the shipped `package.json` is never written"
    );
}

/// A version written before lockfiles declares its engine at the legacy
/// `.vendor/engine/` path, and still resolves; the engine is vendored there, where
/// its `package.json` points, rather than at today's path.
#[test]
fn vendor_engine_vendors_at_the_legacy_engine_path_a_workspace_declares() {
    let store = fake_engine_store("1.0.0", true);
    let (_base, seeder) = seeder_for(&store);
    let shipped = shipped_package_json(LEGACY);
    let repo = workspace_with_package_json(&shipped);

    seeder
        .vendor_engine(repo.path(), &simple_2d(), CASE)
        .expect("vendor the engine");

    let vendored = repo.path().join(".vendor/engine/@clockwyrks");
    assert!(vendored.join("simple-2d/dist/index.js").is_file());
    assert!(vendored.join("asset-contract/package.json").is_file());
    assert!(!repo.path().join(".vendor/packages").exists());
    assert_eq!(
        std::fs::read_to_string(repo.path().join("package.json")).expect("read package.json"),
        shipped,
    );
}

/// A dev dependency is as good a declaration as a dependency, and a spec spelled
/// without the leading `./` names the same path.
#[test]
fn vendor_engine_reads_a_dev_dependency_without_a_leading_dot() {
    let store = fake_engine_store("1.0.0", true);
    let (_base, seeder) = seeder_for(&store);
    let repo = workspace_with_package_json(
        r#"{"devDependencies":{"@clockwyrks/simple-2d":"file:.vendor/packages/@clockwyrks/simple-2d"}}"#,
    );

    seeder
        .vendor_engine(repo.path(), &simple_2d(), CASE)
        .expect("vendor the engine");

    assert!(
        repo.path()
            .join(".vendor/packages/@clockwyrks/simple-2d/package.json")
            .is_file()
    );
}

/// Every declaration the seeder cannot vendor at is refused before anything is
/// copied, naming the case, the engine package, and the spec to write instead: a
/// workspace that does not depend on the engine, one that names it only as a peer,
/// a registry range, a path outside `.vendor/`, one that climbs out of it, and one
/// whose last segments are not the package's name (the closure's relative links
/// would not resolve).
#[test]
fn vendor_engine_refuses_a_declaration_it_cannot_vendor_at() {
    let cases = [
        r#"{"dependencies":{"vite":"^5.0.0"}}"#.to_string(),
        r#"{"peerDependencies":{"@clockwyrks/simple-2d":"file:./.vendor/packages/@clockwyrks/simple-2d"}}"#.to_string(),
        shipped_package_json("^1.0.0"),
        shipped_package_json("file:./lib/@clockwyrks/simple-2d"),
        shipped_package_json("file:./.vendor/../lib/@clockwyrks/simple-2d"),
        shipped_package_json("file:./.vendor/packages/engine"),
    ];
    for shipped in cases {
        let store = fake_engine_store("1.0.0", true);
        let (_base, seeder) = seeder_for(&store);
        let repo = workspace_with_package_json(&shipped);

        let err = seeder
            .vendor_engine(repo.path(), &simple_2d(), CASE)
            .expect_err("an unusable declaration is refused");

        let message = err.to_string();
        assert!(message.contains(CASE), "{message}");
        assert!(message.contains("@clockwyrks/simple-2d"), "{message}");
        assert!(message.contains(VENDORED), "{message}");
        assert!(
            !repo.path().join(".vendor").exists(),
            "nothing is vendored for {shipped}"
        );
        assert_eq!(
            std::fs::read_to_string(repo.path().join("package.json")).expect("package.json"),
            shipped
        );
    }
}

/// Both vendored trees carry `dist/` subtrees, and a case's own `.gitignore`
/// ignores `dist/` for its build output. `init_repo` force-adds `.vendor/` so the
/// seed commit captures them: without it the published repository would install a
/// dependency whose code is not there — the case's packages and the run's engine
/// alike, at today's path and the legacy one.
#[test]
fn init_repo_commits_the_vendored_packages_and_engine_at_either_path() {
    for spec in [VENDORED, LEGACY] {
        let store = fake_engine_store("1.0.0", true);
        let (_base, seeder) = seeder_for(&store);
        let repo = workspace_with_package_json(&shipped_package_json(spec));
        std::fs::write(repo.path().join(".gitignore"), "node_modules/\ndist/\n")
            .expect("gitignore");
        seeder
            .vendor_packages(repo.path(), &["@clockwyrks/asset-contract".to_string()])
            .expect("vendor the case's packages");
        seeder
            .vendor_engine(repo.path(), &simple_2d(), CASE)
            .expect("vendor the engine");

        init_repo(repo.path()).expect("init repo");

        let tracked = git_stdout(repo.path(), &["ls-files"]);
        assert!(
            tracked.contains(".vendor/packages/@clockwyrks/asset-contract/dist/index.js"),
            "the case's vendored packages are committed despite `dist/`: {tracked}"
        );
        let engine = spec.strip_prefix("file:./").expect("in-repo spec");
        assert!(
            tracked.contains(&format!("{engine}/dist/index.js")),
            "the run's vendored engine is committed despite `dist/`: {tracked}"
        );
        assert!(
            tracked.contains("engine/frame.md"),
            "the seeded engine documentation is committed: {tracked}"
        );
        assert_eq!(git_stdout(repo.path(), &["status", "--porcelain"]), "");
    }
}

/// Every vendored tree the seeder writes lies under the root `init_repo` forces
/// into the seed commit.
#[test]
fn every_vendored_tree_lies_under_the_forced_vendor_root() {
    for dir in [
        crate::test_case::TCAB_VENDOR_DIR,
        crate::test_case::TCAB_ENGINE_DIR,
    ] {
        assert!(
            dir.starts_with(&format!("{}/", super::VENDOR_ROOT)),
            "{dir} must lie under {}",
            super::VENDOR_ROOT
        );
    }
}

/// The `none` engine is the whole point of the gate: it vendors nothing, seeds no
/// documentation, records no version, and leaves the workspace `package.json`
/// byte-for-byte as the case shipped it. A run under it is indistinguishable from
/// a run seeded before engines existed.
#[test]
fn vendor_engine_writes_nothing_for_an_engine_with_no_runtime() {
    let store = fake_engine_store("1.0.0", true);
    let (_base, seeder) = seeder_for(&store);
    let original = "{\n  \"name\": \"carom\",\n  \"dependencies\": {}\n}\n";
    let repo = workspace_with_package_json(original);
    let none = crate::engine::built_in_catalog()
        .resolve(&EngineSelection::none())
        .expect("`none` is a built-in engine");

    let version = seeder
        .vendor_engine(repo.path(), &none, CASE)
        .expect("vendoring nothing succeeds");

    assert_eq!(
        version, None,
        "an engine with no runtime records no version"
    );
    assert!(!repo.path().join(".vendor").exists(), "nothing is vendored");
    assert!(!repo.path().join("engine").exists(), "no docs are seeded");
    assert_eq!(
        std::fs::read_to_string(repo.path().join("package.json")).expect("read package.json"),
        original,
        "the shipped `package.json` is not even rewritten in place"
    );
}

/// An engine package that is not in the host store is an operator-facing failure,
/// not a run that quietly builds without its runtime. The message has to name the
/// staging script and the `TCAB_PACKAGE_STORE` override, because those are the two
/// ways to fix it.
#[test]
fn vendor_engine_errors_when_the_package_is_missing_from_the_store() {
    let store = tempfile::tempdir().expect("empty store");
    let base = tempfile::tempdir().expect("seed base");
    let seeder = FsRepoSeeder::with_package_store(base.path(), store.path());
    let repo = workspace_with_package_json(&shipped_package_json(VENDORED));

    let err = seeder
        .vendor_engine(repo.path(), &simple_2d(), CASE)
        .expect_err("a missing engine package is an error");

    let message = err.to_string();
    assert!(message.contains("@clockwyrks/simple-2d"), "{message}");
    assert!(message.contains("stage-tcab-packages.mjs"), "{message}");
    assert!(message.contains("TCAB_PACKAGE_STORE"), "{message}");
}

/// The engine version is recorded on the run and compared across months of runs,
/// so a staged package with no real `version` is refused rather than recorded as
/// something that is not true. The message names the package.
#[test]
fn vendor_engine_errors_when_the_staged_package_declares_no_version() {
    let store = fake_engine_store("1.0.0", true);
    std::fs::write(
        store.path().join("@clockwyrks/simple-2d/package.json"),
        r#"{"name":"@clockwyrks/simple-2d"}"#,
    )
    .expect("rewrite the engine manifest");
    let (_base, seeder) = seeder_for(&store);
    let repo = workspace_with_package_json(&shipped_package_json(VENDORED));

    let err = seeder
        .vendor_engine(repo.path(), &simple_2d(), CASE)
        .expect_err("a versionless engine package is an error");

    let message = err.to_string();
    assert!(message.contains("@clockwyrks/simple-2d"), "{message}");
    assert!(message.contains("version"), "{message}");
}

/// A docs directory the manifest promises but the package does not carry is an
/// error, because the rendered prompt points the build at `/work/engine`: seeding
/// past it would send the model to read documentation that is not there.
#[test]
fn vendor_engine_errors_when_the_declared_docs_are_missing() {
    let store = fake_engine_store("1.0.0", false);
    let (_base, seeder) = seeder_for(&store);
    let repo = workspace_with_package_json(&shipped_package_json(VENDORED));

    let err = seeder
        .vendor_engine(repo.path(), &simple_2d(), CASE)
        .expect_err("a missing docs directory is an error");

    let message = err.to_string();
    assert!(message.contains("simple-2d"), "{message}");
    assert!(message.contains("docs"), "{message}");
}

/// A case that supports an engine ships a workspace `package.json` per engine,
/// because that is the file that declares where the engine is vendored. Reaching
/// seeding without one means the case and the run disagree, so it fails loudly,
/// naming the case, rather than vendoring somewhere nothing points at.
#[test]
fn vendor_engine_errors_when_the_workspace_has_no_package_json() {
    let store = fake_engine_store("1.0.0", true);
    let (_base, seeder) = seeder_for(&store);
    let repo = tempfile::tempdir().expect("repo dir");

    let err = seeder
        .vendor_engine(repo.path(), &simple_2d(), CASE)
        .expect_err("a workspace with no package.json is an error");

    let message = err.to_string();
    assert!(message.contains(CASE), "{message}");
    assert!(message.contains("package.json"), "{message}");
    assert!(
        message.contains(crate::engine::NONE_SLUG),
        "the message says which cases are exempt: {message}"
    );
}

/// Vendor the engine declared at `spec` into a workspace shipping the lockfile
/// that locks it at `engine` and its sibling at `contract`, then run the version
/// check, out of a store staging the engine at `staged`.
fn check_after_vendoring(
    spec: &str,
    staged: &str,
    engine: &str,
    contract: &str,
) -> (tempfile::TempDir, crate::error::Result<()>) {
    let store = fake_engine_store(staged, true);
    let (_base, seeder) = seeder_for(&store);
    let repo = workspace_with_package_json(&shipped_package_json(spec));
    std::fs::write(
        repo.path().join("package-lock.json"),
        shipped_lockfile(spec, engine, contract),
    )
    .expect("write the lockfile");
    seeder
        .vendor_engine(repo.path(), &simple_2d(), CASE)
        .expect("vendor the engine");
    let result = check_vendored_versions(repo.path(), CASE, store.path());
    (repo, result)
}

/// A lockfile that links each vendored copy at the version the copy declares is
/// the case's lockfile describing the tree, at today's path and the legacy one.
#[test]
fn check_vendored_versions_accepts_a_lockfile_that_agrees_with_the_vendored_copies() {
    for spec in [VENDORED, LEGACY] {
        let (_repo, result) = check_after_vendoring(spec, "1.1.1", "1.1.1", "0.0.0");
        result.expect("the lockfile links the versions vendored");
    }
}

/// A store that stages a different engine version than the lockfile links is a
/// seeding error naming the case, the path, both versions and the store, so an
/// operator can tell a stale lockfile from a stale store.
#[test]
fn check_vendored_versions_rejects_a_version_the_lockfile_does_not_link() {
    let (_repo, result) = check_after_vendoring(VENDORED, "1.2.0", "1.1.1", "0.0.0");

    let message = result.expect_err("a mismatch is refused").to_string();
    assert!(message.contains(CASE), "{message}");
    assert!(
        message.contains(".vendor/packages/@clockwyrks/simple-2d"),
        "{message}"
    );
    assert!(message.contains("1.1.1"), "{message}");
    assert!(message.contains("1.2.0"), "{message}");
    assert!(message.contains("package store"), "{message}");
}

/// The closure is held to the lockfile too, not only the engine: a sibling locked
/// at another version is refused.
#[test]
fn check_vendored_versions_rejects_a_closure_sibling_at_another_version() {
    let (_repo, result) = check_after_vendoring(VENDORED, "1.1.1", "1.1.1", "0.2.1");

    let message = result
        .expect_err("a sibling mismatch is refused")
        .to_string();
    assert!(
        message.contains(".vendor/packages/@clockwyrks/asset-contract"),
        "{message}"
    );
    assert!(message.contains("0.2.1"), "{message}");
}

/// A lockfile that links a vendored path the seeder wrote nothing to — the engine
/// vendored at the legacy path while the lockfile links today's — is refused: the
/// install would link an empty directory.
#[test]
fn check_vendored_versions_rejects_a_linked_path_with_nothing_vendored() {
    let store = fake_engine_store("1.1.1", true);
    let (_base, seeder) = seeder_for(&store);
    let repo = workspace_with_package_json(&shipped_package_json(LEGACY));
    std::fs::write(
        repo.path().join("package-lock.json"),
        shipped_lockfile(VENDORED, "1.1.1", "0.0.0"),
    )
    .expect("write the lockfile");
    seeder
        .vendor_engine(repo.path(), &simple_2d(), CASE)
        .expect("vendor the engine");

    let message = check_vendored_versions(repo.path(), CASE, store.path())
        .expect_err("an empty linked path is refused")
        .to_string();
    assert!(
        message.contains("no versioned package was vendored there"),
        "{message}"
    );
}

/// A workspace without a lockfile is accepted unchecked (overview, "Init"): a
/// version written before lockfiles still seeds.
#[test]
fn check_vendored_versions_accepts_a_workspace_with_no_lockfile() {
    let store = fake_engine_store("1.0.0", true);
    let (_base, seeder) = seeder_for(&store);
    let repo = workspace_with_package_json(&shipped_package_json(LEGACY));
    seeder
        .vendor_engine(repo.path(), &simple_2d(), CASE)
        .expect("vendor the engine");

    check_vendored_versions(repo.path(), CASE, store.path()).expect("no lockfile is accepted");
}

/// A lockfile the seeder cannot read is a seeding error naming the case, not a
/// check silently skipped.
#[test]
fn check_vendored_versions_rejects_an_unreadable_lockfile() {
    let repo = workspace_with_package_json(&shipped_package_json(VENDORED));
    std::fs::write(
        repo.path().join("package-lock.json"),
        r#"{"lockfileVersion":1}"#,
    )
    .expect("write the lockfile");

    let message = check_vendored_versions(repo.path(), CASE, repo.path())
        .expect_err("a version 1 lockfile is refused")
        .to_string();
    assert!(message.contains(CASE), "{message}");
    assert!(message.contains("lockfileVersion"), "{message}");
}

/// Run a git command in `repo` and return its stdout, failing the test if git does.
fn git_stdout(repo: &Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .unwrap_or_else(|err| panic!("running `git {}`: {err}", args.join(" ")));
    assert!(
        output.status.success(),
        "git {} failed: {}",
        args.join(" "),
        String::from_utf8_lossy(&output.stderr),
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}

// --- the audio tool config --------------------------------------------------

/// Resolve an audio asset-generation case of `kind` declaring `packs` (the TOML
/// value, for example `["combat-core@0.1.0"]`), returning the resolved version. The
/// pack line is omitted entirely when `packs` is `None`, which is how a `sfx-synth`
/// case is authored.
fn audio_version(kind: &str, packs: Option<&str>) -> (tempfile::TempDir, crate::TestCaseVersion) {
    let dir = tempfile::tempdir().expect("temp dir");
    let version = dir.path().join("asset-generation/medium/clip/v1.0.0");
    std::fs::create_dir_all(version.join("specs")).expect("specs dir");
    std::fs::create_dir_all(version.join("variants")).expect("variants dir");
    std::fs::write(version.join("prompt.hbs"), "Make a sound.").expect("prompt");
    std::fs::write(version.join("changelog.md"), "Introduced.").expect("changelog");
    std::fs::write(version.join("specs/brief.md"), "The brief.").expect("brief");
    std::fs::write(version.join("variants/base.toml"), "slug = \"base\"\n").expect("variant");
    let packs_line = packs.map(|p| format!("packs = {p}\n")).unwrap_or_default();
    let manifest = format!(
        "slug = \"clip\"\nname = \"Clip\"\ndifficulty = \"medium\"\ntags = []\n\
         prompt = \"prompt.hbs\"\nchangelog = \"changelog.md\"\n\
         type = \"asset-generation\"\nasset_kind = \"{kind}\"\n\
         variants = [\"variants/base.toml\"]\n\
         [audio]\nsample_rate = 44100\nchannels = \"stereo\"\nmax_duration_ms = 5000\n\
         {packs_line}\
         [tool]\nbinary = \"{kind}\"\npreview = \"waveform.png\"\n\
         [output]\nactions = \"actions.json\"\n\
         [[spec]]\nsource = \"specs/brief.md\"\ndest = \"specs/brief.md\"\n\
         [[domain]]\nid = \"fidelity\"\ndescription = \"How close the clip is.\"\n"
    );
    std::fs::write(version.join("test-case.toml"), manifest).expect("manifest");
    let catalog =
        crate::test_case::TestCaseCatalog::new(dir.path(), crate::engine::built_in_catalog());
    let resolved = catalog.resolve("clip", "v1.0.0").expect("resolve");
    (dir, resolved)
}

/// Seed `version`'s audio tool config into a fresh repo and return it parsed.
fn seeded_audio_config(version: &crate::TestCaseVersion) -> serde_json::Value {
    let repo = tempfile::tempdir().expect("repo dir");
    super::seed_audio_tool(version, repo.path(), None).expect("seed the audio tool");
    let raw = std::fs::read_to_string(repo.path().join(version.asset_kind.config_dest()))
        .expect("read the seeded config");
    serde_json::from_str(&raw).expect("parse the seeded config")
}

#[test]
fn a_sfx_sample_run_is_pinned_to_the_declared_pack() {
    // The seeded config is the binary's contract, and its `sample_pack` key is the
    // pin `check_identity` holds the loaded pack against. It is derived from the
    // case's one declaration (`audio.packs`) routed by the asset kind, so the pin and
    // the staged tree can never name different packs.
    let (_dir, version) = audio_version("sfx-sample", Some("[\"combat-core@0.1.0\"]"));
    let config = seeded_audio_config(&version);
    assert_eq!(config["sample_pack"], "combat-core@0.1.0");
    assert!(
        config.get("instrument_bank").is_none(),
        "a sample-library effect names no bank: {config}"
    );
}

#[test]
fn a_music_run_is_pinned_to_the_declared_bank() {
    let (_dir, version) = audio_version("music", Some("[\"gm-lite@0.1.0\"]"));
    let config = seeded_audio_config(&version);
    assert_eq!(config["instrument_bank"], "gm-lite@0.1.0");
    assert!(
        config.get("sample_pack").is_none(),
        "a music case names no sample pack: {config}"
    );
}

#[test]
fn a_sfx_synth_run_is_pinned_to_no_pack_at_all() {
    // It synthesizes from oscillators, so it declares no pack and the config names
    // neither key — the binary loads no library.
    let (_dir, version) = audio_version("sfx-synth", None);
    let config = seeded_audio_config(&version);
    assert!(
        config.get("sample_pack").is_none() && config.get("instrument_bank").is_none(),
        "a synthesized effect names no palette: {config}"
    );
}
