//! Tests for the crate root: the working-tree copy that produces a run's
//! published `implementation/` directory, and the per-run JSONL stream files.

use std::collections::BTreeMap;
use std::path::PathBuf;

use super::{
    EngineCatalog, EngineSelection, EngineSupport, Error, EventFormat, EventKind, EventParser,
    HarnessEvent, HarnessOutcome, HarnessSlug, MAX_GAME_JAM_README_BYTES,
    MAX_SHOWCASE_DESCRIPTION_BYTES, MAX_SHOWCASE_MEDIA_ENTRIES, NONE_SLUG, OrchestratorSelection,
    OutputStream, RawOutputLine, ResolvedEngine, Result, RunRequest, RunState, TestCaseVersion,
    TestType, Usage, build_failed_record, completed_state, copy_tree, init_failure_detail,
    read_game_jam_readme, read_showcase, resolve_engine, with_runtime_cap, write_run_streams,
};
use crate::execution::ExecOutput;
use crate::test_case::MediaKind;
use crate::validation::{DebugScriptResult, ValidationSummary};
use time::OffsetDateTime;

#[test]
fn a_build_that_loaded_is_reviewed_however_badly_its_debug_api_behaved() {
    // A broken debug API costs the run the checklist points its scripts back — it
    // does NOT divert the run out of review. The build compiled, loaded, and is
    // playable, so it stays Completed and keeps its Play tab; only a build that
    // never loaded is Catastrophic.
    let failed_script = DebugScriptResult {
        item_id: "spin".to_string(),
        sub_item_id: None,
        title: "Spin".to_string(),
        category_title: "Spin".to_string(),
        script: "validation/spin.mjs".to_string(),
        gates: true,
        ran: false,
        precondition_unmet: false,
        detail: Some("window.__demo was not installed".to_string()),
        verdicts: Vec::new(),
        outputs: Vec::new(),
    };
    let broken_api = ValidationSummary {
        loaded: true,
        debug_scripts: vec![failed_script.clone()],
        ..Default::default()
    };
    assert_eq!(
        completed_state(TestType::EndToEnd, &broken_api),
        RunState::Completed
    );
    // ...and it keeps the playable build the reviewer needs to open.
    assert!(RunState::Completed.has_playable_build());

    // A build that never loaded stays Catastrophic — nothing to host, nothing to
    // review — even when the same script also failed to run against it.
    let never_loaded = ValidationSummary {
        loaded: false,
        debug_scripts: vec![failed_script],
        ..Default::default()
    };
    assert_eq!(
        completed_state(TestType::EndToEnd, &never_loaded),
        RunState::Catastrophic
    );
    assert!(!RunState::Catastrophic.has_playable_build());

    // A clean load with no failing scripts completes normally.
    let clean = ValidationSummary {
        loaded: true,
        ..Default::default()
    };
    assert_eq!(
        completed_state(TestType::EndToEnd, &clean),
        RunState::Completed
    );
}

#[test]
fn read_game_jam_readme_captures_only_game_jam_readmes() {
    let dir = tempfile::tempdir().expect("temp dir");
    std::fs::write(dir.path().join("README.md"), "# My Game\n\nHow to play.").expect("write");

    // Captured for a game jam.
    assert_eq!(
        read_game_jam_readme(TestType::GameJam, dir.path()).as_deref(),
        Some("# My Game\n\nHow to play."),
    );
    // Never captured for another test type, even when a README is present.
    assert_eq!(read_game_jam_readme(TestType::FullStack, dir.path()), None);
}

#[test]
fn read_game_jam_readme_treats_missing_or_blank_as_absent() {
    let dir = tempfile::tempdir().expect("temp dir");
    // No README at all.
    assert_eq!(read_game_jam_readme(TestType::GameJam, dir.path()), None);
    // A whitespace-only README is absent, not an empty entry.
    std::fs::write(dir.path().join("README.md"), "   \n\t\n").expect("write");
    assert_eq!(read_game_jam_readme(TestType::GameJam, dir.path()), None);
}

#[test]
fn read_game_jam_readme_truncates_an_oversized_readme_on_a_char_boundary() {
    let dir = tempfile::tempdir().expect("temp dir");
    // A multi-byte char repeated past the cap, so a naive byte cut could split it.
    let big = "é".repeat(MAX_GAME_JAM_README_BYTES);
    std::fs::write(dir.path().join("README.md"), &big).expect("write");

    let captured = read_game_jam_readme(TestType::GameJam, dir.path()).expect("captured");
    // Valid UTF-8 (no split char), bounded, and marked as truncated.
    assert!(captured.len() <= MAX_GAME_JAM_README_BYTES + "\n\n…(README truncated)".len());
    assert!(captured.ends_with("…(README truncated)"));
}

/// Lay down a `showcase/` directory with the given `showcase.md`, `showcase.toml`,
/// and media files (each written with a tiny placeholder body), returning the repo
/// root the capture reads from.
fn showcase_repo(description: &str, manifest: &str, files: &[&str]) -> tempfile::TempDir {
    let repo = tempfile::tempdir().expect("temp dir");
    let dir = repo.path().join("showcase");
    std::fs::create_dir(&dir).expect("showcase dir");
    std::fs::write(dir.join("showcase.md"), description).expect("write showcase.md");
    std::fs::write(dir.join("showcase.toml"), manifest).expect("write showcase.toml");
    for file in files {
        std::fs::write(dir.join(file), b"media bytes").expect("write media file");
    }
    repo
}

