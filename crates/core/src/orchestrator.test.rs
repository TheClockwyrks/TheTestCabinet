//! Tests for orchestrator resolution, the `tcab-session` wrapper rendering, and
//! session segmentation.

use std::process::Command;

use super::*;
use crate::execution::{OutputStream, RawOutputLine};
use crate::metrics::TokenCounts;

// --- manifest parsing -------------------------------------------------------

#[test]
fn parses_a_manifest_with_params() {
    let toml_src = r#"
        slug = "ralph"
        name = "Ralph"
        description = "A multi-session loop."
        runner = "runner.sh"

        [params]
        marker_file = ".tcab/done"
        status_file = ".tcab/status.md"
    "#;
    let manifest: OrchestratorManifest = toml::from_str(toml_src).expect("manifest parses");
    assert_eq!(manifest.slug, "ralph");
    assert_eq!(manifest.name, "Ralph");
    assert_eq!(manifest.runner, "runner.sh");
    assert_eq!(
        manifest.params.get("marker_file").map(String::as_str),
        Some(".tcab/done")
    );
    assert_eq!(manifest.params.len(), 2);
}

#[test]
fn a_manifest_without_params_defaults_to_empty() {
    let toml_src = r#"
        slug = "one-shot"
        name = "One-shot"
        description = "A single session."
        runner = "runner.sh"
    "#;
    let manifest: OrchestratorManifest = toml::from_str(toml_src).expect("manifest parses");
    assert!(manifest.params.is_empty());
}

// --- catalog resolution -----------------------------------------------------

#[test]
fn resolves_the_builtin_one_shot() {
    let catalog = OrchestratorCatalog::new();
    let orchestrator = catalog
        .resolve(&OrchestratorSelection::default())
        .expect("one-shot resolves");
    assert_eq!(orchestrator.slug(), ONE_SHOT_SLUG);
    assert!(orchestrator.manifest.params.is_empty());
    // The embedded runner is the single-session script.
    assert!(orchestrator.runner_script.contains("tcab-session"));
    assert!(orchestrator.runner_script.contains("$TCAB_PROMPT"));
}

#[test]
fn every_builtin_slug_resolves_and_matches_its_directory() {
    let catalog = OrchestratorCatalog::new();
    for slug in BUILT_IN_SLUGS {
        let orchestrator = catalog
            .resolve(&OrchestratorSelection::builtin(*slug))
            .expect("built-in resolves");
        assert_eq!(orchestrator.slug(), *slug);
        assert!(!orchestrator.manifest.name.trim().is_empty());
        assert!(!orchestrator.runner_script.trim().is_empty());
    }
}

#[test]
fn an_unknown_builtin_slug_is_a_clear_error() {
    let catalog = OrchestratorCatalog::new();
    let err = catalog
        .resolve(&OrchestratorSelection::builtin("does-not-exist"))
        .expect_err("unknown slug errors");
    let message = err.to_string();
    assert!(message.contains("does-not-exist"), "{message}");
    assert!(message.contains(ONE_SHOT_SLUG), "{message}");
}

#[test]
fn resolves_an_external_directory() {
    let dir = tempfile::tempdir().expect("temp dir");
    std::fs::write(
        dir.path().join("orchestrator.toml"),
        "slug = \"custom\"\nname = \"Custom\"\ndescription = \"A custom strategy.\"\nrunner = \"go.sh\"\n",
    )
    .expect("write manifest");
    std::fs::write(
        dir.path().join("go.sh"),
        "#!/bin/sh\nexec tcab-session \"$TCAB_PROMPT\"\n",
    )
    .expect("write runner");

    let catalog = OrchestratorCatalog::new();
    let orchestrator = catalog
        .resolve(&OrchestratorSelection::external(dir.path()))
        .expect("external resolves");
    // The directory's own manifest slug is authoritative.
    assert_eq!(orchestrator.slug(), "custom");
    assert!(orchestrator.runner_script.contains("tcab-session"));
}

#[test]
fn an_external_directory_missing_its_manifest_errors() {
    let dir = tempfile::tempdir().expect("temp dir");
    let catalog = OrchestratorCatalog::new();
    let err = catalog
        .resolve(&OrchestratorSelection::external(dir.path()))
        .expect_err("missing manifest errors");
    assert!(err.to_string().contains("orchestrator.toml"), "{err}");
}

// --- shell quoting ----------------------------------------------------------

#[test]
fn shell_quote_wraps_and_escapes() {
    assert_eq!(shell_quote("plain"), "'plain'");
    assert_eq!(shell_quote(""), "''");
    // A single quote closes, escapes a literal quote, and reopens.
    assert_eq!(shell_quote("a'b"), "'a'\\''b'");
    // Metacharacters are literal inside single quotes.
    assert_eq!(shell_quote("$x `y` \"z\""), "'$x `y` \"z\"'");
}

// --- wrapper rendering ------------------------------------------------------

/// Run a rendered session command line through `sh`, substituting `prompt` as
/// `$1`, and return the argv the command would have received (one element per
/// line). The command is built with `printf '%s\n'` as argv[0] so each surviving
/// argument is echoed verbatim — proving quoting and substitution round-trip.
fn argv_after_substitution(argv: &[String], prompt: &str) -> Vec<String> {
    let command = render_session_command(argv, PROMPT_SENTINEL);
    let output = Command::new("sh")
        .arg("-c")
        .arg(&command)
        .arg("tcab-session") // $0
        .arg(prompt) // $1
        .output()
        .expect("sh runs");
    assert!(output.status.success(), "sh failed: {command}");
    String::from_utf8(output.stdout)
        .expect("utf8")
        .lines()
        .map(str::to_string)
        .collect()
}

