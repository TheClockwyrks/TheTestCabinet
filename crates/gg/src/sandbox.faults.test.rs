//! What happens when a program goes wrong — which, for a model writing code against an API it
//! cannot compile against, is most of the time.
//!
//! # Capture, not interception
//!
//! Nothing in this arm's guest catches a program's throw in order to describe it. The engine renders
//! the uncaught value the way a JavaScript host renders one — the `name`, the `message`, the stack,
//! and the properties the thrown object carries of its own — writes it to standard error, and dies.
//! gg puts what it said in front of the trap, so what the model reads is its own language's account
//! of its own failure, at the line it wrote, and every assertion here reads that text through
//! [`program_failure`].
//!
//! The calls that landed before the failure still stand, because they really happened: a refusal and
//! a failed call are recorded by the **host**, on the membrane, whatever the guest then does with
//! the throw.
//!
//! # How these are grouped
//!
//! By *what kind of thing went wrong*, each driving many programs against its own store. Each test
//! is its own process under `cargo nextest` and obtains the compiled guest once — under test usually
//! a load from the on-disk component cache (`sandbox/engine.cache.rs`) — so a new kind of failure is
//! a new function rather than more programs in an existing one.

use super::*;

/// Everything that can go wrong **while a program runs**, and the promise that none of it is lost:
/// the throw carries the tool's own words and the model's own line, and the calls that landed before
/// it still stand.
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
            "import * as gg from \"gg\";\n",
            "const entries = gg.files.listDir(\"src\");\n",
            "const read = gg.files.readFile(\"missing.ts\");\n",
            "console.log(read.kind + entries.length);\n",
        ),
        &all_operations(),
        SandboxLimits::AMPLE,
        missing,
    );

    let said = program_failure(&outcome);
    for fragment in [
        // What was thrown, in the engine's own words,
        "ApiError: read_file: no such file `missing.ts`",
        // which call it was and why, off the properties the error carries,
        "operation: \"read_file\"",
        "code: \"not-found\"",
        // and the line of the program that made the call.
        "(program.ts:3:23)",
    ] {
        assert!(
            said.contains(fragment),
            "the failure should carry {fragment:?}: {said}"
        );
    }

    // The listing happened. It is real, it is recorded, and the model needs to know it landed.
    assert_eq!(log.names(), ["list_dir", "read_file"]);
    assert_eq!(outcome.tool_calls.len(), 2);
    assert!(outcome.tool_calls[1].error.is_some());

    // Catching it is ordinary control flow: the failure class is a value to branch on.
    let (outcome, _) = run_with(
        concat!(
            "import * as gg from \"gg\";\n",
            "try {\n",
            "  gg.files.readFile(\"missing.ts\");\n",
            "} catch (e) {\n",
            "  const failure = e as gg.core.ApiError;\n",
            "  console.log(JSON.stringify({ code: failure.code, operation: failure.operation, caught: true }));\n",
            "}\n",
        ),
        &all_operations(),
        SandboxLimits::AMPLE,
        missing,
    );
    assert_eq!(
        logged_json(&outcome),
        json!({ "code": "not-found", "operation": "read_file", "caught": true })
    );

    // A caught failure is still on the record, so the feedback can say a call failed even when the
    // program recovered and carried on.
    assert_eq!(outcome.tool_calls.len(), 1);
    assert!(!outcome.tool_calls[0].ok);

    // An `ApiError` survives `JSON.stringify` WITH its message. `Error.prototype.message` is
    // non-enumerable, so without the SDK's `toJSON` a program that logs a caught failure — or an
    // array of them — writes `{}`: the difference between a reported failure and silence.
    let (outcome, _) = run_with(
        concat!(
            "import * as gg from \"gg\";\n",
            "try {\n",
            "  gg.files.editFile(\"a.ts\", \"x\", \"y\");\n",
            "} catch (e) {\n",
            "  console.log(JSON.stringify({ direct: JSON.parse(JSON.stringify(e)), inArray: [e] }));\n",
            "}\n",
        ),
        &all_operations(),
        SandboxLimits::AMPLE,
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
    assert_eq!(returned["direct"]["name"], json!("ApiError"));
    assert_eq!(returned["direct"]["operation"], json!("edit_file"));
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

    // A call this agent was NOT granted is bound like every other — the SDK is static — so it
    // travels to the host and is refused there, and the refusal reaches the model as the error the
    // SDK raised for it.
    let (outcome, log) = run_with(
        "import * as gg from \"gg\";\nconst entries = gg.files.listDir(\"src\");\nconsole.log(entries.length);\n",
        &[crate::sandbox::operations::SHELL_SHELL],
        SandboxLimits::AMPLE,
        canned_outcome,
    );

    let said = program_failure(&outcome);
    assert!(
        said.contains("`gg.files.listDir` is not available."),
        "the refusal names the call the way this program wrote it, and stops there — what would \
         have to change to unlock it is not something this agent can change: {said}"
    );
    assert!(
        said.contains("code: \"unavailable\""),
        "and it carries the class the host refused it under: {said}"
    );
    assert!(
        log.calls().is_empty(),
        "a withheld capability must never reach the loop"
    );

    // A name gg does not have at all is the other failure, and on **this** arm it can no longer be a
    // run-time one: the compiler reads the whole surface plus every global a program may reach, so
    // an identifier neither of those covers is a located compile error before anything runs. That is
    // the better of the two answers and it is the direct consequence of the surface going static.
    let (outcome, log) = run_with(
        "whatever.listDir(\"src\");\n",
        &[crate::sandbox::operations::SHELL_SHELL],
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    assert!(
        matches!(&outcome.result, Err(SandboxError::Prepare(PrepareError::Compile(diagnostics)))
            if diagnostics.contains("Cannot find name 'whatever'")),
        "an identifier the compiler does not know is rejected before the program runs: {:?}",
        outcome.result
    );
    assert!(log.calls().is_empty(), "and nothing ran");

    // The three mistakes a model makes when a value reaches the SDK typed `any` — which is the only
    // way any of them can happen on a checked arm, since each is a compile error when it is written
    // plainly. Each is rejected by the SDK with a sentence naming the function and the argument.
    //
    // The options object, passed positionally — the shape the native tool-calling schema would have
    // taken. Left alone this silently uses the default and the model never learns.
    let (outcome, _) =
        run("import * as gg from \"gg\";\ngg.shell.shell(\"npm test\", 300 as any);\n");
    assert!(
        program_failure(&outcome).contains("options object"),
        "{}",
        program_failure(&outcome)
    );

    // A negative `offset` lowers by two's-complement wrap into 4294967295, and the read then fails
    // for a reason with nothing to do with what was written.
    let (outcome, _) =
        run("import * as gg from \"gg\";\ngg.files.readFile(\"a.ts\", { offset: -1 });\n");
    assert!(
        program_failure(&outcome).contains("must be a whole number 0..4294967295"),
        "{}",
        program_failure(&outcome)
    );

    // An absent `list<T>` record field is defaulted rather than tripping the lowering over an
    // `undefined` with a message that names neither tool nor field.
    let (outcome, log) =
        run("import * as gg from \"gg\";\ngg.tasks.addTask({ id: \"t1\", title: \"T\" });\n");
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

    // And the boundary: a specifier the loader has no answer for. It is refused by the loader with a
    // sentence saying what to write instead, rather than trapping the store the way the same reach
    // does on the guest this arm left.
    let (outcome, _) = run("import * as fs from \"node:fs\";\nconsole.log(fs);\n");
    assert!(
        matches!(&outcome.result, Err(SandboxError::Prepare(PrepareError::Compile(diagnostics)))
            if diagnostics.contains("Cannot find module 'node:fs'")),
        "a specifier this sandbox has no module for is a compile error: {:?}",
        outcome.result
    );
}

/// Everything that can go wrong with what a program **hands back**, each named specifically because
/// each is a mistake a model repeats and cannot diagnose from a generic message.
#[test]
fn a_bad_return_value_is_explained_rather_than_lost() {
    // A top-level `return` is the shape a model reaches for to hand a value back, and on this arm
    // the language itself refuses it before anything runs: a program is a module, and a module has
    // no function body to return from. That is the whole of the old family of rules about returned
    // values — there is nothing left to return.
    for program in [
        "return 42;\n",
        "const a: Record<string, unknown> = { name: \"x\" };\na.self = a;\nreturn a;\n",
        "return Promise.resolve(1);\n",
    ] {
        let (outcome, _) = run(program);
        assert!(
            matches!(&outcome.result, Err(SandboxError::Prepare(PrepareError::Compile(diagnostics)))
                if diagnostics.contains("A 'return' statement can only be used within a function body")),
            "`{program}` must be refused by the language rather than by a rule of gg's: {:?}",
            outcome.result
        );
        assert!(
            !outcome.returned_value,
            "nothing ran, so nothing returned anything"
        );
    }

    // A plain throw keeps its message. The engine's stack does not begin with the name and message,
    // so rendering the stack alone would lose the one line that says what went wrong.
    let said = program_failure(&run("throw new Error(\"boom\");\n").0);
    assert!(said.contains("Error: boom"), "{said}");
    assert!(said.contains("program.ts:1:7"), "{said}");

    // Throwing something that is not an `Error` at all still reads.
    let said = program_failure(&run("throw { reason: \"nope\" };\n").0);
    assert!(said.contains("nope"), "{said}");

    // And a value `JSON.stringify` renders as `{}` — a Map, a Set, a class with only accessors — is
    // described rather than reported as an empty object. `{}` is not a diagnostic.
    let said = program_failure(&run("throw new Map();\n").0);
    assert_ne!(said.trim(), "{}");
    assert!(said.contains("Map"), "{said}");

    // And a program that says nothing at all is a clean run — not an error, and not a trap.
    let (outcome, log) =
        run("import * as gg from \"gg\";\ngg.files.writeFile(\"a.txt\", \"hi\");\n");
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
/// a missing required field, a number where a string goes — and on a checked arm the compiler
/// catches every one of them that is written plainly. What is left is the value that reaches the SDK
/// typed `any`, and that is caught one layer below the SDK's own validators, by the generated
/// lowering, which knows the shape it wanted and nothing about the call.
///
/// Three properties are pinned: the message is not `{}`; it names the function and the underlying
/// fault; and it still carries the line of the program that made the call.
#[test]
fn a_mistyped_argument_names_the_function_and_the_fault() {
    // A record missing a required field. `addTask` takes an `id`, and this program has none.
    let (outcome, _) =
        run("import * as gg from \"gg\";\ngg.tasks.addTask({ title: \"ship it\" } as any);\n");
    let said = program_failure(&outcome);
    assert_ne!(said.trim(), "{}", "the fault that used to arrive empty");
    for fragment in [
        // What the lowering actually said about it,
        "expected a string",
        // and the program's own line, which the SDK's frames sit above.
        "(program.ts:2:10)",
    ] {
        assert!(said.contains(fragment), "{said}");
    }

    // A plain scalar in place of a string, on a different object, reported the same way.
    let (outcome, _) = run("import * as gg from \"gg\";\ngg.files.readFile(123 as any);\n");
    let said = program_failure(&outcome);
    assert!(said.contains("expected a string"), "{said}");
    assert!(said.contains("program.ts:2:"), "{said}");
}

/// **A documentation lookup of something that is not a function says so.**
///
/// `gg.views.openDocsView(gg.shell.run)` — a name the run does not bind — evaluates to `undefined`
/// before the call is even made, and a guest that coerced it would look up a function literally named
/// `"undefined"` and report that name back as unknown. The name was never the model's: nothing it
/// wrote said `undefined`, so it would be sent hunting a typo that did not exist.
///
/// The argument is refused instead, by the last layer that can still see what the value was.
#[test]
fn a_docs_lookup_of_a_non_function_is_refused_on_the_argument() {
    // Both arrive through a value the compiler cannot see into, because it would otherwise refuse
    // them outright — which is the better answer for a checked arm and no answer at all for the
    // guard this test is about, which exists for every value that reaches the call as `any`.
    for program in [
        "import * as gg from \"gg\";\ngg.views.openDocsView((gg.files as any).thereIsNoSuchFunction);\n",
        "import * as gg from \"gg\";\ngg.views.openDocsView(undefined as any);\n",
    ] {
        let (outcome, _) = run(program);
        let said = program_failure(&outcome);
        assert!(
            said.contains("operation: \"openDocsView\"")
                && said.contains("code: \"invalid-argument\""),
            "{program}: {said}"
        );
        assert!(
            !said.contains("undefined`"),
            "the model never wrote that name, so it is never quoted back: {said}"
        );
    }

    // A value of the wrong type entirely is named for what it is.
    let (outcome, _) = run("import * as gg from \"gg\";\ngg.views.openDocsView(42 as any);\n");
    assert!(
        program_failure(&outcome).contains("expected a function or function name, got number"),
        "{}",
        program_failure(&outcome)
    );
}
