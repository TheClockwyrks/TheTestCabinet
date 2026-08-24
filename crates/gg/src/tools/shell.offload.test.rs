//! The `shell` capability's **output offloading**: resolving the policy, the tail that comes back,
//! and the file pair the whole of it is written to.

use super::*;
use serde_json::json;
use tempfile::TempDir;

use crate::tools::{Tool, ToolContext};
use crate::validate::{LaunchDefect, LaunchReport};

/// The policy `implementation`/`params` resolve to, asserting gg honoured them exactly as written.
fn resolved(implementation: Option<&str>, params: &serde_json::Value) -> OffloadPolicy {
    let mut report = LaunchReport::collecting();
    let policy = OffloadPolicy::resolve(implementation, params, &mut report);
    let defects = report.into_defects();
    assert!(defects.is_empty(), "unexpected refusals: {defects:?}");
    policy
}

/// Everything resolving `implementation`/`params` reports, for the cases whose subject is the
/// refusal.
fn reported(
    implementation: Option<&str>,
    params: &serde_json::Value,
) -> (OffloadPolicy, Vec<LaunchDefect>) {
    let mut report = LaunchReport::collecting();
    let policy = OffloadPolicy::resolve(implementation, params, &mut report);
    (policy, report.into_defects())
}

/// A ceiling no command in these tests reaches, for the axis a case is not about. Both ceilings are
/// always set — the output has to satisfy both — so a case testing one of them says so by leaving
/// the other far enough out to never bite.
const UNBOUNDED: usize = 1_000_000;

