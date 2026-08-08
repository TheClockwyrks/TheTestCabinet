//! **The C# arm's execution substrate** — the real Roslyn, the real committed guest and the real
//! membrane, driven end to end: C# the way a model would write it, really compiled by the toolchain
//! in the run image, really interpreted by the Mono IL interpreter gg commits, really talking to
//! gg's real host.
//!
//! # What "real" means here
//!
//! All of it. A program starts as an ordinary C# compilation unit, goes through
//! [`compile_program`](super::compile::compile_program) — the production prepare step, spawning a
//! real `csc` through the seam's own isolated invocation, in a
//! [`PrepareContext`](crate::sandbox::PrepareContext) — and what comes back is a base64 IL assembly,
//! which is handed to the **committed** `guests/csharp.component.wasm`: compiled with
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
//! that two preparations of one program are byte-identical, which is what the seam's isolation gate
//! will rest on when this arm is registered.
//!
//! The isolation gate itself is **not** here. The seam derives its language list from the registry,
//! so from the moment `language: "csharp"` resolves, this arm's program step is driven sixteen ways
//! along with every other registered language's.
//!
//! The programs below call the **SDK**, which is what a model would call: `fs.ReadTextFile`,
//! `view.OpenText`, `Console.WriteLine`. Every one of them is compiled into the program's own
//! assembly out of `packages/gg-sandbox-csharp/src/Gg/`, so what these prove is not only that the
//! crossing happens but that the surface a model is shown is the surface that runs. The SDK's own
//! spelling, function by function, is driven in `csharp.surface.test.rs`.
//!
//! # Why these tests are consolidated
//!
//! Each `#[test]` is its own process under `cargo nextest`, and the first thing any of these does is
//! compile a 34.9 MB component. So each function drives *many* programs against many stores rather
//! than being one behaviour per function, exactly as `sandbox.test.rs` does. Add a program to an
//! existing function rather than adding a function.

use std::sync::OnceLock;
use std::time::Instant;

use test_cabinet_core::gg::GgProgramLanguage;
use wasmtime::component::Component;

use super::GUEST_COMPONENT;
use super::compile::{self, compile_program};
use crate::sandbox::fake::{CallLog, FakeToolApi, canned_outcome};
use crate::sandbox::membrane::{MembraneState, RunEnding, Sandbox};
use crate::sandbox::outcome::{SandboxError, SandboxOutcome};
use crate::sandbox::{
    PrepareContext, PrepareError, PrepareFailure, ProgramScope, SandboxLimits, bounded_store,
    engine, keep_reported_error, linker, reclaim,
};
use crate::tools::ToolOutcome;

/// Compile `source` with the production prepare step, or panic with what the toolchain said.
pub(super) fn prepare(source: &str) -> String {
    match compile_program(source, &PrepareContext::new()) {
        Ok(prepared) => {
            assert!(
                prepared.component.is_none(),
                "this arm evaluates its program with the committed guest, not one per turn"
            );
            assert!(
                !prepared.source.is_empty(),
                "the prepared program is the assembly, base64-encoded"
            );
            prepared.source
        }
        Err(failure) => panic!("the C# toolchain did not compile this program: {failure}"),
    }
}

/// The committed guest, compiled **once per test process**.
///
/// A local `OnceLock` rather than the production [component cache](crate::sandbox::engine::component)
/// for one reason: that cache is indexed by a registered language's wire id, and this arm has none
/// yet. Everything else is the production path, and the bargain is the same one a run strikes —
/// compiling 34.9 MB costs seconds and instantiating the result costs milliseconds, so a function
/// that drives ten programs must not pay ten compiles.
fn component() -> &'static Component {
    static COMPONENT: OnceLock<Component> = OnceLock::new();
    COMPONENT.get_or_init(|| {
        engine::compile_bytes(GUEST_COMPONENT).expect("the committed C# guest is a component")
    })
}

