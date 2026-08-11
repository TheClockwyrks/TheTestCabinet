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
            "const entries = fs.listDir(\"src\");\n",
            "const text = fs.readTextFile(\"missing.ts\");\n",
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
            "  fs.readTextFile(\"missing.ts\");\n",
            "} catch (e) {\n",
            "  const failure = e as ToolError;\n",
            "  console.log(JSON.stringify({ code: failure.code, tool: failure.tool, caught: true }));\n",
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
            "  fs.editFile(\"a.ts\", \"x\", \"y\");\n",
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

    // A capability this run WITHHELD is bound like every other — the SDK is static — so the call
    // travels to the host and is refused there, with a sentence naming the gg capability that buys
    // it. It is `UnknownName` all the same, because that is what the host makes of an `unavailable`
    // code: reaching for something the run does not offer is one event on all eleven arms.
    let (outcome, log) = run_with(
        "return fs.listDir(\"src\");",
        &["shell".to_string()],
        SandboxLimits::default(),
        canned_outcome,
    );

    let error = program_error(&outcome);
    assert_eq!(error.kind, ProgramErrorKind::UnknownName);
    assert!(
        error
            .message
            .contains("`gg.files.listDir` is not available to you"),
        "{}",
        error.message
    );
    assert!(
        error.message.contains("the gg tool `list_dir`"),
        "the refusal names what is missing: {}",
        error.message
    );
    assert!(
        log.calls().is_empty(),
        "a withheld capability must never reach the loop"
    );

    // A name gg does not have at all is the other failure, and on **this** arm it can no longer be a
    // run-time one: the checker declares the whole surface plus every global a program may reach, so
    // an identifier neither of those covers is a located compile error before anything runs. That is
    // the better of the two answers and it is the direct consequence of the surface going static —
    // there is nothing left for a `ReferenceError` to be about except a name gg never had. The
    // guest's own unknown-name branch is exercised where it is still reachable: on the unchecked
    // JavaScript arm, and on Python and Ruby.
    let (outcome, log) = run_with(
        "return whatever.listDir(\"src\");",
        &["shell".to_string()],
        SandboxLimits::default(),
        canned_outcome,
    );
    assert!(
        matches!(&outcome.result, Err(SandboxError::Prepare(PrepareError::Compile(diagnostics)))
            if diagnostics.contains("Cannot find name 'whatever'")),
        "an identifier the checker does not know is rejected before the program runs: {:?}",
        outcome.result
    );
    assert!(log.calls().is_empty(), "and nothing ran");

    // The three mistakes a model makes because its TypeScript was stripped, not CHECKED. Each is
    // rejected by the SDK with a sentence naming the function and the argument.
    //
    // The options object, passed positionally — the shape the native tool-calling schema would have
    // taken. Left alone this silently uses the default and the model never learns.
    // `as any` is how the value reaches the wrapper now that the arm is checked: a bare positional
    // `300` is a compile error first, and this guard is what still catches the same mistake when the
    // value arrives untyped.
    let (outcome, _) = run("system.shell(\"npm test\", 300 as any);");
    let error = program_error(&outcome);
    assert!(
        error.message.contains("options object"),
        "{}",
        error.message
    );

    // A negative `offset` lowers by two's-complement wrap into 4294967295, and the read then fails
    // for a reason with nothing to do with what was written.
    let (outcome, _) = run("fs.readFile(\"a.ts\", { offset: -1 });");
    let error = program_error(&outcome);
    assert!(
        error
            .message
            .contains("must be a whole number 0..4294967295"),
        "{}",
        error.message
    );

    // An absent `list<T>` record field is defaulted rather than tripping the lowering over an
    // `undefined` with a message that names neither tool nor field.
    let (outcome, log) = run("tasks.addTask({ id: \"t1\", title: \"T\" });");
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
        error.message.contains("Promise") && error.message.contains("synchronous"),
        "{}",
        error.message
    );

    // A cyclic structure is NOT a fault, and used to be: nothing serialises a returned value any
    // more, because nothing carries one. The same is true of a two-hundred-deep tree, of a function,
    // and of every other shape that used to have its own rule and its own message.
    for program in [
        "const a: Record<string, unknown> = { name: \"x\" };\na.self = a;\nreturn a;",
        "let node: unknown = 1;\nfor (let i = 0; i < 200; i++) { node = [node]; }\nreturn node;",
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

    // And a value `JSON.stringify` renders as `{}` — a Map, a Set, a class with only accessors —
    // is described rather than reported as an empty object. `{}` is not a diagnostic.
    let (outcome, _) = run("throw new Map();");
    let error = program_error(&outcome);
    assert_ne!(error.message, "{}");
    assert!(error.message.contains("Map"), "{}", error.message);

    // And a program that says nothing at all is a clean run — not an error, and not a trap.
    let (outcome, log) = run("fs.writeFile(\"a.txt\", \"hi\");");
    match &outcome.result {
        Ok(result) => assert!(result.error.is_none(), "nothing went wrong"),
        Err(error) => panic!("the sandbox failed: {error}"),
    }
    assert!(outcome.logs.is_empty(), "and it said nothing");
    assert_eq!(log.names(), ["write_file"]);
}

