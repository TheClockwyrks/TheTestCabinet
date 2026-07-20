//! Tests for orchestrator resolution, the `tcab-session` wrapper rendering, and
//! session segmentation.

use std::process::Command;

use super::*;
use crate::event::{EventFormat, NoopEventSink};
use crate::execution::{ContainerSpec, ContainerStart, OutputStream, RawOutputLine};
use crate::harness::{Availability, HarnessInvocation};
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

// --- in-container execution (integration) -----------------------------------
//
// These drive `drive_orchestrator` end to end against a real POSIX shell. A fake
// `ContainerRuntime` runs every `sh -c` the orchestrator layer issues as a host
// process — with `$HOME` and the workspace rooted in a temp dir and
// `~/.local/bin` on `PATH`, exactly as the base image arranges — and a fake
// harness whose "session" records the prompt it was handed and emits a usage
// line. So the runner script, the `tcab-session` wrapper, the sentinel
// segmentation, and the per-session usage summing all execute for real, and the
// recursive `tcab-session` calls happen inside the runner's own process tree
// (never back through the runtime), mirroring how a real container runs.

/// An epoch far enough in the future that a runner's deadline check never trips.
/// (Kept within `i64` so shell `test -ge` compares it without overflow.)
const NO_DEADLINE: u64 = 32_503_680_000; // ~ 3000-01-01

/// The maximum runtime the success-path drives run under. Their deadline is
/// [`NO_DEADLINE`], so the deadline branch is never reached; this value only
/// labels a [`Error::RunTimedOut`], which those drives never produce.
const TEST_MAX_RUNTIME: u64 = 3_600;

/// A `ContainerRuntime` that runs each command as a host process, so the
/// orchestrator's in-container shell work executes for real against a temp-dir
/// "container". `$HOME` and `PATH` are set as the base image would, so the
/// `tcab-session` wrapper resolves off `~/.local/bin`.
struct HostShellRuntime {
    home: PathBuf,
    path: String,
}

impl HostShellRuntime {
    fn new(home: PathBuf) -> Self {
        let base_path = std::env::var("PATH").unwrap_or_default();
        let path = format!("{}/.local/bin:{base_path}", home.display());
        Self { home, path }
    }
}

#[async_trait::async_trait]
impl ContainerRuntime for HostShellRuntime {
    async fn start(&self, _spec: &ContainerSpec) -> Result<ContainerStart> {
        unreachable!("the orchestrator drives an already-started container")
    }

