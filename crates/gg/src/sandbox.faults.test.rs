//! What happens when a program goes wrong — which, for a model writing code against an API it
//! cannot compile against, is most of the time.
//!
//! Almost every case here is a **program** fault, reported through the guest's one `catch` and
//! handed back as a [`ProgramError`] with a line number in the program's own coordinates. None of
//! those is a trap, and none of them ends the session: the model reads what went wrong, on which
//! line, and writes another program. That difference is the whole reason the shim exists — and the
//! one genuine trap that is still reachable is asserted here too, so the boundary between the two
//! is a checked property rather than a claim.
//!
//! # Two tests, because each pays a component compile
//!
//! `cargo nextest` runs one process per test and the first thing either of these does is compile
//! the ~13 MB artifact. So they are consolidated by *what kind of thing went wrong* — a fault
//! during the program, and a fault in what it handed back — with each driving many programs against
//! its own store. Add a program to one of them rather than a third function.

use super::*;

/// Everything that can go wrong **while a program runs**, and the promise that none of it is lost:
/// the throw is classified, located and carries the tool's own words, and the calls that landed
/// before it still stand because they really happened.
#[test]
fn program_faults_are_reported_not_trapped() {
    let missing = |name: &str, args: &Value| {
        if name == "read_file" {
            ToolOutcome::failed(
                ToolFailure::NotFound,
                "read_file: no such file `missing.ts`",
            )
        } else {
            canned_outcome(name, args)
        }
    };

    // An uncaught tool failure names its tool and its class, and everything before it stands.
    let (outcome, log) = run_with(
        concat!(
            "const entries = listDir(\"src\");\n",
            "const text = readTextFile(\"missing.ts\");\n",
            "return text.length + entries.length;",
        ),
        &all_tools(),
        SandboxLimits::default(),
        missing,
    );

    let error = program_error(&outcome);
    assert_eq!(error.kind, ProgramErrorKind::ToolFailure);
    assert!(
        error.message.contains("`read_file` failed (not-found)"),
        "the throw must name the tool and its class: {}",
        error.message
    );
    assert!(
        error.message.contains("missing.ts"),
        "the throw must carry the tool's own guidance: {}",
        error.message
    );

    // The listing happened. It is real, it is recorded, and the model needs to know it landed.
    assert_eq!(log.names(), ["list_dir", "read_file"]);
    assert_eq!(outcome.tool_calls.len(), 2);
    assert!(outcome.tool_calls[1].error.is_some());

    // Catching it is ordinary control flow: the failure class is a value to branch on.
    let (outcome, _) = run_with(
        concat!(
            "try {\n",
            "  readTextFile(\"missing.ts\");\n",
            "} catch (e) {\n",
            "  console.log(JSON.stringify({ code: e.code, tool: e.tool, caught: true }));\n",
            "}\n",
        ),
        &all_tools(),
        SandboxLimits::default(),
        missing,
    );
    assert_eq!(
        logged_json(&outcome),
        json!({ "code": "not-found", "tool": "read_file", "caught": true })
    );

    // A caught failure is still on the record, so the feedback can say a call failed even when the
    // program recovered and carried on.
    assert_eq!(outcome.tool_calls.len(), 1);
    assert!(!outcome.tool_calls[0].ok);

    // A `ToolError` survives `JSON.stringify` WITH its message. `Error.prototype.message` is
    // non-enumerable, so without the SDK's `toJSON` a program that logs a caught failure — or an
    // array of them — writes `{}`: the difference between a reported failure and silence.
    let (outcome, _) = run_with(
        concat!(
            "try {\n",
            "  editFile(\"a.ts\", \"x\", \"y\");\n",
            "} catch (e) {\n",
            "  console.log(JSON.stringify({ direct: JSON.parse(JSON.stringify(e)), inArray: [e] }));\n",
            "}\n",
        ),
        &all_tools(),
        SandboxLimits::default(),
        |name, args| {
            if name == "edit_file" {
                ToolOutcome::failed(
                    ToolFailure::Conflict,
                    "edit_file: `old_string` is not unique (3 occurrences)",
                )
            } else {
                canned_outcome(name, args)
            }
        },
    );

    let returned = logged_json(&outcome);
    assert_eq!(returned["direct"]["name"], json!("ToolError"));
    assert_eq!(returned["direct"]["tool"], json!("edit_file"));
    assert_eq!(returned["direct"]["code"], json!("conflict"));
    assert!(
        returned["direct"]["message"]
            .as_str()
            .is_some_and(|message| message.contains("3 occurrences")),
        "the message must survive serialisation: {returned}"
    );
    assert_eq!(
        returned["inArray"][0]["message"], returned["direct"]["message"],
        "and it must survive nested inside a logged structure"
    );

    // A tool this run WITHHELD is an undefined identifier, not a call that travels to the host to be
    // refused — and the message answers the question the model is about to ask by listing the names
    // it does have. `ToolError` is deliberately not among them: it is catchable, not callable.
    let (outcome, log) = run_with(
        "return listDir(\"src\");",
        &["shell".to_string(), "read_file".to_string()],
        SandboxLimits::default(),
        canned_outcome,
    );

    let error = program_error(&outcome);
    assert_eq!(error.kind, ProgramErrorKind::UnknownName);
    assert!(
        error.message.contains("listDir is not defined"),
        "{}",
        error.message
    );
    assert!(
        error.message.contains("shell") && error.message.contains("readFile"),
        "the model must be told what it does have: {}",
        error.message
    );
    assert!(
        !error.message.contains("ToolError"),
        "`ToolError` is catchable, not callable, and listing it invites a call: {}",
        error.message
    );
    assert!(
        log.calls().is_empty(),
        "a withheld tool must never reach the loop"
    );

    // The three mistakes a model makes because its TypeScript was stripped, not CHECKED. Each is
    // rejected by the SDK with a sentence naming the function and the argument.
    //
    // The options object, passed positionally — the shape the native tool-calling schema would have
    // taken. Left alone this silently uses the default and the model never learns.
    let (outcome, _) = run("shell(\"npm test\", 300);");
    let error = program_error(&outcome);
    assert!(
        error.message.contains("options object"),
        "{}",
        error.message
    );

    // A negative `offset` lowers by two's-complement wrap into 4294967295, and the read then fails
    // for a reason with nothing to do with what was written.
    let (outcome, _) = run("readFile(\"a.ts\", { offset: -1 });");
    let error = program_error(&outcome);
    assert!(
        error.message.contains("whole number between 0 and"),
        "{}",
        error.message
    );

    // An absent `list<T>` record field is defaulted rather than tripping the lowering over an
    // `undefined` with a message that names neither tool nor field.
    let (outcome, log) = run("addTask({ id: \"t1\", title: \"T\" });");
    assert!(
        matches!(&outcome.result, Ok(result) if result.error.is_none()),
        "an omitted optional list must simply default: {:?}",
        outcome.result
    );
    assert_eq!(
        log.args("add_task")
            .and_then(|args| args.get("blockedBy").cloned()),
        Some(json!([]))
    );

    // And the boundary: a dynamic `import()` smuggled past the transpiler's STATIC rejection — the
    // one thing a program can still do that genuinely traps the store, at a WASI import the
    // component was built without. It is reported as the trap it is rather than lost, and it is the
    // only shape in this file that is not a `ProgramError`.
    let (outcome, _) = run("const f = new Function(\"return import('node:fs')\");\nreturn f();");
    match &outcome.result {
        Err(SandboxError::Trap(message)) => assert!(
            message.contains("path_filestat_get"),
            "a smuggled loader call traps at the absent WASI import: {message}"
        ),
        other => panic!("expected a trap, got {other:?}"),
    }
}

