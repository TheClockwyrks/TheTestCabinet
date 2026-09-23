//! **The workspace SDK, driven from programs** — `gg.shell`, `gg.files` and `gg.skills`.
//!
//! [`sandbox.membrane.test.rs`](super::membrane_tests) pins what each of these calls *sends*: one
//! line of TypeScript per tool and the exact JSON that reached dispatch. This module pins the other
//! two halves of the same contract, which that table deliberately does not touch — what a call
//! **hands back** to the program that made it, and what the program reads when it **fails**.
//!
//! Every case is one `#[test]`, named as a sentence, driving one program a model could have written.
//! A success reads the returned value back and logs it, so the assertion is about the shape a
//! program destructures rather than about the sidecar behind it. A failure is synthesized by
//! [`run_failing`], caught by the program, and asserted through [`assert_caught`]: the class, the
//! operation spelled as the tool name, and gg's own words.
//!
//! Nothing here reaches a model, a provider, or a real file: every answer comes from
//! [`FakeOperationApi`](crate::sandbox::fake::FakeOperationApi).

use super::*;
use crate::tools::ApiData;

// ---------------------------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------------------------

/// **A command that ran hands back its status and its output**, which is the pair every program
/// built on `shell` branches on.
#[test]
fn a_shell_run_hands_back_the_exit_code_and_output() {
    let (outcome, log) = run(r#"import * as gg from "gg";
const result = gg.shell.shell("npm test");
console.log(JSON.stringify({ exitCode: result.exitCode, output: result.output, truncated: result.truncated }));
"#);

    let reported = logged_json(&outcome);
    assert_eq!(reported["exitCode"], json!(0));
    assert_eq!(reported["output"], json!("ran `npm test`"));
    assert_eq!(reported["truncated"], json!(false));
    assert_eq!(
        log.args("shell").map(|args| args["command"].clone()),
        Some(json!("npm test"))
    );
}

/// **A non-zero exit is a value, not a throw** — the one rule that makes `if (result.exitCode !== 0)`
/// the way a program handles a failing command, rather than a `try` around every invocation.
#[test]
fn a_non_zero_exit_is_a_value_rather_than_a_throw() {
    let (outcome, _) = run(r#"import * as gg from "gg";
const result = gg.shell.shell("npm test || fail");
console.log(JSON.stringify({ exitCode: result.exitCode, ranOn: true }));
"#);

    assert_eq!(
        logged_json(&outcome),
        json!({ "exitCode": 1, "ranOn": true })
    );
}

/// **A command the timeout killed is `limit-exceeded`**: no process result came back, so there is
/// nothing to branch on and the call throws.
#[test]
fn a_shell_timeout_is_a_limit_exceeded_the_program_catches() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.shell.shell("sleep 600", { timeoutSecs: 5 })"#),
        "shell",
        ToolFailure::LimitExceeded,
        "shell: `sleep 600` ran past its 5s timeout and was killed",
    );

    assert_caught(&outcome, "limit-exceeded", "shell", "past its 5s timeout");
}

/// **A command that could not be launched at all is an `io-error`** — a different cause from the
/// timeout above, and the class a program must tell apart from it.
#[test]
fn a_shell_that_could_not_launch_is_an_io_error() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.shell.shell("./build.sh")"#),
        "shell",
        ToolFailure::IoError,
        "shell: could not spawn `sh`: Permission denied (os error 13)",
    );

    assert_caught(&outcome, "io-error", "shell", "could not spawn `sh`");
}

/// **A timeout that is not a number is refused on the guest side**, before a process is spawned and
/// before a turn is spent — so the call log is empty.
#[test]
fn a_nonsense_shell_timeout_is_refused_before_the_call() {
    let (outcome, log) = run(&catching(
        r#"gg.shell.shell("npm test", { timeoutSecs: Number.NaN })"#,
    ));

    assert_caught(&outcome, "invalid-argument", "shell", "timeoutSecs");
    assert!(
        log.calls().is_empty(),
        "a refused argument must not reach the tool: {:?}",
        log.names()
    );
}

// ---------------------------------------------------------------------------------------------
// files
// ---------------------------------------------------------------------------------------------

