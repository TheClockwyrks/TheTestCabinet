//! The `shell` capability's **output offloading**: resolving the policy, the tail that comes back,
//! and the file pair the whole of it is written to.

use super::*;
use serde_json::json;
use tempfile::TempDir;

use crate::tools::{Tool, ToolContext};

/// An offloading policy with the given ceilings, writing into `dir`.
fn offloading(dir: &TempDir, max_lines: Option<usize>, max_chars: Option<usize>) -> OffloadPolicy {
    OffloadPolicy::Offload(OffloadLimits {
        max_lines,
        max_chars,
        dir: dir.path().join("offload"),
    })
}

/// An adaptive policy with the given ceilings, writing into `dir`.
fn adaptive(dir: &TempDir, max_lines: Option<usize>, max_chars: Option<usize>) -> OffloadPolicy {
    OffloadPolicy::Adaptive(OffloadLimits {
        max_lines,
        max_chars,
        dir: dir.path().join("offload"),
    })
}

/// Run `args` under `policy` in a fresh workspace, returning the outcome and the workspace (kept
/// alive so the offload directory under it survives the assertions).
async fn run(dir: &TempDir, policy: OffloadPolicy, args: serde_json::Value) -> ToolOutcome {
    let ctx = ToolContext::new(dir.path());
    ShellTool::new(policy).invoke(args, &ctx).await
}

/// The two files an offloaded command wrote, read back as text — found by their `.stdout`/`.stderr`
/// suffixes rather than by predicting the process-and-counter name in them.
fn written_pair(dir: &TempDir) -> (String, String) {
    let mut stdout = None;
    let mut stderr = None;
    for entry in std::fs::read_dir(dir.path().join("offload")).expect("offload directory") {
        let path = entry.unwrap().path();
        match path.extension().and_then(|ext| ext.to_str()) {
            Some("stdout") => stdout = Some(std::fs::read_to_string(&path).unwrap()),
            Some("stderr") => stderr = Some(std::fs::read_to_string(&path).unwrap()),
            other => panic!("unexpected offload file {path:?} ({other:?})"),
        }
    }
    (
        stdout.expect("a stdout file"),
        stderr.expect("a stderr file"),
    )
}

