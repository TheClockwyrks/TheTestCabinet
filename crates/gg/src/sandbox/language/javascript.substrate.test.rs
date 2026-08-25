//! **The JavaScript arm's execution substrate** — a real JavaScript program, really prepared by
//! this arm's own step and really evaluated by the [ECMAScript guest](super::super::ecmascript),
//! talking to gg's real host.
//!
//! # Why this file exists at all, given what the arm is
//!
//! [The arm](super::javascript) is [TypeScript](super::typescript)'s with the type check taken out,
//! and it holds every other variable at zero *by construction*: the same guest reached through the
//! same constant, the same catalogue, the same synthesized programs. A
//! sibling gate asserts each of those equalities directly
//! ([`the_javascript_arm_differs_from_typescript_only_in_the_check`](super::tests)).
//!
//! That says the arm *must* run. It does not say it *was* run — and every other registered language
//! answers that question with a test of its own that starts at a model's text and ends at a value
//! the host handed back. An arm whose execution is only ever inferred is an arm whose first real
//! program is a model's, in a study whose numbers nobody can separate from a plumbing fault.
//!
//! # What "real" means here
//!
//! All of it. A program starts as ordinary JavaScript, goes through
//! [`prepare_program`](ProgramLanguage::prepare_program) — which hands the guest the reply's own
//! bytes — and is driven through [`run_program`](crate::sandbox::run_program), the function a turn
//! calls, with the production linker, the production ceilings and the real membrane.
//!
//! One test rather than a file of them, and one process's component compile is why: `cargo nextest`
//! runs a process per test and the first thing any test here does is compile the guest. Add a
//! program to the function that is here rather than a second function beside it.

use serde_json::json;
use test_cabinet_core::gg::GgProgramLanguage;

use super::super::g8::{self, Answered, Case, Located, Shape};
use crate::limits::TurnErrorType;

use crate::context::ViewKind;
use crate::ending::EndingRole;
use test_cabinet_core::gg::CAPABILITY_DOCVIEW_CLOSE;

use crate::sandbox::fake::{
    CallLog, FakeOperationApi, all_capabilities, all_operations, all_operations_without,
    canned_outcome,
};
use crate::sandbox::language::PrepareContext;
use crate::sandbox::membrane::CodeModule;
use crate::sandbox::{
    ProgramLanguage, ProgramScope, RunEnding, SandboxLimits, SandboxOutcome, language, run_program,
};

/// This arm, reached through the registry so the test exercises the lookup production does.
fn javascript() -> &'static dyn ProgramLanguage {
    language(GgProgramLanguage::JavaScript)
}

/// Run `program` on this arm with every tool bound, the canned invoker and the default ceilings.
fn run(program: &str) -> (SandboxOutcome, CallLog) {
    run_with(program, &all_operations())
}

/// Run `program` on this arm against exactly `enabled` — what a reduced toolset really looks like
/// from inside a program.
fn run_with(
    program: &str,
    operations: &[crate::sandbox::operations::OperationId],
) -> (SandboxOutcome, CallLog) {
    run_scoped(program, operations, &[])
}

/// Run `program` with code modules supplied to it, which is what a turn after a code skill was used
/// looks like.
fn run_scoped(
    program: &str,
    operations: &[crate::sandbox::operations::OperationId],
    modules: &[CodeModule],
) -> (SandboxOutcome, CallLog) {
    let log = CallLog::default();
    let (outcome, _api) = run_program(
        javascript(),
        program,
        ProgramScope {
            capabilities: &all_capabilities(),
            operations,
            modules,
            ending: RunEnding::Role(EndingRole::Standard),
        },
        SandboxLimits::AMPLE,
        None,
        FakeOperationApi::with(&log, canned_outcome),
    );
    (outcome, log)
}

