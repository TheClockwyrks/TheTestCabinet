//! **Gate G8 — a runtime failure reaches the model, on every arm.**
//!
//! The [invariants](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) say a program owns
//! its failures and that what the model reads is what its language emitted. This is the assertion
//! behind that sentence: five failure shapes, driven through every registered arm's **real**
//! preparation and **real** run, read back through the **production** renderer, and held to four
//! things — that the model is told something at all, that it is told under the band the cell
//! declares, that what it is told names the fault in the program's or the language's own words, and
//! that it carries a location wherever the language reports one.
//!
//! # Not every cell reaches a run, and each one says which
//!
//! Five of the shapes cannot be written on the arm they are driven against: the arm's compiler
//! refuses the program, so nothing runs and what the model reads is a compile diagnostic. Each case
//! declares which of the two it is with [`Answered`], and the gate holds the cell to the band the
//! loop files that answer under. A cell that starts running a program it used to refuse fails here,
//! and so does one that stops.
//!
//! # Why it is one module and not eleven tests
//!
//! Because the point is the *uniformity*. Eleven hand-written failure tests are eleven different
//! standards, and an arm that quietly reports less than its neighbours reads as an arm with fewer
//! tests rather than as a defect. Here the assertions are written once, every arm answers the same
//! five questions, and an arm that cannot answer one has to say so **in the table below** rather
//! than by having no test.
//!
//! # The table fails in both directions
//!
//! [`KNOWN_HOLES`] is the explicit record of every cell an arm does not satisfy today, each row
//! naming the arm, the shape and what the model reads *instead*. It is a pin, not a permission:
//!
//! * an arm that **stops** satisfying a shape fails, because no row covers it;
//! * an arm that **starts** satisfying a shape also fails, because its row is still there and the
//!   gate says to delete it;
//! * an arm whose bad output changes fails, because the row records what it says today.
//!
//! So no arm can hide behind another's hole, and closing a hole is a deliberate, visible edit.
//!
//! Every row here was written from what this gate **measured**, running the arm's own five programs
//! through its own toolchain. None of it was copied from a report. Set `GG_G8_SHOW` in the
//! environment and run an arm's gate with `--no-capture` to read every cell it produces, which is
//! how a row is written and how one is checked before it is deleted.
//!
//! A row pins what is **stable about the arm's own program**: a wrong line the strip computed from
//! the model's six-line program is pinned to the number, because it is a function of that program;
//! a line inside a bundle or a Mono assembly guid is not, because it moves with the SDK, and a
//! table that failed for an SDK edit would be a table people delete rather than fix.
//!
//! # What "the model-facing reading" means
//!
//! [`ModelFacing`](crate::agent::code::ModelFacing), produced by
//! [`model_facing`](crate::agent::code::model_facing) — the loop's own `turn_decision`, called
//! rather than mirrored. That matters: a body that reads well as a `ProgramError` struct and badly
//! once rendered is exactly the defect this gate exists to catch, and a gate that re-implemented
//! the rendering would agree with itself instead of with the loop.

use serde_json::Value;
use test_cabinet_core::gg::{GgContextSource, GgProgramLanguage};

use crate::agent::code::ModelFacing;
use crate::sandbox::fake::{
    CallLog, FakeToolApi, all_capabilities, all_operations, canned_outcome, granted_operations,
};
use crate::sandbox::membrane::RunEnding;
use crate::sandbox::{ProgramScope, SandboxLimits, run_program};
use crate::tools::{ToolFailure, ToolOutcome};