#[test]
fn read_showcase_captures_the_description_and_the_carousel_in_declared_order() {
    let manifest = r#"
[[media]]
file = "title.png"
name = "Title screen"

[[media]]
file = "rally.json.gz"
name = "A long rally"

[[media]]
file = "trailer.webm"
name = "Trailer"
"#;
    let repo = showcase_repo(
        "# My Game\n\nA store-page blurb.",
        manifest,
        &["title.png", "rally.json.gz", "trailer.webm"],
    );

    let showcase = read_showcase(repo.path()).expect("captured");
    assert_eq!(showcase.description, "# My Game\n\nA store-page blurb.");
    // Carousel order is declared order, and each kind is inferred from the
    // extension exactly like a declared proof's.
    let entries: Vec<(&str, &str, MediaKind)> = showcase
        .media
        .iter()
        .map(|m| (m.file.as_str(), m.name.as_str(), m.kind))
        .collect();
    assert_eq!(
        entries,
        vec![
            ("title.png", "Title screen", MediaKind::Image),
            ("rally.json.gz", "A long rally", MediaKind::Replay),
            ("trailer.webm", "Trailer", MediaKind::Video),
        ],
    );
}

#[test]
fn read_showcase_is_absent_when_no_showcase_directory_was_produced() {
    let repo = tempfile::tempdir().expect("temp dir");
    assert_eq!(read_showcase(repo.path()), None);
}

#[test]
fn read_showcase_records_nothing_for_an_unparseable_showcase() {
    // A manifest that is not TOML at all: no showcase, no panic.
    let repo = showcase_repo("A game.", "this is [ not toml", &[]);
    assert_eq!(read_showcase(repo.path()), None);

    // An entry missing its required caption is a parse failure, not a partial
    // capture.
    let repo = showcase_repo("A game.", "[[media]]\nfile = \"a.png\"\n", &["a.png"]);
    assert_eq!(read_showcase(repo.path()), None);

    // A showcase directory without the description records nothing either.
    let repo = tempfile::tempdir().expect("temp dir");
    let dir = repo.path().join("showcase");
    std::fs::create_dir(&dir).expect("showcase dir");
    std::fs::write(dir.join("showcase.toml"), "").expect("write showcase.toml");
    assert_eq!(read_showcase(repo.path()), None);
}

#[test]
fn read_showcase_truncates_an_oversized_description_on_a_char_boundary() {
    // A multi-byte char repeated past the cap, so a naive byte cut could split it.
    let big = "é".repeat(MAX_SHOWCASE_DESCRIPTION_BYTES);
    let repo = showcase_repo(&big, "", &[]);

    let showcase = read_showcase(repo.path()).expect("captured");
    // Valid UTF-8 (no split char), bounded, and marked as truncated.
    assert!(
        showcase.description.len()
            <= MAX_SHOWCASE_DESCRIPTION_BYTES + "\n\n…(description truncated)".len()
    );
    assert!(showcase.description.ends_with("…(description truncated)"));
}

#[test]
fn read_showcase_drops_an_entry_whose_file_is_missing_or_escapes_the_directory() {
    let manifest = r#"
[[media]]
file = "present.png"
name = "Present"

[[media]]
file = "missing.png"
name = "Missing"

[[media]]
file = "sub/dir.png"
name = "In a subdirectory"

[[media]]
file = "shot..final.png"
name = "Traversal-looking name"
"#;
    // `shot..final.png` exists, but the serve routes refuse any name containing
    // `..`, so capture must drop it too — a recorded name is a servable name.
    let repo = showcase_repo("A game.", manifest, &["present.png", "shot..final.png"]);

    // The bad entries cost only themselves; the rest of the carousel survives.
    let showcase = read_showcase(repo.path()).expect("captured");
    assert_eq!(showcase.media.len(), 1);
    assert_eq!(showcase.media[0].file, "present.png");
}

#[test]
fn read_showcase_trims_the_carousel_to_the_entry_cap() {
    let files: Vec<String> = (0..MAX_SHOWCASE_MEDIA_ENTRIES + 2)
        .map(|i| format!("shot-{i}.png"))
        .collect();
    let manifest: String = files
        .iter()
        .map(|file| format!("[[media]]\nfile = \"{file}\"\nname = \"Shot\"\n\n"))
        .collect();
    let file_refs: Vec<&str> = files.iter().map(String::as_str).collect();
    let repo = showcase_repo("A game.", &manifest, &file_refs);

    // The first N declared entries are kept; the excess is dropped, not an error.
    let showcase = read_showcase(repo.path()).expect("captured");
    assert_eq!(showcase.media.len(), MAX_SHOWCASE_MEDIA_ENTRIES);
    assert_eq!(showcase.media[0].file, "shot-0.png");
    assert_eq!(
        showcase.media[MAX_SHOWCASE_MEDIA_ENTRIES - 1].file,
        format!("shot-{}.png", MAX_SHOWCASE_MEDIA_ENTRIES - 1),
    );
}