/// **A text read arrives as the text arm**, with the window the read covered, so a program can page.
#[test]
fn a_text_read_arrives_as_the_text_variant() {
    let (outcome, _) = run(r#"import * as gg from "gg";
const read = gg.files.readFile("src/a.ts");
if (read.kind !== "text") throw new Error("expected the text arm");
console.log(JSON.stringify({ contents: read.contents, firstLine: read.firstLine, lastLine: read.lastLine, totalLines: read.totalLines, byteTruncated: read.byteTruncated }));
"#);

    let reported = logged_json(&outcome);
    assert_eq!(
        reported["contents"],
        json!("contents of src/a.ts\nline two\n")
    );
    assert_eq!(reported["firstLine"], json!(1));
    assert_eq!(reported["lastLine"], json!(2));
    assert_eq!(reported["totalLines"], json!(2));
    assert_eq!(reported["byteTruncated"], json!(false));
}

/// **A picture read arrives as the image arm**, describing the file and carrying none of its text.
///
/// The pixels never enter the program, and on this path they never reach the model either: a bare
/// read *describes* a picture, so `shown` is false and the reason names the call that would show it.
/// That is the same separation a model is taught for text, applied to pictures.
#[test]
fn an_image_read_arrives_as_the_image_variant() {
    let (outcome, _) = run(r#"import * as gg from "gg";
const read = gg.files.readFile("logo.png");
if (read.kind !== "image") throw new Error("expected the image arm");
console.log(JSON.stringify({ mediaType: read.mediaType, label: read.label, bytes: read.bytes, shown: read.shown, notShownReason: read.notShownReason ?? null, hasContents: "contents" in read, hasTotalLines: "totalLines" in read }));
"#);

    let reported = logged_json(&outcome);
    assert_eq!(reported["mediaType"], json!("image/png"));
    assert_eq!(reported["label"], json!("PNG"));
    assert_eq!(reported["bytes"], json!(1_234));
    assert_eq!(
        reported["shown"],
        json!(false),
        "a bare read describes a picture and shows nothing: {reported}"
    );
    assert!(
        reported["notShownReason"]
            .as_str()
            .is_some_and(|reason| reason.contains("openFile")),
        "and the reason names the call that would show it, in this arm's spelling: {reported}"
    );
    assert_eq!(
        reported["hasContents"],
        json!(false),
        "the image arm carries no text fields: {reported}"
    );
    assert_eq!(reported["hasTotalLines"], json!(false));
}

/// **An empty read path is an argument error**, and the empty string is what crossed — not the
/// absence a missing argument would lower to.
#[test]
fn an_empty_read_path_is_an_argument_error() {
    let (outcome, log) = run_failing(
        &catching(r#"gg.files.readFile("")"#),
        "read_file",
        ToolFailure::InvalidArgument,
        "read_file: `path` must not be empty",
    );

    assert_caught(
        &outcome,
        "invalid-argument",
        "read_file",
        "must not be empty",
    );
    assert_eq!(
        log.args("read_file").map(|args| args["path"].clone()),
        Some(json!(""))
    );
}

/// **A write hands back how many bytes it wrote**, which is the only thing it returns.
#[test]
fn a_write_hands_back_the_byte_count() {
    let (outcome, _) = run(r#"import * as gg from "gg";
console.log(JSON.stringify({ written: gg.files.writeFile("out.txt", "hello") }));
"#);

    assert_eq!(logged_json(&outcome), json!({ "written": 5 }));
}

/// **An empty write path is an argument error.**
#[test]
fn an_empty_write_path_is_an_argument_error() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.files.writeFile("", "hello")"#),
        "write_file",
        ToolFailure::InvalidArgument,
        "write_file: `path` must not be empty",
    );

    assert_caught(
        &outcome,
        "invalid-argument",
        "write_file",
        "must not be empty",
    );
}

/// **A write the disk refused is an `io-error`** — a separate cause from the empty path above, and
/// the one a program cannot fix by rewriting its arguments.
#[test]
fn a_write_that_fails_on_disk_is_an_io_error() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.files.writeFile("out/summary.txt", "hello")"#),
        "write_file",
        ToolFailure::IoError,
        "write_file: could not create `out/`: Read-only file system (os error 30)",
    );

    assert_caught(&outcome, "io-error", "write_file", "Read-only file system");
}

