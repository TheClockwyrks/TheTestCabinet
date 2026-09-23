//! **The TypeScript arm's execution substrate**, held to
//! [gate G8](super::super::g8) — a runtime failure reaches the model.
//!
//! Every program below is compiled by the real `tsc` and evaluated by the real
//! [ECMAScript guest](super::super::ecmascript), through
//! [`run_program`](crate::sandbox::run_program), and read back through the loop's own renderer. What
//! the locations assert is the property the arm was converted for: the file is `program.ts` and the
//! line is the model's own, reached through `tsc`'s source map and by no arithmetic.

use test_cabinet_core::gg::GgProgramLanguage;

use super::super::g8::{self, Answered, Case, Located, Shape};
use crate::limits::TurnErrorType;

/// **Gate [G8](super::super::g8) for TypeScript** — all five shapes a runtime failure takes,
/// driven through the production path and read back as the model would read them.
#[test]
fn g8_a_runtime_failure_reaches_the_model() {
    g8::gate(
        GgProgramLanguage::TypeScript,
        &[
            Case {
                shape: Shape::ApiError,
                program: r#"// G8 (a): a gg call the host answers `not-found`, uncaught.

import { files } from "gg";

const text: files.FileRead = files.readFile(
  "missing.md",
);
console.log(text);
"#,
                names: &["read_file", "not-found", "missing.md"],
                located: Located::At("program.ts:5:36"),
                answered: Answered::AtRuntime,
                // The guest reads the `code` off the uncaught `ApiError` and reports it, so the
                // turn is filed as the program fighting the API — as on every arm whose guest sees
                // the throw — and never as a sandbox trap.
                recorded: Some(TurnErrorType::ProgramApiError),
            },
            Case {
                shape: Shape::NativeFault,
                program: r#"// G8 (b): reaching into something that is not there.

const values: number[] = [1, 2, 3];
console.log(
  values[7].toString(),
);
"#,
                names: &["TypeError"],
                located: Located::At("program.ts:5:3"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::ProgramThrow),
            },
            Case {
                shape: Shape::FailureValue,
                program: r#"// G8 (c): an async failure nothing observes.

async function step(): Promise<void> {
  throw new Error("the third step did not finish");
}

step();
"#,
                names: &["the third step did not finish"],
                located: Located::At("program.ts:4:13"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::ProgramThrow),
            },
            Case {
                shape: Shape::ResourceFault,
                program: r#"// G8 (d): unbounded recursion.

function deeper(n: number): number {
  return deeper(n + 1);
}

deeper(0);
"#,
                names: &["Maximum call stack size exceeded"],
                located: Located::At("program.ts:4:21"),
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
                names: &["Cannot find name 'process'"],
                located: Located::At("program.ts(4,1)"),
                // Nothing runs: this guest is not Node, so `tsc` has no declaration for the one name
                // a model reaches for to stop a program. It cannot abort at all, and the refusal is
                // what it reads instead, at its own line and column.
                answered: Answered::ByRefusingToCompile,
                recorded: Some(TurnErrorType::TranspileCompile),
            },
        ],
    );
}

/// **An uncaught `views.openFile` of a missing path is the program's fault, not a sandbox limit.**
///
/// The owner's ruling: every API function returns a structured error, so an uncaught one is filed
/// as [`ProgramApiError`](TurnErrorType::ProgramApiError) — the bucket every arm whose guest sees
/// the throw files it under — and a `sandbox_*` type is recorded only for a real ceiling or a real
/// trap. Before this, the ECMAScript guest wrote the throw to standard error and aborted, and the
/// model read `wasm trap: unreachable` under four SDK frames (`sdk:gg/core.js:26:9`,
/// `sdk:internal/errors.js`) that named files it cannot open.
///
/// What is asserted is what the model reads, rendered by the loop's own renderer: the structured
/// error's code and operation, the path, the program's own frame read back through `tsc`'s map,
/// and neither an SDK frame nor a trap.
#[test]
fn an_uncaught_open_of_a_missing_file_is_a_program_api_error() {
    use crate::sandbox::fake::{
        CallLog, FakeOperationApi, all_capabilities, all_operations, granted_operations,
    };
    use crate::sandbox::membrane::RunEnding;
    use crate::sandbox::{ProgramScope, SandboxLimits, run_program};

    let log = CallLog::default();
    let api = FakeOperationApi::with(&log, g8::responder);
    let operations = granted_operations(&all_operations(), false);
    let scope = ProgramScope {
        capabilities: &all_capabilities(),
        operations: &operations,
        modules: &[],
        ending: RunEnding::None,
    };
    let (outcome, _api) = run_program(
        crate::sandbox::language(GgProgramLanguage::TypeScript),
        r#"// A view of a file that is not there, uncaught.

import { views } from "gg";

const view = views.openFile(
  "missing.md",
);
console.log(view);
"#,
        scope,
        &crate::sandbox::AgentWorkspace::new(),
        SandboxLimits::AMPLE,
        None,
        api,
    );
    let read = crate::agent::code::model_facing(&outcome);
    assert_eq!(
        read.error,
        Some(TurnErrorType::ProgramApiError),
        "an uncaught API failure is the program fighting the API, never a sandbox limit:\n{}",
        read.body
    );
    for expected in [
        "ApiError",
        "not-found",
        "open_file",
        "missing.md",
        "program.ts:5:20",
    ] {
        assert!(
            read.body.contains(expected),
            "the model should read {expected:?}; it reads:\n{}",
            read.body
        );
    }
    for forbidden in ["sdk:", "wasm trap", "sandbox trapped", "(native)"] {
        assert!(
            !read.body.contains(forbidden),
            "the model should not read {forbidden:?}; it reads:\n{}",
            read.body
        );
    }
}