#[test]
fn read_showcase_drops_an_entry_of_no_known_media_kind() {
    let manifest = r#"
[[media]]
file = "notes.txt"
name = "Notes"

[[media]]
file = "title.png"
name = "Title"
"#;
    let repo = showcase_repo("A game.", manifest, &["notes.txt", "title.png"]);

    let showcase = read_showcase(repo.path()).expect("captured");
    assert_eq!(showcase.media.len(), 1);
    assert_eq!(showcase.media[0].file, "title.png");
    assert_eq!(showcase.media[0].kind, MediaKind::Image);
}

#[test]
fn init_failure_detail_prefers_stderr_and_reports_the_exit_code() {
    let output = ExecOutput {
        exit_code: 7,
        stdout: "installing…\n".to_string(),
        stderr: "npm ERR! missing script: build\n".to_string(),
        idle_timed_out: false,
    };
    let detail = init_failure_detail(&output);
    assert!(detail.contains("code 7"), "{detail}");
    assert!(detail.contains("missing script: build"), "{detail}");
}

#[test]
fn init_failure_detail_falls_back_to_stdout_when_stderr_is_empty() {
    let output = ExecOutput {
        exit_code: 1,
        stdout: "boom on stdout".to_string(),
        stderr: "   \n".to_string(),
        idle_timed_out: false,
    };
    let detail = init_failure_detail(&output);
    assert!(detail.contains("boom on stdout"), "{detail}");
}

/// The two JSONL files must round-trip and, crucially, replaying `raw.jsonl`
/// through a fresh parser must reproduce the events in `events.jsonl`. That
/// replay property is the whole point of recording both files: a run ships the
/// real harness output beside its translation so the parsing can be re-checked.
#[test]
fn run_streams_persist_raw_output_and_translation_for_replay() {
    let lines = [
        (
            OutputStream::Stdout,
            r#"{"type":"thread.started","thread_id":"t-1"}"#,
        ),
        (
            OutputStream::Stdout,
            r#"{"type":"item.completed","item":{"type":"agent_message","text":"hi"}}"#,
        ),
        (
            OutputStream::Stdout,
            r#"{"type":"item.completed","item":{"type":"command_execution","command":"npm test","exit_code":0}}"#,
        ),
        (OutputStream::Stderr, "a diagnostic"),
    ];

    // Translate as a run does, capturing the raw lines and the events together.
    let mut parser = EventParser::new(EventFormat::Codex);
    let mut raw = Vec::new();
    let mut events = Vec::new();
    for (stream, line) in lines {
        raw.push(RawOutputLine {
            stream,
            line: line.to_string(),
        });
        events.extend(parser.ingest(stream, line));
    }

    let dir = tempfile::tempdir().expect("temp dir");
    write_run_streams(dir.path(), &raw, &events).expect("write run streams");

    let raw_back: Vec<RawOutputLine> = std::fs::read_to_string(dir.path().join("raw.jsonl"))
        .expect("read raw.jsonl")
        .lines()
        .map(|line| serde_json::from_str(line).expect("deserialize raw line"))
        .collect();
    assert_eq!(raw_back, raw);

    let events_back: Vec<HarnessEvent> = std::fs::read_to_string(dir.path().join("events.jsonl"))
        .expect("read events.jsonl")
        .lines()
        .map(|line| serde_json::from_str(line).expect("deserialize event line"))
        .collect();
    assert_eq!(events_back, events);

    let mut replay = EventParser::new(EventFormat::Codex);
    let replayed: Vec<EventKind> = raw_back
        .iter()
        .flat_map(|entry| replay.ingest(entry.stream, &entry.line))
        .map(|event| event.kind)
        .collect();
    let original: Vec<EventKind> = events.iter().map(|event| event.kind.clone()).collect();
    assert_eq!(replayed, original);
}

/// A package manager's `.bin/*` entries are symlinks whose script bodies import
/// siblings via paths relative to the link's real location. Dereferencing them
/// during the copy (writing the target's bytes as a plain file) repoints those
/// imports at the wrong directory, which is what broke `npm run dev`. The copy
/// must therefore recreate symlinks as symlinks.
///
/// Unix-only: it relies on `std::os::unix` to create the link, and the
/// behaviour it guards (npm `.bin` symlinks) is a Unix concern.
#[cfg(unix)]
#[test]
fn copy_tree_preserves_symlinks() {
    let src = tempfile::tempdir().expect("src temp dir");
    let real = src.path().join("vite/bin/vite.js");
    std::fs::create_dir_all(real.parent().unwrap()).expect("create real dir");
    std::fs::write(&real, "// cli entry").expect("write real file");

    let bin = src.path().join(".bin");
    std::fs::create_dir_all(&bin).expect("create .bin");
    std::os::unix::fs::symlink("../vite/bin/vite.js", bin.join("vite")).expect("create symlink");

    let dest = tempfile::tempdir().expect("dest temp dir");
    let out = dest.path().join("implementation");
    copy_tree(src.path(), &out).expect("copy tree");

    let link = out.join(".bin/vite");
    let meta = std::fs::symlink_metadata(&link).expect("link metadata");
    assert!(
        meta.file_type().is_symlink(),
        "copied entry must stay a symlink"
    );
    assert_eq!(
        std::fs::read_link(&link).expect("read link"),
        std::path::Path::new("../vite/bin/vite.js"),
        "the link target must be preserved verbatim",
    );
}