/// The five shapes a program's runtime failure takes, from
/// [ruling D8](https://docs.testcabinet.ai/gg/responses-as-code/invariants/).
///
/// They are five because they fail through five different doors, and a language's reporting can be
/// whole on one and absent on the next: a throw is caught by an exception mechanism, a native fault
/// is a trap the guest never sees, a returned failure value walks past every catch there is, a
/// resource fault is a ceiling gg imposed, and an explicit exit is the program stopping the process
/// out from under all of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Shape {
    /// (a) A gg call the host answers with a failure, uncaught. The commonest runtime failure a gg
    /// program has, and the one a model most needs the tool's name and the failure's code from.
    ToolError,
    /// (b) An uncaught native fault — an index past the end, a nil unwrapped, a bad cast. Never a
    /// divide by zero: that is not a fault on five of the eleven arms, so a gate built on it would
    /// be measuring the language rather than gg.
    NativeFault,
    /// (c) Termination by a failure **value**: an entry point that returns an error, a non-zero
    /// exit status, an unobserved rejected async. It walks past every catch an arm has, which is
    /// why it is the column most often silently absent.
    FailureValue,
    /// (d) A resource fault — unbounded recursion, which every arm can reach and no arm can catch
    /// its way out of.
    ResourceFault,
    /// (e) An explicit abort or exit: the program stopping the process itself, rather than failing
    /// in it.
    Abort,
}

impl Shape {
    /// Every shape, in the order the ruling states them — what a per-arm case list is checked
    /// against for completeness.
    pub(super) const ALL: [Self; 5] = [
        Self::ToolError,
        Self::NativeFault,
        Self::FailureValue,
        Self::ResourceFault,
        Self::Abort,
    ];

    /// The shape's letter and name, for a failure message an operator reads without this file open.
    fn label(self) -> &'static str {
        match self {
            Self::ToolError => "(a) an uncaught gg tool failure",
            Self::NativeFault => "(b) an uncaught native fault",
            Self::FailureValue => "(c) termination by a failure value",
            Self::ResourceFault => "(d) a resource fault",
            Self::Abort => "(e) an explicit abort or exit",
        }
    }
}

/// Where the model is told the fault is.
#[derive(Debug, Clone, Copy)]
pub(super) enum Located {
    /// The language reports a location for this shape, and this is how the arm spells it — in the
    /// **model's own coordinates**, asserted as a substring of what the model reads.
    ///
    /// Every G8 program is written with a comment header, a blank line and a multi-line call above
    /// the fault, so an off-by-N cannot hide the way it does in a one-line program.
    At(&'static str),
    /// The language reports no location for this shape.
    ///
    /// Asserted rather than assumed: the gate checks that the outcome carries no location at all,
    /// so an arm that starts shipping one — right or wrong — fails here instead of passing
    /// unnoticed. It says nothing about a location an arm buries inside the message text, which is
    /// why an arm that locates that way (C++, Swift) declares [`At`](Self::At) instead.
    Nowhere,
}

/// Whether the arm answers a shape out of a program that **ran**.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Answered {
    /// **At run time.** The program compiled, ran, and its own runtime reported the fault, which is
    /// what [D8](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) asks of an arm.
    AtRuntime,
    /// **By refusing to compile it.** This arm's compiler will not accept a program of this shape,
    /// so nothing ran and what the model reads is a compile diagnostic.
    ///
    /// It is an answer and not a hole, because there is no runtime failure for the arm to lose: a
    /// model cannot write the shape on this arm at all, and it is told so in the compiler's own
    /// words before it spends a turn on it. What makes it worth declaring is that the gate would
    /// otherwise read the two states as one — a compile refusal satisfies every other check here —
    /// and a cell that stops running its program would pass unnoticed under a module that says
    /// every cell is a real run.
    ///
    /// Declared per case rather than gathered in a table because it is a property of this arm's
    /// program in this shape, the same kind of fact [`Located`] carries, and an arm registered
    /// tomorrow has to answer it five times rather than inherit a silence.
    ByRefusingToCompile,
}

impl Answered {
    /// The [band](GgContextSource) the loop files this answer under, which is what the gate holds a
    /// cell to: an arm cannot move between the two states without the row moving with it.
    fn band(self) -> GgContextSource {
        match self {
            Self::AtRuntime => GgContextSource::RuntimeError,
            Self::ByRefusingToCompile => GgContextSource::CompilerError,
        }
    }