/// The lines a successful program logged, with the program's own failure surfaced rather than
/// swallowed.
/// The throw the guest reported, which is how every failure of a program's own reaches gg on
/// this arm — the guest reports over `feedback.report-error` and returns, so `result` is `Ok` and
/// the error rides on it.
fn thrown<'a>(outcome: &'a SandboxOutcome, why: &str) -> &'a crate::sandbox::outcome::ProgramError {
    match &outcome.result {
        Ok(result) => result.error.as_ref().expect(why),
        Err(error) => panic!("{why}: the store died instead of the guest reporting — {error:?}"),
    }
}

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

/// **A real JavaScript program runs through the real membrane** — its own bytes evaluated as a
/// module, calling gg's real host and reading back what it answered.
///
/// Five programs, because five different things are being observed and a component compile is paid
/// once per process:
///
/// 1. that a program with no gg call in it evaluates at all, that its own bytes are what ran, and
///    that evaluating it took time — a zero reading would mean it never ran;
/// 2. that typed calls reach the host in the order the program made them and their **results** are
///    values the program can read, which is the whole of what this capability is;
/// 3. that a program whose types are wrong **runs anyway**, which is this arm's entire reason for
///    existing. A sibling gate asserts that the checked arm rejects the same program at prepare
///    time; what it cannot assert is what happens next here, because on this arm there is a next;
/// 4. the documented `gg.<module>.<call>` spelling, reached through the import the documentation
///    states, across every bound module;
/// 5. the **convenience helpers** a returned value carries. They are the one part of this SDK that
///    is not a module export, so they are the one part no catalogue and no drift gate can prove:
///    they exist only if the baked guest attached them to the value the host handed back.
#[test]
fn a_real_javascript_program_runs_through_the_real_membrane() {
    // 1. The floor. Note what is absent: no import, no annotation, no ceremony — a program that
    //    calls nothing of gg's needs no line of gg's.
    let program = "console.log(40 + 2);\n";
    let (outcome, log) = run(program);
    assert_eq!(logs(&outcome), ["42"]);
    assert!(log.calls().is_empty(), "no tool was called");
    assert_eq!(
        javascript()
            .prepare_program(program, &[], &crate::sandbox::PrepareContext::new())
            .expect("nothing reads a program on this arm")
            .source,
        program,
        "the bytes the guest evaluated are the bytes the reply carried"
    );
    assert!(
        outcome.elapsed > std::time::Duration::ZERO,
        "evaluating a program takes time; a zero reading means it never ran"
    );
    assert!(
        outcome.compile.is_none(),
        "nothing compiles on this arm, so there is no compile time to report — `None` and \
         `Some(0)` are different claims and this arm is the one they are compared across"
    );

    // 2. The headline: list, filter, read each, write once, report. Every value here came back
    // across the membrane as a typed result the program read fields off, not as a document it
    // parsed — and every gg name in it came from the import on the first line.
    let (outcome, log) = run(concat!(
        "import { files } from \"gg\";\n",
        "\n",
        "const entries = files.listDir(\"src\").filter((e) => e.kind === \"file\");\n",
        "const texts = entries.map((e) => files.readFile(`src/${e.name}`).contents);\n",
        "const written = files.writeFile(\"out/summary.txt\", texts.join(\"\\n\"));\n",
        "console.log(JSON.stringify({ files: entries.map((f) => f.name), written }));\n",
    ));
    let lines = logs(&outcome);
    assert_eq!(lines.len(), 1, "expected one logged line: {lines:?}");
    let reported: serde_json::Value = serde_json::from_str(&lines[0])
        .unwrap_or_else(|error| panic!("the log line is not JSON ({error}): {}", lines[0]));
    assert_eq!(reported["files"], json!(["a.ts", "b.test.ts"]));
    assert!(
        reported["written"].as_u64().is_some_and(|bytes| bytes > 0),
        "the host's answer reached the program: {reported}"
    );
    assert_eq!(
        log.names(),
        ["list_dir", "read_file", "read_file", "write_file"],
        "the calls reach the host in the order the program made them"
    );
    assert_eq!(
        outcome
            .tool_calls
            .iter()
            .map(|call| call.name.as_str())
            .collect::<Vec<_>>(),
        [
            "files.list_dir",
            "files.read_file",
            "files.read_file",
            "files.write_file"
        ],
        "and the roster names what the MODEL wrote — the log above names the read each call was \
         serviced by"
    );

    // 3. The arm's variable, observed rather than inferred. `openText` takes two strings; this
    // program passes two numbers. On the checked arm that reply never reaches a guest — `tsc`
    // refuses it and the model is handed a diagnostic before anything runs. Here nothing reads the
    // program before the engine does, so the mistake becomes a *run-time* answer — and what
    // produces it is the hand-written half of the SDK, which is the layer the seam says exists to
    // validate the argument shapes the wire cannot. A turn later rather than a turn earlier is
    // exactly the cost this arm is registered to price.
    let (outcome, log) = run(concat!(
        "import { views } from \"gg\";\n",
        "\n",
        "views.openText(1, 2);\n",
        "console.log(\"reached\");\n",
    ));
    let error = thrown(&outcome, "an uncaught throw fails the program");
    let message = error.message.clone();
    assert!(
        message.contains("TypeError: expected a string, got a number"),
        "the SDK's own argument validation is what catches it, and it says what it wanted: {message}"
    );
    assert!(
        message.contains("(program.js:3:7)"),
        "and the engine's frames reach the model's own line, which is the line that names the \
         call: {message}"
    );
    assert!(
        !message.contains("sdk:"),
        "the SDK's own frames are struck, because `sdk:gg/views.js` is not a file the model can \
         open: {message}"
    );
    assert!(
        log.names().is_empty(),
        "nothing crossed the membrane: the SDK refused the call before the host saw it, which is \
         why the host never recorded one either — {:?}",
        log.names()
    );
    assert!(
        outcome.logs.is_empty(),
        "and the throw stopped the program, so the line after it never ran: {:?}",
        outcome.logs
    );

    // 4. THE DOCUMENTED SPELLING. `import { files } from "gg";` is the line every documentation view
    // of `gg.files` states, and `gg.files.readFile` is the name every search hit carries and the
    // prompt quotes — the call site is that name with its leading `gg.` dropped, which is the one
    // difference the prompt's language rules spell out. One named binding per bound module, plus the
    // `ApiError` the aggregate exports beside them.
    let (outcome, log) = run(concat!(
        "import { board, context, delegation, docs, files, memories } from \"gg\";\n",
        "import { session, shell, skills, tasks, views } from \"gg\";\n",
        "import { ApiError } from \"gg\";\n",
        "\n",
        "views.openText(\"scratch\", files.readFile(\"notes.md\").contents);\n",
        "shell.shell(\"ls\");\n",
        "board.createEpic({ prefix: \"epc\", title: \"E\", description: \"D\" });\n",
        "tasks.addTask({ id: \"t1\", title: \"T\" });\n",
        "memories.readMemory(\"layout\");\n",
        "context.compact(\"done\");\n",
        "delegation.sendMessage(\"agent-1\", \"more\");\n",
        "skills.readSkill(\"testing\");\n",
        "try {\n",
        "  files.readFile(\"a.ts\", { offset: -1 });\n",
        "} catch (error) {\n",
        "  console.log(`${error instanceof ApiError} ${error.code}`);\n",
        "}\n",
        // The call the whole discovery loop begins at, written the way the prompt describes it: a
        // query, a union of modules and a page, all of them optional and all of them in one options
        // object, and a value the program reads fields off. The double holds no catalogue, so what
        // is being observed here is the envelope crossing the membrane and the SDK's own lowering of
        // that object into six positional arguments — the ranking is `DocsRuntime`'s and is tested
        // against the arm's real catalogue.
        "const found = docs.search({\n",
        "  query: \"view\", modules: [\"gg.views\"], kind: \"function\", limit: 5,\n",
        "});\n",
        "console.log(JSON.stringify({\n",
        "  total: found.total, offset: found.offset, hits: found.hits.length,\n",
        "}));\n",
        "session.finish(\"drove the documented spelling\");\n",
    ));
    assert!(
        matches!(&outcome.result, Ok(result) if result.error.is_none()),
        "the documented spelling did not run: {:?}",
        outcome.result
    );
    assert_eq!(
        log.names(),
        [
            "read_file",
            "shell",
            "create_epic",
            "add_task",
            "read_memory",
            "compact",
            "send_message",
            "read_skill",
        ],
        "every module reached gg's dispatch from the binding its own import line states"
    );
    // A view is not a tool call, so `views.openText` shows up here rather than in the log above —
    // and neither is a search, which places its results in the window under gg's own constant
    // selector rather than under anything the program chose.
    assert_eq!(
        outcome
            .views_opened
            .iter()
            .map(|view| (view.kind, view.selector.as_str()))
            .collect::<Vec<_>>(),
        [
            (ViewKind::Text, "scratch"),
            (ViewKind::Search, crate::context::SEARCH_RESULTS_VIEW),
        ],
        "the documented spellings of `openText` and `search` each opened the view they name"
    );
    // The `ApiError` a `catch` narrows on, which the aggregate module exports beside the
    // namespaces so that one class serves the SDK and the program alike.
    let lines = logs(&outcome);
    assert_eq!(
        lines[0], "true invalid-argument",
        "an imported `ApiError` narrows a failure the SDK threw, and its `code` reads off it"
    );
    // The search's page came back as a value the program read fields off, envelope and all: a total
    // it can compare its page against, the offset echoed back so paging needs nothing tracked, and
    // hits it can index. The double finds nothing, which is the honest answer for a catalogue it
    // does not model — an empty page is still a page.
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&lines[1]).unwrap_or_else(|error| panic!(
            "the search's line is not JSON ({error}): {}",
            lines[1]
        )),
        json!({ "total": 0, "offset": 0, "hits": 0 }),
        "`gg.docs.search` handed the program a page it could read"
    );
    assert!(
        matches!(
            outcome
                .completion
                .as_ref()
                .map(|completion| &completion.ending),
            Some(crate::ending::Ending::Finished { .. })
        ),
        "the ending group is reached by its documented spelling too: {:?}",
        outcome.completion
    );

    // 5. THE CONVENIENCE HELPERS, which are the one part of this SDK that no static artifact can
    // vouch for. Every module function is an export the catalogue reflects, the checker declares and
    // the drift gate compares; a helper is a *closure the guest attaches to a value the host handed
    // back*, so the catalogue can promise `handle.send` and the embedded component can have
    // forgotten to put one there — a model reading the documentation would then meet a `TypeError`
    // on a call gg told it to make. That is only observable by running one, which is what this does:
    // four helpers, each hanging off a value a different call produced, each reaching gg's dispatch
    // under the operation it is an alias of.
    let (outcome, log) = run(concat!(
        "import * as gg from \"gg\";\n",
        "\n",
        "const issue = gg.board.createIssue({\n",
        "  title: \"T\", inScope: \"a\", outOfScope: \"b\", completionCriteria: \"c\", agent: \"worker\",\n",
        "});\n",
        "console.log(issue.wait());\n",
        "console.log(gg.memories.searchMemories([\"build\"])[0].read());\n",
        "gg.delegation.spawnSubagent({ agent: \"worker\", prompt: \"go\" }).send(\"more\");\n",
        "gg.views.openText(\"scratch\", \"shown\");\n",
        "console.log(String(gg.views.close(\"scratch\")));\n",
    ));
    assert_eq!(
        logs(&outcome),
        ["wait registered", "the memory contents", "1"],
        "each helper returned what the operation it aliases returns"
    );
    assert_eq!(
        log.names(),
        [
            "create_issue",
            "wait_for_issue",
            "search_memories",
            "read_memory",
            "spawn_subagent",
            "send_message",
        ],
        "and each reached gg's dispatch under that operation's own tool, interleaved with the call \
         that produced the value it hangs off"
    );
    // The whole point of a helper is the id it does not have to be told, so what is asserted is that
    // gg was handed the id the *previous* call minted rather than one the program restated.
    assert_eq!(
        log.args("wait_for_issue"),
        Some(json!({ "issueId": "EPIC-1" })),
        "`issue.wait()` supplied the id the board assigned"
    );
    assert_eq!(
        log.args("read_memory"),
        Some(json!({ "name": "build-commands" })),
        "`hit.read()` supplied the slug the search matched"
    );
    assert_eq!(
        log.args("send_message"),
        Some(json!({ "agentId": "agent-1", "message": "more" })),
        "`handle.send(text)` supplied the id the spawn minted"
    );
    assert_eq!(
        (
            outcome
                .views_opened
                .iter()
                .map(|view| view.selector.as_str())
                .collect::<Vec<_>>(),
            outcome.views_closed.clone()
        ),
        (vec!["scratch"], vec!["scratch".to_string()]),
        "`view.close()` closed the view it was listed as, supplying its own selector"
    );
}