/// `node_modules` is regenerated from the lockfile, so it should never be copied
/// into the published implementation. Everything else must still come across.
#[test]
fn copy_tree_skips_node_modules() {
    let src = tempfile::tempdir().expect("src temp dir");
    std::fs::create_dir_all(src.path().join("node_modules/vite")).expect("create node_modules");
    std::fs::write(src.path().join("node_modules/vite/index.js"), "dep").expect("write dep");
    std::fs::create_dir_all(src.path().join("src")).expect("create src");
    std::fs::write(src.path().join("src/main.ts"), "app").expect("write app");
    std::fs::write(src.path().join("package.json"), "{}").expect("write manifest");

    let dest = tempfile::tempdir().expect("dest temp dir");
    let out = dest.path().join("implementation");
    copy_tree(src.path(), &out).expect("copy tree");

    assert!(
        !out.join("node_modules").exists(),
        "node_modules must be skipped"
    );
    assert!(
        out.join("src/main.ts").exists(),
        "source files must be copied"
    );
    assert!(out.join("package.json").exists(), "manifest must be copied");
}

/// Regular files at arbitrary depth are copied with their contents intact.
#[test]
fn copy_tree_copies_nested_files() {
    let src = tempfile::tempdir().expect("src temp dir");
    let nested = src.path().join("a/b/c.txt");
    std::fs::create_dir_all(nested.parent().unwrap()).expect("create nested dirs");
    std::fs::write(&nested, "deep contents").expect("write nested file");

    let dest = tempfile::tempdir().expect("dest temp dir");
    let out = dest.path().join("implementation");
    copy_tree(src.path(), &out).expect("copy tree");

    assert_eq!(
        std::fs::read_to_string(out.join("a/b/c.txt")).expect("read copied file"),
        "deep contents",
    );
}

/// A resolved version carrying `seconds` as its runtime cap; the other fields are
/// irrelevant to the cap and left empty.
fn version_with_cap(seconds: u64) -> TestCaseVersion {
    TestCaseVersion {
        toolchain: None,
        instrumentation: None,
        slug: "pong".to_string(),
        version: "v1.0.0".to_string(),
        experimental: false,
        engine_format: false,
        name: "Carom".to_string(),
        difficulty: "easy".to_string(),
        tags: Vec::new(),
        summary: None,
        description_path: None,
        changelog_path: std::path::PathBuf::new(),
        root: PathBuf::from("/tmp/pong"),
        prompt_path: PathBuf::from("/tmp/pong/prompt.hbs"),
        max_runtime_seconds: seconds,
        test_type: crate::test_case::TestType::EndToEnd,
        build: Some(crate::test_case::BuildCommands {
            install: "npm ci".to_string(),
            build: "npm run build".to_string(),
            module: None,
        }),
        canvas: None,
        tool: None,
        output: None,
        contract: None,
        sandbox: None,
        simulation: None,
        r#match: None,
        replay: None,
        asset_kind: crate::test_case::AssetKind::Sprite,
        asset_dimension: crate::test_case::AssetDimension::TwoD,
        sheet: None,
        voxel: None,
        model: None,
        ui: None,
        material: None,
        particle: None,
        audio: None,
        audio_packs: Vec::new(),
        common_specs: Vec::new(),
        common_workspace: Default::default(),
        init: None,
        asset_paths: Vec::new(),
        packages: Vec::new(),
        // The engineless run, which is what a version declaring no `engines` at all
        // resolves to. The engine-supporting fixture below widens it.
        engines: vec![EngineSupport::unbounded(NONE_SLUG)],
        variants: Vec::new(),
        common_references: Vec::new(),
        common_proofs: Vec::new(),
        checks: Vec::new(),
        common_review_items: Vec::new(),
        domains: Vec::new(),
        cases: Vec::new(),
        errata: Vec::new(),
    }
}

/// A run request for the pong case with the given runtime override.
fn request_with_override(max_runtime_override: Option<u64>) -> RunRequest {
    RunRequest {
        test_case_slug: "pong".to_string(),
        test_case_version: Some("v1.0.0".to_string()),
        variant: "base".to_string(),
        harness: HarnessSlug::Claude,
        model_id: "some-model".to_string(),
        orchestrator: OrchestratorSelection::default(),
        engine: EngineSelection::default(),
        max_runtime_override,
        container_image: None,
        gg_capability_set: None,
        gg_model_windows: Default::default(),
        gg_model_modalities: Default::default(),
    }
}

/// The effective cap is the per-invocation override when set, and otherwise the
/// resolved case's own default — so a run is always bounded either way.
#[test]
fn effective_max_runtime_prefers_the_override_then_the_case_default() {
    let case = version_with_cap(1800);
    assert_eq!(
        request_with_override(None).effective_max_runtime(&case),
        1800,
        "with no override the case's default is in effect",
    );
    assert_eq!(
        request_with_override(Some(120)).effective_max_runtime(&case),
        120,
        "an override replaces the default for this run",
    );
}