    /// What the state says happened, for a failure an operator reads without this file open.
    fn label(self) -> &'static str {
        match self {
            Self::AtRuntime => "the program ran and its runtime reported the fault",
            Self::ByRefusingToCompile => "the compiler refused the program and nothing ran",
        }
    }
}

/// One arm's answer to one shape.
pub(super) struct Case {
    /// Which shape this program drives.
    pub(super) shape: Shape,
    /// The program, in this arm's own spelling, written the way a model would write it.
    pub(super) program: &'static str,
    /// Tokens the **program** or its **language** chose, every one of which the model must read
    /// back.
    ///
    /// Never a gg-authored string on its own: `Error: Error: null` names a fault to a gate that
    /// asserts gg's own words and names nothing to a model.
    pub(super) names: &'static [&'static str],
    /// Where the fault is, in the model's coordinates — or that this language locates it nowhere.
    pub(super) located: Located,
    /// Whether this arm reaches this shape at run time, or refuses the program before it runs.
    pub(super) answered: Answered,
}

/// A cell an arm does not satisfy today, and what the model reads in its place.
struct Hole {
    /// The arm.
    arm: GgProgramLanguage,
    /// The shape it does not satisfy.
    shape: Shape,
    /// What the model reads instead.
    instead: Instead,
}