    async fn exec(&self, _container: &ContainerHandle, command: &[String]) -> Result<ExecOutput> {
        let output = Command::new(&command[0])
            .args(&command[1..])
            .env("HOME", &self.home)
            .env("PATH", &self.path)
            .output()
            .map_err(|err| Error::ContainerRuntime(err.to_string()))?;
        Ok(ExecOutput {
            exit_code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }

    async fn stop(&self, _container: &ContainerHandle) -> Result<()> {
        Ok(())
    }
}

/// One usage line the fake harness emits, parsed back out of a session segment.
#[derive(Deserialize)]
struct ReportedUsage {
    input_tokens: u64,
    output_tokens: u64,
}

/// A fake harness whose "session" records the prompt it received (one file per
/// session, `prompt.<n>`) and emits a usage line, and which creates the marker
/// file once it has run `sessions_before_marker` times — standing in for a model
/// that signals completion per the ralph protocol.
struct RecordingHarness {
    /// Absolute path to a file tracking how many sessions have run.
    count_file: String,
    /// Absolute directory the per-session prompt captures are written to.
    capture_dir: String,
    /// Absolute path of the marker file — the very path the runner checks.
    marker_file: String,
    /// The session count at which the harness creates the marker.
    sessions_before_marker: u32,
}

#[async_trait::async_trait]
impl AgentHarness for RecordingHarness {
    fn slug(&self) -> HarnessSlug {
        HarnessSlug::Claude
    }

    fn api_key_env(&self) -> Option<&'static str> {
        Some("FAKE_API_KEY")
    }

    fn session_argv(&self, _model_id: &str, prompt: &str) -> Vec<String> {
        // Positional args to the script: $1=count $2=capture-dir $3=marker
        // $4=threshold $5=prompt. The final element is the prompt sentinel; the
        // orchestrator swaps it for the wrapper's first argument, so `$5` is
        // whatever prompt this session is handed.
        let script = r#"
n=$(cat "$1" 2>/dev/null || echo 0)
n=$((n + 1))
printf '%s' "$n" > "$1"
printf '%s' "$5" > "$2/prompt.$n"
printf '%s\n' '{"input_tokens":10,"output_tokens":5}'
if [ "$n" -ge "$4" ]; then : > "$3"; fi
"#;
        vec![
            "sh".to_string(),
            "-c".to_string(),
            script.to_string(),
            "tcab-fake".to_string(),
            self.count_file.clone(),
            self.capture_dir.clone(),
            self.marker_file.clone(),
            self.sessions_before_marker.to_string(),
            prompt.to_string(),
        ]
    }

    fn event_format(&self) -> EventFormat {
        EventFormat::Generic
    }

    fn parse_session_usage(&self, output: &ExecOutput) -> (Usage, Option<f64>) {
        // Sum the counts from every usage line this segment carries — one per
        // session, so a segment for one session yields that session's counts.
        let mut tokens = TokenCounts::default();
        for line in output.stdout.lines() {
            if let Ok(reported) = serde_json::from_str::<ReportedUsage>(line) {
                tokens.uncached_input =
                    Some(tokens.uncached_input.unwrap_or(0) + reported.input_tokens);
                tokens.output = Some(tokens.output.unwrap_or(0) + reported.output_tokens);
            }
        }
        (Usage { tokens }, None)
    }

    async fn probe(
        &self,
        _runtime: &dyn ContainerRuntime,
        _container: &ContainerHandle,
    ) -> Result<Availability> {
        unreachable!("the orchestrator does not probe")
    }

    async fn invoke(
        &self,
        _runtime: &dyn ContainerRuntime,
        _container: &ContainerHandle,
        _invocation: &HarnessInvocation,
        _events: &mut dyn EventSink,
    ) -> Result<HarnessOutcome> {
        unreachable!("the orchestrator drives sessions through tcab-session, not invoke")
    }
}

/// What driving an orchestrator against the host-shell fake actually did: the
/// aggregated outcome, the prompt each session was handed (in session order), and
/// how many sessions ran.
struct DriveResult {
    outcome: HarnessOutcome,
    prompts: Vec<String>,
    session_count: u32,
}

/// Drive the built-in `slug`'s runner against a fresh temp workspace: `goal` is
/// the base prompt, the fake harness marks itself done after
/// `sessions_before_marker` sessions, and `deadline_epoch` is the runner's
/// deadline. Returns what happened on disk.
async fn drive(
    slug: &str,
    goal: &str,
    sessions_before_marker: u32,
    deadline_epoch: u64,
) -> DriveResult {
    let root = tempfile::tempdir().expect("temp dir");
    let home = root.path().join("home");
    let workspace = root.path().join("work");
    let capture = root.path().join("captures");
    for dir in [&home, &workspace, &capture] {
        std::fs::create_dir_all(dir).expect("create dir");
    }

    let orchestrator = OrchestratorCatalog::new()
        .resolve(&OrchestratorSelection::builtin(slug))
        .expect("orchestrator resolves");

    // The marker the fake harness creates is the exact path this orchestrator's
    // runner checks: the workspace joined with the manifest's `marker_file` param.
    // A single-session orchestrator declares none and needs none.
    let marker_file = orchestrator
        .manifest
        .params
        .get("marker_file")
        .map(|rel| workspace.join(rel))
        .unwrap_or_else(|| workspace.join(".tcab/unused-marker"));

    let count_file = root.path().join("session-count");
    let harness = RecordingHarness {
        count_file: count_file.to_string_lossy().into_owned(),
        capture_dir: capture.to_string_lossy().into_owned(),
        marker_file: marker_file.to_string_lossy().into_owned(),
        sessions_before_marker,
    };
    let runtime = HostShellRuntime::new(home);
    let container = ContainerHandle {
        id: "fake".to_string(),
    };
    let mut events = NoopEventSink;

    let outcome = drive_orchestrator(
        &runtime,
        &container,
        &harness,
        &orchestrator,
        HarnessSlug::Claude,
        "fake-model",
        goal,
        &workspace.to_string_lossy(),
        deadline_epoch,
        TEST_MAX_RUNTIME,
        &mut events,
    )
    .await
    .expect("orchestrator drives to completion");

    let prompts = read_captured_prompts(&capture);
    let session_count = std::fs::read_to_string(&count_file)
        .ok()
        .and_then(|raw| raw.trim().parse().ok())
        .unwrap_or(0);
    DriveResult {
        outcome,
        prompts,
        session_count,
    }
}

/// Read the per-session prompt captures (`prompt.1`, `prompt.2`, …) in session
/// order.
fn read_captured_prompts(capture: &Path) -> Vec<String> {
    let mut entries: Vec<(u32, String)> = std::fs::read_dir(capture)
        .expect("read captures")
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            let index: u32 = path
                .file_name()?
                .to_str()?
                .strip_prefix("prompt.")?
                .parse()
                .ok()?;
            Some((index, std::fs::read_to_string(&path).ok()?))
        })
        .collect();
    entries.sort_by_key(|(index, _)| *index);
    entries.into_iter().map(|(_, body)| body).collect()
}