/// **An edit that landed returns nothing and the program runs on**, so the only thing to read back
/// is that the call reached dispatch with the two strings the program named.
#[test]
fn an_edit_that_landed_returns_nothing_and_the_program_runs_on() {
    let (outcome, log) = run(r#"import * as gg from "gg";
gg.files.editFile("src/a.ts", "alpha", "beta");
console.log(JSON.stringify({ ranOn: true }));
"#);

    assert_eq!(logged_json(&outcome), json!({ "ranOn": true }));
    assert_eq!(
        log.args("edit_file"),
        Some(json!({ "path": "src/a.ts", "old_string": "alpha", "new_string": "beta" }))
    );
}

/// **An edit whose old text is nowhere in the file is `not-found`**, which is how a program learns
/// its assumption about the file was wrong.
#[test]
fn an_edit_whose_old_text_is_absent_is_not_found() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.files.editFile("src/a.ts", "alpha", "beta")"#),
        "edit_file",
        ToolFailure::NotFound,
        "edit_file: `old_string` does not appear in `src/a.ts`",
    );

    assert_caught(&outcome, "not-found", "edit_file", "does not appear in");
}

/// **A listing hands back each entry's name and kind**, which is what lets a program recurse into
/// directories and read files.
#[test]
fn a_listing_hands_back_its_entries_and_their_kinds() {
    let (outcome, _) = run(r#"import * as gg from "gg";
console.log(JSON.stringify(gg.files.listDir("src").map((entry) => ({ name: entry.name, kind: entry.kind }))));
"#);

    assert_eq!(
        logged_json(&outcome),
        json!([
            { "name": "a.ts", "kind": "file" },
            { "name": "b.test.ts", "kind": "file" },
            { "name": "sub", "kind": "directory" },
        ])
    );
}

/// **An empty directory is an empty array, not a failure** — nothing to catch, and `.length` is
/// zero.
#[test]
fn an_empty_directory_is_an_empty_list() {
    let (outcome, _) = run_answering(
        r#"import * as gg from "gg";
console.log(JSON.stringify({ entries: gg.files.listDir("empty").length }));
"#,
        "list_dir",
        ToolOutcome::ok("", "0 entries").with_data(ApiData::DirEntries(Vec::new())),
    );

    assert_eq!(logged_json(&outcome), json!({ "entries": 0 }));
}

/// **An empty listing path is an argument error**, and it is the empty string that crossed: omitting
/// the argument entirely is the thing that lists the workspace root, and the two must not be
/// confused.
#[test]
fn an_empty_listing_path_is_an_argument_error() {
    let (outcome, log) = run_failing(
        &catching(r#"gg.files.listDir("")"#),
        "list_dir",
        ToolFailure::InvalidArgument,
        "list_dir: `path` must not be empty; omit it to list the workspace root",
    );

    assert_caught(&outcome, "invalid-argument", "list_dir", "omit it to list");
    assert_eq!(log.args("list_dir"), Some(json!({ "path": "" })));
}

/// **A listing of a directory that is not there is `not-found`.**
#[test]
fn a_listing_of_a_directory_that_is_not_there_is_not_found() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.files.listDir("nowhere")"#),
        "list_dir",
        ToolFailure::NotFound,
        "list_dir: no such directory `nowhere`",
    );

    assert_caught(&outcome, "not-found", "list_dir", "no such directory");
}

/// **A tree hands back its rendering**, one block of text the program holds rather than a structure.
#[test]
fn a_tree_hands_back_its_rendering() {
    let (outcome, log) = run(r#"import * as gg from "gg";
console.log(JSON.stringify({ tree: gg.files.tree({ path: "src", depth: 3 }) }));
"#);

    assert_eq!(
        logged_json(&outcome),
        json!({ "tree": "a.ts\nb.test.ts\nsub/\n  c.ts" })
    );
    assert_eq!(log.args("tree"), Some(json!({ "path": "src", "depth": 3 })));
}

/// **A tree rooted at a path that is not there is `not-found`.**
#[test]
fn a_tree_of_a_path_that_is_not_there_is_not_found() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.files.tree({ path: "nowhere" })"#),
        "tree",
        ToolFailure::NotFound,
        "tree: no such path `nowhere`",
    );

    assert_caught(&outcome, "not-found", "tree", "no such path");
}

/// **A tree rooted at something that is not a directory is an argument error** — a separate cause
/// from a path that is missing altogether.
#[test]
fn a_tree_of_something_that_is_not_a_directory_is_an_argument_error() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.files.tree({ path: "src/a.ts" })"#),
        "tree",
        ToolFailure::InvalidArgument,
        "tree: `src/a.ts` is a file, not a directory",
    );

    assert_caught(
        &outcome,
        "invalid-argument",
        "tree",
        "is a file, not a directory",
    );
}