/// An offloading policy with the given ceilings, writing into `dir`.
fn offloading(dir: &TempDir, max_lines: usize, max_chars: usize) -> OffloadPolicy {
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
        Some(ApiData::Shell(data)) => data,
        other => panic!("expected shell data, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Resolving the policy
// ---------------------------------------------------------------------------

/// A fully written capability resolves to the mode it names, at the ceilings it writes, and reports
/// nothing.
#[test]
fn a_written_capability_resolves_to_what_it_says() {
    let policy = resolved(
        Some(SHELL_OUTPUT_OFFLOAD),
        &json!({ "maxLines": 250, "maxChars": 4096 }),
    );
    let limits = policy.limits().expect("armed");
    assert_eq!(limits.max_lines, 250);
    assert_eq!(limits.max_chars, 4096);
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

/// The inline mode is the opt-out, and it carries no ceilings — they are the other modes'
/// configuration. It still writes them, because one params block swept across the three modes is
/// judged the same way on every launch in it.
#[test]
fn the_inline_mode_is_the_opt_out() {
    assert_eq!(
        resolved(
            Some(SHELL_OUTPUT_INLINE),
            &json!({ "maxLines": 10, "maxChars": 400 })
        ),
        OffloadPolicy::Inline,
    );
    assert!(OffloadPolicy::Inline.limits().is_none());
}

/// Both ceilings are written on every arm, and both come back as written.
#[test]
fn both_ceilings_arm_a_truncating_mode() {
    let both = resolved(
        Some(SHELL_OUTPUT_OFFLOAD),
        &json!({ "maxLines": 40, "maxChars": 900 }),
    );
    let limits = both.limits().expect("armed");
    assert_eq!((limits.max_lines, limits.max_chars), (40, 900));
}

/// **A ceiling nobody wrote refuses the launch**, at its own locus and whichever mode is named —
/// including `inline`, which does not carry the ceilings.
///
/// A truncating mode is defined by what it truncates past, so "offload past nothing" is the inline
/// mode wearing another name; and a figure gg picked would run one arm of the offloading experiment
/// while the record named the ceilings nobody wrote. An operator short of both hears about both in
/// one refusal.
#[test]
fn an_absent_ceiling_is_refused() {
    for mode in [SHELL_OUTPUT_OFFLOAD, SHELL_OUTPUT_INLINE] {
        for (params, missing) in [
            (json!({ "maxChars": 900 }), vec!["maxLines"]),
            (json!({ "maxLines": 40 }), vec!["maxChars"]),
            (json!({}), vec!["maxLines", "maxChars"]),
            (
                json!({ "maxLines": null, "maxChars": null }),
                vec!["maxLines", "maxChars"],
            ),
        ] {
            let (policy, defects) = reported(Some(mode), &params);
            assert_eq!(
                defects.len(),
                missing.len(),
                "{mode} {params} -> {defects:?}"
            );
            for key in &missing {
                assert!(
                    defects
                        .iter()
                        .any(|defect| defect.locus == format!("shell.params.{key}")
                            && defect.found.is_empty()),
                    "{mode} {params} -> {defects:?}"
                );
            }
            if mode == SHELL_OUTPUT_INLINE {
                assert_eq!(policy, OffloadPolicy::Inline, "{params}: inline needs none");
            } else {
                assert_eq!(
                    policy,
                    OffloadPolicy::LaunchRefused,
                    "{mode} {params}: a truncating arm has nothing to truncate past"
                );
            }
        }
    }
}

/// A ceiling gg cannot honour **refuses the launch**. A `0` returns none of the command's output and
/// a `"lots"` names no number at all; reading either as "no ceiling on this axis" says the opposite
/// of what was written, and there is no figure gg would put there instead.
///
/// Read whichever arm is selected — including `inline`, which does not carry the ceilings — so a
/// typo is refused in this pass rather than in whichever launch first happens to select a truncating
/// mode.
#[test]
fn an_unusable_ceiling_is_refused() {
    for (key, value) in [
        ("maxLines", json!(0)),
        ("maxChars", json!("lots")),
        ("maxLines", json!(-1)),
        ("maxChars", json!(4.5)),
    ] {
        for mode in [SHELL_OUTPUT_OFFLOAD, SHELL_OUTPUT_INLINE] {
            // The other ceiling written, so the one defect is the one under test.
            let mut params = json!({ "maxLines": 40, "maxChars": 900 });
            params[key] = value.clone();
            let (_, defects) = reported(Some(mode), &params);
            assert_eq!(defects.len(), 1, "{mode} {params} -> {defects:?}");
            assert_eq!(defects[0].locus, format!("shell.params.{key}"));
        }
    }
}

/// **An integral float is a count.** JSON has no integer type, so a sweep generated from JavaScript
/// writes `40.0` as readily as `40`.
#[test]
fn an_integral_float_is_a_ceiling() {
    let policy = resolved(
        Some(SHELL_OUTPUT_OFFLOAD),
        &json!({ "maxLines": 40.0, "maxChars": 900 }),
    );
    assert_eq!(policy.limits().expect("armed").max_lines, 40);
}

/// **A mode gg does not recognize refuses the launch.** Reading it as any of the three would run one
/// arm of the offloading experiment under the arm nobody named, which is the study answering a
/// question it was not asked.
#[test]
fn an_unknown_mode_is_refused() {
    let (policy, defects) = reported(Some("offlaod"), &json!({ "maxLines": 5, "maxChars": 50 }));
    assert_eq!(
        policy,
        OffloadPolicy::LaunchRefused,
        "the resolver stays total"
    );
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(defects[0].locus, "shell.implementation");
    assert_eq!(defects[0].known, SHELL_OUTPUT_MODES);
}

/// **An unwritten mode is not one of the modes.** The arm is the offloading experiment's own
/// variable, so the resolver has nothing to select and answers with the placeholder that says so. It
/// reports nothing: the absence belongs to the launch pass, the one reader that can see whether the
/// capability is switched on.
#[test]
fn an_unwritten_mode_selects_no_arm() {
    for implementation in [None, Some(""), Some("   ")] {
        let (policy, defects) = reported(implementation, &json!({ "maxLines": 5, "maxChars": 50 }));
        assert_eq!(policy, OffloadPolicy::LaunchRefused, "{implementation:?}");
        assert_eq!(defects, Vec::new(), "{implementation:?}");
    }
}

/// A **disabled** shell capability is owed no ceiling — it offers no `shell`, so there is nothing it
/// could be short of — and everything it does write is still read, which is what keeps the on and
/// off arms of one comparison one document with one switch moved.
#[test]
fn a_disabled_capability_is_owed_nothing_and_still_read() {
    let judged = |implementation: Option<&str>, params: &serde_json::Value| {
        let mut report = LaunchReport::collecting();
        check_declaration(implementation, params, &mut report);
        report.into_defects()
    };

    assert_eq!(
        judged(Some(SHELL_OUTPUT_OFFLOAD), &json!({})),
        Vec::new(),
        "an absent ceiling is nothing to be short of"
    );
    assert_eq!(
        judged(None, &json!({})),
        Vec::new(),
        "nor is an absent mode"
    );

    let defects = judged(Some("offlaod"), &json!({ "maxChars": 0 }));
    assert_eq!(defects.len(), 2, "{defects:?}");
    assert!(
        defects
            .iter()
            .any(|defect| defect.locus == "shell.implementation"),
        "{defects:?}"
    );
    assert!(
        defects
            .iter()
            .any(|defect| defect.locus == "shell.params.maxChars"),
        "{defects:?}"
    );
}

/// A hook's own `output` override travels the same vocabulary, and a mode gg does not recognize
/// there refuses the launch too — the one hook field no other launch diagnostic reads, so a hook
/// written to keep its build output inline would otherwise run under a mode nobody named.
#[test]
fn an_unknown_hook_output_mode_is_refused() {
    let agent = OffloadPolicy::Offload(OffloadLimits {
        max_lines: 250,
        max_chars: 4096,
        dir: PathBuf::from(OFFLOAD_DIR),
    });
    let mut report = LaunchReport::collecting();
    let policy = OffloadPolicy::for_mode("inlien", &agent, "hooks[build].output", &mut report);
    assert_eq!(
        policy,
        OffloadPolicy::LaunchRefused,
        "the resolver stays total"
    );
    let defects = report.into_defects();
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(defects[0].locus, "hooks[build].output");
    assert_eq!(defects[0].known, SHELL_OUTPUT_MODES);

    // Both real modes are honoured, and report nothing. The truncating one keeps the agent's own
    // ceilings: the override says "keep this one inline", not "and size it differently from
    // everything else".
    for mode in SHELL_OUTPUT_MODES {
        let mut report = LaunchReport::collecting();
        let policy = OffloadPolicy::for_mode(mode, &agent, "hooks[build].output", &mut report);
        assert!(report.is_empty(), "`{mode}` is a mode gg offers");
        if mode != SHELL_OUTPUT_INLINE {
            assert_eq!(policy.limits(), agent.limits(), "`{mode}`");
        }
    }
}

/// **A hook cannot ask for a tail an agent declares no ceiling for.** An agent whose own shell runs
/// inline — or offers no shell at all — carries no ceilings, and there is no figure gg puts there
/// on the operator's behalf, so the override is refused rather than conducted at a ceiling nobody
/// wrote.
#[test]
fn a_truncating_hook_override_over_an_inline_agent_is_refused() {
    let mode = SHELL_OUTPUT_OFFLOAD;
    let mut report = LaunchReport::collecting();
    let policy = OffloadPolicy::for_mode(
        mode,
        &OffloadPolicy::Inline,
        "hooks[build].output",
        &mut report,
    );
    assert_eq!(policy, OffloadPolicy::LaunchRefused, "`{mode}`");
    let defects = report.into_defects();
    assert_eq!(defects.len(), 1, "`{mode}` -> {defects:?}");
    assert_eq!(defects[0].locus, "hooks[build].output");
    assert_eq!(defects[0].found, mode);

    // …and asking for inline over an inline agent is no override at all, so it reports nothing.
    let mut report = LaunchReport::collecting();
    let policy = OffloadPolicy::for_mode(
        SHELL_OUTPUT_INLINE,
        &OffloadPolicy::Inline,
        "hooks[build].output",
        &mut report,
    );
    assert_eq!(policy, OffloadPolicy::Inline);
    assert!(report.is_empty());
}

/// The ceilings read the same way in the tool description, the system prompt, and the truncation
/// note, because all three ask the same object.
#[test]
fn limits_describe_themselves_in_prose() {
    assert_eq!(
        OffloadLimits {
            max_lines: 200,
            max_chars: 4_000,
            dir: PathBuf::from(OFFLOAD_DIR),
        }
        .describe(),
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
        offloading(&dir, 50, UNBOUNDED),
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
        offloading(&dir, 3, UNBOUNDED),
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
    // went — not only the tool-calling prose around it. It says what was kept, where the whole of
    // it is, and the shape of each file it names.
    let note: Vec<&str> = data.body.lines().rev().take(6).collect();
    assert!(
        note[5].starts_with("[Output truncated: last 3 lines and "),
        "{}",
        data.body
    );
    assert!(
        note[4].starts_with("stdout: ") && note[4].ends_with(".stdout"),
        "{}",
        data.body
    );
    // `line-1`..`line-9` are six characters, `line-10`..`line-40` seven — so every percentile of
    // the forty lines lands on 7.
    assert_eq!(note[3], "  40 lines; line length p50 7, p95 7, p99 7");
    assert_eq!(
        note[2],
        "  longest lines: 7 chars @ 10, 7 @ 11, 7 @ 12, 7 @ 13, 7 @ 14"
    );
    assert!(
        note[1].starts_with("stderr: ") && note[1].ends_with(".stderr"),
        "{}",
        data.body
    );
    assert_eq!(note[0], "  0 lines", "{}", data.body);
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
        offloading(&dir, 1, UNBOUNDED),
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
        offloading(&dir, 5, UNBOUNDED),
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
        offloading(&dir, UNBOUNDED, 10),
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
        offloading(&dir, 10, 15),
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
        offloading(&dir, 2, UNBOUNDED),
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
            max_lines: 2,
            max_chars: UNBOUNDED,
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
    // The failure is disclosed as the one fact it is: where gg tried to write, and why it could not.
    let note = data.body.lines().next_back().expect("a note");
    assert!(
        note.starts_with(&format!(
            "[could not write output to {}: ",
            blocked.join("shell").display()
        )),
        "{}",
        data.body
    );
    assert!(note.ends_with(']'), "{}", data.body);
}

/// The tool's own description says a tail is what comes back when offloading is on, and that the
/// whole output is retrievable, so a model reading the schema of the tool it is about to call
/// learns the rule there too. Neither the *paths* nor the *numbers* are in it: the result carries
/// the paths, and states the counts on the one call that lost something.
#[test]
fn the_definition_names_the_tail_when_offloading() {
    let inline = ShellTool::new(OffloadPolicy::Inline).definition();
    assert!(
        !inline.description.contains("grep"),
        "{}",
        inline.description
    );

    let limits = OffloadLimits {
        max_lines: 120,
        max_chars: UNBOUNDED,
        dir: PathBuf::from(OFFLOAD_DIR),
    };
    let offloaded = ShellTool::new(OffloadPolicy::Offload(limits.clone())).definition();
    assert!(
        offloaded
            .description
            .contains("the tail of merged stdout+stderr"),
        "{}",
        offloaded.description
    );
    assert!(
        !offloaded.description.contains("120"),
        "{}",
        offloaded.description
    );
    assert!(
        offloaded.description.contains("files named in the result")
            && offloaded.description.contains("`grep`"),
        "{}",
        offloaded.description
    );
    assert!(
        !offloaded.description.contains(OFFLOAD_DIR),
        "{}",
        offloaded.description
    );
}

/// **A command that succeeded hands its output over.** Offloading bounds how much of a chatty
/// command comes back; it does not decide, from the exit code, that a command the agent ran is one
/// whose output the agent did not want. A short success comes back whole, and the file pair is
/// written beside it as it is for every command.
#[tokio::test]
async fn a_successful_command_hands_its_output_over() {
    let dir = TempDir::new().unwrap();
    let outcome = run(
        &dir,
        offloading(&dir, 50, UNBOUNDED),
        json!({ "command": "echo one; echo two" }),
    )
    .await;

    assert!(outcome.ok);
    let data = shell_data(&outcome);
    assert_eq!(data.body, "one\ntwo\n");
    assert!(!data.truncated);
    assert_eq!(outcome.output, "exit code: 0\none\ntwo\n");
    assert_eq!(written_pair(&dir).0, "one\ntwo\n");
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

// ---------------------------------------------------------------------------
// The shape beneath each offloaded path
// ---------------------------------------------------------------------------

/// An untruncated command carries **no shape lines**: the note the shape belongs to only exists
/// when something was dropped, and a body the model already has whole needs no map of itself.
#[tokio::test]
async fn an_untruncated_body_carries_no_shape() {
    let dir = TempDir::new().unwrap();
    let outcome = run(
        &dir,
        offloading(&dir, 50, UNBOUNDED),
        json!({ "command": "echo one; echo two" }),
    )
    .await;

    let data = shell_data(&outcome);
    assert!(!data.truncated);
    assert!(!data.body.contains("line length"), "{}", data.body);
    assert!(!data.body.contains("longest lines"), "{}", data.body);
}

/// Both streams get their own shape, in each file's own line numbers — the coordinates a windowed
/// view of that file takes.
#[tokio::test]
async fn each_stream_reports_its_own_shape() {
    let dir = TempDir::new().unwrap();
    let outcome = run(
        &dir,
        offloading(&dir, 2, UNBOUNDED),
        json!({
            "command": "for i in $(seq 1 9); do echo out-$i; done; echo error-line 1>&2; echo e 1>&2"
        }),
    )
    .await;

    let data = shell_data(&outcome);
    assert!(data.truncated);
    // stdout: nine lines of five characters each — an all-ties list resolves to the earliest five.
    assert!(
        data.body
            .contains("\n  9 lines; line length p50 5, p95 5, p99 5\n  longest lines: 5 chars @ 1, 5 @ 2, 5 @ 3, 5 @ 4, 5 @ 5\n"),
        "{}",
        data.body
    );
    // stderr: two lines, so the longest-lines list holds both and no more — and the median of a
    // ten-and-a-one ranks to the one.
    assert!(
        data.body.contains(
            "\n  2 lines; line length p50 1, p95 10, p99 10\n  longest lines: 10 chars @ 1, 1 @ 2"
        ),
        "{}",
        data.body
    );
}

/// Percentiles are nearest-rank over the actual line lengths: on a hundred lines of lengths
/// 1..=100 the 50th/95th/99th percentiles are exactly 50, 95, and 99.
#[test]
fn percentiles_are_nearest_rank_on_a_known_distribution() {
    let text: String = (1..=100).map(|length| "x".repeat(length) + "\n").collect();
    let shape = describe_shape(&text);
    assert!(
        shape.starts_with("\n  100 lines; line length p50 50, p95 95, p99 99\n"),
        "{shape}"
    );
    assert!(
        shape.ends_with("\n  longest lines: 100 chars @ 100, 99 @ 99, 98 @ 98, 97 @ 97, 96 @ 96"),
        "{shape}"
    );
}

/// The longest-five list is ordered longest first, and a tie goes to the **earlier** line, so the
/// same file always describes itself the same way.
#[test]
fn longest_lines_break_ties_by_line_number() {
    let shape = describe_shape("aaa\nbb\nccc\ndddd\nee\nfff\n");
    assert!(
        shape.ends_with("\n  longest lines: 4 chars @ 4, 3 @ 1, 3 @ 3, 3 @ 6, 2 @ 2"),
        "{shape}"
    );
}

/// A single-line file has a one-length distribution — every percentile is that length, and the
/// longest-lines list is just it — rather than a panic over an empty upper tail.
#[test]
fn a_single_line_body_describes_itself_without_panicking() {
    assert_eq!(
        describe_shape("hello"),
        "\n  1 line; line length p50 5, p95 5, p99 5\n  longest lines: 5 chars @ 1"
    );
    // A trailing newline terminates the line rather than starting a second one, exactly as the
    // tail counts.
    assert_eq!(describe_shape("hello\n"), describe_shape("hello"));
}

/// A stream that printed nothing is just `0 lines`: there is no distribution to describe, and the
/// absence must not panic.
#[test]
fn an_empty_body_is_zero_lines() {
    assert_eq!(describe_shape(""), "\n  0 lines");
}

/// One pathological line among small ones is exactly what the shape is for: it dominates the upper
/// percentiles and heads the longest-lines list with its (character) length and line number.
#[test]
fn a_huge_line_dominates_the_shape() {
    let huge = "y".repeat(100_000);
    let text = format!("short\n{huge}\ntiny\n");
    assert_eq!(
        describe_shape(&text),
        "\n  3 lines; line length p50 5, p95 100000, p99 100000\n  longest lines: 100000 chars @ 2, 5 @ 1, 4 @ 3"
    );
}

/// Lengths are **characters**, not bytes, so a shape means the same thing whatever the output is
/// written in — and matches how the model will count when windowing a view.
#[test]
fn line_lengths_count_characters_not_bytes() {
    assert_eq!(
        describe_shape("αβγδε\n"),
        "\n  1 line; line length p50 5, p95 5, p99 5\n  longest lines: 5 chars @ 1"
    );
}
