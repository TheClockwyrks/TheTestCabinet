//! **The C# arm's execution substrate** — the real Roslyn, the real embedded guest and the real
//! membrane, driven end to end: C# the way a model would write it, really compiled by the toolchain
//! in the run image, really interpreted by the Mono IL interpreter gg embeds, really talking to
//! gg's real host.
//!
//! # What "real" means here
//!
//! All of it. A program starts as an ordinary C# compilation unit, goes through
//! [`compile_program`](super::compile::compile_program) — the production prepare step, spawning a
//! real `csc` through the seam's own isolated invocation, in a
//! [`PrepareContext`](crate::sandbox::PrepareContext) — and what comes back is a manifest of
//! base64 IL assemblies, handed to the **prebuilt** [`GUEST_COMPONENT`](super::GUEST_COMPONENT):
//! compiled with
//! [`compile_bytes`](crate::sandbox::engine::compile_bytes), linked with
//! [`linker`](crate::sandbox::linker) (the production linker: the whole membrane plus the whole
//! ambient WASI surface), put in a [`bounded_store`](crate::sandbox::bounded_store) with the
//! production ceilings, instantiated through the `bindgen!`-generated
//! [`Sandbox`](crate::sandbox::membrane::Sandbox) and driven through its `run` export.
//!
//! # What is here and what is not
//!
//! That a whole C# program compiles, crosses and runs; that what it says reaches the host through
//! the real membrane and that what the host answers reaches it back; that the .NET class libraries
//! really are inside the artifact, with **no filesystem and no preopen**, which is this guest's one
//! structural claim; that `try`/`catch`/`finally` work and that an unhandled exception is reported
//! with its type, its message *and* its managed frames — the best error surface of any compiled arm
//! here; that Roslyn's rejection of a program is told apart from a toolchain that could not run; and
//! that two preparations of one program are byte-identical, which is `-deterministic` doing what the
//! flag list says it does rather than anything the seam requires.
//!
//! The isolation gate is **not** here. The seam derives its language list from the registry, so from
//! the moment `language: "csharp"` resolves, this arm's program step is driven concurrently along
//! with every other registered language's — searching each artifact for markers, which is all it
//! asks of any arm.
//!
//! The programs below call the **SDK**, which is what a model would call: `Files.ReadFile`,
//! `Views.OpenText`, `Console.WriteLine`. Every one of them is compiled into the program's own
//! assembly out of `packages/gg-sandbox-csharp/src/Gg/`, so what these prove is not only that the
//! crossing happens but that the surface a model is shown is the surface that runs. The SDK's own
//! spelling, function by function, is driven in `csharp.surface.test.rs`.
//!
//! # How these tests are grouped
//!
//! Each `#[test]` is its own process under `cargo nextest`, so each obtains the embedded guest
//! once — the largest component any arm embeds — and every program in it costs a real `csc`. A
//! function groups the programs that exercise one behaviour, so they share that cost; one that
//! grows into the slow end of the suite is split rather than extended.

use test_cabinet_core::gg::{CAPABILITY_DOCVIEW_CLOSE, GgProgramLanguage};

use super::super::g8::{self, Answered, Case, Located, Shape};
use crate::limits::TurnErrorType;
use wasmtime::component::Component;

use super::compile::{self, compile_program};
use crate::sandbox::fake::{
    CallLog, FakeOperationApi, all_capabilities, all_operations, canned_outcome, granted_operations,
};
use crate::sandbox::membrane::{MembraneState, RunEnding, Sandbox};
use crate::sandbox::outcome::{SandboxError, SandboxOutcome};
use crate::sandbox::{
    PrepareContext, PrepareError, PrepareFailure, ProgramScope, SandboxLimits, bounded_store,
    capability_operations, engine, keep_reported_error, linker, reclaim,
};
use crate::tools::ToolOutcome;

/// Compile `source` with the production prepare step, or panic with what the toolchain said.
pub(super) fn prepare(source: &str) -> String {
    match compile_program(source, &[], &PrepareContext::detached()) {
        Ok(prepared) => {
            assert!(
                prepared.component.is_none(),
                "this arm evaluates its program with the embedded guest, not one per turn"
            );
            assert!(
                prepared.source.contains(compile::PROGRAM_ASSEMBLY),
                "the prepared program is a manifest naming the assembly the guest runs"
            );
            prepared.source
        }
        Err(failure) => panic!("the C# toolchain did not compile this program: {failure}"),
    }
}