#[tokio::test]
async fn ralph_loops_until_the_marker_and_wraps_the_prompt_each_session() {
    let goal = "Build the reference brick-breaker game.";
    // The harness signals completion (creates the marker) on its second session.
    let result = drive(RALPH_SLUG, goal, 2, NO_DEADLINE).await;

    // The loop ran exactly until the marker appeared: two sessions, no more.
    assert_eq!(result.session_count, 2);
    assert_eq!(result.prompts.len(), 2);

    // Every session was handed the ralph protocol wrapped around the goal: the
    // goal itself, the progress-file protocol, and the instruction to create the
    // marker file to signal completion.
    for prompt in &result.prompts {
        assert!(
            prompt.contains(goal),
            "goal missing from session prompt: {prompt}"
        );
        assert!(
            prompt.contains(".tcab/ralph/progress.md"),
            "progress-file protocol missing: {prompt}"
        );
        assert!(
            prompt.contains(".tcab/ralph/done"),
            "marker-file instruction missing: {prompt}"
        );
        assert!(
            prompt.contains("Do not create it early."),
            "completion protocol missing: {prompt}"
        );
        // The wrapping adds material beyond the bare goal.
        assert!(
            prompt.len() > goal.len(),
            "prompt was not wrapped: {prompt}"
        );
    }

    // Usage summed across both sessions (each reported 10 input + 5 output).
    assert_eq!(result.outcome.usage.tokens.uncached_input, Some(20));
    assert_eq!(result.outcome.usage.tokens.output, Some(10));
}

#[tokio::test]
async fn one_shot_runs_a_single_unwrapped_session() {
    let goal = "Draw the sprite.";
    // A threshold it never reaches: one-shot needs no marker — it is a single
    // session regardless.
    let result = drive(ONE_SHOT_SLUG, goal, 99, NO_DEADLINE).await;

    assert_eq!(result.session_count, 1);
    // one-shot hands the goal straight through, with no protocol wrapping.
    assert_eq!(result.prompts, vec![goal.to_string()]);
    assert_eq!(result.outcome.usage.tokens.uncached_input, Some(10));
    assert_eq!(result.outcome.usage.tokens.output, Some(5));
}

#[tokio::test]
async fn ralph_stops_at_the_deadline_before_running_a_session() {
    // A deadline already in the past: the loop's first check breaks before any
    // session runs, yet the runner still exits cleanly with an empty outcome
    // (partial work — here, none — is collected, not discarded).
    let result = drive(RALPH_SLUG, "Build it.", 2, 1).await;

    assert_eq!(result.session_count, 0);
    assert!(result.prompts.is_empty());
    assert_eq!(result.outcome.usage.tokens.uncached_input, None);
    assert_eq!(result.outcome.usage.tokens.output, None);
}