/// A third-party-harness run is not a gg run, carries no capability set, and
/// satisfies the invariant as-is.
#[test]
fn a_third_party_harness_run_is_not_gg_and_validates_without_a_capability_set() {
    let request = request_with_override(None);
    assert!(!request.is_gg(), "the pong helper builds a Claude run");
    request
        .validate()
        .expect("a non-gg run with no capability set holds the invariant");
    assert!(
        matches!(request.gg_capability_set(), Err(Error::GgConfiguration(_))),
        "asking a non-gg run for a capability set is a clear gg-configuration error",
    );
}

/// A gg run carries its capability set, reports `is_gg`, validates, and hands the
/// set back through the validated accessor.
#[test]
fn a_gg_run_with_a_capability_set_is_gg_and_yields_its_set() {
    let set = crate::gg::GgCapabilitySet::minimal("mock/primary");
    let request = RunRequest {
        harness: HarnessSlug::Gg,
        gg_capability_set: Some(set.clone()),
        // The launch resolves a context window for every bound model; a gg run
        // carrying none is refused (see the test below).
        gg_model_windows: BTreeMap::from([("mock/primary".to_string(), 200_000)]),
        gg_model_modalities: Default::default(),
        ..request_with_override(None)
    };
    assert!(request.is_gg());
    request
        .validate()
        .expect("a gg run with a set holds the invariant");
    assert_eq!(
        request.gg_capability_set().expect("the set is present"),
        &set,
        "the validated accessor returns the carried set",
    );
}

/// A gg run missing its capability set violates the invariant with a clear error,
/// rather than silently taking the wrong execution path.
#[test]
fn a_gg_run_without_a_capability_set_is_a_configuration_error() {
    let request = RunRequest {
        harness: HarnessSlug::Gg,
        gg_capability_set: None,
        ..request_with_override(None)
    };
    assert!(
        matches!(request.validate(), Err(Error::GgConfiguration(_))),
        "a gg run requires a capability set",
    );
}

/// A gg run whose bound model carries no context window is refused before any container
/// work. gg measures fullness — and triggers compaction — against that figure and assumes
/// no default, so a run without one would report context accounting that is quietly wrong.
#[test]
fn a_gg_run_without_a_model_window_is_a_configuration_error() {
    let mut set = crate::gg::GgCapabilitySet::minimal("mock/primary");
    set.agents.push(crate::gg::GgAgentConfig {
        name: "subagent".to_string(),
        model_id: "openai/gpt-5.4-mini".to_string(),
        ..crate::gg::GgAgentConfig::root()
    });
    let request = RunRequest {
        harness: HarnessSlug::Gg,
        gg_capability_set: Some(set),
        // Only the primary is covered; the subagent's model is not.
        gg_model_windows: BTreeMap::from([("mock/primary".to_string(), 200_000)]),
        gg_model_modalities: Default::default(),
        ..request_with_override(None)
    };
    let err = request
        .validate()
        .expect_err("a bound model with no window is refused");
    assert!(
        matches!(&err, Error::GgConfiguration(msg) if msg.contains("openai/gpt-5.4-mini")),
        "the error names the uncovered model: {err}",
    );
}

/// A stray capability set on a non-gg run also violates the invariant, so a
/// misassembled request cannot masquerade as a valid third-party-harness run.
#[test]
fn a_capability_set_on_a_non_gg_run_is_a_configuration_error() {
    let request = RunRequest {
        harness: HarnessSlug::Claude,
        gg_capability_set: Some(crate::gg::GgCapabilitySet::minimal("mock/primary")),
        ..request_with_override(None)
    };
    assert!(
        matches!(request.validate(), Err(Error::GgConfiguration(_))),
        "a non-gg run must not carry a capability set",
    );
}

/// The pong fixture widened to declare the `simple-2d` engine alongside the
/// engineless run, as a case whose specs and validation are written for it does.
fn version_supporting_simple_2d() -> TestCaseVersion {
    TestCaseVersion {
        engines: vec![
            EngineSupport::unbounded(NONE_SLUG),
            EngineSupport::unbounded("simple-2d"),
        ],
        ..version_with_cap(1800)
    }
}

/// A run request for the pong case naming `slug` as its engine.
fn request_with_engine(slug: &str) -> RunRequest {
    RunRequest {
        engine: EngineSelection::new(slug),
        ..request_with_override(None)
    }
}

/// A request that names no engine resolves the engineless one, and a run recorded
/// from it carries `none` with no version — which is the truth about it, since
/// there is no package to have a version.
#[test]
fn a_request_naming_no_engine_resolves_and_records_the_engineless_run() {
    let case = version_with_cap(1800);
    let request = request_with_override(None);
    assert_eq!(
        request.engine,
        EngineSelection::none(),
        "an unspecified engine is the engineless run, not an empty selection",
    );

    let engine = resolve_engine(&EngineCatalog::new(), &request, &case)
        .expect("every case supports the engineless run");
    assert_eq!(engine.slug(), NONE_SLUG);
    assert!(
        !engine.provides_runtime(),
        "the engineless engine vendors nothing into the repository",
    );

    let now = OffsetDateTime::from_unix_timestamp(1_700_000_000).expect("now");
    let record = build_failed_record(
        "job-none",
        &request,
        Some(&case),
        now,
        now,
        RunState::Infrastructure,
        "locating a container runtime: none found",
    );
    assert_eq!(record.subject.engine_slug, NONE_SLUG);
    assert!(
        record.subject.engine_version.is_none(),
        "an engine that vendors no runtime has no version to record",
    );
}