/// This arm, resolved from the registry — the same `&'static dyn ProgramLanguage` a run resolves.
fn csharp() -> &'static dyn crate::sandbox::ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::CSharp)
}

/// The embedded guest, obtained once per test process through the **production** per-language
/// cache, so every case here evaluates in the slot a run's programs really come out of.
fn component() -> &'static Component {
    engine::component(csharp())
        .expect("the embedded C# guest compiles")
        .0
}

/// Evaluate an already-prepared program through the real membrane, with `operations`
/// offered.
///
/// A near-copy of the evaluation [`run_program`](crate::sandbox::run_program) ends in, starting from
/// a program [`prepare`] has already compiled. Everything past the preparation is the production
/// path, including [`keep_reported_error`](crate::sandbox::keep_reported_error).
///
/// # Why the component is resolved before the store is built
///
/// Because that is production's order: [`run_program`](crate::sandbox::run_program) resolves its
/// component and builds its linker, and only then builds the store. The program's own clock is
/// started by [`MembraneState::start_program`] immediately before `run` in both, so the component
/// this process obtains first is never charged to the program it evaluates.
pub(super) fn evaluate(
    program: &str,
    operations: &[crate::sandbox::operations::OperationId],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &serde_json::Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate_granting(program, operations, ending, library, |log| {
        FakeOperationApi::with(log, responder)
    })
}

