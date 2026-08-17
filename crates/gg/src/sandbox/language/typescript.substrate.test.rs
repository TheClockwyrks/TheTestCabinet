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

const text: string = files.readTextFile(
  "missing.md",
);
console.log(text);
"#,
                names: &["read_text_file", "not-found", "missing.md"],
                located: Located::At("program.ts:5:28"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::SandboxTrap),
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
                recorded: Some(TurnErrorType::SandboxTrap),
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
                recorded: Some(TurnErrorType::SandboxTrap),
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
                recorded: Some(TurnErrorType::SandboxTrap),
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