/// **Nothing this arm offers resolves without a line the program wrote.**
///
/// The invariant every converted arm carries a test of, and the one this arm could not have had
/// while its guest bound gg's surface into a program's scope. The same call is written twice: once
/// with no import, where the engine's own `ReferenceError` names the identifier and nothing crosses
/// the membrane; and once with the import the documentation states, where it answers.
///
/// A **withheld capability** is deliberately not this case. Every function is bound whatever the run
/// enables, so reaching for one this agent was not granted is a refusal from the host.
#[test]
fn nothing_this_arm_offers_resolves_without_a_line_the_program_wrote() {
    let (outcome, log) = run("const found = docs.search({ query: \"view\" });\n");
    let error = thrown(&outcome, "an unbound identifier fails the program");
    let message = error.message.clone();
    assert!(
        message.contains("ReferenceError") && message.contains("docs is not defined"),
        "the engine's own sentence is what the model reads: {message}"
    );
    assert_eq!(
        error.kind,
        crate::sandbox::outcome::ProgramErrorKind::UnknownName,
        "and a ReferenceError is reported as an unknown name: {error:?}"
    );
    assert!(
        message.contains("program.js:1:1"),
        "in the model's own file: {message}"
    );
    assert!(log.calls().is_empty(), "and nothing ran");

    let (outcome, log) = run("import { docs } from \"gg\";\n\ndocs.search({ query: \"view\" });\n");
    assert!(
        matches!(&outcome.result, Ok(result) if result.error.is_none()),
        "the same call, reached through the line the documentation states: {:?}",
        outcome.result
    );
    assert!(
        log.calls().is_empty(),
        "searching is not a gg tool: {:?}",
        log.names()
    );
    assert_eq!(
        outcome.views_opened.len(),
        1,
        "it placed its page in the window"
    );

    // And the same rule for a **code module**, which is the other thing this arm makes available by
    // making a specifier resolve. Supplying it declares no name, so the key is an unbound identifier
    // until the program writes the import line.
    let modules = [CodeModule {
        name: "csvTools".to_string(),
        source: "export function parse(text) {\n  return text.length;\n}\n".to_string(),
    }];
    let (outcome, log) = run_scoped(
        "console.log(csvTools.parse(\"a,b\"));\n",
        &all_operations(),
        &modules,
    );
    let message = thrown(&outcome, "an unbound identifier fails the program")
        .message
        .clone();
    assert!(
        message.contains("ReferenceError") && message.contains("csvTools is not defined"),
        "a module in scope is not a name in scope: {message}"
    );
    assert!(log.calls().is_empty(), "and nothing ran");

    let written =
        "import * as csvTools from \"lib:csvTools\";\n\nconsole.log(csvTools.parse(\"a,b\"));\n";
    let (outcome, _log) = run_scoped(written, &all_operations(), &modules);
    assert_eq!(
        logs(&outcome),
        ["3"],
        "the same call, reached through the line the documentation states"
    );

    // The authorship rule under those same conditions: a module in scope changes nothing about the
    // bytes this arm hands the guest, because this arm hands over the reply and does nothing else.
    let prepared = javascript()
        .prepare_program(written, &modules, &PrepareContext::new())
        .expect("this arm prepares whatever it is handed");
    assert_eq!(
        prepared.source, written,
        "the prepared program is the model's own bytes"
    );
}