#[test]
fn rendered_command_substitutes_an_arbitrary_prompt_at_any_position() {
    // argv[0] echoes every following argument on its own line. The sentinel sits
    // in the middle, so substitution must work regardless of position.
    let argv = vec![
        "printf".to_string(),
        "%s\n".to_string(),
        "--model".to_string(),
        "some-model".to_string(),
        PROMPT_SENTINEL.to_string(),
        "--flag".to_string(),
    ];
    // A prompt with spaces, quotes, `$`, and a newline.
    let prompt = "build it: \"now\" $HOME\nline two & 'go'";
    let got = argv_after_substitution(&argv, prompt);
    assert_eq!(
        got,
        vec![
            "--model".to_string(),
            "some-model".to_string(),
            // The newline in the prompt splits across two echoed lines.
            "build it: \"now\" $HOME".to_string(),
            "line two & 'go'".to_string(),
            "--flag".to_string(),
        ]
    );
}

#[test]
fn the_session_wrapper_brackets_the_command_with_sentinels() {
    let argv = vec![
        "printf".to_string(),
        "%s\n".to_string(),
        PROMPT_SENTINEL.to_string(),
    ];
    let wrapper = render_session_wrapper(&argv, PROMPT_SENTINEL);
    assert!(wrapper.starts_with("#!/bin/sh"));
    assert!(wrapper.contains(SESSION_BEGIN));
    assert!(wrapper.contains(SESSION_END));
    assert!(wrapper.contains("\"$1\""));
    // Running it prints the sentinels around the substituted prompt.
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("tcab-session");
    std::fs::write(&path, &wrapper).expect("write wrapper");
    let output = Command::new("sh")
        .arg(&path)
        .arg("hello world")
        .output()
        .expect("sh runs");
    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).expect("utf8");
    let lines: Vec<&str> = stdout.lines().collect();
    assert_eq!(lines, vec![SESSION_BEGIN, "hello world", SESSION_END]);
}

// --- session segmentation ---------------------------------------------------

fn raw(stream: OutputStream, line: &str) -> RawOutputLine {
    RawOutputLine {
        stream,
        line: line.to_string(),
    }
}

#[test]
fn segments_split_on_the_session_sentinels_and_ignore_runner_chatter() {
    let lines = vec![
        // Runner's own output before the first session is ignored.
        raw(OutputStream::Stdout, "starting"),
        raw(OutputStream::Stdout, SESSION_BEGIN),
        raw(OutputStream::Stdout, r#"{"usage":{"input_tokens":1}}"#),
        raw(OutputStream::Stderr, "session 1 stderr"),
        raw(OutputStream::Stdout, SESSION_END),
        raw(OutputStream::Stdout, "between sessions"),
        raw(OutputStream::Stdout, SESSION_BEGIN),
        raw(OutputStream::Stdout, r#"{"usage":{"input_tokens":2}}"#),
        raw(OutputStream::Stdout, SESSION_END),
    ];
    let segments = segment_sessions(&lines);
    assert_eq!(segments.len(), 2);
    assert_eq!(segments[0].stdout, "{\"usage\":{\"input_tokens\":1}}\n");
    assert_eq!(segments[0].stderr, "session 1 stderr\n");
    assert_eq!(segments[1].stdout, "{\"usage\":{\"input_tokens\":2}}\n");
    assert!(segments[1].stderr.is_empty());
}

#[test]
fn a_single_session_segment_recovers_the_harness_stdout_exactly() {
    // One bracketed session: its slice is exactly the harness's stdout lines, so a
    // one-shot run's usage extraction sees what a direct invoke would.
    let body = "line a\nline b";
    let lines = vec![
        raw(OutputStream::Stdout, SESSION_BEGIN),
        raw(OutputStream::Stdout, "line a"),
        raw(OutputStream::Stdout, "line b"),
        raw(OutputStream::Stdout, SESSION_END),
    ];
    let segments = segment_sessions(&lines);
    assert_eq!(segments.len(), 1);
    assert_eq!(segments[0].stdout.trim_end(), body);
}

// --- token summing ----------------------------------------------------------

#[test]
fn add_tokens_keeps_unreported_classes_unreported() {
    // Both sides unreported for a class stays None; otherwise present values add.
    let a = TokenCounts {
        uncached_input: Some(10),
        cached_input: None,
        output: Some(5),
        reasoning: None,
    };
    let b = TokenCounts {
        uncached_input: Some(3),
        cached_input: Some(7),
        output: Some(2),
        reasoning: None,
    };
    let sum = add_tokens(a, b);
    assert_eq!(sum.uncached_input, Some(13));
    assert_eq!(sum.cached_input, Some(7)); // None + Some(7)
    assert_eq!(sum.output, Some(7));
    assert_eq!(sum.reasoning, None); // None + None
}

#[test]
fn summing_a_single_session_reproduces_its_counts() {
    let counts = TokenCounts {
        uncached_input: Some(100),
        cached_input: Some(40),
        output: Some(25),
        reasoning: None,
    };
    // Summing one session into the default total yields the session's own counts.
    assert_eq!(add_tokens(TokenCounts::default(), counts), counts);
}
