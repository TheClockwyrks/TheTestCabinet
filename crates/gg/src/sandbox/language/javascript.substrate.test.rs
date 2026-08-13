//! **The JavaScript arm's execution substrate** — a real JavaScript program, really prepared by
//! this arm's own step and really evaluated by the embedded guest, talking to gg's real host.
//!
//! # Why this file exists at all, given what the arm is
//!
//! [The arm](super::javascript) is [TypeScript](super::typescript)'s with the type check taken out,
//! and it holds every other variable at zero *by construction*: the same embedded component
//! reached through TypeScript's own constant, the same strip, the same catalogue, the same healing
//! dialect. A sibling gate asserts each of those equalities directly
//! ([`the_javascript_arm_differs_from_typescript_only_in_the_check`](super::tests)), and
//! `sandbox.test.rs` drives whole programs through that very component.
//!
//! Between them those two say the arm *must* run. They do not say it *was* run — and every other
//! registered language answers that question with a test of its own that starts at a model's text
//! and ends at a value the host handed back. An arm whose execution is only ever inferred is an arm
//! whose first real program is a model's, in a study whose numbers nobody can separate from a
//! plumbing fault. So the inference is replaced with an observation, in the shape the other ten
//! arms already use.
//!
//! # What "real" means here
//!
//! All of it. A program starts as ordinary JavaScript, goes through
//! [`prepare_program`](ProgramLanguage::prepare_program) — this arm's production step, the `oxc`
//! strip with nothing after it — and the prepared source is handed to the **prebuilt**
//! `guests/typescript.component.wasm`, linked with the production
//! [linker](crate::sandbox::linker), instantiated with the production ceilings and driven through
//! the real membrane, exactly as [`run_program`](crate::sandbox::run_program) does on a turn.
//!
//! One test rather than a file of them, and one process's component compile is why: `cargo nextest`
//! runs a process per test and the first thing any test here does is compile the ~13.4 MB artifact.
//! `sandbox.test.rs` states the same rule for the same reason — add a program to the function that
//! is here rather than a second function beside it.

use serde_json::json;
use test_cabinet_core::gg::GgProgramLanguage;

use crate::context::ViewKind;
use crate::ending::EndingRole;
use test_cabinet_core::gg::CAPABILITY_DOCVIEW_CLOSE;

use crate::sandbox::fake::{
    CallLog, FakeToolApi, all_capabilities, all_operations, all_operations_without, canned_outcome,
};
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
    let log = CallLog::default();
    let (outcome, _api) = run_program(
        javascript(),
        program,
        ProgramScope {
            capabilities: &all_capabilities(),
            operations,
            modules: &[],
            ending: RunEnding::Role(EndingRole::Standard),
        },
        SandboxLimits::default(),
        None,
        FakeToolApi::with(&log, canned_outcome),
    );
    (outcome, log)
}