/// **An argument of the wrong shape names the call it was wrong for.**
///
/// The most common mistake a model makes against an API it cannot compile against is an argument —
/// a missing required field, a number where a string goes — and it is caught one layer below the
/// SDK's own validators, by the generated lowering code, which knows the shape it wanted and
/// nothing about the call.
///
/// It used to be caught by nothing at all. The `TypeError` those bindings raise is an `Error` from
/// **another realm**, so `instanceof Error` answered `false`, the guest's classifier dropped it into
/// the value branch, and an `Error`'s fields are non-enumerable — so `JSON.stringify` rendered it as
/// the literal string `{}`, and that is the entire runtime error the model received. It could not
/// tell which call failed, what was wrong with it, or that an argument was involved.
///
/// So three properties are pinned here, and the first is the one that regressed: the message is not
/// `{}`; it names the function and the underlying fault; and it still carries the line of the
/// program that made the call.
#[test]
fn a_mistyped_argument_names_the_function_and_the_fault() {
    // A record missing a required field. `addTask` takes an `id`, and this program has none.
    let (outcome, _) = run("tasks.addTask({ title: \"ship it\" } as any);");
    let error = program_error(&outcome);
    assert_ne!(error.message, "{}", "the fault that used to arrive empty");
    assert_eq!(error.kind, ProgramErrorKind::ToolFailure);
    for fragment in [
        // Which call was wrong,
        "`addTask` failed (invalid-argument)",
        // and what the bindings actually said about it.
        "expected a string",
    ] {
        assert!(error.message.contains(fragment), "{}", error.message);
    }
    // And the program's own line survives the re-tagging: the `ToolError` is built at the call site,
    // and normalising it a second time must not replace the stack that knows where that was.
    assert_eq!(error.location.as_deref(), Some("line 1, column 7"));

    // A plain scalar in place of a string, on a different object, reported the same way. Cast for
    // the reason above: in a checked language this is a compile error before it is ever a call, and
    // the guard is what catches it when the value arrives typed `any`.
    let (outcome, _) = run("fs.readFile(123 as any);");
    let error = program_error(&outcome);
    assert!(
        error
            .message
            .contains("`readFile` failed (invalid-argument)"),
        "{}",
        error.message
    );
    assert!(error.location.is_some(), "{error:?}");
}

/// **A documentation lookup of something that is not a function says so.**
///
/// `view.openDocsView(system.run)` — a name the run does not bind — evaluates to `undefined` before
/// the call is even made, and the guest used to coerce it, look up a function literally named
/// `"undefined"`, and report that name back as unknown. The name was never the model's: nothing it
/// wrote said `undefined`, so it was sent hunting a typo that did not exist.
///
/// The argument is refused instead, by the last layer that can still see what the value was.
#[test]
fn a_docs_lookup_of_a_non_function_is_refused_on_the_argument() {
    // Both arrive through a value the type checker cannot see into, because it would otherwise
    // refuse them outright — which is the better answer for a checked arm and no answer at all for
    // the guard this test is about, which exists for every value that reaches the call as `any`.
    for program in [
        "view.openDocsView((fs as any).thereIsNoSuchFunction);",
        "view.openDocsView(undefined as any);",
    ] {
        let (outcome, _) = run(program);
        let error = program_error(&outcome);
        assert!(
            error
                .message
                .contains("`openDocsView` failed (invalid-argument)"),
            "{}: {}",
            program,
            error.message
        );
        assert!(
            !error.message.contains("undefined`"),
            "the model never wrote that name, so it is never quoted back: {}",
            error.message
        );
    }

    // A value of the wrong type entirely is named for what it is.
    let (outcome, _) = run("view.openDocsView(42 as any);");
    let error = program_error(&outcome);
    assert!(
        error
            .message
            .contains("expected a function or function name, got number"),
        "{}",
        error.message
    );
}