/// A request naming an engine the case declares resolves to that engine's
/// manifest — the runtime half included, since that is what the seeder vendors.
#[test]
fn a_request_naming_a_supported_engine_resolves_it() {
    let engine = resolve_engine(
        &EngineCatalog::new(),
        &request_with_engine("simple-2d"),
        &version_supporting_simple_2d(),
    )
    .expect("the case declares simple-2d");

    assert_eq!(engine.slug(), "simple-2d");
    assert!(
        engine.provides_runtime() && engine.package().is_some(),
        "a declared engine carries the package the seeder vendors",
    );
}

/// A request naming an engine the case does **not** declare is refused, and it is
/// refused here — by a check that takes only the request and the resolved case, so
/// nothing has been rendered, seeded, pulled, or started when it fires. The message
/// names the engines the case does support, so the fix is one step.
#[test]
fn an_engine_the_case_does_not_support_is_refused_before_any_container_work() {
    let case = version_with_cap(1800);
    let err = resolve_engine(
        &EngineCatalog::new(),
        &request_with_engine("simple-2d"),
        &case,
    )
    .expect_err("the fixture declares only the engineless run");

    match &err {
        Error::EngineUnsupportedForCase {
            slug,
            test_case,
            version,
            supported,
        } => {
            assert_eq!(slug, "simple-2d");
            assert_eq!(test_case, "pong");
            assert_eq!(version, "v1.0.0");
            assert_eq!(supported, &vec![NONE_SLUG.to_string()]);
        }
        other => panic!("expected EngineUnsupportedForCase, got {other:?}"),
    }
    assert!(
        err.to_string().contains(NONE_SLUG),
        "the message names what the case does support: {err}",
    );
}

/// The engineless run is held to the case's declared set like any other engine.
///
/// A version built against a runtime does not support it: its workspace
/// `package.json` depends on the engine package, which only an engine run vendors
/// in, so an engineless run would seed a tree whose install cannot succeed. The
/// gate has to say so here — before anything is rendered, seeded, pulled, or
/// started — rather than let the run reach a failing `npm ci` in a container.
#[test]
fn the_engineless_run_is_refused_by_a_case_built_against_an_engine() {
    let case = TestCaseVersion {
        engines: vec![EngineSupport::unbounded("simple-2d")],
        ..version_with_cap(1800)
    };
    // `EngineSelection::default()` is the engineless run, which is what a request
    // naming no engine resolves to.
    let err = resolve_engine(&EngineCatalog::new(), &request_with_override(None), &case)
        .expect_err("the case declares simple-2d alone");

    match &err {
        Error::EngineUnsupportedForCase {
            slug, supported, ..
        } => {
            assert_eq!(slug, NONE_SLUG);
            assert_eq!(supported, &vec!["simple-2d".to_string()]);
        }
        other => panic!("expected EngineUnsupportedForCase, got {other:?}"),
    }
}

/// A version that declares `none` alongside an engine still admits the engineless
/// run, so declaring both is how a case that genuinely builds either way says so.
#[test]
fn the_engineless_run_is_admitted_by_a_case_that_declares_it_alongside_an_engine() {
    let engine = resolve_engine(
        &EngineCatalog::new(),
        &request_with_override(None),
        &version_supporting_simple_2d(),
    )
    .expect("the case declares the engineless run alongside simple-2d");
    assert_eq!(engine.slug(), NONE_SLUG);
}

/// A slug no build carries is reported as the unknown engine it is — naming the
/// engines that would have worked — rather than as one this case happens not to
/// support, because the catalogue is consulted before the case's gate.
#[test]
fn an_unknown_engine_slug_does_not_resolve() {
    let err = resolve_engine(
        &EngineCatalog::new(),
        &request_with_engine("simpel-2d"),
        &version_supporting_simple_2d(),
    )
    .expect_err("no built-in engine is spelled that way");

    match &err {
        Error::Engine(detail) => {
            assert!(detail.contains("simpel-2d"), "{detail}");
            assert!(detail.contains("simple-2d"), "{detail}");
        }
        other => panic!("expected Engine, got {other:?}"),
    }
}

/// A run that failed before producing an implementation still records the engine it
/// was launched with, so even a failed attempt is attributable to the runtime it was
/// meant to be built on. The version stays absent: it is read out of the staged
/// package while seeding, and this run never got that far.
#[test]
fn a_failed_run_records_the_engine_it_was_launched_with() {
    let case = version_supporting_simple_2d();
    let now = OffsetDateTime::from_unix_timestamp(1_700_000_000).expect("now");

    let record = build_failed_record(
        "job-engine",
        &request_with_engine("simple-2d"),
        Some(&case),
        now,
        now,
        RunState::Infrastructure,
        "the sandbox pod never became ready",
    );

    assert_eq!(record.subject.engine_slug, "simple-2d");
    assert!(record.subject.engine_version.is_none());
}