/// **A specifier the loader does not resolve is a refusal that says what to write instead.**
///
/// The other half of the import rule: a program that reaches past gg's documented surface — into the
/// SDK's own files, or into the raw membrane — is told the two specifiers that are the surface. It is
/// the engine's resolution that answers, so the sentence arrives with the failed import's own
/// coordinates.
#[test]
fn a_specifier_outside_the_documented_surface_names_the_ones_inside_it() {
    let (outcome, log) = run("import { readFile } from \"test-cabinet:gg/files\";\n");
    let message = thrown(&outcome, "an unresolvable import fails the program")
        .message
        .clone();
    assert!(
        message.contains("gg's own plumbing") && message.contains("import \"gg\""),
        "the refusal names what to write instead: {message}"
    );
    assert!(log.calls().is_empty(), "and nothing ran");
}

/// **A capability this run withheld is bound, called, and refused by the host** — the inversion,
/// observed on this arm rather than inferred from TypeScript's.
///
/// The two arms share one guest, so what is asserted here is not a second implementation; it is
/// that the *unchecked* arm reaches the same refusal, which is the arm where a model can actually
/// write the call without a compiler stopping it first. Three things are checked, and each is one of
/// the three reasons the inversion happened: the name is **there** (a property access, not a
/// `ReferenceError`), the refusal is a **value** a `catch` narrows and reads a code off, and the
/// sentence **names the capability** rather than merely saying no.
#[test]
fn a_withheld_capability_is_still_bound_and_refused_with_a_sentence() {
    let (outcome, log) = run_with(
        concat!(
            "import * as gg from \"gg\";\n",
            "import { ApiError } from \"gg\";\n",
            "\n",
            "console.log(String(typeof gg.files.listDir));\n",
            "try {\n",
            "  gg.files.listDir(\"src\");\n",
            "} catch (error) {\n",
            "  console.log(`${error instanceof ApiError} ${error.code} ${error.operation}`);\n",
            "  console.log(error.message);\n",
            "}\n",
        ),
        &[crate::sandbox::operations::SHELL_SHELL],
    );
    let lines = logs(&outcome);
    assert_eq!(
        lines[0], "function",
        "the withheld function is bound like every other: {lines:?}"
    );
    assert_eq!(
        lines[1], "true unavailable list_dir",
        "the refusal is a typed value the program narrowed and read: {lines:?}"
    );
    assert_eq!(
        lines[2], "`gg.files.listDir` is not available.",
        "and it names the call as this program would write it: {lines:?}"
    );
    assert!(
        log.calls().is_empty(),
        "nothing reached the host's dispatch"
    );
    assert_eq!(
        outcome.refusals.len(),
        1,
        "and the reach is recorded, which is what a comparison of two configurations counts: {:?}",
        outcome.refusals
    );

    // A capability buys a call the same way a tool does, and the documentation family is where the
    // two halves of that rule are visible side by side: searching is bound whatever a run enables,
    // because a model that cannot search cannot learn what it holds, and closing a documentation
    // view is bought — so this program's first call answers and its second is refused.
    let (outcome, log) = run_with(
        concat!(
            "import { docs, ApiError } from \"gg\";\n",
            "\n",
            "console.log(String(docs.search({ query: \"view\" }).total));\n",
            "try {\n",
            "  docs.closeAll();\n",
            "} catch (error) {\n",
            "  console.log(`${error instanceof ApiError} ${error.code} ${error.operation}`);\n",
            "  console.log(error.message);\n",
            "}\n",
        ),
        &all_operations_without(CAPABILITY_DOCVIEW_CLOSE),
    );
    let lines = logs(&outcome);
    assert_eq!(
        lines[0], "0",
        "searching is never bought, so it answered: {lines:?}"
    );
    assert_eq!(
        lines[1], "true unavailable close_all",
        "and closing is, so it refused as a value the program narrowed: {lines:?}"
    );
    assert_eq!(
        lines[2], "`gg.docs.closeAll` is not available.",
        "naming the call the program wrote and stopping there: {lines:?}"
    );
    assert!(
        log.calls().is_empty(),
        "neither call is a gg tool: {:?}",
        log.names()
    );
}

