//! **The workspace SDK, driven from JavaScript programs** — one program per call in `shell`,
//! `files`, `memories`, `tasks`, `board` and `skills`, reading back what the host answered, and one
//! program per distinct way each of those calls fails.
//!
//! # Why a file of small tests rather than one big one
//!
//! [The substrate file](super::substrate) observes five things about *the arm*: that a program runs
//! at all, that its calls reach the host in order, that a mistyped program runs anyway, that the
//! documented import spelling works, and that the convenience helpers exist. Five programs in one
//! function is the right shape for those, because each is a statement about the arm and they share
//! one component compile.
//!
//! What is here is a different question, asked once per call: **what does a program read back?** A
//! success and each of its documented failure classes are independent facts about independent
//! functions, and a hundred of them in one function is a test that fails with one line of context
//! for whichever assertion tripped first, hiding every fact behind it. So they are one `#[test]`
//! apiece, each a handful of lines: the program, the lines it logged, and the JSON the host was
//! handed.
//!
//! # What "failure" means here
//!
//! Three different layers refuse a call, and a program tells them apart by what it catches:
//!
//! 1. **The guest's own argument validators** — `packages/gg-sandbox/src/internal/errors.ts` —
//!    throw an [`ApiError`](crate::sandbox::membrane) whose `operation` is the *SDK function's*
//!    name, before anything crosses. Every one of those tests asserts the call log is **empty**.
//! 2. **The generated component bindings**, which reject a bad enum case with a `TypeError` naming
//!    the cases that exist. That is not an `ApiError` and carries no code; the sentence is the
//!    whole of what a model reads.
//! 3. **gg itself**, which answers a call it accepted with a failed [`ToolOutcome`]. The membrane
//!    lowers that into an `ApiError` carrying gg's own operation key, its code, and the sentence
//!    the tool wrote. Those are the cases [`run_answering`] injects.
//!
//! Every response here is synthesized by [`FakeOperationApi`], so nothing in this file reaches a
//! provider, a container or a disk.

use serde_json::{Value, json};
use test_cabinet_core::gg::GgProgramLanguage;

use crate::ending::EndingRole;
use crate::sandbox::fake::{
    CallLog, FakeOperationApi, all_capabilities, all_operations, canned_outcome,
};
use crate::sandbox::{
    ProgramLanguage, ProgramScope, RunEnding, SandboxLimits, SandboxOutcome, language, run_program,
};
use crate::tools::{ToolFailure, ToolOutcome};

/// This arm, reached through the registry so the tests exercise the lookup production does.
fn javascript() -> &'static dyn ProgramLanguage {
    language(GgProgramLanguage::JavaScript)
}

/// Run `program` with every tool bound, the canned answers and the default ceilings.
fn run(program: &str) -> (SandboxOutcome, CallLog) {
    run_with(program, canned_outcome)
}

/// Run `program` against `responder`, which answers every call the membrane makes.
fn run_with(
    program: &str,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    let log = CallLog::default();
    let (outcome, _api) = run_program(
        javascript(),
        program,
        ProgramScope {
            capabilities: &all_capabilities(),
            operations: &all_operations(),
            modules: &[],
            ending: RunEnding::Role(EndingRole::Standard),
        },
        &crate::sandbox::AgentWorkspace::new(),
        SandboxLimits::AMPLE,
        None,
        FakeOperationApi::with(&log, responder),
    );
    (outcome, log)
}

/// Run `program` with one tool answered by `responder` and every other answered as usual.
///
/// The fallback is what makes a failure test a *short* one: a program that has to stand its own
/// fixture up first — create the epic it then fails to update — would otherwise lose its setup to
/// the injected failure as collateral damage.
fn run_answering(
    program: &str,
    tool: &'static str,
    responder: impl Fn() -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    run_with(program, move |name, args| {
        if name == tool {
            responder()
        } else {
            canned_outcome(name, args)
        }
    })
}

/// [`run_answering`] with the one injected answer spelled as the failure gg would have written.
fn failing(
    program: &str,
    tool: &'static str,
    failure: ToolFailure,
    message: &'static str,
) -> (SandboxOutcome, CallLog) {
    run_answering(program, tool, move || {
        ToolOutcome::failed(failure, message.to_string())
    })
}

/// The lines a successful program logged, with the program's own failure surfaced rather than
/// swallowed.
fn logs(outcome: &SandboxOutcome) -> &[String] {
    match &outcome.result {
        Ok(result) => {
            assert!(
                result.error.is_none(),
                "the program threw: {:?}",
                result.error
            );
            &outcome.logs
        }
        Err(error) => panic!("the sandbox could not run the program: {error}"),
    }
}

/// The throw the guest reported, which is how a program's own uncaught failure reaches gg here.
#[allow(dead_code)]
fn thrown<'a>(outcome: &'a SandboxOutcome, why: &str) -> &'a crate::sandbox::outcome::ProgramError {
    match &outcome.result {
        Ok(result) => result.error.as_ref().expect(why),
        Err(error) => panic!("{why}: the store died instead of the guest reporting — {error:?}"),
    }
}

/// A program importing `module` beside the `ApiError` a `catch` narrows on, making `call` under
/// `try`, printing the failure's identity and its sentence, and then reaching a line after the
/// handler.
///
/// The trailing line is not decoration: a failure a program *caught* must leave the program
/// running, and a throw that escaped the handler would take that line with it.
fn caught(module: &str, call: &str) -> String {
    format!(
        r#"import {{ {module} }} from "gg";
import {{ ApiError }} from "gg";

try {{
  {call}
  console.log("the call did not throw");
}} catch (error) {{
  console.log(`${{error instanceof ApiError}} ${{error.code}} ${{error.operation}}`);
  console.log(error.message);
}}
console.log("the program ran on");
"#
    )
}

/// Assert the three lines [`caught`] logs: the failure's identity, its sentence, and the line the
/// program reached after handling it.
fn assert_caught(outcome: &SandboxOutcome, code: &str, operation: &str, sentence: &str) {
    let lines = logs(outcome);
    assert_eq!(
        lines.len(),
        3,
        "a caught failure logs its identity, its sentence and the line after it: {lines:?}"
    );
    assert_eq!(
        lines[0],
        format!("true {code} {operation}"),
        "the program caught an `ApiError` carrying gg's own identity for the call"
    );
    assert!(
        lines[1].contains(sentence),
        "the sentence the model reads says what went wrong: {}",
        lines[1]
    );
    assert_eq!(
        lines[2], "the program ran on",
        "a caught failure leaves the program running"
    );
}

/// A program whose call the **generated bindings** reject, printing only the sentence: a bad enum
/// case is a `TypeError` from another realm, not an `ApiError`, so it carries no code to print.
fn caught_binding(module: &str, call: &str) -> String {
    format!(
        r#"import {{ {module} }} from "gg";

try {{
  {call}
  console.log("the call did not throw");
}} catch (error) {{
  console.log(error.message);
}}
console.log("the program ran on");
"#
    )
}