/// A minimal successful outcome for exercising the cap without a real harness.
fn ready_outcome() -> HarnessOutcome {
    HarnessOutcome {
        usage: Usage::default(),
        harness_version: None,
        reported_cost: None,
        raw_output: Vec::new(),
        translated_events: Vec::new(),
        gg_summary: None,
        tool_calls: Default::default(),
        canceled: false,
    }
}

/// A session that finishes inside the cap passes its own result straight through.
#[tokio::test]
async fn runtime_cap_passes_a_session_that_finishes_in_time() {
    let outcome = with_runtime_cap(async { Ok(ready_outcome()) }, 3600, HarnessSlug::Claude)
        .await
        .expect("a session within the cap should pass through");
    assert_eq!(outcome, ready_outcome());
}

/// A session that runs past the cap is stopped and reported as timed out, naming
/// the harness and the cap it exceeded. Paused time auto-advances past the cap so
/// the test does not wait out a real wall-clock timeout.
#[tokio::test(start_paused = true)]
async fn runtime_cap_stops_a_session_that_runs_too_long() {
    let never = std::future::pending::<super::Result<HarnessOutcome>>();
    let err = with_runtime_cap(never, 30, HarnessSlug::Claude)
        .await
        .expect_err("a session past the cap should time out");
    match err {
        Error::RunTimedOut { slug, seconds } => {
            assert_eq!(slug, "claude");
            assert_eq!(seconds, 30);
        }
        other => panic!("expected RunTimedOut, got {other:?}"),
    }
}

/// A failure after the version resolves records the run as `failed` with its real
/// subject and the reason, so it surfaces in the produced-runs listing with
/// enough context to see what was attempted and why it stopped.
#[test]
fn failed_record_captures_subject_and_reason_from_a_resolved_run() {
    let request = request_with_override(None);
    let case = version_with_cap(1800);
    let started = OffsetDateTime::from_unix_timestamp(1_700_000_000).expect("start");
    let finished = OffsetDateTime::from_unix_timestamp(1_700_000_042).expect("finish");

    let record = build_failed_record(
        "job-123",
        &request,
        Some(&case),
        started,
        finished,
        RunState::Infrastructure,
        "locating a container runtime: none found",
    );

    assert_eq!(record.id, "job-123");
    assert_eq!(record.status.state, RunState::Infrastructure);
    assert_eq!(
        record.status.detail.as_deref(),
        Some("locating a container runtime: none found"),
    );
    assert_eq!(record.subject.test_case_slug, "pong");
    assert_eq!(record.subject.test_case_version, "v1.0.0");
    assert_eq!(record.subject.test_type, case.test_type);
    assert_eq!(record.subject.variant, "base");
    assert_eq!(record.subject.harness_slug, HarnessSlug::Claude);
    assert_eq!(record.subject.model_id, "some-model");
    // A failed run produced no metrics, validation, or environment.
    assert_eq!(record.metrics, super::RunMetrics::default());
    assert!(!record.validation.loaded);
    assert!(!record.started_at.is_empty() && !record.finished_at.is_empty());
    // …and it names no seed commit: a failed record is built from the request alone,
    // so claiming one would point anything measuring the tree at a commit this record
    // has no evidence for.
    assert!(record.seed_commit.is_none());
}

/// A failure before the version could be resolved still records a `failed` run,
/// falling back to what the request carried for the subject.
#[test]
fn failed_record_falls_back_to_the_request_when_unresolved() {
    let request = request_with_override(None);
    let now = OffsetDateTime::from_unix_timestamp(1_700_000_000).expect("now");

    let record = build_failed_record(
        "job-9",
        &request,
        None,
        now,
        now,
        RunState::Infrastructure,
        "backend unreachable",
    );

    assert_eq!(record.status.state, RunState::Infrastructure);
    assert_eq!(record.subject.test_case_version, "v1.0.0");
    // Unresolved: the test type defaults rather than guessing.
    assert_eq!(
        record.subject.test_type,
        crate::test_case::TestType::default()
    );
}

// --- the engine version gate ------------------------------------------------

/// The pong fixture pinned to engine versions `[min, max)` for `simple-2d`.
fn version_pinning_simple_2d(min: &str, max: Option<&str>) -> TestCaseVersion {
    TestCaseVersion {
        engines: vec![
            EngineSupport::unbounded(NONE_SLUG),
            EngineSupport {
                slug: "simple-2d".to_string(),
                min_version: Some(semver::Version::parse(min).expect("min")),
                max_version: max.map(|raw| semver::Version::parse(raw).expect("max")),
            },
        ],
        ..version_with_cap(1800)
    }
}