/// Everything that can go wrong with what a program **hands back**, each named specifically because
/// each is a mistake a model repeats and cannot diagnose from a generic message.
#[test]
fn a_bad_return_value_is_explained_rather_than_lost() {
    // A Promise: the tools are synchronous, and returning a Promise loses the result entirely.
    let (outcome, _) = run("return Promise.resolve(1);");
    let error = program_error(&outcome);
    assert!(
        error.message.contains("Promise") && error.message.contains("async"),
        "{}",
        error.message
    );

    // A cyclic structure is NOT a fault, and used to be: nothing serialises a returned value any
    // more, because nothing carries one. The same is true of a two-hundred-deep tree, of a function,
    // and of every other shape that used to have its own rule and its own message.
    for program in [
        "const a = { name: \"x\" };\na.self = a;\nreturn a;",
        "let node = 1;\nfor (let i = 0; i < 200; i++) { node = [node]; }\nreturn node;",
    ] {
        let (outcome, _) = run(program);
        assert!(
            matches!(&outcome.result, Ok(result) if result.error.is_none()),
            "`{program}` must run cleanly: {:?}",
            outcome.result
        );
        assert!(
            outcome.returned_value,
            "and the model is told where it went"
        );
    }

    // A plain throw keeps its message. The engine's stack does not begin with the name and message,
    // so rendering the stack alone would lose the one line that says what went wrong.
    let (outcome, _) = run("throw new Error(\"boom\");");
    let error = program_error(&outcome);
    assert_eq!(error.kind, ProgramErrorKind::Other);
    assert!(error.message.contains("boom"), "{}", error.message);
    assert_eq!(error.location.as_deref(), Some("line 1, column 7"));

    // Throwing something that is not an `Error` at all still reads.
    let (outcome, _) = run("throw { reason: \"nope\" };");
    let error = program_error(&outcome);
    assert!(error.message.contains("nope"), "{}", error.message);

    // And a program that says nothing at all is a clean run — not an error, and not a trap.
    let (outcome, log) = run("writeFile(\"a.txt\", \"hi\");");
    match &outcome.result {
        Ok(result) => assert!(result.error.is_none(), "nothing went wrong"),
        Err(error) => panic!("the sandbox failed: {error}"),
    }
    assert!(outcome.logs.is_empty(), "and it said nothing");
    assert_eq!(log.names(), ["write_file"]);
}