// ---------------------------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------------------------

#[test]
fn a_command_that_succeeded_reads_back_its_exit_code_and_output() {
    let (outcome, log) = run(concat!(
        "import { shell } from \"gg\";\n",
        "\n",
        "const ran = shell.shell(\"ls\");\n",
        "console.log(`${ran.exitCode} ${ran.truncated}`);\n",
        "console.log(ran.output);\n",
    ));
    assert_eq!(logs(&outcome), ["0 false", "ran `ls`"]);
    assert_eq!(
        log.args("shell")
            .as_ref()
            .and_then(|args| args.get("command")),
        Some(&json!("ls")),
        "the command the program wrote is the command gg was handed"
    );
}

#[test]
fn a_non_zero_exit_is_a_value_the_program_reads_rather_than_a_throw() {
    let (outcome, _log) = run(concat!(
        "import { shell } from \"gg\";\n",
        "\n",
        "const ran = shell.shell(\"fail\");\n",
        "console.log(`${ran.exitCode}`);\n",
        "console.log(\"the program ran on\");\n",
    ));
    assert_eq!(
        logs(&outcome),
        ["1", "the program ran on"],
        "a command that exited non-zero is a result to branch on, never a throw"
    );
}

#[test]
fn a_shell_timeout_reaches_the_program_as_limit_exceeded() {
    let (outcome, _log) = failing(
        &caught("shell", "shell.shell(\"sleep 500\", { timeoutSecs: 5 });"),
        "shell",
        ToolFailure::LimitExceeded,
        "shell: `sleep 500` was killed after 5s",
    );
    assert_caught(&outcome, "limit-exceeded", "shell", "was killed after 5s");
}

#[test]
fn a_process_that_could_not_be_launched_reaches_the_program_as_io_error() {
    let (outcome, _log) = failing(
        &caught("shell", "shell.shell(\"ls\");"),
        "shell",
        ToolFailure::IoError,
        "shell: could not launch `sh`: No such file or directory",
    );
    assert_caught(&outcome, "io-error", "shell", "could not launch `sh`");
}

#[test]
fn a_nonsense_shell_timeout_is_refused_before_it_crosses() {
    let (outcome, log) = run(&caught(
        "shell",
        "shell.shell(\"ls\", { timeoutSecs: -1 });",
    ));
    assert_caught(
        &outcome,
        "invalid-argument",
        "shell",
        "`timeoutSecs` must be a positive number, got -1",
    );
    assert!(
        log.calls().is_empty(),
        "the guest refused it before anything crossed: {:?}",
        log.names()
    );
}

#[test]
fn a_positional_second_argument_to_shell_names_the_options_object() {
    let (outcome, log) = run(&caught("shell", "shell.shell(\"npm test\", 300);"));
    assert_caught(
        &outcome,
        "invalid-argument",
        "shell",
        "expected an options object, got number",
    );
    assert!(
        log.calls().is_empty(),
        "a timeout passed positionally is refused rather than silently ignored: {:?}",
        log.names()
    );
}

// ---------------------------------------------------------------------------------------------
// files
// ---------------------------------------------------------------------------------------------

#[test]
fn a_text_read_arrives_as_the_text_arm_of_a_file_read() {
    let (outcome, _log) = run(concat!(
        "import { files } from \"gg\";\n",
        "\n",
        "const read = files.readFile(\"notes.md\");\n",
        "console.log(`${read.kind} ${read.firstLine} ${read.lastLine} ${read.totalLines} ${read.byteTruncated}`);\n",
        "console.log(read.contents.split(\"\\n\")[0]);\n",
    ));
    assert_eq!(
        logs(&outcome),
        ["text 1 2 2 false", "contents of notes.md"],
        "every field of the text arm reached the program"
    );
}

#[test]
fn an_image_read_arrives_as_the_image_arm_of_a_file_read() {
    let (outcome, _log) = run(concat!(
        "import { files } from \"gg\";\n",
        "\n",
        "const picture = files.readFile(\"logo.png\");\n",
        "console.log(`${picture.kind} ${picture.mediaType} ${picture.label} ${picture.bytes} ${picture.shown}`);\n",
        "console.log(picture.notShownReason);\n",
    ));
    let lines = logs(&outcome);
    assert_eq!(
        lines[0], "image image/png PNG 1234 false",
        "a read describes the picture rather than showing it"
    );
    assert!(
        lines[1].contains("does not show images"),
        "and says why, naming the call that would show it: {}",
        lines[1]
    );
}

#[test]
fn an_empty_path_to_read_file_is_an_argument_failure() {
    let (outcome, _log) = failing(
        &caught("files", "files.readFile(\"\");"),
        "read_file",
        ToolFailure::InvalidArgument,
        "read_file: `path` must not be empty",
    );
    assert_caught(
        &outcome,
        "invalid-argument",
        "read_file",
        "`path` must not be empty",
    );
}

#[test]
fn a_fractional_read_limit_is_refused_before_it_crosses() {
    let (outcome, log) = run(&caught(
        "files",
        "files.readFile(\"a.ts\", { limit: 0.5 });",
    ));
    assert_caught(
        &outcome,
        "invalid-argument",
        "readFile",
        "`limit` must be a whole number 0..4294967295, got 0.5",
    );
    assert!(log.calls().is_empty(), "{:?}", log.names());
}

#[test]
fn a_positional_second_argument_to_read_file_names_the_options_object() {
    let (outcome, log) = run(&caught("files", "files.readFile(\"a.ts\", 5);"));
    assert_caught(
        &outcome,
        "invalid-argument",
        "readFile",
        "expected an options object, got number",
    );
    assert!(log.calls().is_empty(), "{:?}", log.names());
}

#[test]
fn a_write_reports_the_bytes_it_wrote_as_a_number() {
    let (outcome, log) = run(concat!(
        "import { files } from \"gg\";\n",
        "\n",
        "const written = files.writeFile(\"out/notes.md\", \"hello\");\n",
        "console.log(`${typeof written} ${written}`);\n",
    ));
    assert_eq!(
        logs(&outcome),
        ["number 5"],
        "the `u64` the host returned is narrowed to a number the program can do arithmetic on"
    );
    assert_eq!(
        log.args("write_file"),
        Some(json!({ "path": "out/notes.md", "contents": "hello" }))
    );
}

#[test]
fn an_empty_path_to_write_file_is_an_argument_failure() {
    let (outcome, _log) = failing(
        &caught("files", "files.writeFile(\"\", \"hello\");"),
        "write_file",
        ToolFailure::InvalidArgument,
        "write_file: `path` must not be empty",
    );
    assert_caught(
        &outcome,
        "invalid-argument",
        "write_file",
        "`path` must not be empty",
    );
}