/// A catalog whose package store stages `simple-2d` at `version`, so the gate
/// compares against the version a run of it would actually be seeded with.
fn catalog_staging_simple_2d(version: &str) -> (tempfile::TempDir, EngineCatalog) {
    let store = tempfile::tempdir().expect("temp store");
    let dir = store.path().join("@test-cabinet/simple-2d");
    std::fs::create_dir_all(&dir).expect("staged package dir");
    std::fs::write(
        dir.join("package.json"),
        format!("{{\"name\":\"@test-cabinet/simple-2d\",\"version\":\"{version}\"}}"),
    )
    .expect("write staged package.json");
    let catalog = EngineCatalog::with_package_store(store.path());
    (store, catalog)
}

/// Resolve `simple-2d` for a case pinned to `[min, max)` against a store holding
/// `staged`.
fn gate(staged: &str, min: &str, max: Option<&str>) -> Result<ResolvedEngine> {
    let (_store, catalog) = catalog_staging_simple_2d(staged);
    resolve_engine(
        &catalog,
        &request_with_engine("simple-2d"),
        &version_pinning_simple_2d(min, max),
    )
}

#[test]
fn the_declared_minimum_is_inclusive_at_the_gate() {
    // Exactly the floor is supported: the minimum is the earliest contract the
    // case's specs were written against, which the case *does* support.
    let engine = gate("1.2.0", "1.2.0", Some("2.0.0")).expect("the floor is inside the range");
    assert_eq!(engine.slug(), "simple-2d");
}

#[test]
fn a_version_below_the_declared_minimum_is_refused_before_any_container_work() {
    // The check takes only the resolved case and the resolved engine, so nothing
    // has been rendered, seeded, pulled, or started when it fires.
    let err = gate("1.1.9", "1.2.0", Some("2.0.0")).expect_err("below the floor");

    match &err {
        Error::EngineVersionUnsupportedForCase {
            slug,
            engine_version,
            test_case,
            version,
            range,
        } => {
            assert_eq!(slug, "simple-2d");
            assert_eq!(engine_version, "1.1.9");
            assert_eq!(test_case, "pong");
            assert_eq!(version, "v1.0.0");
            assert_eq!(range, ">= 1.2.0, < 2.0.0");
        }
        other => panic!("expected EngineVersionUnsupportedForCase, got {other:?}"),
    }
    // The message must name the case, the engine, the version, and the range, so
    // the fix — restage, or run a case version that accepts it — is one step.
    let message = err.to_string();
    for expected in ["pong", "simple-2d", "1.1.9", ">= 1.2.0, < 2.0.0"] {
        assert!(
            message.contains(expected),
            "expected `{expected}` in: {message}"
        );
    }
}

#[test]
fn the_declared_maximum_is_exclusive_at_the_gate() {
    // Immediately below the ceiling is supported; exactly the ceiling is not —
    // that is the version whose behaviour changed a check the case depends on.
    assert!(gate("1.999.999", "1.0.0", Some("2.0.0")).is_ok());
    let err = gate("2.0.0", "1.0.0", Some("2.0.0")).expect_err("the ceiling is exclusive");
    assert!(
        matches!(err, Error::EngineVersionUnsupportedForCase { .. }),
        "got {err:?}"
    );
}

#[test]
fn an_unbounded_ceiling_accepts_every_later_engine_version() {
    assert!(gate("14.3.1", "1.0.0", None).is_ok());
    let err = gate("0.9.0", "1.0.0", None).expect_err("still below the floor");
    match &err {
        Error::EngineVersionUnsupportedForCase { range, .. } => assert_eq!(range, ">= 1.0.0"),
        other => panic!("expected EngineVersionUnsupportedForCase, got {other:?}"),
    }
}

#[test]
fn a_declared_range_that_cannot_be_checked_refuses_the_run() {
    // The engine resolved and the case supports it; the only missing thing is the
    // version of its package in the host store. A declared range is a claim that
    // only *some* versions are safe, so an unverifiable pairing is refused rather
    // than admitted.
    let store = tempfile::tempdir().expect("temp store");
    let err = resolve_engine(
        &EngineCatalog::with_package_store(store.path()),
        &request_with_engine("simple-2d"),
        &version_pinning_simple_2d("1.0.0", None),
    )
    .expect_err("nothing is staged, so the range cannot be checked");

    match &err {
        Error::EngineVersionUnknown {
            slug,
            test_case,
            version,
            range,
        } => {
            assert_eq!(slug, "simple-2d");
            assert_eq!(test_case, "pong");
            assert_eq!(version, "v1.0.0");
            assert_eq!(range, ">= 1.0.0");
        }
        other => panic!("expected EngineVersionUnknown, got {other:?}"),
    }
}

#[test]
fn a_case_declaring_no_range_never_consults_the_package_store() {
    // The bare `engines` list is support at any version, which is what every
    // frozen case declares. A store the host cannot read a version out of must
    // cost such a case nothing — otherwise landing version ranges would have
    // broken every shipped case version.
    let store = tempfile::tempdir().expect("temp store");
    let engine = resolve_engine(
        &EngineCatalog::with_package_store(store.path()),
        &request_with_engine("simple-2d"),
        &version_supporting_simple_2d(),
    )
    .expect("an unbounded declaration constrains nothing");

    assert_eq!(engine.slug(), "simple-2d");
    assert_eq!(engine.version(), None);
}
