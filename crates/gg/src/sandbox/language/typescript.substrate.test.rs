//! **The TypeScript arm's execution substrate**, held to
//! [gate G8](super::super::g8) — a runtime failure reaches the model.
//!
//! # Why this file exists, and why it is only this
//!
//! Because until it did, this arm had no substrate test of its own. Its end-to-end coverage rode on
//! [`javascript`](super::super::javascript)'s, on the grounds that the two arms share a component, a
//! strip and a catalogue — which is true, and which leaves out the one thing that is not shared.
//! [`check`](super::check) is the whole difference between the pair, and it sits *before* the run:
//! a program TypeScript refuses never reaches the guest at all, so a failure this arm answers at
//! compile time is a failure the JavaScript arm answers at runtime, in a different band, with a
//! different location, and neither arm's coverage says anything about the other's.
//!
//! G8 is where that shows up first. A model reaching for a name this runtime does not have is told
//! so by `tsc`, in the model's own coordinates, before anything runs — and the same program on the
//! JavaScript arm is a runtime unknown-name at a line the strip moved. Those are two different
//! answers to one question, and an arm with no file of its own could not record either.

use test_cabinet_core::gg::GgProgramLanguage;

use super::super::g8::{self, Case, Located, Shape};

/// **Gate [G8](super::super::g8) for TypeScript** — all five shapes a runtime failure takes,
/// driven through the production path and read back as the model would read them.
#[test]
fn g8_a_runtime_failure_reaches_the_model() {
    g8::gate(
        GgProgramLanguage::TypeScript,
        &[
            Case {
                shape: Shape::ToolError,
                program: r#"// G8 (a): a gg call the host answers `not-found`, uncaught.

const text: string = fs.readTextFile(
  "missing.md",
);
console.log(text);
"#,
                names: &["read_text_file", "not-found", "missing.md"],
                located: Located::At("line 3, column 17"),
            },
            Case {
                shape: Shape::NativeFault,
                program: r#"// G8 (b): reaching into something that is not there.

const values: number[] = [1, 2, 3];
console.log(
  values[7].toString(),
);
"#,
                names: &["TypeError", "values[7] is undefined"],
                located: Located::At("line 5, column 13"),
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
                located: Located::Nowhere,
            },
            Case {
                shape: Shape::ResourceFault,
                program: r#"// G8 (d): unbounded recursion.

function deeper(n: number): number {
  return deeper(n + 1);
}

deeper(0);
"#,
                names: &["too much recursion"],
                located: Located::At("line 4, column 10"),
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
            },
        ],
    );
}