#[test]
fn a_write_that_could_not_reach_the_disk_is_an_io_error() {
    let (outcome, _log) = failing(
        &caught("files", "files.writeFile(\"out/notes.md\", \"hello\");"),
        "write_file",
        ToolFailure::IoError,
        "write_file: could not create `out`: Permission denied",
    );
    assert_caught(
        &outcome,
        "io-error",
        "write_file",
        "could not create `out`: Permission denied",
    );
}

#[test]
fn an_edit_reaches_the_host_with_the_two_strings_it_was_given() {
    let (outcome, log) = run(concat!(
        "import { files } from \"gg\";\n",
        "\n",
        "files.editFile(\"src/a.ts\", \"const answer = 42;\", \"const answer = 43;\");\n",
        "console.log(\"edited\");\n",
    ));
    assert_eq!(logs(&outcome), ["edited"]);
    assert_eq!(
        log.args("edit_file"),
        Some(json!({
            "path": "src/a.ts",
            "old_string": "const answer = 42;",
            "new_string": "const answer = 43;",
        })),
        "both strings crossed in the order the signature names them"
    );
}

#[test]
fn text_that_is_not_in_the_file_is_a_not_found_edit() {
    let (outcome, _log) = failing(
        &caught("files", "files.editFile(\"src/a.ts\", \"nope\", \"yes\");"),
        "edit_file",
        ToolFailure::NotFound,
        "edit_file: `nope` does not appear in `src/a.ts`",
    );
    assert_caught(
        &outcome,
        "not-found",
        "edit_file",
        "does not appear in `src/a.ts`",
    );
}

#[test]
fn text_that_appears_more_than_once_is_a_conflicting_edit() {
    let (outcome, _log) = failing(
        &caught(
            "files",
            "files.editFile(\"src/a.ts\", \"answer\", \"result\");",
        ),
        "edit_file",
        ToolFailure::Conflict,
        "edit_file: `answer` appears 3 times in `src/a.ts`; include more surrounding text",
    );
    assert_caught(&outcome, "conflict", "edit_file", "appears 3 times");
}

#[test]
fn a_directory_that_is_not_there_is_a_not_found_listing() {
    let (outcome, _log) = failing(
        &caught("files", "files.listDir(\"nope\");"),
        "list_dir",
        ToolFailure::NotFound,
        "list_dir: no directory `nope`",
    );
    assert_caught(&outcome, "not-found", "list_dir", "no directory `nope`");
}

#[test]
fn an_empty_path_to_list_dir_is_an_argument_failure() {
    let (outcome, _log) = failing(
        &caught("files", "files.listDir(\"\");"),
        "list_dir",
        ToolFailure::InvalidArgument,
        "list_dir: `path` must not be empty; omit it to list the workspace root",
    );
    assert_caught(
        &outcome,
        "invalid-argument",
        "list_dir",
        "omit it to list the workspace root",
    );
}