/// **Gate [G8](super::super::g8) for JavaScript** — all five shapes a runtime failure takes,
/// driven through the production path and read back as the model would read them.
///
/// Every location below is `program.js`, which is the model's own file: nothing prepared these
/// programs, so the coordinates the engine reports are already the coordinates the model wrote in
/// and there is no map between them.
#[test]
fn g8_a_runtime_failure_reaches_the_model() {
    g8::gate(
        GgProgramLanguage::JavaScript,
        &[
            Case {
                shape: Shape::ApiError,
                program: r#"// G8 (a): a gg call the host answers `not-found`, uncaught.

import { files } from "gg";

const text = files.readFile(
  "missing.md",
);
console.log(text);
"#,
                names: &["read_file", "not-found", "missing.md"],
                located: Located::At("program.js:6:3"),
                answered: Answered::AtRuntime,
                // The guest reads the `code` off the uncaught `ApiError` and reports it, so the
                // turn is filed as the program fighting the API — as on Python, Ruby and C++ —
                // and never as a sandbox trap.
                recorded: Some(TurnErrorType::ProgramApiError),
            },
            Case {
                shape: Shape::NativeFault,
                program: r#"// G8 (b): reaching into something that is not there.

const values = [1, 2, 3];
console.log(
  values[7].toString(),
);
"#,
                names: &["TypeError", "toString"],
                located: Located::At("program.js:5:3"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::ProgramThrow),
            },
            Case {
                shape: Shape::FailureValue,
                program: r#"// G8 (c): an async failure nothing observes.

async function step() {
  throw new Error("the third step did not finish");
}

step();
"#,
                names: &["the third step did not finish"],
                located: Located::At("program.js:4:13"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::ProgramThrow),
            },
            Case {
                shape: Shape::ResourceFault,
                program: r#"// G8 (d): unbounded recursion.

function deeper(n) {
  return deeper(n + 1);
}

deeper(0);
"#,
                names: &["Maximum call stack size exceeded"],
                located: Located::At("program.js:4:21"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::ProgramThrow),
            },
            Case {
                shape: Shape::Abort,
                program: r#"// G8 (e): stopping the process outright.

console.log("before the exit");
process.exit(
  3,
);
console.log("after the exit");
"#,
                names: &["process is not defined"],
                located: Located::At("program.js:4:1"),
                // The guest is not Node and binds no `process`, so a program cannot stop it. What
                // the model reads is the engine's own `ReferenceError` at the line it reached for
                // one, and the statements after it do not run. A `ReferenceError` is reported
                // as an unknown name, which is what reaching for a name nothing bound is.
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::ProgramUnknownName),
            },
        ],
    );
}