/// A fake harness whose session always exits non-zero, standing in for a run that
/// the container tore down (killed at the deadline) or a genuine harness failure —
/// the two the reclassification below must tell apart by the deadline alone.
struct FailingHarness;

#[async_trait::async_trait]
impl AgentHarness for FailingHarness {
    fn slug(&self) -> HarnessSlug {
        HarnessSlug::Claude
    }

    fn api_key_env(&self) -> Option<&'static str> {
        Some("FAKE_API_KEY")
    }

    fn session_argv(&self, _model_id: &str, prompt: &str) -> Vec<String> {
        // Exit non-zero, exactly as a killed or failed session's process would; the
        // wrapper propagates the code so the runner exit is non-zero.
        vec![
            "sh".to_string(),
            "-c".to_string(),
            "exit 1".to_string(),
            "tcab-fake".to_string(),
            prompt.to_string(),
        ]
    }

    fn event_format(&self) -> EventFormat {
        EventFormat::Generic
    }

    fn parse_session_usage(&self, _output: &ExecOutput) -> (Usage, Option<f64>) {
        (Usage::default(), None)
    }

    async fn probe(
        &self,
        _runtime: &dyn ContainerRuntime,
        _container: &ContainerHandle,
    ) -> Result<Availability> {
        unreachable!("the orchestrator does not probe")
    }

    async fn invoke(
        &self,
        _runtime: &dyn ContainerRuntime,
        _container: &ContainerHandle,
        _invocation: &HarnessInvocation,
        _events: &mut dyn EventSink,
    ) -> Result<HarnessOutcome> {
        unreachable!("the orchestrator drives sessions through tcab-session, not invoke")
    }
}

/// Drive the one-shot runner with a session that exits non-zero, under the given
/// `deadline_epoch`, and return the resulting error.
async fn drive_failing(deadline_epoch: u64) -> Error {
    let root = tempfile::tempdir().expect("temp dir");
    let home = root.path().join("home");
    let workspace = root.path().join("work");
    for dir in [&home, &workspace] {
        std::fs::create_dir_all(dir).expect("create dir");
    }
    let orchestrator = OrchestratorCatalog::new()
        .resolve(&OrchestratorSelection::builtin(ONE_SHOT_SLUG))
        .expect("orchestrator resolves");
    let runtime = HostShellRuntime::new(home);
    let container = ContainerHandle {
        id: "fake".to_string(),
    };
    let mut events = NoopEventSink;
    drive_orchestrator(
        &runtime,
        &container,
        &FailingHarness,
        &orchestrator,
        HarnessSlug::Claude,
        "fake-model",
        "Build it.",
        &workspace.to_string_lossy(),
        deadline_epoch,
        TEST_MAX_RUNTIME,
        &mut events,
    )
    .await
    .expect_err("a non-zero runner exit must be an error")
}

#[tokio::test]
async fn nonzero_runner_exit_at_the_deadline_is_a_timeout_not_a_harness_error() {
    // Past the deadline, a killed runner is the run exhausting its maximum runtime,
    // so it must classify as a timeout (whose work is published) rather than a
    // harness error — a deadline of 1 (epoch) is comfortably in the past.
    match drive_failing(1).await {
        Error::RunTimedOut { seconds, .. } => assert_eq!(seconds, TEST_MAX_RUNTIME),
        other => panic!("expected a timeout past the deadline, got {other:?}"),
    }
}

#[tokio::test]
async fn nonzero_runner_exit_before_the_deadline_is_a_harness_error() {
    // Well before the deadline, the same non-zero exit is a genuine harness failure
    // and must stay a harness error, not be misread as a timeout.
    match drive_failing(NO_DEADLINE).await {
        Error::HarnessInvocation { .. } => {}
        other => panic!("expected a harness error before the deadline, got {other:?}"),
    }
}
