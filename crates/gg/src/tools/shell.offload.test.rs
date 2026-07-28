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

/// Nothing configured is the historical behavior: output comes back inline, and nothing is written
/// to disk.
#[test]
fn an_unconfigured_capability_is_inline() {
    assert_eq!(
        OffloadPolicy::resolve(None, &json!({})),
        OffloadPolicy::Inline
    );
    assert_eq!(
        OffloadPolicy::resolve(Some(SHELL_OUTPUT_INLINE), &json!({ "maxLines": 10 })),
        OffloadPolicy::Inline,
        "the inline mode ignores ceilings — they are the other mode's configuration",
    );
}

/// Either ceiling alone arms offloading; both together arm both.
#[test]
fn offloading_resolves_from_either_ceiling() {
    let lines = OffloadPolicy::resolve(Some(SHELL_OUTPUT_OFFLOAD), &json!({ "maxLines": 40 }));
    let limits = lines.limits().expect("armed");
    assert_eq!(limits.max_lines, Some(40));
    assert_eq!(limits.max_chars, None);
    assert_eq!(limits.dir, std::path::Path::new(OFFLOAD_DIR));

    let chars = OffloadPolicy::resolve(Some(SHELL_OUTPUT_OFFLOAD), &json!({ "maxChars": 900 }));
    assert_eq!(chars.limits().expect("armed").max_chars, Some(900));

    let both = OffloadPolicy::resolve(
        Some(SHELL_OUTPUT_OFFLOAD),
        &json!({ "maxLines": 40, "maxChars": 900 }),
    );
    let limits = both.limits().expect("armed");
    assert_eq!((limits.max_lines, limits.max_chars), (Some(40), Some(900)));
}

/// An `offload` mode with no usable ceiling falls back to the inline behavior rather than inventing
/// one — and says so, so the operator is not left with a control run wearing the treatment's name.
#[test]
fn offloading_without_a_ceiling_falls_back_to_inline_and_is_reported() {
    for params in [
        json!({}),
        json!({ "maxLines": 0 }),
        json!({ "maxChars": "lots" }),
    ] {
        assert_eq!(
            OffloadPolicy::resolve(Some(SHELL_OUTPUT_OFFLOAD), &params),
            OffloadPolicy::Inline,
            "{params} should not arm offloading",
        );
        assert!(offload_misconfigured(Some(SHELL_OUTPUT_OFFLOAD), &params));
    }
    // The two configurations that are not a misconfiguration: an armed offload, and not asking for
    // one at all.
    assert!(!offload_misconfigured(
        Some(SHELL_OUTPUT_OFFLOAD),
        &json!({ "maxLines": 5 })
    ));
    assert!(!offload_misconfigured(None, &json!({})));
}

/// An unrecognized mode is a misconfiguration, not an instruction: it reads as inline (what an
/// unconfigured run does), not as an offload with defaults nobody chose.
#[test]
fn an_unknown_mode_reads_as_inline() {
    assert_eq!(
        OffloadPolicy::resolve(Some("offlaod"), &json!({ "maxLines": 5 })),
        OffloadPolicy::Inline
    );
    assert!(!offload_misconfigured(
        Some("offlaod"),
        &json!({ "maxLines": 5 })
    ));
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

    let offloaded = ShellTool::new(OffloadPolicy::Offload(OffloadLimits {
        max_lines: Some(120),
        max_chars: None,
        dir: PathBuf::from(OFFLOAD_DIR),
    }))
    .definition();
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