/// Evaluate an already-prepared program through the real membrane, with `enabled`'s gg tools
/// offered.
///
/// A near-copy of [`run_program`](crate::sandbox::run_program) with one thing left out, because it
/// belongs to a *registered* language rather than to an artifact: the resolution of the language
/// itself. Everything else is the production path, including
/// [`keep_reported_error`](crate::sandbox::keep_reported_error).
///
/// The [membrane state](MembraneState) is built with TypeScript's arm, because this one has no wire
/// id yet. Nothing these tests assert depends on it: the language decides how a *refused* call's
/// name is spelled back at the model, and no program here is refused one.
pub(super) fn evaluate(
    program: &str,
    enabled: &[String],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &serde_json::Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    let limits = SandboxLimits::default();
    let log = CallLog::default();
    let api = FakeToolApi::with(&log, responder);
    let linker = linker::<FakeToolApi>().expect("the production linker builds");
    let scope = ProgramScope {
        enabled,
        modules: &[],
        ending,
        library,
    };
    let mut store = bounded_store(
        MembraneState::new(
            api,
            crate::sandbox::language(GgProgramLanguage::TypeScript),
            scope,
            limits,
            None,
        ),
        limits,
    );
    let bound = match Sandbox::instantiate(&mut store, component(), &linker) {
        Ok(bound) => bound,
        Err(error) => panic!(
            "the committed C# guest instantiates against the real membrane: {}",
            engine::classify(&store, limits, &error, SandboxError::Instantiate)
        ),
    };
    let returned = bound
        .call_run(&mut store, program, &[], enabled, ending.into(), library)
        .map_err(|error| engine::classify(&store, limits, &error, SandboxError::Trap));
    if returned.is_err() {
        store.data_mut().revoke_completion();
    }
    let returned = keep_reported_error(returned, &store);
    let (outcome, _api) = reclaim(store, returned, None, None, None);
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
/// There is no preamble and no bridge to append, which is the whole point of what landed with the
/// SDK: gg's surface is compiled into the program's own assembly and reaches its scope through a
/// `global using`, so what a test writes here is exactly what a model would write.
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
using System;

public static class Program {
  public static void Main() {
    var text = fs.ReadTextFile("notes.md");
    var first = text.Split('\n')[0];
    Console.WriteLine($"read {first.ToUpperInvariant()}");
  }
}
"#,
        )),
        &["read_file".to_string()],
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
        &PrepareContext::new(),
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

    // A syntax error reaches the same band, and that is a stated limit rather than an oversight —
    // see this arm's `compile` module for why gg does not guess at Roslyn's parse-versus-bind
    // taxonomy. What matters for a model is that it is recoverable and located.
    let malformed = compile_program(
        "public static class Program {\n  public static void Main() {\n    var x = ;\n  }\n}\n",
        &PrepareContext::new(),
    )
    .expect_err("a program with a syntax error does not compile");
    assert!(
        matches!(
            &malformed,
            PrepareFailure::Program(PrepareError::Compile(diagnostic))
                if diagnostic.contains("program.cs(3,")
        ),
        "a syntax error is not located in the model's own coordinates: {malformed:?}"
    );

    // And a toolchain that is not there at all is NOT the model's. It gets its own band, so a
    // machine missing a compiler cannot be read as a run of worse programs.
    let absent = temp_env(compile::DOTNET_HOME_ENV, "/nonexistent/gg-dotnet", || {
        compile_program(
            "public static class Program { public static void Main() { } }\n",
            &PrepareContext::new(),
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
    // What the seam's isolation gate will rest on when this arm is registered: it drives a
    // preparation sixteen ways and compares each result with what the same input produced alone, so
    // a compiler that stamped anything per-invocation would fail that gate for a reason that has
    // nothing to do with isolation. Roslyn stamps a build's MVID from its inputs under
    // `-deterministic`, which is why this arm can pass it — asserted here on its own so that a
    // failure over there is read as an isolation failure rather than as a compiler that started
    // stamping something.
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

#[test]
fn what_compiling_a_csharp_program_cost_is_a_reading_the_seam_can_take() {
    // The seam requires an arm whose prepare step invokes a compiler to declare it, so that the
    // per-turn cost is recorded rather than inferred. This asserts the reading exists and is
    // plausible; the numbers themselves are in this arm's `compile` module, measured rather than
    // quoted.
    let source = program(
        r#"
using System;
using System.Linq;

public static class Program {
  public static void Main() => Console.WriteLine(Enumerable.Range(1, 10).Sum());
}
"#,
    );
    // Warm the compiler: the first `csc` in a process tree pays the runtime's own JIT, which is a
    // property of .NET starting rather than of compiling this program.
    let _ = prepare(&source);

    let started = Instant::now();
    let prepared = prepare(&source);
    let elapsed = started.elapsed();
    assert!(
        elapsed.as_secs() < 30,
        "a warm C# compile took {elapsed:?}, which is not a compile"
    );
    assert!(
        prepared.len() > 1_000,
        "the prepared assembly is implausibly small: {} bytes of base64",
        prepared.len()
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
        "Console.WriteLine(\"ran\");\n",
        "public static class Program { public static void Main() { Console.WriteLine(\"ran\"); } }\n",
        "public static class Program { public static void Main(string[] args) { Console.WriteLine(\"ran\"); } }\n",
        "public static class Program { public static int Main() { Console.WriteLine(\"ran\"); return 0; } }\n",
    ] {
        assert_eq!(
            logs(&run(source)),
            ["ran"],
            "this shape of entry point did not run: {source}"
        );
    }
}