/// **A depth of zero is refused on the guest side**, so nothing is spent finding out.
#[test]
fn a_tree_depth_of_zero_is_refused_before_the_call() {
    let (outcome, log) = run(&catching(r#"gg.files.tree({ path: "src", depth: 0 })"#));

    assert_caught(
        &outcome,
        "invalid-argument",
        "tree",
        "`depth` must be at least 1",
    );
    assert!(
        log.calls().is_empty(),
        "a refused argument must not reach the tool: {:?}",
        log.names()
    );
}

/// **A search hands back each match with its path and 1-based line**, which is what makes the result
/// something a program can read the file at.
#[test]
fn a_search_hands_back_its_matches_with_paths_and_line_numbers() {
    let (outcome, _) = run(r#"import * as gg from "gg";
console.log(JSON.stringify(gg.files.search("todo").map((match_) => ({ path: match_.path, line: match_.line, text: match_.text }))));
"#);

    assert_eq!(
        logged_json(&outcome),
        json!([{ "path": "src/a.ts", "line": 3, "text": "const answer = 42;" }])
    );
}

/// **A blank query is an argument error.**
#[test]
fn a_blank_search_query_is_an_argument_error() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.files.search("   ")"#),
        "search",
        ToolFailure::InvalidArgument,
        "search: `query` must not be blank",
    );

    assert_caught(&outcome, "invalid-argument", "search", "must not be blank");
}

/// **A pattern that does not parse is an argument error naming the pattern** — a separate cause from
/// a blank query, and the one a program fixes by escaping something.
#[test]
fn a_search_pattern_that_does_not_parse_is_an_argument_error() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.files.search("fn (")"#),
        "search",
        ToolFailure::InvalidArgument,
        "search: `fn (` is not a valid regular expression: unclosed group",
    );

    assert_caught(
        &outcome,
        "invalid-argument",
        "search",
        "`fn (` is not a valid",
    );
}

/// **A limit of zero is refused on the guest side**, so nothing is spent asking for no matches.
#[test]
fn a_search_limit_of_zero_is_refused_before_the_call() {
    let (outcome, log) = run(&catching(r#"gg.files.search("todo", { limit: 0 })"#));

    assert_caught(
        &outcome,
        "invalid-argument",
        "search",
        "`limit` must be at least 1",
    );
    assert!(
        log.calls().is_empty(),
        "a refused argument must not reach the tool: {:?}",
        log.names()
    );
}

/// **A search rooted under a path that is not there is `not-found`**, rather than an empty result:
/// nothing matched and nothing was searched are different answers.
#[test]
fn a_search_under_a_path_that_is_not_there_is_not_found() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.files.search("todo", { path: "nowhere" })"#),
        "search",
        ToolFailure::NotFound,
        "search: no such path `nowhere`",
    );

    assert_caught(&outcome, "not-found", "search", "no such path");
}

// ---------------------------------------------------------------------------------------------
// skills
// ---------------------------------------------------------------------------------------------

/// **Reading a skill hands its body back to the program**, front matter stripped.
#[test]
fn a_skill_read_hands_back_its_body() {
    let (outcome, log) = run(r#"import * as gg from "gg";
console.log(JSON.stringify({ body: gg.skills.readSkill("testing") }));
"#);

    assert_eq!(logged_json(&outcome), json!({ "body": "the skill body" }));
    assert_eq!(log.args("read_skill"), Some(json!({ "name": "testing" })));
}

/// **An unknown skill is `not-found` carrying the names that do exist** — the sentence the membrane
/// composes at [`knowledge`](crate::sandbox::membrane::knowledge), reaching the program whole so a
/// model can correct itself without another turn spent guessing.
#[test]
fn an_unknown_skill_is_not_found_and_names_the_skills_that_exist() {
    let (outcome, _) = run_failing(
        &catching(r#"gg.skills.readSkill("tetsing")"#),
        "read_skill",
        ToolFailure::NotFound,
        "read_skill: no skill named `tetsing`; available skills: testing",
    );

    assert_caught(
        &outcome,
        "not-found",
        "read_skill",
        "available skills: testing",
    );
}