/// [`evaluate`] for a program with no ending group, granted every call.
///
/// Its own function because what the documentation-close cases drive is this arm's lowering of the
/// answer, which needs the call to *succeed* — and an agent granted the two closes and no ending is
/// the shortest scope that reaches it.
pub(super) fn evaluate_closing_docviews(
    program: &str,
    operations: &[crate::sandbox::operations::OperationId],
    responder: impl FnMut(&str, &serde_json::Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    let granted: Vec<crate::sandbox::operations::OperationId> = operations
        .iter()
        .copied()
        .chain(capability_operations([CAPABILITY_DOCVIEW_CLOSE]))
        .collect();
    evaluate_granting(program, &granted, RunEnding::None, false, |log| {
        FakeOperationApi::with(log, responder)
    })
}

/// [`evaluate`] for an agent that keeps a program library with `source` already recorded under `id` on `turn`.
///
/// The one thing a library-holding agent cannot be driven to without it: `Programs.Get` and the
/// `ProgramSummary.Source` method that is a second spelling of it both answer out of a history a
/// fresh double has none of, so a test that seeded nothing can only ever observe a `NotFound`.
pub(super) fn evaluate_with_program(
    program: &str,
    id: &str,
    turn: u64,
    source: &str,
    responder: impl FnMut(&str, &serde_json::Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate_granting(program, &[], RunEnding::None, true, |log| {
        FakeOperationApi::with(log, responder).with_program(id, turn, source)
    })
}

/// What both of the above are: one evaluation, with everything the scope carries stated.
///
/// It is also where the component-before-store ordering [`evaluate`]'s documentation explains
/// actually happens, since that is a property of this body rather than of any wrapper.
///
/// The double is BUILT here rather than passed in, because the log it writes to is created here and
/// the two must be the same one. `build` takes that log and hands back the api, which is what lets a
/// caller seed the double — a program library with something in it — without a second parameter for
/// every thing a caller might seed.
fn evaluate_granting(
    program: &str,
    operations: &[crate::sandbox::operations::OperationId],
    ending: RunEnding,
    library: bool,
    build: impl FnOnce(&CallLog) -> FakeOperationApi,
) -> (SandboxOutcome, CallLog) {
    let limits = SandboxLimits::AMPLE;
    let log = CallLog::default();
    let api = build(&log);
    // Both of these before the store exists, for the reason this function's documentation gives.
    let component = component();
    let linker = linker::<FakeOperationApi>().expect("the production linker builds");
    let operations = granted_operations(operations, library);
    let scope = ProgramScope {
        capabilities: &all_capabilities(),
        operations: &operations,
        modules: &[],
        ending,
    };
    let granted: Vec<String> = operations.iter().map(ToString::to_string).collect();
    let mut store = bounded_store(
        MembraneState::new(api, csharp(), scope, limits, None),
        limits,
    );
    let bound = match Sandbox::instantiate(&mut store, component, &linker) {
        Ok(bound) => bound,
        Err(error) => panic!(
            "the embedded C# guest instantiates against the real membrane: {}",
            engine::classify(&store, limits, &error, SandboxError::Instantiate)
        ),
    };
    // The program's clock starts here rather than when the state was built, exactly as
    // `crate::sandbox::evaluate` does it: instantiating the component above is gg's work, not the
    // program's. See `MembraneState::start_program`.
    store.data_mut().start_program();
    let returned = bound
        .call_run(&mut store, program, &[], &granted, ending.into(), library)
        .map_err(|error| engine::classify(&store, limits, &error, SandboxError::Trap));
    if returned.is_err() {
        store.data_mut().revoke_completion();
    }
    let returned = keep_reported_error(returned, &store);
    let (outcome, _api) = reclaim(store, returned, None, None);
    (outcome, log)
}

/// Compile and run one C# program with no gg tool offered — the shape most cases here want.
fn run(source: &str) -> SandboxOutcome {
    evaluate(
        &prepare(source),
        &[],
        RunEnding::None,
        false,
        canned_outcome,
    )
    .0
}

/// One program under test: the model's own C#, unaltered.
///
/// There is no preamble and no bridge to append: gg's surface is compiled into the program's own
/// assembly and reached through the `using Gg;` the program itself writes, so what a test writes
/// here is exactly what a model would write, import lines included.
fn program(body: &str) -> String {
    body.to_string()
}

/// What a program logged, insisting that the sandbox ran it and that it did not fail.
pub(super) fn logs(outcome: &SandboxOutcome) -> &[String] {
    match &outcome.result {
        Ok(result) => {
            assert!(
                result.error.is_none(),
                "the program failed: {:?}",
                result.error
            );
            &outcome.logs
        }
        Err(error) => panic!("the sandbox could not run the program: {error}"),
    }
}

/// The model-facing error a program produced, insisting there was one and that the sandbox itself
/// did not fail.
pub(super) fn program_error(outcome: &SandboxOutcome) -> &crate::sandbox::outcome::ProgramError {
    match &outcome.result {
        Ok(result) => match &result.error {
            Some(error) => error,
            None => panic!(
                "the program was expected to fail; it logged {:?}",
                outcome.logs
            ),
        },
        Err(error) => panic!("the sandbox could not run the program: {error}"),
    }
}

#[test]
fn a_real_csharp_program_runs_through_the_real_membrane() {
    // Ordinary modern C#, exercising what a model actually writes: a `record` with a primary
    // constructor, an expression-bodied property, a collection expression, LINQ with projections and
    // a comparer, a switch expression with property patterns, string interpolation with a format
    // specifier, a generic method and a `Dictionary`. The point is not that any one of them is
    // doubtful — it is that a whole C# program survives Roslyn, the crossing and the interpreter
    // rather than a subset.
    let outcome = run(&program(
        r#"
using System;
using System.Collections.Generic;
using System.Linq;

namespace Inventory {
  public record Entry(string Word, int Count) {
    public string Label => $"{Word}={Count}";
  }
  public static class Rank {
    public static int Total<T>(IEnumerable<T> rows, Func<T, int> of) => rows.Sum(of);
    public static string Describe(Entry entry) => entry switch {
      { Count: > 2 } => "common",
      { Count: 1 } => "once",
      _ => "twice",
    };
  }
}

public static class Program {
  public static void Main() {
    const string text = "the quick brown fox the lazy dog the end";
    Dictionary<string, int> counts = [];
    foreach (var word in text.Split(' ')) {
      counts[word] = counts.GetValueOrDefault(word) + 1;
    }
    var rows = counts
      .Select(pair => new Inventory.Entry(pair.Key, pair.Value))
      .OrderByDescending(row => row.Count)
      .ThenBy(row => row.Word, StringComparer.Ordinal)
      .ToList();
    Console.WriteLine($"top {rows[0].Label} ({Inventory.Rank.Describe(rows[0])})");
    Console.WriteLine($"distinct {rows.Count} total {Inventory.Rank.Total(rows, r => r.Count)}");
    var shortest = rows.Where(row => row.Word.Length <= 3)
      .Select(row => row.Word)
      .OrderBy(word => word, StringComparer.Ordinal);
    var joined = string.Join(",", shortest);
    Console.WriteLine($"short {joined}");
    Console.WriteLine($"ratio {3.0 / 8.0:F3}");
  }
}
"#,
    ));

    assert_eq!(
        logs(&outcome),
        [
            "top the=3 (common)",
            "distinct 7 total 9",
            "short dog,end,fox,the",
            "ratio 0.375",
        ],
        "a whole C# program did not survive the crossing"
    );
}

#[test]
fn a_csharp_program_dispatches_a_real_call_through_the_membrane() {
    // `Gg.Native.ReadFile` takes a string and hands one back, through gg's typed `files.read-file`
    // binding. What it proves is that a C# program's argument is marshalled out of the interpreter,
    // lowered across the canonical ABI, dispatched by gg's real tool loop, and that what comes back
    // is a value the program can compute with.
    let (outcome, calls) = evaluate(
        &prepare(&program(
            r#"
using Gg;
using System;

public static class Program {
  public static void Main() {
    var text = ((Files.TextFile)Files.ReadFile("notes.md")).Contents;
    var first = text.Split('\n')[0];
    Console.WriteLine($"read {first.ToUpperInvariant()}");
  }
}
"#,
        )),
        &[crate::sandbox::operations::FILES_READ_FILE],
        RunEnding::None,
        false,
        canned_outcome,
    );

    assert_eq!(
        logs(&outcome),
        ["read CONTENTS OF NOTES.MD"],
        "a real membrane call did not come back into the program"
    );
    assert_eq!(
        calls.names(),
        ["read_file"],
        "a C# program's call did not reach gg's tool dispatch"
    );
}

#[test]
fn the_class_libraries_are_inside_the_artifact_and_no_filesystem_is_touched() {
    // The guest's one structural claim: the class libraries and ICU are bundled into the component
    // and registered as in-memory resources, so nothing here reads a file, needs a preopen, or
    // depends on a path the toolchain image happened to install.
    //
    // Every line below reaches a library that is *not* in the interpreter's core: `Regex` lives in
    // System.Text.RegularExpressions, `JsonSerializer` in System.Text.Json, `BigInteger` in
    // System.Runtime.Numerics, `ImmutableArray` in System.Collections.Immutable, and culture-aware
    // formatting in the ICU data. A guest reading its library set off a filesystem would fail on the
    // first of them, and this test runs in a process whose working directory holds none of it.
    let outcome = run(&program(
        r#"
using System;
using System.Collections.Immutable;
using System.Globalization;
using System.Linq;
using System.Numerics;
using System.Text.Json;
using System.Text.RegularExpressions;

public static class Program {
  public static void Main() {
    var words = Regex.Matches("a1 b22 c333", @"[a-z]\d+").Select(match => match.Value);
    Console.WriteLine("regex " + string.Join("|", words));
    var json = JsonSerializer.Serialize(new { Name = "gg", Arms = 10 });
    Console.WriteLine("json " + json);
    var big = BigInteger.Pow(7, 40);
    Console.WriteLine("bigint " + big.ToString(CultureInfo.InvariantCulture));
    ImmutableArray<int> frozen = [3, 1, 2];
    Console.WriteLine("immutable " + string.Join(",", frozen.Sort()));
    var german = new CultureInfo("de-DE");
    Console.WriteLine("culture " + 1234.5.ToString("N2", german));
    var day = new DateTime(2026, 8, 8).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    Console.WriteLine("date " + day);
  }
}
"#,
    ));

    assert_eq!(
        logs(&outcome),
        [
            "regex a1|b22|c333",
            "json {\"Name\":\"gg\",\"Arms\":10}",
            "bigint 6366805760909027985741435139224001",
            "immutable 1,2,3",
            "culture 1.234,50",
            "date 2026-08-08",
        ],
        "the bundled class libraries are not all reachable from inside the guest"
    );
}

#[test]
fn the_one_class_library_this_runtime_does_not_implement_says_so_by_name() {
    // Measured rather than assumed, and worth a case of its own because it is the arm's one
    // genuine library gap and it is **the runtime's**, not gg's: Mono's wasi build ships
    // `System.Security.Cryptography` as types that throw. Nothing gg does could restore it — the
    // native implementation does not exist for this target — so what matters is that the failure a
    // model gets is a named, catchable, recoverable one rather than a trap.
    //
    // It is not the same shape as the `System.Net.Http` handler this arm deliberately leaves out
    // (see `compile`'s module documentation): that one gg removed, this one was never there.
    let outcome = run(&program(
        r#"
using System;
using System.Security.Cryptography;
using System.Text;

public static class Program {
  public static void Main() {
    try {
      var digest = SHA256.HashData(Encoding.UTF8.GetBytes("test-cabinet"));
      Console.WriteLine("sha " + Convert.ToHexString(digest));
    } catch (PlatformNotSupportedException failure) {
      Console.WriteLine("refused: " + failure.Message);
    }
  }
}
"#,
    ));

    assert_eq!(
        logs(&outcome),
        ["refused: System.Security.Cryptography is not supported on this platform."],
        "the runtime's own cryptography gap did not arrive as a catchable exception"
    );
}

#[test]
fn exceptions_work_and_an_unhandled_one_carries_its_managed_frames() {
    // The thing this arm has that no other compiled arm does. Rust aborts and reaches for a panic
    // hook; Swift traps and has no hook at all; C++ has `throw` and `catch` but nothing to ask a
    // caught exception where it came from. Here the interpreter *is* a .NET runtime, so all of this
    // is ordinary IL.
    let caught = run(&program(
        r#"
using System;

public sealed class TooSmall : InvalidOperationException {
  public TooSmall(string message) : base(message) { }
}

public static class Program {
  static int Parse(string text) {
    var value = int.Parse(text);
    if (value < 10) throw new TooSmall($"{value} is under ten");
    return value;
  }
  public static void Main() {
    try { Parse("3"); }
    catch (TooSmall failure) { Console.WriteLine("caught own " + failure.Message); }
    finally { Console.WriteLine("finally ran"); }
    try { Parse("nope"); }
    catch (FormatException failure) { Console.WriteLine("caught bcl " + failure.GetType().Name); }
    var pair = new int[2];
    try { Console.WriteLine(pair[5].ToString()); }
    catch (IndexOutOfRangeException) { Console.WriteLine("caught bounds"); }
  }
}
"#,
    ));
    assert_eq!(
        logs(&caught),
        [
            "caught own 3 is under ten",
            "finally ran",
            "caught bcl FormatException",
            "caught bounds",
        ],
        "try/catch/finally did not behave the way C# says they do"
    );

    // And what nothing caught: reported as a recoverable model-facing error carrying the exception's
    // own `ToString()` — the type, the message and the managed stack. The frames are the half a
    // model can act on, and this is the only compiled arm here that has any.
    let uncaught = run(&program(
        r#"
using System;

public static class Program {
  static int Depth(int at) =>
    at == 0 ? throw new ArgumentOutOfRangeException("at", "bottomed out") : Depth(at - 1);
  public static void Main() {
    Console.WriteLine("before");
    Depth(2);
  }
}
"#,
    ));
    let reported = program_error(&uncaught);
    assert_eq!(
        uncaught.logs,
        ["before"],
        "the program's work before the throw was lost"
    );
    assert!(
        reported
            .message
            .contains("System.ArgumentOutOfRangeException")
            && reported.message.contains("bottomed out"),
        "an unhandled exception did not carry its own type and message: {}",
        reported.message
    );
    assert!(
        reported.message.contains("Program.Depth"),
        "an unhandled exception did not carry the managed frames only this arm has: {}",
        reported.message
    );
}

#[test]
fn the_compiler_tells_a_rejected_program_from_a_toolchain_that_could_not_run() {
    // A type error: Roslyn read the whole program and disagreed. The model's, recoverable, and
    // carrying Roslyn's own diagnostic at the model's own coordinates.
    let rejected = compile_program(
        "public static class Program {\n  public static void Main() {\n    int total = \"seven\";\n  }\n}\n",
        &[],
        &PrepareContext::detached(),
    )
    .expect_err("a program with a type error does not compile");
    match rejected {
        PrepareFailure::Program(PrepareError::Compile(diagnostic)) => {
            assert!(
                diagnostic.contains("error CS0029") && diagnostic.contains("program.cs(3,"),
                "the compile error did not carry Roslyn's own diagnostic at the model's line: \
                 {diagnostic}"
            );
        }
        other => panic!("a type error is the model's compile error, not {other:?}"),
    }

    // A syntax error reaches its OWN band, which is what gg's parse-only Roslyn driver is for: the
    // two say different things about a model, and `csc` will not say which it produced.
    let malformed = compile_program(
        "public static class Program {\n  public static void Main() {\n    var x = ;\n  }\n}\n",
        &[],
        &PrepareContext::detached(),
    )
    .expect_err("a program with a syntax error does not compile");
    assert!(
        matches!(
            &malformed,
            PrepareFailure::Program(PrepareError::Syntax(diagnostic))
                if diagnostic.contains("program.cs(3,")
        ),
        "a syntax error is not the parser's own band, located in the model's own coordinates: \
         {malformed:?}"
    );

    // And a toolchain that is not there at all is NOT the model's. It gets its own band, so a
    // machine missing a compiler cannot be read as a run of worse programs.
    let absent = temp_env(compile::DOTNET_HOME_ENV, "/nonexistent/gg-dotnet", || {
        compile_program(
            "public static class Program { public static void Main() { } }\n",
            &[],
            &PrepareContext::detached(),
        )
    })
    .expect_err("a missing toolchain cannot compile anything");
    match absent {
        PrepareFailure::Toolchain(message) => assert!(
            message.contains("install-dotnet.sh"),
            "the toolchain failure does not say how to fix it: {message}"
        ),
        other => panic!("a missing compiler is a toolchain failure, not {other:?}"),
    }
}

#[test]
fn two_preparations_of_one_program_are_byte_identical() {
    // `-deterministic` doing what [the flag list](super::compile) says it does. Roslyn stamps a
    // build's MVID from its inputs rather than from the clock, so one program compiled twice is one
    // assembly — and that is a claim about a flag gg passes, held to the toolchain rather than to
    // the documentation.
    //
    // It is NOT what the seam's isolation gate rests on. That gate searches an artifact for markers
    // and has no opinion about whether two compiles agree byte for byte; the check that did compare
    // them was deleted, for reasons recorded in
    // [`isolation`](crate::sandbox::language::isolation)'s module documentation. What survives here
    // is the narrower and still worthwhile claim: this arm's artifact is a function of its program,
    // so a study that re-prepares a recorded program gets the assembly that ran.
    let source = program(
        r#"
using System;

public static class Program {
  public static void Main() => Console.WriteLine(DateTime.UtcNow.Year);
}
"#,
    );
    assert_eq!(
        prepare(&source),
        prepare(&source),
        "two preparations of one C# program produced different assemblies"
    );
}

/// Set an environment variable for the duration of `body`, restoring it afterwards.
///
/// `unsafe` because the standard library says so on a multi-threaded process, and safe here for the
/// reason every other arm's copy of this is: each `#[test]` is its own process under `cargo nextest`
/// — so the only race is within one test function, and this one is not concurrent.
fn temp_env<T>(key: &str, value: &str, body: impl FnOnce() -> T) -> T {
    let previous = std::env::var_os(key);
    unsafe { std::env::set_var(key, value) };
    let outcome = body();
    match previous {
        Some(had) => unsafe { std::env::set_var(key, had) },
        None => unsafe { std::env::remove_var(key) },
    }
    outcome
}

#[test]
fn every_shape_of_entry_point_c_sharp_offers_is_one_a_model_may_write() {
    // Four ways to begin a C# program, and a model may reach for any of them — **top-level
    // statements first**, since that is what a program written to do one thing looks like in this
    // decade and what every `dotnet new console` since .NET 6 emits.
    //
    // It is a test rather than an assumption because two of the four were broken, in a way nothing
    // else here would have caught: Roslyn compiles top-level statements to an entry point declaring
    // `string[] args`, and the runtime asserts *inside itself* when such a method is invoked with no
    // `argv[0]` to take the program's path from. The failure was a wasm trap carrying a Mono
    // assertion, on a program a model would have had no reason to doubt.
    for source in [
        "using System;\nConsole.WriteLine(\"ran\");\n",
        "using System;\npublic static class Program { public static void Main() { \
         Console.WriteLine(\"ran\"); } }\n",
        "using System;\npublic static class Program { public static void Main(string[] args) { \
         Console.WriteLine(\"ran\"); } }\n",
        "using System;\npublic static class Program { public static int Main() { \
         Console.WriteLine(\"ran\"); return 0; } }\n",
    ] {
        assert_eq!(
            logs(&run(source)),
            ["ran"],
            "this shape of entry point did not run: {source}"
        );
    }
}

#[test]
fn csharp_runs_a_program_written_the_async_way_a_model_reaches_for() {
    // A model told "everything is synchronous" still writes `static async Task Main` sometimes,
    // because it is the shape a decade of C# samples open with. On this arm that shape **works**,
    // and gg engineered none of it: Roslyn lowers an async entry point — and a top-level `await` —
    // into a synthesized *synchronous* entry point that blocks on the result, and it is that
    // synthesized method the assembly's entry-point token names, so it is the one
    // `mono_wasi_assembly_get_entry_point` hands back.
    //
    // None of that lowering is gg's to keep working, and if it ever stopped the loss would be a
    // whole turn — silently, on the arm where the wrapper is most idiomatic and a model has every
    // reason to reach for it. So it is measured here rather than assumed.
    for source in [
        // The wrapper itself: a class, an async entry point, and an await inside it.
        "using System;\nusing System.Threading.Tasks;\npublic static class Program {\n  public \
         static async Task Main() {\n    await Task.CompletedTask;\n    \
         Console.WriteLine(\"ran\");\n  }\n}\n",
        // The same thing without the class: top-level statements containing an `await`, which
        // Roslyn lowers the same way.
        "using System;\nusing System.Threading.Tasks;\nawait Task.CompletedTask;\n\
         Console.WriteLine(\"ran\");\n",
        // And an awaited value, so the lowering is doing more than swallowing a completed task.
        "using System;\nusing System.Threading.Tasks;\nvar word = await \
         Task.FromResult(\"ran\");\nConsole.WriteLine(word);\n",
    ] {
        assert_eq!(
            logs(&run(source)),
            ["ran"],
            "this async shape did not run: {source}"
        );
    }
}

/// **A whole C# program, written the way a model writes one, runs through gg's own turn path.**
///
/// Everything else in this file drives [`evaluate`], which is the production path with the language
/// registry left out. This one calls [`run_program`](crate::sandbox::run_program) — the function a
/// turn calls — so what answers is the registered arm: its real prepare step, a real `csc`, the real
/// guest and the real membrane.
///
/// The program is what the [invariants](https://docs.testcabinet.ai/gg/responses-as-code/invariants/)
/// ask a model for on this arm and nothing gg supplies: its own `using` lines, its own entry point,
/// a call that crosses to the host, and a view opened on what came back. What is asserted is the
/// whole round trip — the call arrived, the turn carries no error, and the view the program opened
/// is in the outcome under the selector the program gave it.
#[test]
fn a_whole_csharp_program_a_model_would_write_runs_through_the_turn_path() {
    let log = CallLog::default();
    let api = FakeOperationApi::with(&log, canned_outcome);
    let operations = granted_operations(&all_operations(), false);
    let scope = ProgramScope {
        capabilities: &all_capabilities(),
        operations: &operations,
        modules: &[],
        ending: RunEnding::None,
    };
    let (outcome, _api) = crate::sandbox::run_program(
        crate::sandbox::language(GgProgramLanguage::CSharp),
        r#"using Gg;
using System;

public static class Program
{
    public static void Main()
    {
        var notes = ((Files.TextFile)Files.ReadFile("notes.md")).Contents;
        Console.WriteLine($"read {notes.Length} characters");
        Views.OpenText("notes", notes);
    }
}
"#,
        scope,
        &crate::sandbox::AgentWorkspace::new(),
        SandboxLimits::AMPLE,
        None,
        api,
    );

    let result = match &outcome.result {
        Ok(result) => result,
        Err(error) => panic!("the program did not run: {error:?}"),
    };
    assert!(
        result.error.is_none(),
        "the program ran and reported a failure: {:?}",
        result.error
    );
    assert_eq!(
        log.names(),
        ["read_file"],
        "the call the program wrote did not reach the host"
    );
    let opened: Vec<&str> = outcome
        .views_opened
        .iter()
        .map(|view| view.selector.as_str())
        .collect();
    assert_eq!(
        opened,
        ["notes"],
        "the view the program opened is not in what the turn hands back"
    );
}

/// **Every way a C# program can end by a status is read**, not only the one G8 drives.
///
/// `mono_runtime_run_main` hands back the entry point's own return value, so both spellings of one
/// are read: an explicit `int Main`, and top-level statements ending in `return 3;`, which is the
/// same entry point written the way this arm's prompt directs. A zero is measured beside them, so a
/// program that ended cleanly is not reported as having failed.
///
/// `Environment.ExitCode` is measured too, and it is the one this runtime does **not** read. It is
/// asserted rather than left out so that the row here is a measurement rather than a silence.
#[test]
fn a_status_a_csharp_program_ends_with_reaches_the_model_however_it_was_set() {
    let said = |source: &str| {
        run(source)
            .result
            .expect("the program ran")
            .error
            .map(|error| error.message)
    };
    assert_eq!(
        said("using System;\npublic static class Program { public static int Main() { return 3; } }\n")
            .as_deref(),
        Some("the program's entry point returned 3"),
        "a returned status did not reach the model"
    );
    assert_eq!(
        said("return 3;\n").as_deref(),
        Some("the program's entry point returned 3"),
        "a status returned from top-level statements did not reach the model"
    );
    assert_eq!(
        said("using System;\nEnvironment.ExitCode = 4;\n"),
        None,
        "MEASURED, and recorded rather than asserted as desirable: this runtime reads the entry \
         point's RETURN VALUE and never `Environment.ExitCode`, so a program that sets the field \
         and returns nothing is a clean turn. Closing it means reading \
         `mono_environment_exitcode_get` in the guest, and this assertion is what would notice a \
         runtime pin that closed it on its own"
    );
    assert_eq!(
        said(
            "using System;\nusing System.Threading.Tasks;\n\nvar failed = \
             Task.FromException(new InvalidOperationException(\"unobserved\"));\nConsole.WriteLine(\
             \"after\");\n"
        ),
        None,
        "MEASURED, and the third spelling `Shape::FailureValue` is defined by: a faulted `Task` \
         nobody awaited. .NET has not made one a process failure since 4.5 — an unobserved task \
         exception is raised on the finalizer thread and swallowed — so `the runtime does not kill \
         it` is this language's own answer rather than a hole in the capture. The awaited form \
         does reach the model, which is what the ApiError and NativeFault cases above drive. \
         Closing this one means a `TaskScheduler.UnobservedTaskException` handler and a collection \
         at end of run, which is interception rather than capture"
    );
    assert_eq!(
        said(
            "using System;\npublic static class Program { public static int Main() { return 0; } }\n"
        ),
        None,
        "a program that ended cleanly was reported as a failure"
    );
}

/// **Gate [G8](super::super::g8) for C#** — all five shapes a runtime failure takes,
/// driven through the production path and read back as the model would read them.
#[test]
fn g8_a_runtime_failure_reaches_the_model() {
    g8::gate(
        GgProgramLanguage::CSharp,
        &[
            Case {
                shape: Shape::ApiError,
                program: r#"// G8 (a): a gg call the host answers `not-found`, uncaught.
using Gg;
using System;

var text = Files.ReadFile(
    "missing.md"
);
Console.WriteLine(text);
"#,
                names: &["Gg.ApiException", "Files.ReadFile", "missing.md"],
                located: Located::At("./program.cs:line 5"),
                answered: Answered::AtRuntime,
                // The guest reads the `Code` off the uncaught `Gg.ApiException` and reports it, so
                // the turn is filed as the program fighting the API — as on Python, Ruby, C++ and
                // the ECMAScript arms.
                recorded: Some(TurnErrorType::ProgramApiError),
            },
            Case {
                shape: Shape::NativeFault,
                program: r#"// G8 (b): an index past the end of an array.
using System;

var values = new int[] { 1, 2, 3 };
var missing = values[
    7
];
Console.WriteLine(missing);
"#,
                names: &[
                    "System.IndexOutOfRangeException",
                    "Index was outside the bounds of the array",
                ],
                located: Located::At("./program.cs:line 5"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::ProgramThrow),
            },
            Case {
                shape: Shape::FailureValue,
                program: r#"// G8 (c): ending by returning a failure status.
using System;

public static class Program {
  public static int Main() {
    Console.WriteLine("the third step did not finish");
    return 3;
  }
}
"#,
                // The status, which is every word the program produced that reaches the model:
                // `Console` is the operator's channel, so the line above is not fed back. C#
                // locates a returned status nowhere, because it is not a fault raised at a
                // statement — it is how the program chose to end.
                names: &["returned 3"],
                located: Located::Nowhere,
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::ProgramThrow),
            },
            Case {
                shape: Shape::ResourceFault,
                program: r#"// G8 (d): unbounded recursion.
using System;

public static class Program {
  static int Deeper(int n) {
    return 1 + Deeper(n + 1);
  }
  public static void Main() {
    Console.WriteLine(Deeper(0));
  }
}
"#,
                // The fault's name is the FIRST thing Mono writes and the thousand identical frames
                // under it are the last, so this cell is what holds the guest stderr bound to
                // keeping both ends: a bound that kept either one alone would lose one of these
                // two assertions.
                names: &["StackOverflowException"],
                located: Located::At("./program.cs:6"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::SandboxTrap),
            },
            Case {
                shape: Shape::Abort,
                program: r#"// G8 (e): stopping the process outright.
using System;

Console.WriteLine("before the exit");
Environment.Exit(
    3
);
Console.WriteLine("after the exit");
"#,
                names: &["exit(3)"],
                located: Located::Nowhere,
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::SandboxTrap),
            },
        ],
    );
}