/// What a held cell produces in place of a failure that names itself.
#[derive(Debug, Clone, Copy)]
enum Instead {
    /// **Nothing.** The turn is recorded as a success and the model is told its program worked —
    /// the worst shape a hole takes, because the correct response to it is to do nothing.
    Nothing,
    /// A body arrives, and this is what it says. Asserted as a substring, so the row is a pin: the
    /// day the words change, the row is wrong and the gate says so.
    Says(&'static str),
}

/// **Every cell of the eleven-arm × five-shape matrix that is not satisfied today.**
///
/// Measured by this gate, through each arm's own toolchain. A row is a defect that is *recorded*,
/// not a defect that is *accepted*: see the module documentation for why the gate fails when a row
/// becomes true as well as when it becomes false.
const KNOWN_HOLES: &[Hole] = &[
    // ---- python -----------------------------------------------------------------------------
    Hole {
        arm: GgProgramLanguage::Python,
        shape: Shape::Abort,
        // The status the program chose is destroyed on the way out: `os._exit(3)` is reported as
        // `exit(1)`, for the reason Swift, C++ and C# report the same thing — the preview1 adapter
        // this guest is linked through imports only `wasi:cli/exit.exit`, and that import carries a
        // boolean rather than a status. The sentence is gg's and it is right about everything
        // except the one number the program picked.
        instead: Instead::Says("the program called exit(1) instead of returning"),
    },
    // ---- ruby -------------------------------------------------------------------------------
    Hole {
        arm: GgProgramLanguage::Ruby,
        shape: Shape::FailureValue,
        // Nothing, and Ruby is where the shape runs out rather than this arm. A top-level Ruby
        // script has no entry point to return from and no async to leave unobserved: its last
        // expression's value is discarded by the language, so a program whose final value IS the
        // failure is a clean script under CRuby too. The one termination-by-status Ruby does have
        // is `exit`, which is shape (e), and that one this arm answers.
        instead: Instead::Nothing,
    },
    // ---- javascript -------------------------------------------------------------------------
    Hole {
        arm: GgProgramLanguage::JavaScript,
        shape: Shape::ToolError,
        // The right words at the wrong line: the model wrote the call on line 3 and is sent to
        // line 2. The column is right, so the number looks trustworthy and is not.
        instead: Instead::Says("at line 2, column 17"),
    },
    Hole {
        arm: GgProgramLanguage::JavaScript,
        shape: Shape::NativeFault,
        // Worse than off-by-one: line 7 of a six-line program. The offset is a function of the
        // program's own shape, so it grows with the program rather than being a constant anyone
        // could correct for.
        instead: Instead::Says("at line 7, column 13"),
    },
    Hole {
        arm: GgProgramLanguage::JavaScript,
        shape: Shape::FailureValue,
        // Nothing. A rejected promise nothing observes is a clean turn, and `async` is the first
        // reflex a model brings to a runtime it has not met.
        instead: Instead::Nothing,
    },
    Hole {
        arm: GgProgramLanguage::JavaScript,
        shape: Shape::ResourceFault,
        // The engine's own words, at a line the model did not write.
        instead: Instead::Says("too much recursion\n    at line 3, column 9"),
    },
    Hole {
        arm: GgProgramLanguage::JavaScript,
        shape: Shape::Abort,
        // This arm has no way to stop its own process: `process` is not a name the guest binds, so
        // the reach for it is answered as an unknown name — and mislocated, like every other
        // location on this arm.
        instead: Instead::Says("process is not defined"),
    },
    // ---- typescript -------------------------------------------------------------------------
    Hole {
        arm: GgProgramLanguage::TypeScript,
        shape: Shape::ToolError,
        // The strip's coordinates, not the model's: the call is on line 3 and the model is sent to
        // line 2. Shared with the JavaScript arm, which shares the strip.
        instead: Instead::Says("at line 2, column 17"),
    },
    Hole {
        arm: GgProgramLanguage::TypeScript,
        shape: Shape::NativeFault,
        // Line 7 of a six-line program.
        instead: Instead::Says("at line 7, column 13"),
    },
    Hole {
        arm: GgProgramLanguage::TypeScript,
        shape: Shape::FailureValue,
        // Nothing: a rejected promise nothing observes is a clean turn.
        instead: Instead::Nothing,
    },
    Hole {
        arm: GgProgramLanguage::TypeScript,
        shape: Shape::ResourceFault,
        // The engine's own words, at a line the model did not write.
        instead: Instead::Says("too much recursion\n    at line 3, column 9"),
    },
    // ---- purescript -------------------------------------------------------------------------
    //
    // Every located cell on this arm is located in the ESBUILD BUNDLE, hundreds of lines into a
    // file the model did not write and cannot open. The rows pin the WORDS rather than the wrong
    // line: a bundle coordinate moves whenever the SDK or the library set does, so pinning it
    // would make this table fail for edits that have nothing to do with reporting — where the
    // JavaScript arm's wrong lines are a function of the model's own program and are pinned.
    Hole {
        arm: GgProgramLanguage::PureScript,
        shape: Shape::ToolError,
        instead: Instead::Says("`read_text_file` failed (not-found)"),
    },
    Hole {
        arm: GgProgramLanguage::PureScript,
        shape: Shape::NativeFault,
        instead: Instead::Says("Failed pattern match at Data.Maybe"),
    },
    Hole {
        arm: GgProgramLanguage::PureScript,
        shape: Shape::FailureValue,
        // Nothing. `main`'s value is discarded by the entry gg synthesizes, so a program that ends
        // by RETURNING its failure is a clean turn — the shape PureScript has no other spelling of.
        instead: Instead::Nothing,
    },
    Hole {
        arm: GgProgramLanguage::PureScript,
        shape: Shape::ResourceFault,
        instead: Instead::Says("too much recursion"),
    },
    Hole {
        arm: GgProgramLanguage::PureScript,
        shape: Shape::Abort,
        instead: Instead::Says("Error: the third step did not finish"),
    },
    // ---- rust -------------------------------------------------------------------------------
    Hole {
        arm: GgProgramLanguage::Rust,
        shape: Shape::Abort,
        // The status the program chose is destroyed on the way out: `std::process::exit(3)` is
        // reported as `exit(1)`, for the reason Python, Swift, C++ and C# report the same thing —
        // the preview1 adapter this program is encoded with imports only `wasi:cli/exit.exit`, and
        // that import carries a boolean rather than a status. The sentence is gg's and it is right
        // about everything except the one number the program picked.
        instead: Instead::Says("the program called exit(1) instead of returning"),
    },
    // ---- swift ------------------------------------------------------------------------------
    Hole {
        arm: GgProgramLanguage::Swift,
        shape: Shape::ToolError,
        // The words are whole — Swift's own `Fatal error: Error raised at top level:` in front of
        // the failed call's name and code — and the location is the STANDARD LIBRARY's. Swift
        // propagates an error by RETURN, so by the time the entry point's synthesized epilogue
        // hands it to `swift_errorInMain` the throwing call's frame has already been popped: what
        // the runtime reports is where it raised the fatal error, and no frame of the model's own
        // file survives to symbolicate. Nothing this arm can do reaches past that, since catching
        // the error is the one thing that keeps the frame and catching is interception.
        instead: Instead::Says("Swift/ErrorType.swift:254"),
    },
    Hole {
        arm: GgProgramLanguage::Swift,
        shape: Shape::FailureValue,
        // Nothing, and the reason is one step earlier than it looks: the `Task`'s body never runs
        // at all. Swift's cooperative executor needs a drain, an `@main async` is what performs
        // one, and a top-level file has none — so the task is enqueued, the entry point returns and
        // the shell hands control back. Measured by logging inside the body: `before` and `after`
        // arrive and the body's own line never does. Nothing gg can capture, because nothing ran.
        //
        // The drain Swift itself uses is in the pinned SDK and is not reachable from here, which is
        // measured rather than assumed: `_Concurrency.swiftinterface` declares
        // `swift_task_asyncMainDrainQueue` returning `Never`, and this arm's `run` export has to
        // RETURN for the component's own `run` to return. So closing this shape would take an
        // executor that drains and yields, which is a runtime this arm does not have.
        instead: Instead::Nothing,
    },
    Hole {
        arm: GgProgramLanguage::Swift,
        shape: Shape::Abort,
        // The status the program chose is destroyed on the way out: `exit(3)` is reported as
        // `exit(1)`, because the committed preview1 adapter imports only `wasi:cli/exit.exit` and
        // that import carries a boolean, not a status.
        instead: Instead::Says("the program called exit(1) instead of returning"),
    },
    // ---- cpp --------------------------------------------------------------------------------
    Hole {
        arm: GgProgramLanguage::Cpp,
        shape: Shape::Abort,
        // The status the program chose is destroyed on the way out: `std::exit(3)` is reported as
        // `exit(1)`.
        instead: Instead::Says("the program called exit(1) instead of returning"),
    },
    // ---- csharp -----------------------------------------------------------------------------
    Hole {
        arm: GgProgramLanguage::CSharp,
        shape: Shape::ResourceFault,
        // A wall of identical frames and no statement of what happened: the runtime writes
        // `StackOverflowException` FIRST, and the 8 KiB stderr policy keeps the tail, so the one
        // line that named the fault is the one line evicted. What survives is ~200 copies of the
        // recursive frame and, at the end, an exit the runtime made on the program's behalf.
        //
        // The frames now carry the model's own file and line, which they did not when this row was
        // written: that half is `-debug:embedded` and `mono_debug_init` landing together. What is
        // still missing is the fault's NAME, and it is missing to a trim rather than to this arm —
        // the same 8 KiB tail policy would evict any arm's leading line.
        instead: Instead::Says("at Program.Deeper (int) [0x00000] in ./program.cs:6"),
    },
    Hole {
        arm: GgProgramLanguage::CSharp,
        shape: Shape::Abort,
        // The status the program chose is destroyed on the way out: `Environment.Exit(3)` is
        // reported as `exit(1)`.
        instead: Instead::Says("the program called exit(1) instead of returning"),
    },
    // ---- kotlin -----------------------------------------------------------------------------
    Hole {
        arm: GgProgramLanguage::Kotlin,
        shape: Shape::NativeFault,
        // Java's defect, on the road the two arms share: the model's own line in the message and a
        // bundle line appended after it.
        instead: Instead::Says("at program.kts:5\n    at line "),
    },
    Hole {
        arm: GgProgramLanguage::Kotlin,
        shape: Shape::ResourceFault,
        // The JavaScript engine's own words for a Kotlin program's stack overflow, at a bundle
        // line.
        instead: Instead::Says("InternalError: too much recursion"),
    },
];

/// The tool responder every G8 program is driven against.
///
/// One call fails and everything else answers normally, so shape (a) is a real host failure
/// crossing a real membrane rather than a program throwing on gg's behalf. `not-found` is the code
/// because it is the one a model meets most: a path that was right last turn and is not right now.
pub(super) fn responder(name: &str, args: &Value) -> ToolOutcome {
    match name {
        "read_file" => ToolOutcome::failed(
            ToolFailure::NotFound,
            "no such file or directory: missing.md".to_string(),
        ),
        _ => canned_outcome(name, args),
    }
}

/// **What the model reads back after `arm` runs `program`** — the production road, end to end.
///
/// [`run_program`] is the function a turn calls: it prepares the program with the arm's own prepare
/// step (its real compiler, where it has one), evaluates the result in the arm's real guest against
/// the real membrane, and hands back an outcome whose `result` is `Err` for a program the compiler
/// refused. [`model_facing`](crate::agent::code::model_facing) then renders it exactly as the loop
/// renders it.
///
/// Nothing here is a stand-in. The alternative — each arm's substrate harness, which leaves out one
/// production step or another for reasons of its own — would make eleven different roads and one
/// gate, which is the arrangement this module exists to replace.
fn drive(arm: GgProgramLanguage, program: &str) -> Read {
    let log = CallLog::default();
    let api = FakeToolApi::with(&log, responder);
    let operations = granted_operations(&all_operations(), false);
    let scope = ProgramScope {
        capabilities: &all_capabilities(),
        operations: &operations,
        modules: &[],
        ending: RunEnding::None,
    };
    let (outcome, _api) = run_program(
        crate::sandbox::language(arm),
        program,
        scope,
        SandboxLimits::default(),
        None,
        api,
    );
    Read {
        attached: outcome
            .result
            .as_ref()
            .ok()
            .and_then(|result| result.error.as_ref())
            .and_then(|error| error.location.clone()),
        model: crate::agent::code::model_facing(arm, &outcome),
    }
}

/// One cell, measured: what the model reads, and the location gg put on it.
struct Read {
    /// What the model reads, rendered by the loop's own renderer.
    model: ModelFacing,
    /// The [location](crate::sandbox::outcome::ProgramError::location) gg attached, read off the
    /// outcome rather than parsed back out of the rendered body.
    ///
    /// Read from the field because the rendering is a four-space `at` line, which is also how a
    /// runtime indents a stack frame: an arm whose guest stderr happened to indent a frame that way
    /// would be read as gg's own location and would invert every [`Located::Nowhere`] assertion
    /// here. The field says what gg did with no string to match.
    attached: Option<String>,
}

/// Drive `arm`'s `cases` through the production path and hold every one of them to G8.
pub(super) fn gate(arm: GgProgramLanguage, cases: &[Case]) {
    for shape in Shape::ALL {
        assert!(
            cases.iter().any(|case| case.shape == shape),
            "{arm} drives no program for {}; every arm answers all five shapes",
            shape.label()
        );
    }
    for hole in KNOWN_HOLES.iter().filter(|hole| hole.arm == arm) {
        assert!(
            cases.iter().any(|case| case.shape == hole.shape),
            "{arm} holds a row for {} that no case drives; delete the row or write the case",
            hole.shape.label()
        );
    }

    // Every shape is driven before anything is reported, and the report carries all of them. Five
    // separate panics would mean five runs of an arm whose programs cost a compiler each, and would
    // show whoever is closing a hole one cell at a time when the interesting thing is the row.
    let mut wrong: Vec<String> = Vec::new();
    for case in cases {
        let read = drive(arm, case.program);
        if std::env::var_os("GG_G8_SHOW").is_some() {
            eprintln!("=== {arm} {} ===\n{}", case.shape.label(), quoted(&read));
        }
        let verdict = satisfies(&read, case);
        let held = KNOWN_HOLES
            .iter()
            .find(|hole| hole.arm == arm && hole.shape == case.shape);
        let problem = match (held, verdict) {
            (None, Ok(())) => continue,
            (None, Err(why)) => format!("{why}, and no row records it"),
            (Some(_), Ok(())) => {
                "is recorded as a hole and now satisfies the gate; delete its row from `KNOWN_HOLES`"
                    .to_string()
            }
            (Some(hole), Err(_)) => match hole.instead {
                Instead::Nothing if !read.model.body.trim().is_empty() || read.model.fatal => {
                    "is recorded as producing nothing, and it produced something".to_string()
                }
                Instead::Says(words) if !read.model.body.contains(words) => {
                    format!("is recorded as saying {words:?}, and it no longer does")
                }
                _ => continue,
            },
        };
        wrong.push(format!(
            "{} {problem}\n\nwhat the model reads:\n{}",
            case.shape.label(),
            quoted(&read)
        ));
    }
    assert!(
        wrong.is_empty(),
        "{arm} fails gate G8 on {} of {} shapes:\n\n{}",
        wrong.len(),
        cases.len(),
        wrong.join("\n\n---\n\n")
    );
}

/// Whether what the model reads satisfies G8, and the first thing wrong with it if not.
///
/// Four checks, in the order the requirement states them. They are deliberately few: this gate asks
/// whether a failure **reached** the model, not whether the whole message is well written.
fn satisfies(read: &Read, case: &Case) -> Result<(), String> {
    if read.model.fatal {
        return Err("gg ended the run and told the model nothing".to_string());
    }
    if read.model.body.trim().is_empty() {
        return Err(match read.model.error {
            Some(kind) => format!("the model was told nothing (the turn was recorded as {kind:?})"),
            None => {
                "the model was told nothing, and the turn was recorded as a success".to_string()
            }
        });
    }
    if read.model.source != Some(case.answered.band()) {
        return Err(format!(
            "this cell is recorded as one where {}, and the message arrived under {:?}",
            case.answered.label(),
            read.model.source
        ));
    }
    for name in case.names {
        if !read.model.body.contains(name) {
            return Err(format!("what the model reads never says {name:?}"));
        }
    }
    match case.located {
        Located::At(location) => {
            if !read.model.body.contains(location) {
                return Err(format!(
                    "the fault is not located at {location:?}, which is where the model wrote it"
                ));
            }
            // And gg's own location, where there is one, is that same place. An arm that puts the
            // model's line in the message and then appends a second one out of a bundle has told
            // the model two things and left it to guess: the second is a coordinate in a file it
            // cannot open, and it is the one the loop renders last.
            match &read.attached {
                Some(attached) if !attached.contains(location) => Err(format!(
                    "the fault is at {location:?} and gg attached {attached:?} instead, which is a \
                     second location in a file the model did not write"
                )),
                _ => Ok(()),
            }
        }
        Located::Nowhere => match &read.attached {
            Some(attached) => Err(format!(
                "this shape is recorded as having no location, and gg attached {attached:?}; if it \
                 is right, make the case say so"
            )),
            None => Ok(()),
        },
    }
}

/// What the model read, indented, with the band it arrived under, the class the turn was recorded
/// as and the location gg attached — so a G8 failure **is** the regression report.
fn quoted(read: &Read) -> String {
    let body = match read.model.body.trim().is_empty() {
        true => "    <nothing>".to_string(),
        false => read
            .model
            .body
            .lines()
            .map(|line| format!("    {line}"))
            .collect::<Vec<_>>()
            .join("\n"),
    };
    format!(
        "{body}\n  (band: {:?}, turn recorded as: {:?}, gg attached: {:?})",
        read.model.source, read.model.error, read.attached
    )
}

#[cfg(test)]
#[path = "g8.test.rs"]
mod tests;
