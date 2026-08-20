use std::path::Path;

use super::{
    FsRepoSeeder, JsonNode, init_repo, reserve_unique_dir, run_timestamp,
    seed_prior_game_jam_entries,
};
use crate::engine::{EngineCatalog, EngineSelection, ResolvedEngine};
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
/// `@test-cabinet` sibling it depends on, laid out exactly as
/// `scripts/stage-tcab-packages.mjs` stages them: each package under its scoped
/// name, siblings referenced by a relative `file:` path, build output in `dist/`.
///
/// `version` is what the engine package declares, since that is the value a run
/// records; `docs` controls whether the package carries the documentation
/// directory its manifest promises, so the missing-docs failure can be exercised.
fn fake_engine_store(version: &str, docs: bool) -> tempfile::TempDir {
    let store = tempfile::tempdir().expect("store dir");
    let engine = store.path().join("@test-cabinet/simple-2d");
    let dep = store.path().join("@test-cabinet/run-record");
    std::fs::create_dir_all(engine.join("dist")).expect("engine dist");
    std::fs::create_dir_all(dep.join("dist")).expect("dep dist");
    std::fs::write(
        engine.join("package.json"),
        format!(
            r#"{{
  "name": "@test-cabinet/simple-2d",
  "version": "{version}",
  "dependencies": {{ "@test-cabinet/run-record": "file:../run-record" }}
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
        r#"{"name":"@test-cabinet/run-record","version":"0.0.0"}"#,
    )
    .expect("dep manifest");
    std::fs::write(dep.join("dist/index.js"), "// types").expect("dep dist file");
    store
}

/// The `simple-2d` engine, resolved from the real embedded catalogue rather than
/// hand-built, so these tests fail if the shipped manifest stops naming a package
/// or a docs directory.
fn simple_2d() -> ResolvedEngine {
    EngineCatalog::new()
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

/// The workspace `package.json` a case ships. Its keys are deliberately not in
/// alphabetical order, so a rewrite that re-sorted them would be impossible to
/// miss in the assertion below.
const SHIPPED_PACKAGE_JSON: &str = r#"{
  "name": "carom",
  "private": true,
  "scripts": {
    "build": "vite build"
  },
  "dependencies": {
    "vite": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
"#;

/// The same file after the engine is vendored: exactly one line more, inside the
/// object it belongs to, with everything else where the author left it.
const SEEDED_PACKAGE_JSON: &str = r#"{
  "name": "carom",
  "private": true,
  "scripts": {
    "build": "vite build"
  },
  "dependencies": {
    "vite": "^5.0.0",
    "@test-cabinet/simple-2d": "file:./.tcab/engine/@test-cabinet/simple-2d"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
"#;

/// A run repository holding the workspace `package.json` a case ships.
fn workspace_with_package_json(contents: &str) -> tempfile::TempDir {
    let repo = tempfile::tempdir().expect("repo dir");
    std::fs::write(repo.path().join("package.json"), contents).expect("write package.json");
    repo
}

/// The whole engine delivery in one pass: the package *and its transitive
/// `@test-cabinet` closure* land under `.tcab/engine/`, the engine's own
/// documentation lands at `engine/`, the staged version comes back to be recorded
/// on the run, and the workspace `package.json` gains the `file:` dependency —
/// with every key the case authored still in the position it authored it in, at
/// two-space indentation with a trailing newline.
///
/// The exact-text assertion is the point: this file is read by the model and
/// diffed by everything downstream, so "the dependency is there" is not enough —
/// re-emitting it in a different shape would turn a one-line addition into a
/// whole-file change.
#[test]
fn vendor_engine_vendors_the_closure_the_docs_and_the_dependency() {
    let store = fake_engine_store("1.4.2", true);
    let (_base, seeder) = seeder_for(&store);
    let repo = workspace_with_package_json(SHIPPED_PACKAGE_JSON);

    let version = seeder
        .vendor_engine(repo.path(), &simple_2d())
        .expect("vendor the engine");

    assert_eq!(
        version.as_deref(),
        Some("1.4.2"),
        "the recorded version is the one the staged package declares"
    );
    let vendored = repo.path().join(".tcab/engine/@test-cabinet");
    assert!(
        vendored.join("simple-2d/dist/index.js").is_file(),
        "the engine package is vendored, build output included"
    );
    assert!(
        vendored.join("run-record/package.json").is_file(),
        "the transitive @test-cabinet dependency is vendored too, so the staged \
         package's relative `file:` link still resolves"
    );
    assert!(
        !repo.path().join(".tcab/packages").exists(),
        "the engine never lands in the case's own vendor tree"
    );
    assert_eq!(
        std::fs::read_to_string(repo.path().join("engine/frame.md")).expect("seeded engine docs"),
        "# Frame\n",
        "the engine's documentation is seeded where the prompt points the build"
    );
    assert_eq!(
        std::fs::read_to_string(repo.path().join("package.json")).expect("read package.json"),
        SEEDED_PACKAGE_JSON,
        "only the dependency is added; every other key keeps its place and shape"
    );
}

/// A workspace that declares no `dependencies` at all still gets the engine: the
/// object is created (appended, so nothing the author wrote moves) rather than the
/// engine being silently dropped.
#[test]
fn vendor_engine_creates_a_missing_dependencies_object() {
    let store = fake_engine_store("1.0.0", true);
    let (_base, seeder) = seeder_for(&store);
    let repo = workspace_with_package_json("{\n  \"name\": \"carom\"\n}\n");

    seeder
        .vendor_engine(repo.path(), &simple_2d())
        .expect("vendor the engine");

    assert_eq!(
        std::fs::read_to_string(repo.path().join("package.json")).expect("read package.json"),
        r#"{
  "name": "carom",
  "dependencies": {
    "@test-cabinet/simple-2d": "file:./.tcab/engine/@test-cabinet/simple-2d"
  }
}
"#,
    );
}

/// Both vendored trees carry `dist/` subtrees, and a case's own `.gitignore`
/// ignores `dist/` for its build output. `init_repo` force-adds each so the seed
/// commit captures them: without it the published repository would install a
/// dependency whose code is not there — the case's packages and the run's engine
/// alike.
#[test]
fn init_repo_commits_both_the_vendored_packages_and_the_vendored_engine() {
    let store = fake_engine_store("1.0.0", true);
    let (_base, seeder) = seeder_for(&store);
    let repo = workspace_with_package_json("{\n  \"name\": \"carom\"\n}\n");
    std::fs::write(repo.path().join(".gitignore"), "node_modules/\ndist/\n").expect("gitignore");
    seeder
        .vendor_packages(repo.path(), &["@test-cabinet/run-record".to_string()])
        .expect("vendor the case's packages");
    seeder
        .vendor_engine(repo.path(), &simple_2d())
        .expect("vendor the engine");

    init_repo(repo.path()).expect("init repo");

    let tracked = git_stdout(repo.path(), &["ls-files"]);
    assert!(
        tracked.contains(".tcab/packages/@test-cabinet/run-record/dist/index.js"),
        "the case's vendored packages are committed despite `dist/`: {tracked}"
    );
    assert!(
        tracked.contains(".tcab/engine/@test-cabinet/simple-2d/dist/index.js"),
        "the run's vendored engine is committed despite `dist/`: {tracked}"
    );
    assert!(
        tracked.contains("engine/frame.md"),
        "the seeded engine documentation is committed: {tracked}"
    );
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
    let none = EngineCatalog::new()
        .resolve(&EngineSelection::none())
        .expect("`none` is a built-in engine");

    let version = seeder
        .vendor_engine(repo.path(), &none)
        .expect("vendoring nothing succeeds");

    assert_eq!(
        version, None,
        "an engine with no runtime records no version"
    );
    assert!(!repo.path().join(".tcab").exists(), "nothing is vendored");
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
    let repo = workspace_with_package_json("{\n  \"name\": \"carom\"\n}\n");

    let err = seeder
        .vendor_engine(repo.path(), &simple_2d())
        .expect_err("a missing engine package is an error");

    let message = err.to_string();
    assert!(message.contains("@test-cabinet/simple-2d"), "{message}");
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
        store.path().join("@test-cabinet/simple-2d/package.json"),
        r#"{"name":"@test-cabinet/simple-2d"}"#,
    )
    .expect("rewrite the engine manifest");
    let (_base, seeder) = seeder_for(&store);
    let repo = workspace_with_package_json("{\n  \"name\": \"carom\"\n}\n");

    let err = seeder
        .vendor_engine(repo.path(), &simple_2d())
        .expect_err("a versionless engine package is an error");

    let message = err.to_string();
    assert!(message.contains("@test-cabinet/simple-2d"), "{message}");
    assert!(message.contains("version"), "{message}");
}

/// A docs directory the manifest promises but the package does not carry is an
/// error, because the rendered prompt points the build at `/work/engine`: seeding
/// past it would send the model to read documentation that is not there.
#[test]
fn vendor_engine_errors_when_the_declared_docs_are_missing() {
    let store = fake_engine_store("1.0.0", false);
    let (_base, seeder) = seeder_for(&store);
    let repo = workspace_with_package_json("{\n  \"name\": \"carom\"\n}\n");

    let err = seeder
        .vendor_engine(repo.path(), &simple_2d())
        .expect_err("a missing docs directory is an error");

    let message = err.to_string();
    assert!(message.contains("simple-2d"), "{message}");
    assert!(message.contains("docs"), "{message}");
}

/// A case that supports an engine must ship a workspace `package.json`, because
/// that is the file the dependency is written into. Reaching seeding without one
/// means the case and the run disagree, so it fails loudly rather than inventing a
/// manifest the case's specs never described.
#[test]
fn vendor_engine_errors_when_the_workspace_has_no_package_json() {
    let store = fake_engine_store("1.0.0", true);
    let (_base, seeder) = seeder_for(&store);
    let repo = tempfile::tempdir().expect("repo dir");

    let err = seeder
        .vendor_engine(repo.path(), &simple_2d())
        .expect_err("a workspace with no package.json is an error");

    let message = err.to_string();
    assert!(message.contains("package.json"), "{message}");
    assert!(
        message.contains(crate::engine::NONE_SLUG),
        "the message says which cases are exempt: {message}"
    );
}

/// The order-preserving JSON model is what keeps the rewrite above to one line.
/// A round trip must return every object's keys in their authored order — not
/// `serde_json::Value`'s alphabetical one — and re-emit every value shape
/// (nested objects, arrays, numbers, booleans, null, and the empty forms of both
/// containers) at two-space indentation.
#[test]
fn json_node_round_trips_a_document_in_its_authored_order() {
    let source = r#"{"zeta":1,"alpha":[1,2.5,true,null,"s"],"nested":{"b":{},"a":[]}}"#;

    let document: JsonNode = serde_json::from_str(source).expect("parse");
    let rendered = serde_json::to_string_pretty(&document).expect("render");

    assert_eq!(
        rendered,
        r#"{
  "zeta": 1,
  "alpha": [
    1,
    2.5,
    true,
    null,
    "s"
  ],
  "nested": {
    "b": {},
    "a": []
  }
}"#,
    );
}

/// A duplicate key is malformed JSON that parsers accept. The last value wins —
/// what every JSON reader resolves to — while the first key keeps its position,
/// which is what a human reading the file sees.
#[test]
fn json_node_resolves_a_duplicate_key_in_place() {
    let document: JsonNode = serde_json::from_str(r#"{"a":1,"b":2,"a":3}"#).expect("parse");

    let rendered = serde_json::to_string_pretty(&document).expect("render");

    assert_eq!(rendered, "{\n  \"a\": 3,\n  \"b\": 2\n}");
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