/// The lines a successful program logged, with the program's own failure surfaced rather than
/// swallowed.
fn logs(outcome: &crate::sandbox::SandboxOutcome) -> &[String] {
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

/// **A real JavaScript program runs through the real membrane** — prepared by this arm, evaluated by
/// the embedded guest, calling gg's real host and reading back what it answered.
///
/// Three programs, because three different things are being observed and a component compile is
/// paid once per process:
///
/// 1. that a program with no gg call in it evaluates at all, and that evaluating it took time — a
///    zero reading would mean it never ran;
/// 2. that typed calls reach the host in the order the program made them and their **results** are
///    values the program can read, which is the whole of what this capability is;
/// 3. that a program whose types are wrong **runs anyway**, which is this arm's entire reason for
///    existing. A sibling gate asserts that the checked arm rejects the same program at prepare
///    time; what it cannot assert is what happens next here, because on this arm there is a next.
///
/// Two more were added with the surface they observe: the documented `gg.<module>.<call>` spelling
/// (4), and the **convenience helpers** a returned value carries (5). The helpers are the one part
/// of this SDK that is not a module export, so they are the one part no catalogue, no type check
/// and no drift gate can prove: they exist only if the *baked component* attached them to the value
/// the host handed back.
#[test]
fn a_real_javascript_program_runs_through_the_real_membrane() {
    // 1. The floor.
    let (outcome, log) = run("console.log(40 + 2);");
    assert_eq!(logs(&outcome), ["42"]);
    assert!(log.calls().is_empty(), "no tool was called");
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
    // parsed.
    let (outcome, log) = run(concat!(
        "const files = fs.listDir(\"src\").filter((e) => e.kind === \"file\");\n",
        "const texts = files.map((e) => fs.readTextFile(`src/${e.name}`));\n",
        "const written = fs.writeFile(\"out/summary.txt\", texts.join(\"\\n\"));\n",
        "console.log(JSON.stringify({ files: files.map((f) => f.name), written }));",
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
            "files.read_text_file",
            "files.read_text_file",
            "files.write_file"
        ],
        "and the roster names what the MODEL wrote, which is `readTextFile` twice — the log above \
         names the read each of them was serviced by"
    );

    // 3. The arm's variable, observed rather than inferred. `view.openText` takes two strings; this
    // program passes two numbers. On the checked arm that reply never reaches a guest — `tsc`
    // refuses it and the model is handed a diagnostic before anything runs. Here nothing reads the
    // program before the engine does, so the mistake becomes a *run-time* answer — and what
    // produces it is the hand-written half of the SDK, which is the layer the seam says exists to
    // validate the argument shapes the wire cannot. A turn later rather than a turn earlier is
    // exactly the cost this arm is registered to price.
    let (outcome, log) = run("view.openText(1, 2);\nconsole.log(\"reached\");");
    assert!(
        outcome.result.is_ok(),
        "the sandbox ran the program rather than refusing it: {:?}",
        outcome.result
    );
    let result = outcome
        .result
        .as_ref()
        .expect("the sandbox ran the program rather than refusing it before it started");
    let error = result.error.as_ref().expect(
        "a call written with the wrong argument types fails somewhere; here it is at run time",
    );
    assert!(
        error.message.contains("`openText` failed")
            && error
                .message
                .contains("expected a string, received [number]"),
        "the SDK's own argument validation is what catches it, and it says what it wanted: {}",
        error.message
    );
    assert_eq!(
        error.location.as_deref(),
        Some("line 1, column 6"),
        "and it is reported at the model's own coordinates, not the guest's"
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

    // 4. THE DOCUMENTED SPELLING, which is the one nothing above uses. `fs` and `view` are legacy
    // grouping names that appear in no catalogue and that no model is ever shown; they are bound for
    // the sibling arms whose compiled bundles resolve them as free identifiers. What a model reads is
    // `gg.<module>.<function>`, and until this ran, the surface every test executed was the one no
    // model is shown and the surface every model is shown was the one nothing executed — so a
    // regression in the shim's module wiring would have left this suite green and every real program
    // dead with a `ReferenceError`.
    //
    // One call per bound module, the module directory every module carries, and the one gg name
    // bound bare.
    let (outcome, log) = run(concat!(
        "gg.views.openText(\"scratch\", gg.files.readTextFile(\"notes.md\"));\n",
        "gg.shell.shell(\"ls\");\n",
        "gg.board.createEpic({ prefix: \"epc\", title: \"E\", description: \"D\" });\n",
        "gg.tasks.addTask({ id: \"t1\", title: \"T\" });\n",
        "gg.memories.readMemory(\"layout\");\n",
        "gg.context.compact(\"done\");\n",
        "gg.delegation.sendMessage(\"agent-1\", \"more\");\n",
        "gg.skills.readSkill(\"testing\");\n",
        "try {\n",
        "  gg.files.readTextFile(42);\n",
        "} catch (error) {\n",
        "  console.log(String(error instanceof ToolError));\n",
        "}\n",
        // The call the whole discovery loop begins at, written the way the prompt describes it: a
        // query, a module filter and a page, and a value the program reads fields off. The double
        // holds no catalogue, so what is being observed here is the envelope crossing the membrane
        // and the SDK's own lowering of an options object into six positional arguments — the
        // ranking is `DocsRuntime`'s and is tested against the arm's real catalogue.
        "const found = gg.docs.search(\"view\", { module: \"gg.views\", kind: \"function\", limit: 5 });\n",
        "console.log(JSON.stringify({\n",
        "  total: found.total, offset: found.offset, hits: found.hits.length,\n",
        "}));\n",
        "gg.session.finish(\"drove the documented spelling\");\n",
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
        "every module reached gg's dispatch from its `gg.`-qualified spelling"
    );
    // A view is not a tool call, so `gg.views.openText` shows up here rather than in the log above —
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
    // The bare `ToolError` a `catch` narrows on — the one thing the prompt teaches that is not a
    // tool call.
    let lines = logs(&outcome);
    assert_eq!(
        lines[0], "true",
        "`ToolError` is bound bare, so `instanceof` narrows a caught failure"
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
        "const issue = gg.board.createIssue({\n",
        "  title: \"T\", inScope: \"a\", outOfScope: \"b\", completionCriteria: \"c\", agent: \"worker\",\n",
        "});\n",
        "console.log(issue.wait());\n",
        "console.log(gg.memories.searchMemories([\"build\"])[0].read());\n",
        "gg.delegation.spawnSubagent({ agent: \"worker\", prompt: \"go\" }).send(\"more\");\n",
        "gg.views.openText(\"scratch\", \"shown\");\n",
        "console.log(String(gg.views.current()[0].close()));\n",
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

/// **A name gg does not have is an unknown name, and the guest answers the question it provokes.**
///
/// This lives on *this* arm rather than on TypeScript's, and the reason is the whole of what the
/// static surface changed. On the checked arm the SDK's every module and function is declared to
/// `tsc`, so an identifier neither the surface nor the globals covers is a located **compile error**
/// before anything runs — there is no `ReferenceError` left to observe there. Here nothing reads a
/// program before the engine does, so the guest's own branch is reachable, and what it composes into
/// the error is the answer to *what do I have?*: gg's modules, qualified exactly as the
/// documentation qualifies them.
///
/// A **withheld capability** is deliberately not this case any more, on any arm. Every function is
/// bound whatever the run enables, so reaching for one this agent was not granted is a refusal from
/// the host — see `sandbox.faults.test.rs` and each arm's surface test.
#[test]
fn a_name_gg_does_not_have_is_an_unknown_name_that_names_the_modules_it_does() {
    let (outcome, log) = run("whatever.listDir(\"src\");");
    let result = outcome
        .result
        .as_ref()
        .expect("nothing reads the program before the engine on this arm");
    let error = result
        .error
        .as_ref()
        .expect("an identifier nothing bound is a run-time failure here");
    assert_eq!(error.kind, crate::sandbox::ProgramErrorKind::UnknownName);
    assert!(
        error.message.contains("whatever is not defined"),
        "the engine's own sentence is kept: {}",
        error.message
    );
    assert!(
        error.message.contains("gg.files") && error.message.contains("gg.session"),
        "and gg's modules are named beside it: {}",
        error.message
    );
    assert!(
        !error.message.contains("ToolError"),
        "`ToolError` is catchable, not callable, and listing it invites a call: {}",
        error.message
    );
    assert!(log.calls().is_empty(), "and nothing ran");
}

/// **A capability this run withheld is bound, called, and refused by the host** — the inversion,
/// observed on this arm rather than inferred from TypeScript's.
///
/// The two arms share one component, so what is asserted here is not a second implementation; it is
/// that the *unchecked* arm reaches the same refusal, which is the arm where a model can actually
/// write the call without a compiler stopping it first. Three things are checked, and each is one of
/// the three reasons the inversion happened: the name is **there** (a property access, not a
/// `ReferenceError`), the refusal is a **value** a `catch` narrows and reads a code off, and the
/// sentence **names the capability** rather than merely saying no.
#[test]
fn a_withheld_capability_is_still_bound_and_refused_with_a_sentence() {
    let (outcome, log) = run_with(
        concat!(
            "console.log(String(typeof gg.files.listDir));\n",
            "try {\n",
            "  gg.files.listDir(\"src\");\n",
            "} catch (error) {\n",
            "  console.log(`${error instanceof ToolError} ${error.code} ${error.tool}`);\n",
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
            "console.log(String(gg.docs.search(\"view\").total));\n",
            "try {\n",
            "  gg.docs.closeAll();\n",
            "} catch (error) {\n",
            "  console.log(`${error instanceof ToolError} ${error.code} ${error.tool}`);\n",
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