#[test]
fn a_tree_reads_back_as_one_block_of_text() {
    let (outcome, log) = run(concat!(
        "import { files } from \"gg\";\n",
        "\n",
        "const rendered = files.tree({ path: \"src\", depth: 2 });\n",
        "console.log(JSON.stringify(rendered));\n",
    ));
    assert_eq!(
        logs(&outcome),
        [r#""a.ts\nb.test.ts\nsub/\n  c.ts""#],
        "the rendering arrived whole, newlines and indentation included"
    );
    assert_eq!(
        log.args("tree"),
        Some(json!({ "path": "src", "depth": 2 })),
        "both options travelled in the one trailing object"
    );
}

#[test]
fn a_tree_depth_of_zero_is_refused_before_it_crosses() {
    let (outcome, log) = run(&caught("files", "files.tree({ depth: 0 });"));
    assert_caught(
        &outcome,
        "invalid-argument",
        "tree",
        "`depth` must be at least 1, got 0",
    );
    assert!(log.calls().is_empty(), "{:?}", log.names());
}

#[test]
fn a_negative_tree_depth_is_refused_before_it_crosses() {
    let (outcome, log) = run(&caught("files", "files.tree({ depth: -1 });"));
    assert_caught(
        &outcome,
        "invalid-argument",
        "tree",
        "`depth` must be a whole number 0..4294967295, got -1",
    );
    assert!(
        log.calls().is_empty(),
        "a negative depth would have wrapped to 4294967295 on the wire: {:?}",
        log.names()
    );
}

#[test]
fn a_tree_root_that_is_not_a_directory_is_an_argument_failure() {
    let (outcome, _log) = failing(
        &caught("files", "files.tree({ path: \"src/a.ts\" });"),
        "tree",
        ToolFailure::InvalidArgument,
        "tree: `src/a.ts` is not a directory",
    );
    assert_caught(&outcome, "invalid-argument", "tree", "is not a directory");
}

#[test]
fn a_tree_root_that_is_not_there_is_not_found() {
    let (outcome, _log) = failing(
        &caught("files", "files.tree({ path: \"nope\" });"),
        "tree",
        ToolFailure::NotFound,
        "tree: no directory `nope`",
    );
    assert_caught(&outcome, "not-found", "tree", "no directory `nope`");
}

#[test]
fn a_search_reads_back_its_matches_with_paths_and_line_numbers() {
    let (outcome, log) = run(concat!(
        "import { files } from \"gg\";\n",
        "\n",
        "const matches = files.search(\"answer\");\n",
        "const first = matches[0];\n",
        "console.log(`${matches.length} ${first.path} ${first.line} ${first.text}`);\n",
    ));
    assert_eq!(
        logs(&outcome),
        ["1 src/a.ts 3 const answer = 42;"],
        "each match carries the file it is in, its 1-based line and the line itself"
    );
    assert_eq!(
        log.args("search"),
        Some(json!({ "query": "answer", "path": null, "limit": null }))
    );
}

#[test]
fn a_search_limit_of_zero_is_refused_before_it_crosses() {
    let (outcome, log) = run(&caught("files", "files.search(\"answer\", { limit: 0 });"));
    assert_caught(
        &outcome,
        "invalid-argument",
        "search",
        "`limit` must be at least 1, got 0",
    );
    assert!(log.calls().is_empty(), "{:?}", log.names());
}

#[test]
fn a_blank_search_query_is_an_argument_failure() {
    let (outcome, _log) = failing(
        &caught("files", "files.search(\"   \");"),
        "search",
        ToolFailure::InvalidArgument,
        "search: `query` must not be blank",
    );
    assert_caught(
        &outcome,
        "invalid-argument",
        "search",
        "`query` must not be blank",
    );
}

#[test]
fn a_search_pattern_that_does_not_parse_is_an_argument_failure() {
    let (outcome, _log) = failing(
        &caught("files", "files.search(\"fn(\");"),
        "search",
        ToolFailure::InvalidArgument,
        "search: `fn(` is not a valid regular expression: unclosed group",
    );
    assert_caught(
        &outcome,
        "invalid-argument",
        "search",
        "`fn(` is not a valid regular expression",
    );
}

#[test]
fn a_search_root_that_is_not_there_is_not_found() {
    let (outcome, _log) = failing(
        &caught("files", "files.search(\"answer\", { path: \"nope\" });"),
        "search",
        ToolFailure::NotFound,
        "search: no path `nope`",
    );
    assert_caught(&outcome, "not-found", "search", "no path `nope`");
}

// ---------------------------------------------------------------------------------------------
// memories
// ---------------------------------------------------------------------------------------------

/// The four budget fields every memory mutation reports, as the canned usage carries them.
const MEMORY_BUDGET: &str = "1 8 12 4000";

/// A program logging the four axes of a `MemoryUsage` the expression `call` returned.
fn memory_usage_program(call: &str) -> String {
    format!(
        r#"import {{ memories }} from "gg";

const usage = {call};
console.log(`${{usage.count}} ${{usage.maxCount}} ${{usage.totalChars}} ${{usage.maxTotalChars}}`);
"#
    )
}

#[test]
fn a_written_memory_reports_the_budget_it_now_occupies() {
    let (outcome, log) = run(&memory_usage_program(
        "memories.writeMemory({ name: \"layout\", description: \"where things live\", body: \"src/ holds the engine\" })",
    ));
    assert_eq!(logs(&outcome), [MEMORY_BUDGET]);
    assert_eq!(
        log.args("write_memory"),
        Some(json!({
            "name": "layout",
            "description": "where things live",
            "body": "src/ holds the engine",
            "code": null,
            "onUse": null,
        })),
        "the two optional code halves cross as absent rather than as empty modules"
    );
}

#[test]
fn a_duplicate_memory_name_is_a_conflicting_write() {
    let (outcome, _log) = failing(
        &caught(
            "memories",
            "memories.writeMemory({ name: \"layout\", description: \"d\", body: \"b\" });",
        ),
        "write_memory",
        ToolFailure::Conflict,
        "write_memory: a memory named `layout` is already held",
    );
    assert_caught(&outcome, "conflict", "write_memory", "already held");
}

#[test]
fn a_memory_body_over_the_cap_is_a_limit_exceeded_write() {
    let (outcome, _log) = failing(
        &caught(
            "memories",
            "memories.writeMemory({ name: \"layout\", description: \"d\", body: \"b\" });",
        ),
        "write_memory",
        ToolFailure::LimitExceeded,
        "write_memory: the body is 5000 characters; this run allows 4000 in total",
    );
    assert_caught(
        &outcome,
        "limit-exceeded",
        "write_memory",
        "this run allows 4000 in total",
    );
}

#[test]
fn an_updated_memory_reports_the_budget_after_the_replacement() {
    let (outcome, log) = run(&memory_usage_program(
        "memories.updateMemory({ name: \"layout\", description: \"d\", body: \"the replacement\" })",
    ));
    assert_eq!(logs(&outcome), [MEMORY_BUDGET]);
    assert_eq!(
        log.args("update_memory"),
        Some(json!({
            "name": "layout",
            "description": "d",
            "body": "the replacement",
            "code": null,
            "onUse": null,
        })),
        "an update carries the whole replacement, not a patch of it"
    );
}

#[test]
fn updating_a_memory_that_is_not_held_is_not_found() {
    let (outcome, _log) = failing(
        &caught(
            "memories",
            "memories.updateMemory({ name: \"nope\", description: \"d\", body: \"b\" });",
        ),
        "update_memory",
        ToolFailure::NotFound,
        "update_memory: no memory named `nope`",
    );
    assert_caught(
        &outcome,
        "not-found",
        "update_memory",
        "no memory named `nope`",
    );
}

#[test]
fn a_replacement_over_the_cap_is_a_limit_exceeded_update() {
    let (outcome, _log) = failing(
        &caught(
            "memories",
            "memories.updateMemory({ name: \"layout\", description: \"d\", body: \"b\" });",
        ),
        "update_memory",
        ToolFailure::LimitExceeded,
        "update_memory: the replacement is 5000 characters; this run allows 4000 in total",
    );
    assert_caught(
        &outcome,
        "limit-exceeded",
        "update_memory",
        "the replacement is 5000 characters",
    );
}

#[test]
fn a_created_memory_reports_the_budget_it_now_occupies() {
    let (outcome, log) = run(&memory_usage_program(
        "memories.createMemory({ name: \"layout\", description: \"where things live\", body: \"src/ holds the engine\" })",
    ));
    assert_eq!(logs(&outcome), [MEMORY_BUDGET]);
    assert_eq!(
        log.args("create_memory"),
        Some(json!({
            "name": "layout",
            "description": "where things live",
            "contents": "src/ holds the engine",
            "code": null,
            "onUse": null,
        })),
        "a creation's body crosses under gg's own `contents` key"
    );
}

#[test]
fn a_duplicate_memory_slug_is_a_conflicting_creation() {
    let (outcome, _log) = failing(
        &caught(
            "memories",
            "memories.createMemory({ name: \"layout\", description: \"d\", body: \"b\" });",
        ),
        "create_memory",
        ToolFailure::Conflict,
        "create_memory: a memory with the slug `layout` is already held",
    );
    assert_caught(
        &outcome,
        "conflict",
        "create_memory",
        "slug `layout` is already held",
    );
}

#[test]
fn a_creation_over_the_cap_is_limit_exceeded() {
    let (outcome, _log) = failing(
        &caught(
            "memories",
            "memories.createMemory({ name: \"layout\", description: \"d\", body: \"b\" });",
        ),
        "create_memory",
        ToolFailure::LimitExceeded,
        "create_memory: this run holds 8 memories, which is all it allows",
    );
    assert_caught(
        &outcome,
        "limit-exceeded",
        "create_memory",
        "which is all it allows",
    );
}

#[test]
fn reading_a_memory_that_is_not_held_is_not_found() {
    let (outcome, _log) = failing(
        &caught("memories", "memories.readMemory(\"nope\");"),
        "read_memory",
        ToolFailure::NotFound,
        "read_memory: no memory with the slug `nope`",
    );
    assert_caught(
        &outcome,
        "not-found",
        "read_memory",
        "no memory with the slug `nope`",
    );
}

#[test]
fn an_edited_memory_reports_the_budget_after_the_revision() {
    let (outcome, log) = run(&memory_usage_program(
        "memories.editMemory({ name: \"layout\", search: \"src/\", replace: \"crates/\" })",
    ));
    assert_eq!(logs(&outcome), [MEMORY_BUDGET]);
    assert_eq!(
        log.args("edit_memory"),
        Some(json!({
            "name": "layout",
            "old_string": "src/",
            "new_string": "crates/",
        })),
        "the revision's two strings cross under gg's own names for them"
    );
}

#[test]
fn text_that_is_not_in_the_memory_is_a_not_found_revision() {
    let (outcome, _log) = failing(
        &caught(
            "memories",
            "memories.editMemory({ name: \"layout\", search: \"nope\", replace: \"yes\" });",
        ),
        "edit_memory",
        ToolFailure::NotFound,
        "edit_memory: `nope` does not appear in `layout`",
    );
    assert_caught(
        &outcome,
        "not-found",
        "edit_memory",
        "does not appear in `layout`",
    );
}

#[test]
fn text_that_appears_more_than_once_is_a_conflicting_revision() {
    let (outcome, _log) = failing(
        &caught(
            "memories",
            "memories.editMemory({ name: \"layout\", search: \"src\", replace: \"crates\" });",
        ),
        "edit_memory",
        ToolFailure::Conflict,
        "edit_memory: `src` appears 4 times in `layout`; include more surrounding text",
    );
    assert_caught(&outcome, "conflict", "edit_memory", "appears 4 times");
}

#[test]
fn a_revision_over_the_cap_is_limit_exceeded() {
    let (outcome, _log) = failing(
        &caught(
            "memories",
            "memories.editMemory({ name: \"layout\", search: \"src\", replace: \"crates\" });",
        ),
        "edit_memory",
        ToolFailure::LimitExceeded,
        "edit_memory: the revised memory is 5000 characters; this run allows 4000 in total",
    );
    assert_caught(
        &outcome,
        "limit-exceeded",
        "edit_memory",
        "the revised memory is 5000 characters",
    );
}

#[test]
fn a_revision_that_would_empty_the_memory_is_an_argument_failure() {
    let (outcome, _log) = failing(
        &caught(
            "memories",
            "memories.editMemory({ name: \"layout\", search: \"src/ holds the engine\", replace: \"\" });",
        ),
        "edit_memory",
        ToolFailure::InvalidArgument,
        "edit_memory: the revision would leave `layout` empty; delete it instead",
    );
    assert_caught(
        &outcome,
        "invalid-argument",
        "edit_memory",
        "would leave `layout` empty",
    );
}

#[test]
fn a_memory_search_reads_back_the_numbers_each_hit_was_ranked_by() {
    let (outcome, log) = run(concat!(
        "import { memories } from \"gg\";\n",
        "\n",
        "const hit = memories.searchMemories([\"build\"])[0];\n",
        "console.log(`${hit.name} ${hit.matched} ${hit.occurrences}`);\n",
        "console.log(`${hit.description} | ${hit.excerpt}`);\n",
    ));
    assert_eq!(
        logs(&outcome),
        [
            "build-commands 2 3",
            "How to build | …cargo nextest run --workspace…",
        ],
        "the primary ranking, the tiebreak and the window around the match all reached the program"
    );
    assert_eq!(
        log.args("search_memories"),
        Some(json!({ "keywords": ["build"] }))
    );
}

#[test]
fn a_memory_search_of_only_empty_keywords_is_an_argument_failure() {
    let (outcome, _log) = failing(
        &caught("memories", "memories.searchMemories([\"\", \"   \"]);"),
        "search_memories",
        ToolFailure::InvalidArgument,
        "search_memories: every keyword is empty; give at least one word to look for",
    );
    assert_caught(
        &outcome,
        "invalid-argument",
        "search_memories",
        "every keyword is empty",
    );
}

#[test]
fn a_deleted_memory_reports_the_budget_that_is_left_in_use() {
    let (outcome, log) = run(&memory_usage_program("memories.deleteMemory(\"layout\")"));
    assert_eq!(logs(&outcome), [MEMORY_BUDGET]);
    assert_eq!(log.args("delete_memory"), Some(json!({ "name": "layout" })));
}

#[test]
fn deleting_a_memory_that_is_not_held_is_not_found() {
    let (outcome, _log) = failing(
        &caught("memories", "memories.deleteMemory(\"nope\");"),
        "delete_memory",
        ToolFailure::NotFound,
        "delete_memory: no memory named `nope`",
    );
    assert_caught(
        &outcome,
        "not-found",
        "delete_memory",
        "no memory named `nope`",
    );
}

// ---------------------------------------------------------------------------------------------
// tasks
// ---------------------------------------------------------------------------------------------

#[test]
fn an_added_task_reports_the_budget_it_now_occupies() {
    let (outcome, log) = run(concat!(
        "import { tasks } from \"gg\";\n",
        "\n",
        "const usage = tasks.addTask({ id: \"t1\", title: \"T\", description: \"D\", blockedBy: [\"t0\"] });\n",
        "console.log(`${usage.count} ${usage.maxTasks}`);\n",
    ));
    assert_eq!(logs(&outcome), ["2 20"]);
    assert_eq!(
        log.args("add_task"),
        Some(json!({
            "id": "t1",
            "title": "T",
            "description": "D",
            "blockedBy": ["t0"],
        }))
    );
}

#[test]
fn a_duplicate_task_id_is_a_conflicting_addition() {
    let (outcome, _log) = failing(
        &caught("tasks", "tasks.addTask({ id: \"t1\", title: \"T\" });"),
        "add_task",
        ToolFailure::Conflict,
        "add_task: a task with the id `t1` is already on the list",
    );
    assert_caught(&outcome, "conflict", "add_task", "already on the list");
}

#[test]
fn a_blocker_edge_that_would_close_a_cycle_is_a_conflicting_addition() {
    let (outcome, _log) = failing(
        &caught(
            "tasks",
            "tasks.addTask({ id: \"t1\", title: \"T\", blockedBy: [\"t2\"] });",
        ),
        "add_task",
        ToolFailure::Conflict,
        "add_task: that blocker would close a cycle: t1 -> t2 -> t1",
    );
    assert_caught(
        &outcome,
        "conflict",
        "add_task",
        "would close a cycle: t1 -> t2 -> t1",
    );
}

#[test]
fn a_blocked_by_that_is_not_an_array_is_refused_before_it_crosses() {
    let (outcome, log) = run(&caught(
        "tasks",
        "tasks.addTask({ id: \"t1\", title: \"T\", blockedBy: \"t0\" });",
    ));
    assert_caught(
        &outcome,
        "invalid-argument",
        "addTask",
        "`blockedBy` must be an array, got string",
    );
    assert!(log.calls().is_empty(), "{:?}", log.names());
}

#[test]
fn a_task_update_carries_its_title_status_and_cleared_description() {
    let (outcome, log) = run(concat!(
        "import { tasks } from \"gg\";\n",
        "\n",
        "tasks.updateTask(\"t1\", { title: \"New\", description: null, status: \"in_progress\" });\n",
        "console.log(\"updated\");\n",
    ));
    assert_eq!(logs(&outcome), ["updated"]);
    // The SDK's `in_progress` is lowered onto the WIT's `in-progress`; anything else would have
    // been refused by the generated bindings before it crossed, which is the case below. What gg
    // records is its own schema's word for the same arm.
    assert_eq!(
        log.args("update_task"),
        Some(json!({
            "id": "t1",
            "title": "New",
            "status": "in_progress",
            "description": "",
        })),
        "`description: null` crossed as the empty-string clear sentinel rather than being omitted"
    );
}

#[test]
fn updating_a_task_that_is_not_on_the_list_is_not_found() {
    let (outcome, _log) = failing(
        &caught("tasks", "tasks.updateTask(\"nope\", { title: \"New\" });"),
        "update_task",
        ToolFailure::NotFound,
        "update_task: no task with the id `nope`",
    );
    assert_caught(
        &outcome,
        "not-found",
        "update_task",
        "no task with the id `nope`",
    );
}

#[test]
fn a_task_status_outside_the_three_names_the_cases_that_exist() {
    let (outcome, log) = run(&caught_binding(
        "tasks",
        "tasks.updateTask(\"t1\", { status: \"bogus\" });",
    ));
    let lines = logs(&outcome);
    assert!(
        lines[0].contains("task-status"),
        "the generated binding names the enum whose cases it lists: {}",
        lines[0]
    );
    assert_eq!(lines[1], "the program ran on");
    assert!(log.calls().is_empty(), "{:?}", log.names());
}

#[test]
fn replacing_a_task_s_blockers_carries_the_whole_new_set() {
    let (outcome, log) = run(concat!(
        "import { tasks } from \"gg\";\n",
        "\n",
        "tasks.setBlockedBy(\"t2\", [\"t0\", \"t1\"]);\n",
        "tasks.setBlockedBy(\"t2\", []);\n",
        "console.log(\"set\");\n",
    ));
    assert_eq!(logs(&outcome), ["set"]);
    let calls = log.calls();
    assert_eq!(
        calls.iter().map(|call| &call.args).collect::<Vec<_>>(),
        [
            &json!({ "id": "t2", "blockedBy": ["t0", "t1"] }),
            &json!({ "id": "t2", "blockedBy": [] }),
        ],
        "the whole set crosses each time, and an empty array is how a program clears it"
    );
}

#[test]
fn blocking_a_task_that_is_not_on_the_list_is_not_found() {
    let (outcome, _log) = failing(
        &caught("tasks", "tasks.setBlockedBy(\"nope\", [\"t0\"]);"),
        "set_blocked_by",
        ToolFailure::NotFound,
        "set_blocked_by: no task with the id `nope`",
    );
    assert_caught(
        &outcome,
        "not-found",
        "set_blocked_by",
        "no task with the id `nope`",
    );
}

#[test]
fn a_blocker_replacement_that_would_close_a_cycle_is_a_conflict() {
    let (outcome, _log) = failing(
        &caught("tasks", "tasks.setBlockedBy(\"t1\", [\"t2\"]);"),
        "set_blocked_by",
        ToolFailure::Conflict,
        "set_blocked_by: that blocker would close a cycle: t1 -> t2 -> t1",
    );
    assert_caught(
        &outcome,
        "conflict",
        "set_blocked_by",
        "would close a cycle: t1 -> t2 -> t1",
    );
}

#[test]
fn a_blocker_replacement_that_is_not_an_array_is_refused_before_it_crosses() {
    let (outcome, log) = run(&caught("tasks", "tasks.setBlockedBy(\"t1\", \"t0\");"));
    assert_caught(
        &outcome,
        "invalid-argument",
        "setBlockedBy",
        "`blockedBy` must be an array, got string",
    );
    assert!(log.calls().is_empty(), "{:?}", log.names());
}

#[test]
fn completing_a_task_reaches_the_host_with_its_id() {
    let (outcome, log) = run(concat!(
        "import { tasks } from \"gg\";\n",
        "\n",
        "tasks.completeTask(\"t1\");\n",
        "console.log(\"completed\");\n",
    ));
    assert_eq!(logs(&outcome), ["completed"]);
    assert_eq!(log.args("complete_task"), Some(json!({ "id": "t1" })));
}

#[test]
fn completing_a_task_that_is_not_on_the_list_is_not_found() {
    let (outcome, _log) = failing(
        &caught("tasks", "tasks.completeTask(\"nope\");"),
        "complete_task",
        ToolFailure::NotFound,
        "complete_task: no task with the id `nope`",
    );
    assert_caught(
        &outcome,
        "not-found",
        "complete_task",
        "no task with the id `nope`",
    );
}

#[test]
fn a_removed_task_reports_the_budget_that_is_left_in_use() {
    let (outcome, log) = run(concat!(
        "import { tasks } from \"gg\";\n",
        "\n",
        "const usage = tasks.removeTask(\"t1\");\n",
        "console.log(`${usage.count} ${usage.maxTasks}`);\n",
    ));
    assert_eq!(logs(&outcome), ["2 20"]);
    assert_eq!(log.args("remove_task"), Some(json!({ "id": "t1" })));
}

#[test]
fn removing_a_task_that_is_not_on_the_list_is_not_found() {
    let (outcome, _log) = failing(
        &caught("tasks", "tasks.removeTask(\"nope\");"),
        "remove_task",
        ToolFailure::NotFound,
        "remove_task: no task with the id `nope`",
    );
    assert_caught(
        &outcome,
        "not-found",
        "remove_task",
        "no task with the id `nope`",
    );
}

// ---------------------------------------------------------------------------------------------
// board
// ---------------------------------------------------------------------------------------------

/// The four board budget fields, as the canned usage carries them.
const BOARD_BUDGET: &str = "1 4 3 20";

/// The `createIssue` call every board test that needs an issue writes, with every required field.
const CREATE_ISSUE: &str = "{ title: \"T\", inScope: \"a\", outOfScope: \"b\", completionCriteria: \"c\", agent: \"worker\" }";

#[test]
fn a_created_epic_reads_back_its_id_and_the_board_budget() {
    let (outcome, log) = run(concat!(
        "import { board } from \"gg\";\n",
        "\n",
        "const epic = board.createEpic({ prefix: \"epc\", title: \"E\", description: \"D\" });\n",
        "console.log(`${epic.id} ${epic.board.epics} ${epic.board.maxEpics} ${epic.board.issues} ${epic.board.maxIssues}`);\n",
    ));
    assert_eq!(logs(&outcome), [format!("EPIC {BOARD_BUDGET}")]);
    assert_eq!(
        log.args("create_epic"),
        Some(json!({ "prefix": "epc", "title": "E", "description": "D" }))
    );
}

#[test]
fn a_prefix_outside_three_to_six_letters_is_an_argument_failure() {
    let (outcome, _log) = failing(
        &caught(
            "board",
            "board.createEpic({ prefix: \"ab\", title: \"E\", description: \"D\" });",
        ),
        "create_epic",
        ToolFailure::InvalidArgument,
        "create_epic: `prefix` must be 3 to 6 letters, got `ab`",
    );
    assert_caught(
        &outcome,
        "invalid-argument",
        "create_epic",
        "must be 3 to 6 letters",
    );
}

#[test]
fn a_prefix_another_epic_holds_is_a_conflicting_creation() {
    let (outcome, _log) = failing(
        &caught(
            "board",
            "board.createEpic({ prefix: \"epc\", title: \"E\", description: \"D\" });",
        ),
        "create_epic",
        ToolFailure::Conflict,
        "create_epic: the epic `EPC` already holds that prefix",
    );
    assert_caught(
        &outcome,
        "conflict",
        "create_epic",
        "already holds that prefix",
    );
}

#[test]
fn a_created_issue_reads_back_the_id_the_board_assigned_and_the_budget() {
    let (outcome, log) = run(&format!(
        r#"import {{ board }} from "gg";

const issue = board.createIssue({CREATE_ISSUE});
console.log(`${{issue.id}} ${{issue.board.epics}} ${{issue.board.maxEpics}} ${{issue.board.issues}} ${{issue.board.maxIssues}}`);
"#
    ));
    assert_eq!(logs(&outcome), [format!("EPIC-1 {BOARD_BUDGET}")]);
    assert_eq!(
        log.args("create_issue"),
        Some(json!({
            "title": "T",
            "description": null,
            "inScope": "a",
            "outOfScope": "b",
            "completionCriteria": "c",
            "blockedBy": [],
            "epicId": null,
            "agent": "worker",
            "reviewers": [],
        })),
        "the two omitted lists defaulted to empty rather than tripping the lowering"
    );
}

#[test]
fn an_agent_this_session_may_not_spawn_is_an_argument_failure() {
    let (outcome, _log) = failing(
        &caught("board", &format!("board.createIssue({CREATE_ISSUE});")),
        "create_issue",
        ToolFailure::InvalidArgument,
        "create_issue: this session may not spawn `worker`; it may spawn: reviewer",
    );
    assert_caught(
        &outcome,
        "invalid-argument",
        "create_issue",
        "may not spawn `worker`",
    );
}

#[test]
fn a_reviewer_this_session_may_not_spawn_is_an_argument_failure() {
    let (outcome, _log) = failing(
        &caught(
            "board",
            "board.createIssue({ title: \"T\", inScope: \"a\", outOfScope: \"b\", completionCriteria: \"c\", agent: \"worker\", reviewers: [\"ghost\"] });",
        ),
        "create_issue",
        ToolFailure::InvalidArgument,
        "create_issue: `ghost` is not a reviewer this session may spawn",
    );
    assert_caught(
        &outcome,
        "invalid-argument",
        "create_issue",
        "`ghost` is not a reviewer this session may spawn",
    );
}

#[test]
fn an_issue_blocker_edge_that_would_close_a_cycle_is_a_conflict() {
    let (outcome, _log) = failing(
        &caught(
            "board",
            "board.createIssue({ title: \"T\", inScope: \"a\", outOfScope: \"b\", completionCriteria: \"c\", agent: \"worker\", blockedBy: [\"EPIC-1\"] });",
        ),
        "create_issue",
        ToolFailure::Conflict,
        "create_issue: that blocker would close a cycle: EPIC-1 -> EPIC-2 -> EPIC-1",
    );
    assert_caught(
        &outcome,
        "conflict",
        "create_issue",
        "would close a cycle: EPIC-1 -> EPIC-2 -> EPIC-1",
    );
}

#[test]
fn issue_blockers_that_are_not_an_array_are_refused_before_they_cross() {
    let (outcome, log) = run(&caught(
        "board",
        "board.createIssue({ title: \"T\", inScope: \"a\", outOfScope: \"b\", completionCriteria: \"c\", agent: \"worker\", blockedBy: \"EPIC-1\" });",
    ));
    assert_caught(
        &outcome,
        "invalid-argument",
        "createIssue",
        "`blockedBy` must be an array, got string",
    );
    assert!(log.calls().is_empty(), "{:?}", log.names());
}

#[test]
fn issue_reviewers_that_are_not_an_array_are_refused_before_they_cross() {
    let (outcome, log) = run(&caught(
        "board",
        "board.createIssue({ title: \"T\", inScope: \"a\", outOfScope: \"b\", completionCriteria: \"c\", agent: \"worker\", reviewers: \"checker\" });",
    ));
    assert_caught(
        &outcome,
        "invalid-argument",
        "createIssue",
        "`reviewers` must be an array, got string",
    );
    assert!(log.calls().is_empty(), "{:?}", log.names());
}

#[test]
fn an_issue_update_carries_its_status_cleared_description_and_detachment() {
    let (outcome, log) = run(concat!(
        "import { board } from \"gg\";\n",
        "\n",
        "board.updateIssue(\"EPIC-1\", { description: null, status: \"done\", epicId: null });\n",
        "console.log(\"updated\");\n",
    ));
    assert_eq!(logs(&outcome), ["updated"]);
    assert_eq!(
        log.args("update_issue"),
        Some(json!({
            "id": "EPIC-1",
            "title": null,
            "inScope": null,
            "outOfScope": null,
            "completionCriteria": null,
            "status": "done",
            "description": "",
            "epicId": "",
        })),
        "both sentinels crossed as the empty string: a cleared description and a detached epic"
    );
}

#[test]
fn updating_an_issue_that_is_not_on_the_board_is_not_found() {
    let (outcome, _log) = failing(
        &caught(
            "board",
            "board.updateIssue(\"NOPE-1\", { title: \"New\" });",
        ),
        "update_issue",
        ToolFailure::NotFound,
        "update_issue: no issue with the id `NOPE-1`",
    );
    assert_caught(
        &outcome,
        "not-found",
        "update_issue",
        "no issue with the id `NOPE-1`",
    );
}

#[test]
fn an_issue_status_outside_its_cases_names_the_ones_that_exist() {
    let (outcome, log) = run(&caught_binding(
        "board",
        "board.updateIssue(\"EPIC-1\", { status: \"bogus\" });",
    ));
    let lines = logs(&outcome);
    assert!(
        lines[0].contains("issue-status"),
        "the generated binding names the enum whose cases it lists: {}",
        lines[0]
    );
    assert_eq!(lines[1], "the program ran on");
    assert!(log.calls().is_empty(), "{:?}", log.names());
}

#[test]
fn replacing_an_issue_s_blockers_carries_the_whole_new_set() {
    let (outcome, log) = run(concat!(
        "import { board } from \"gg\";\n",
        "\n",
        "board.setIssueBlockedBy(\"EPIC-2\", [\"EPIC-1\"]);\n",
        "board.setIssueBlockedBy(\"EPIC-2\", []);\n",
        "console.log(\"set\");\n",
    ));
    assert_eq!(logs(&outcome), ["set"]);
    let calls = log.calls();
    assert_eq!(
        calls.iter().map(|call| &call.args).collect::<Vec<_>>(),
        [
            &json!({ "id": "EPIC-2", "blockedBy": ["EPIC-1"] }),
            &json!({ "id": "EPIC-2", "blockedBy": [] }),
        ],
        "the whole set crosses each time, and an empty array is how a program clears it"
    );
}

#[test]
fn blocking_an_issue_that_is_not_on_the_board_is_not_found() {
    let (outcome, _log) = failing(
        &caught(
            "board",
            "board.setIssueBlockedBy(\"NOPE-1\", [\"EPIC-1\"]);",
        ),
        "set_issue_blocked_by",
        ToolFailure::NotFound,
        "set_issue_blocked_by: no issue with the id `NOPE-1`",
    );
    assert_caught(
        &outcome,
        "not-found",
        "set_issue_blocked_by",
        "no issue with the id `NOPE-1`",
    );
}

#[test]
fn an_issue_blocker_replacement_that_would_close_a_cycle_is_a_conflict() {
    let (outcome, _log) = failing(
        &caught(
            "board",
            "board.setIssueBlockedBy(\"EPIC-1\", [\"EPIC-2\"]);",
        ),
        "set_issue_blocked_by",
        ToolFailure::Conflict,
        "set_issue_blocked_by: that blocker would close a cycle: EPIC-1 -> EPIC-2 -> EPIC-1",
    );
    assert_caught(
        &outcome,
        "conflict",
        "set_issue_blocked_by",
        "would close a cycle: EPIC-1 -> EPIC-2 -> EPIC-1",
    );
}

#[test]
fn an_issue_blocker_replacement_that_is_not_an_array_is_refused_before_it_crosses() {
    let (outcome, log) = run(&caught(
        "board",
        "board.setIssueBlockedBy(\"EPIC-2\", \"EPIC-1\");",
    ));
    assert_caught(
        &outcome,
        "invalid-argument",
        "setIssueBlockedBy",
        "`blockedBy` must be an array, got string",
    );
    assert!(log.calls().is_empty(), "{:?}", log.names());
}

#[test]
fn a_removed_epic_reports_the_board_budget_that_is_left() {
    let (outcome, log) = run(concat!(
        "import { board } from \"gg\";\n",
        "\n",
        "const usage = board.removeEpic(\"EPIC\");\n",
        "console.log(`${usage.epics} ${usage.maxEpics} ${usage.issues} ${usage.maxIssues}`);\n",
    ));
    assert_eq!(logs(&outcome), [BOARD_BUDGET]);
    assert_eq!(log.args("remove_epic"), Some(json!({ "id": "EPIC" })));
}

#[test]
fn removing_an_epic_that_is_not_on_the_board_is_not_found() {
    let (outcome, _log) = failing(
        &caught("board", "board.removeEpic(\"NOPE\");"),
        "remove_epic",
        ToolFailure::NotFound,
        "remove_epic: no epic with the id `NOPE`",
    );
    assert_caught(
        &outcome,
        "not-found",
        "remove_epic",
        "no epic with the id `NOPE`",
    );
}

#[test]
fn a_removed_issue_reports_the_board_budget_that_is_left() {
    let (outcome, log) = run(concat!(
        "import { board } from \"gg\";\n",
        "\n",
        "const usage = board.removeIssue(\"EPIC-1\");\n",
        "console.log(`${usage.epics} ${usage.maxEpics} ${usage.issues} ${usage.maxIssues}`);\n",
    ));
    assert_eq!(logs(&outcome), [BOARD_BUDGET]);
    assert_eq!(log.args("remove_issue"), Some(json!({ "id": "EPIC-1" })));
}

#[test]
fn removing_an_issue_that_is_not_on_the_board_is_not_found() {
    let (outcome, _log) = failing(
        &caught("board", "board.removeIssue(\"NOPE-1\");"),
        "remove_issue",
        ToolFailure::NotFound,
        "remove_issue: no issue with the id `NOPE-1`",
    );
    assert_caught(
        &outcome,
        "not-found",
        "remove_issue",
        "no issue with the id `NOPE-1`",
    );
}

#[test]
fn a_registered_wait_reads_back_gg_s_acknowledgement() {
    let (outcome, log) = run(concat!(
        "import { board } from \"gg\";\n",
        "\n",
        "console.log(board.waitForIssue(\"EPIC-1\"));\n",
        "console.log(\"the program ran on\");\n",
    ));
    assert_eq!(
        logs(&outcome),
        ["wait registered", "the program ran on"],
        "nothing blocks inside the program: the wait is registered and the rest of it still runs"
    );
    assert_eq!(
        log.args("wait_for_issue"),
        Some(json!({ "issueId": "EPIC-1" }))
    );
}

#[test]
fn waiting_on_an_issue_that_is_not_on_the_board_is_not_found() {
    let (outcome, _log) = failing(
        &caught("board", "board.waitForIssue(\"NOPE-1\");"),
        "wait_for_issue",
        ToolFailure::NotFound,
        "wait_for_issue: no issue with the id `NOPE-1`",
    );
    assert_caught(
        &outcome,
        "not-found",
        "wait_for_issue",
        "no issue with the id `NOPE-1`",
    );
}

#[test]
fn waiting_on_this_session_s_own_issue_is_an_argument_failure() {
    let (outcome, _log) = failing(
        &caught("board", "board.waitForIssue(\"EPIC-1\");"),
        "wait_for_issue",
        ToolFailure::InvalidArgument,
        "wait_for_issue: `EPIC-1` is the issue this session was assigned",
    );
    assert_caught(
        &outcome,
        "invalid-argument",
        "wait_for_issue",
        "is the issue this session was assigned",
    );
}

// ---------------------------------------------------------------------------------------------
// skills
// ---------------------------------------------------------------------------------------------

#[test]
fn a_read_skill_hands_the_program_the_body_it_returned() {
    let (outcome, log) = run(concat!(
        "import { skills } from \"gg\";\n",
        "\n",
        "console.log(skills.readSkill(\"testing\"));\n",
    ));
    assert_eq!(
        logs(&outcome),
        ["the skill body"],
        "a skill's body is its own result, handed straight to the program"
    );
    assert_eq!(log.args("read_skill"), Some(json!({ "name": "testing" })));
}

#[test]
fn an_unknown_skill_is_not_found_and_lists_the_ones_that_exist() {
    let (outcome, _log) = failing(
        &caught("skills", "skills.readSkill(\"nope\");"),
        "read_skill",
        ToolFailure::NotFound,
        "read_skill: no skill named `nope`; available skills: testing",
    );
    assert_caught(
        &outcome,
        "not-found",
        "read_skill",
        "available skills: testing",
    );
}