/// The [`ShellData`] an outcome carries.
fn shell_data(outcome: &ToolOutcome) -> &ShellData {
    match outcome.data.as_ref() {
        Some(ToolData::Shell(data)) => data,
        other => panic!("expected shell data, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Resolving the policy
// ---------------------------------------------------------------------------

/// Nothing configured is the adaptive mode at its default ceilings — the mode a run gets when its
/// capability set says nothing about output.
#[test]
fn an_unconfigured_capability_is_adaptive_at_the_defaults() {
    let policy = OffloadPolicy::resolve(None, &json!({}));
    assert_eq!(policy, OffloadPolicy::default());
    assert!(policy.withholds_on_success());
    let limits = policy.limits().expect("armed");
    assert_eq!(limits.max_lines, Some(DEFAULT_MAX_LINES));
    assert_eq!(limits.max_chars, Some(DEFAULT_MAX_CHARS));
    assert_eq!(limits.dir, std::path::Path::new(OFFLOAD_DIR));
}

/// The offload directory must not nest under the gg binary, which is a regular *file* at
/// `/tmp/gg` for the whole of a run.
///
/// This is the one thing about `OFFLOAD_DIR` no other test can see: every test above points `dir`
/// at a temp directory, so the production path is exercised only in a container. It regressed
/// exactly that way — `OFFLOAD_DIR` was once `/tmp/gg/shell`, every `create_dir_all` in a real run
/// failed with `ENOTDIR`, and offloading silently degraded to inline output for entire sessions.
/// The second half reproduces that failure against a temp replica, so this test fails loudly with
/// the reason rather than just an inscrutable string comparison.
#[tokio::test]
async fn offload_dir_is_not_under_the_gg_binary() {
    let binary = std::path::Path::new(test_cabinet_core::gg::BINARY_PATH);
    let offload = std::path::Path::new(OFFLOAD_DIR);
    assert!(
        !offload.starts_with(binary),
        "{OFFLOAD_DIR} nests under the gg binary at {}, so it can never be created in a run",
        binary.display(),
    );

    // Why it can never be created: a file where the parent directory would have to be.
    let temp = TempDir::new().expect("temp dir");
    let file_in_the_way = temp.path().join("gg");
    tokio::fs::write(&file_in_the_way, "the gg binary")
        .await
        .expect("write");
    let err = tokio::fs::create_dir_all(file_in_the_way.join("shell"))
        .await
        .expect_err("a directory cannot be created under a file");
    assert_eq!(err.kind(), std::io::ErrorKind::NotADirectory);
}

/// The inline mode is the opt-out, and it ignores the ceilings — they are the other modes'
/// configuration.
#[test]
fn the_inline_mode_is_the_opt_out() {
    assert_eq!(
        OffloadPolicy::resolve(Some(SHELL_OUTPUT_INLINE), &json!({ "maxLines": 10 })),
        OffloadPolicy::Inline,
    );
    assert!(OffloadPolicy::Inline.limits().is_none());
    assert!(!OffloadPolicy::Inline.withholds_on_success());
}

/// Either ceiling alone is a complete instruction, and leaves the axis it omits uncapped; both
/// together arm both. Read the same way under either truncating mode.
#[test]
fn either_ceiling_alone_arms_a_truncating_mode() {
    for mode in [SHELL_OUTPUT_OFFLOAD, SHELL_OUTPUT_ADAPTIVE] {
        let lines = OffloadPolicy::resolve(Some(mode), &json!({ "maxLines": 40 }));
        let limits = lines.limits().expect("armed");
        assert_eq!((limits.max_lines, limits.max_chars), (Some(40), None));

        let chars = OffloadPolicy::resolve(Some(mode), &json!({ "maxChars": 900 }));
        let limits = chars.limits().expect("armed");
        assert_eq!((limits.max_lines, limits.max_chars), (None, Some(900)));

        let both = OffloadPolicy::resolve(Some(mode), &json!({ "maxLines": 40, "maxChars": 900 }));
        let limits = both.limits().expect("armed");
        assert_eq!((limits.max_lines, limits.max_chars), (Some(40), Some(900)));
    }
}

/// A truncating mode that names **no** usable ceiling takes the defaults rather than quietly
/// becoming the inline mode under another name.
#[test]
fn a_truncating_mode_without_a_ceiling_takes_the_defaults() {
    for params in [
        json!({}),
        json!({ "maxLines": 0 }),
        json!({ "maxChars": "lots" }),
    ] {
        let policy = OffloadPolicy::resolve(Some(SHELL_OUTPUT_OFFLOAD), &params);
        assert_eq!(
            policy,
            OffloadPolicy::Offload(OffloadLimits::default()),
            "{params} should still offload, at the defaults",
        );
        assert!(!policy.withholds_on_success());
    }
}

/// An unrecognized mode is a misconfiguration, not an instruction: it reads as the default mode
/// (what an unconfigured run does), not as one of the arms nobody named. The launch log warns about
/// it separately, so it is never silent.
#[test]
fn an_unknown_mode_reads_as_the_default() {
    assert_eq!(
        OffloadPolicy::resolve(Some("offlaod"), &json!({ "maxLines": 5 })),
        OffloadPolicy::Adaptive(OffloadLimits {
            max_lines: Some(5),
            max_chars: None,
            dir: PathBuf::from(OFFLOAD_DIR),
        })
    );
}

/// The ceilings read the same way in the tool description, the system prompt, and the truncation
/// note, because all three ask the same object.
#[test]
fn limits_describe_themselves_in_prose() {
    let describe = |lines, chars| {
        OffloadLimits {
            max_lines: lines,
            max_chars: chars,
            dir: PathBuf::from(OFFLOAD_DIR),
        }
        .describe()
    };
    assert_eq!(describe(Some(200), None), "last 200 lines");
    assert_eq!(describe(None, Some(4_000)), "last 4000 characters");
    assert_eq!(
        describe(Some(200), Some(4_000)),
        "last 200 lines and 4000 characters"
    );
}

// ---------------------------------------------------------------------------
// Running a command under offloading
// ---------------------------------------------------------------------------

/// Output under the ceiling comes back whole, with no note — a two-line command costs no context
/// for a feature it did not need.
#[tokio::test]
async fn short_output_comes_back_untouched() {
    let dir = TempDir::new().unwrap();
    let outcome = run(
        &dir,
        offloading(&dir, Some(50), None),
        json!({ "command": "echo one; echo two" }),
    )
    .await;

    assert!(outcome.ok);
    let data = shell_data(&outcome);
    assert_eq!(data.body, "one\ntwo\n");
    assert!(!data.truncated);
    assert!(!outcome.output.contains("truncated"), "{}", outcome.output);
}

/// Output over the line ceiling comes back as the tail, followed by a note naming both files — and
/// the files hold the whole of each stream.
#[tokio::test]
async fn long_output_is_tailed_and_written_to_the_file_pair() {
    let dir = TempDir::new().unwrap();
    let outcome = run(
        &dir,
        offloading(&dir, Some(3), None),
        json!({ "command": "for i in $(seq 1 40); do echo line-$i; done" }),
    )
    .await;

    assert!(outcome.ok);
    let data = shell_data(&outcome);
    assert!(data.truncated);
    assert!(
        data.body.starts_with("line-38\nline-39\nline-40\n"),
        "the tail is the last three lines: {}",
        data.body
    );
    assert!(!data.body.contains("line-37"), "{}", data.body);
    // The note is part of the body, so a code program that prints the output sees where the rest
    // went — not only the tool-calling prose around it.
    assert!(data.body.contains("Output truncated"), "{}", data.body);
    assert!(data.body.contains(".stdout"), "{}", data.body);
    assert!(data.body.contains(".stderr"), "{}", data.body);
    assert!(outcome.output.contains("line-40"), "{}", outcome.output);

    let (stdout, stderr) = written_pair(&dir);
    assert!(stdout.starts_with("line-1\n"), "{stdout}");
    assert!(stdout.ends_with("line-40\n"), "{stdout}");
    assert_eq!(stdout.lines().count(), 40);
    assert_eq!(stderr, "");
}

/// The streams are written **separately**, so a command's stderr is greppable on its own rather
/// than interleaved into one log.
#[tokio::test]
async fn each_stream_is_written_to_its_own_file() {
    let dir = TempDir::new().unwrap();
    run(
        &dir,
        offloading(&dir, Some(1), None),
        json!({ "command": "echo to-stdout; echo to-stderr 1>&2" }),
    )
    .await;

    let (stdout, stderr) = written_pair(&dir);
    assert_eq!(stdout, "to-stdout\n");
    assert_eq!(stderr, "to-stderr\n");
}

/// A command that printed nothing still gets its (empty) pair: "the full output is on disk" is only
/// useful if it is true unconditionally.
#[tokio::test]
async fn the_pair_is_written_even_for_a_silent_command() {
    let dir = TempDir::new().unwrap();
    let outcome = run(
        &dir,
        offloading(&dir, Some(5), None),
        json!({ "command": "true" }),
    )
    .await;

    assert!(outcome.output.contains("(no output)"), "{}", outcome.output);
    assert_eq!(written_pair(&dir), (String::new(), String::new()));
}

/// A character ceiling cuts by characters, keeping the tail.
#[tokio::test]
async fn a_character_ceiling_keeps_the_last_characters() {
    let dir = TempDir::new().unwrap();
    let outcome = run(
        &dir,
        offloading(&dir, None, Some(10)),
        json!({ "command": "printf 'abcdefghijklmnopqrstuvwxyz'" }),
    )
    .await;

    let data = shell_data(&outcome);
    assert!(data.truncated);
    assert!(data.body.starts_with("qrstuvwxyz"), "{}", data.body);
    assert_eq!(written_pair(&dir).0, "abcdefghijklmnopqrstuvwxyz");
}

/// With both ceilings set the **tighter** one decides, because the result has to satisfy both.
#[tokio::test]
async fn the_tighter_of_two_ceilings_decides() {
    let dir = TempDir::new().unwrap();
    // Twenty lines of five characters each: the line ceiling would keep ten of them, the character
    // ceiling only the last three.
    let outcome = run(
        &dir,
        offloading(&dir, Some(10), Some(15)),
        json!({ "command": "for i in $(seq 10 29); do echo x-$i; done" }),
    )
    .await;

    let data = shell_data(&outcome);
    let tail: Vec<&str> = data
        .body
        .lines()
        .take_while(|line| !line.is_empty())
        .collect();
    assert_eq!(tail, vec!["x-27", "x-28", "x-29"]);
}

/// A killed command's partial output is offloaded on the same terms a completed one's is — a
/// command that hung after printing a hundred megabytes is exactly what this mode is for.
#[tokio::test]
async fn a_timed_out_command_still_writes_its_pair() {
    let dir = TempDir::new().unwrap();
    let outcome = run(
        &dir,
        offloading(&dir, Some(2), None),
        json!({
            // `exec` so the sleep REPLACES the shell rather than being forked by it: a grandchild
            // holding the pipe open past the kill is a race this test is not about.
            "command": "for i in $(seq 1 20); do echo noisy-$i; done; exec sleep 30",
            "timeout_secs": 0.5,
        }),
    )
    .await;

    assert!(!outcome.ok);
    assert!(outcome.output.contains("timed out"), "{}", outcome.output);
    assert!(
        outcome.output.contains("Output truncated"),
        "{}",
        outcome.output
    );
    assert!(written_pair(&dir).0.contains("noisy-1\n"));
}

/// When gg cannot write the pair, it does **not** truncate to a tail whose remainder now exists
/// nowhere: it falls back to the inline behavior and says why the promised files are missing.
#[tokio::test]
async fn a_failed_write_falls_back_to_inline_output() {
    let dir = TempDir::new().unwrap();
    // A regular file where the offload directory should be, so `create_dir_all` cannot succeed.
    let blocked = dir.path().join("blocked");
    std::fs::write(&blocked, "not a directory").unwrap();
    let outcome = run(
        &dir,
        OffloadPolicy::Offload(OffloadLimits {
            max_lines: Some(2),
            max_chars: None,
            dir: blocked.join("shell"),
        }),
        json!({ "command": "for i in $(seq 1 20); do echo kept-$i; done" }),
    )
    .await;

    assert!(outcome.ok);
    let data = shell_data(&outcome);
    assert!(!data.truncated, "the whole output fits under the byte cap");
    assert!(data.body.contains("kept-1\n"), "{}", data.body);
    assert!(data.body.contains("kept-20\n"), "{}", data.body);
    assert!(
        data.body.contains("could not write"),
        "the failure is disclosed: {}",
        data.body
    );
}

/// The tool's own description states the ceiling and the directory when offloading is on, so a model
/// reading the schema of the tool it is about to call learns the rule there too.
#[test]
fn the_definition_states_the_ceiling_when_offloading() {
    let inline = ShellTool::new(OffloadPolicy::Inline).definition();
    assert!(
        !inline.description.contains("grep"),
        "{}",
        inline.description
    );

    let limits = OffloadLimits {
        max_lines: Some(120),
        max_chars: None,
        dir: PathBuf::from(OFFLOAD_DIR),
    };
    let offloaded = ShellTool::new(OffloadPolicy::Offload(limits.clone())).definition();
    assert!(
        offloaded.description.contains("last 120 lines"),
        "{}",
        offloaded.description
    );
    assert!(
        offloaded.description.contains(OFFLOAD_DIR),
        "{}",
        offloaded.description
    );

    // The adaptive description has the extra thing to say, and the model that will be surprised by
    // an empty result is the one that most needs to read it in the tool it is calling.
    let adaptive = ShellTool::new(OffloadPolicy::Adaptive(limits)).definition();
    assert!(
        adaptive
            .description
            .contains("succeeds returns only its exit code"),
        "{}",
        adaptive.description
    );
    assert!(
        adaptive.description.contains("last 120 lines")
            && adaptive.description.contains(OFFLOAD_DIR),
        "{}",
        adaptive.description
    );
}

// ---------------------------------------------------------------------------
// The adaptive mode
// ---------------------------------------------------------------------------

/// A command that worked comes back as its exit code and the paths — not as its output, however
/// short that output was.
#[tokio::test]
async fn a_successful_command_returns_only_its_exit_code() {
    let dir = TempDir::new().unwrap();
    let outcome = run(
        &dir,
        adaptive(&dir, Some(50), None),
        json!({ "command": "echo one; echo two" }),
    )
    .await;

    assert!(outcome.ok);
    assert!(
        outcome.output.starts_with("exit code: 0\n"),
        "{}",
        outcome.output
    );
    assert!(!outcome.output.contains("one"), "{}", outcome.output);
    let data = shell_data(&outcome);
    assert!(data.truncated);
    assert!(data.body.contains("succeeded"), "{}", data.body);
    // The output is withheld, not discarded: the pair holds the whole of it, and the body says so.
    assert!(
        data.body.contains(".stdout") && data.body.contains(".stderr"),
        "{}",
        data.body
    );
    assert_eq!(written_pair(&dir).0, "one\ntwo\n");
}

/// A command that printed nothing and worked is reported as exactly that, with no note pointing at
/// two empty files.
#[tokio::test]
async fn a_silent_successful_command_says_no_output() {
    let dir = TempDir::new().unwrap();
    let outcome = run(
        &dir,
        adaptive(&dir, Some(50), None),
        json!({ "command": "true" }),
    )
    .await;

    assert!(outcome.ok);
    assert_eq!(outcome.output, "exit code: 0\n(no output)");
    let data = shell_data(&outcome);
    assert!(data.body.is_empty(), "{}", data.body);
    assert!(!data.truncated);
}

/// A command that **failed** comes back exactly as it would under offloading — the tail, the note,
/// and the pair. This is the half of the mode that is worth the other half.
#[tokio::test]
async fn a_failed_command_is_offloaded_normally() {
    let dir = TempDir::new().unwrap();
    let outcome = run(
        &dir,
        adaptive(&dir, Some(3), None),
        json!({ "command": "for i in $(seq 1 40); do echo line-$i; done; exit 3" }),
    )
    .await;

    assert!(!outcome.ok);
    assert!(
        outcome.output.starts_with("exit code: 3\n"),
        "{}",
        outcome.output
    );
    let data = shell_data(&outcome);
    assert_eq!(data.exit_code, Some(3));
    assert!(data.truncated);
    assert!(
        data.body.starts_with("line-38\nline-39\nline-40\n"),
        "{}",
        data.body
    );
    assert!(data.body.contains("Output truncated"), "{}", data.body);
    assert_eq!(written_pair(&dir).0.lines().count(), 40);
}

/// A short failure comes back whole, with no note — the ceiling only bites what exceeds it.
#[tokio::test]
async fn a_short_failure_comes_back_untouched() {
    let dir = TempDir::new().unwrap();
    let outcome = run(
        &dir,
        adaptive(&dir, Some(50), None),
        json!({ "command": "echo broke 1>&2; exit 1" }),
    )
    .await;

    assert!(!outcome.ok);
    let data = shell_data(&outcome);
    assert_eq!(data.body, "broke\n");
    assert!(!data.truncated);
}

/// A killed command did not succeed, so its partial output is offloaded rather than withheld: the
/// agent is about to be told something went wrong, and the output is the part that says what.
#[tokio::test]
async fn a_timed_out_command_is_not_withheld() {
    let dir = TempDir::new().unwrap();
    let outcome = run(
        &dir,
        adaptive(&dir, Some(2), None),
        json!({
            // `exec` so the sleep REPLACES the shell rather than being forked by it, as above.
            "command": "for i in $(seq 1 20); do echo noisy-$i; done; exec sleep 30",
            "timeout_secs": 0.5,
        }),
    )
    .await;

    assert!(!outcome.ok);
    assert!(outcome.output.contains("timed out"), "{}", outcome.output);
    assert!(outcome.output.contains("noisy-20"), "{}", outcome.output);
}

/// When gg cannot write the pair there is nowhere to withhold the output *to*, so a successful
/// command falls back to handing it over — withholding what nobody can retrieve is discarding.
#[tokio::test]
async fn a_failed_write_hands_a_successful_commands_output_over() {
    let dir = TempDir::new().unwrap();
    let blocked = dir.path().join("blocked");
    std::fs::write(&blocked, "not a directory").unwrap();
    let outcome = run(
        &dir,
        OffloadPolicy::Adaptive(OffloadLimits {
            max_lines: Some(2),
            max_chars: None,
            dir: blocked.join("shell"),
        }),
        json!({ "command": "for i in $(seq 1 20); do echo kept-$i; done" }),
    )
    .await;

    assert!(outcome.ok);
    let data = shell_data(&outcome);
    assert!(
        data.body.contains("kept-1\n") && data.body.contains("kept-20\n"),
        "{}",
        data.body
    );
    assert!(data.body.contains("could not write"), "{}", data.body);
}

// ---------------------------------------------------------------------------
// The tail helpers
// ---------------------------------------------------------------------------

/// A trailing newline terminates the last line rather than starting a new one — `tail -n` counts
/// the same way, and an agent comparing the two will expect it to.
#[test]
fn the_line_tail_counts_lines_the_way_tail_does() {
    assert_eq!(&"a\nb\nc\n"[line_tail_start("a\nb\nc\n", 2)..], "b\nc\n");
    assert_eq!(&"a\nb\nc"[line_tail_start("a\nb\nc", 2)..], "b\nc");
    assert_eq!(line_tail_start("a\nb\n", 5), 0, "fewer lines than the cap");
    assert_eq!(line_tail_start("", 3), 0);
}

/// The character tail counts **characters**, not bytes, so a ceiling means the same thing whatever
/// the output is written in — and it never splits one.
#[test]
fn the_character_tail_counts_characters_not_bytes() {
    let text = "αβγδε";
    assert_eq!(&text[char_tail_start(text, 2)..], "δε");
    assert_eq!(
        char_tail_start(text, 99),
        0,
        "fewer characters than the cap"
    );
    assert_eq!(char_tail_start("", 3), 0);
}
