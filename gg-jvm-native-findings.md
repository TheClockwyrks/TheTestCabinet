# A complete non-JS Java/Kotlin arm for gg — measurements

Nothing in /workspaces/the-test-cabinet was modified.
STATUS: the end-to-end build WORKS. Java and Kotlin both.

## 0. Headline
- Java -> TeaVM WEBASSEMBLY_WASI -> wasm COMPONENT: YES. 333,340 bytes, wasmtime 45 accepts it.
- Model writes its own public static void main, no wrapper, no catch chain: YES.
- Calls a gg-shaped host import, gets a real answer back: YES (real WIT iface, canonical ABI).
- Uncaught exception -> model's own file+line on stderr, captured by GuestStderr: YES.
- Exception HEADER line: missing upstream; FIXED by overriding one TeaVM runtime class
  from the classpath (no jar fork). Message recovered; type name still open.
- Kotlin -> JVM bytecode -> same pipeline: YES, identical. at ProgKt.boom(prog.kt:5).
- Host functions gg would own in the narrow interface: ONE. Plus cabi_realloc in Java (~25 lines).
- Maintenance: THE WALL. Target deleted upstream in 0.14.0 (~12,275 lines). 0.13.1 is last.

## 1. What was built
t3/Prog.java       - the MODEL's program. default package, own public static void main.
t3/GgEntry.java    - the two lines gg generates. @Export(name="run") -> Abi.reset(); Prog.main(...).
                     NO try, NO catch.
t3/gg/Abi.java     - the SDK's whole ABI layer: pinned byte[] arena, cabi_realloc as a bump
                     pointer, one @Import host fn, lower/lift for a string + two byte lists (~90 lines).
t3/gg/Gg.java      - model-facing sliver, Gg.readFile(path).
k1/src/prog.kt     - the Kotlin model program, fun main().
host/              - Rust wasmtime-45 host: wasmtime_wasi::p2 linked SYNC,
                     wasm_backtrace_details(Enable), GuestStderr copied from
                     crates/gg/src/sandbox/membrane.rs (same 4 trait impls, same tail()).
wit/gg-sandbox.wit - gg's REAL 1220-line WIT + a `wire` interface + a `jvm-sandbox` world.

## 2. Commands (Java)
L=~/.local/share/gg-java/libs; CP="$(find $L -name '*.jar'|sort|tr '\n' ':')"; J=~/.local/share/gg-java/jdk/bin
$J/java -Dgg.preserve=GgEntry,gg.Abi -cp "bld:$CP" Build t3 t3/classes t3/out gg.Main prog.wasm WEBASSEMBLY_WASI
wasm-tools component embed wit --world jvm-sandbox t3/out/prog.wasm -o t3/prog.embed.wasm
A=/home/vscode/.local/share/tcab/gg-adapters/wasi_snapshot_preview1.reactor-45.0.3.wasm
wasm-tools component new t3/prog.embed.wasm --adapt wasi_snapshot_preview1=$A -o t3/prog.component.wasm
/cargo-target/the-test-cabinet/release/jvm-host t3/prog.component.wasm

Build output:
  INFO: Classes compiled: 146
  INFO: Methods compiled: 1451
  teavm errors: 0
  real 0m1.365s  user 0m6.307s  sys 0m0.478s
Sizes:
  312529  t3/out/prog.wasm         (core module)
  333340  t3/prog.component.wasm   (component)

Core module imports:
  (import "wasi_snapshot_preview1" "clock_time_get" ...)
  (import "wasi_snapshot_preview1" "args_sizes_get" ...)
  (import "wasi_snapshot_preview1" "args_get" ...)
  (import "wasi_snapshot_preview1" "fd_write" ...)
  (import "test-cabinet:gg/wire" "call" (func $call (;4;) (type 10)))
Core module exports (non-teavm_):
  (export "cabi_realloc" (func $cabi_realloc))
  (export "run" (func $run))
  (export "memory" (memory 0))
Signatures, exactly canonical ABI, straight out of @Import/@Export:
  (type (;10;) (func (param i32 i32 i32 i32 i32)))   ; wire.call lowered
  (func $cabi_realloc (param i32 i32 i32 i32) (result i32))
  (func $run (param i32 i32 i32 i32 i32 i32 i32 i32))
=> the WHOLE preview1 surface a TeaVM WASI module needs is 4 functions.

Component WIT:
  world root {
    import test-cabinet:gg/wire;
    import test-cabinet:gg/session;
    import wasi:cli/... wasi:io/... wasi:clocks/... wasi:filesystem/...
    use test-cabinet:gg/session.{ending-kind};
    record code-module { name: string, source: string, }
    export run: func(program: string, modules: list<code-module>, tools: list<string>,
                     ending: ending-kind, library: bool);
  }
`run` is byte-for-byte gg's own sandbox-world signature (gg-sandbox.wit:1204).

## 3. The run
[host] wire.call op="files.read_file" request="notes.txt"
--- host: calls the guest made ---
  files.read_file(notes.txt)
--- host: run() returned ---
  Err: error while executing at wasm backtrace:
    0:   0xbf4d - throwException
    1:   0xf3a2 - boom      at TString.java:91:0
    2:   0xf341 - boom      at org/teavm/classlib/java/util/TObjects.java:162:0
    ...
  Caused by: wasm trap: wasm `unreachable` instruction executed
--- host: GuestStderr raw (259 bytes) ---
"hello, gg \xe2\x80\x94 the host answered: <contents of notes.txt, served by the wasmtime host>\n
 \tat Prog.boom(Prog.java:16)\n\tat Prog.boom(Prog.java:18)\n\tat Prog.boom(Prog.java:18)\n
 \tat Prog.boom(Prog.java:18)\n\tat Prog.main(Prog.java:11)\n\tat GgEntry.run(GgEntry.java:16)\n"

Three things at once: (1) the host import was answered for real and the JAVA program
printed the answer; (2) the uncaught exception killed the program as its runtime chose
(printStack(); abort(); -> unreachable -> wasmtime trap), gg caught nothing;
(3) the trace names the model's own file and lines (16 = the throw, 18 = recursion, 11 = main).

CAVEAT: wasmtime's own backtrace has correct FUNCTION NAMES but WRONG file/line
(TString.java:91, TObjects.java:162) - TeaVM 0.12.3's DWARF is misattributed. The correct
locations are on stderr, the channel gg already reads. gg must NOT symbolicate this arm
the way it does Swift.

## 4. Narrow-import question - ANSWERED: ONE host function
  interface wire { call: func(op: string, request: list<u8>) -> list<u8>; }
Same shape the current Java SDK already has (gg/internal/Wire.java's single @JSBody
apply(target,name,args) dispatcher, with its own documented argument for why one bridge
is right below the typed surface). Only the far side changes: the shared ECMAScript guest
-> gg's Rust host.

What gg writes and owns:
  wire WIT interface                 crates/gg/wit/gg-sandbox.wit    ~4 lines
  jvm-sandbox world                  same file                       ~20 lines
  component-type custom section      gg's Rust, IN PROCESS, via wit_component::metadata::encode
                                     (gg already depends on wit-component 0.248, Cargo.toml:327)
                                     -> NO Java codegen at all
  cabi_realloc + lower/lift          packages/gg-sandbox-java/.../Abi.java  ~90 lines, shared by both arms
  op/request/response encoding       both sides, gg's choice, gg already owns both
  host side of wire.call             crates/gg/src/sandbox/ - one match arm per operation
What gg does NOT write: canonical-ABI marshalling for the 1220-line WIT. The only canonical
ABI the Java side implements is one string and two byte-lists (~40 lines, written once).
There is no wit-bindgen for Java and none is needed.

Two measured facts made it work:
 - @Import(module="test-cabinet:gg/wire", name="call") on a static native method emits a REAL
   core-wasm import under the WASI backend, with an ARBITRARY module name -> the module name
   can be a WIT interface id.
 - @Export(name="run") emits a real core export BUT ONLY IF THE CLASS IS REACHABLE. An
   @Export on a class nothing calls is dead-stripped SILENTLY. setClassesToPreserve is
   MANDATORY; without it the module exported only `memory` and the encode produced a
   component with NO EXPORTS AT ALL. Footgun gg must encode in the driver.

## 5. Kotlin - the arms unify
Same Abi.java, same WIT, same adapter, same host.
  $J/java -cp "$KCP" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib \
      -cp "$K/kotlin-stdlib-2.4.10.jar:t3/classes" -d k1/classes k1/src/prog.kt
  $J/java -Dgg.preserve=GgEntry,gg.Abi -cp "bld:$CP:$K/kotlin-stdlib-2.4.10.jar:$PWD/k1/classes" \
      Build k1/java k1/jclasses k1/out gg.Main prog.wasm WEBASSEMBLY_WASI
  INFO: Classes compiled: 147 / Methods compiled: 1463 / teavm errors: 0 / real 0m1.575s
  324319 k1/out/prog.wasm ; 345130 k1/prog.component.wasm
Run:
  hello, gg - the host answered: <contents of notes.txt, served by the wasmtime host>
  	at ProgKt.boom(prog.kt:5)
  	at ProgKt.boom(prog.kt:7)   x3
  	at ProgKt.main(prog.kt:13)
  	at GgEntry.run(GgEntry.java:12)
prog.kt:5 = the throw, :7 = recursion, :13 = main's call. All correct.
Only per-arm difference: ONE LINE in the generated entry class
(Prog.main(new String[0]) vs ProgKt.main()).
Bonus: this also retires the Kotlin arm's SCRIPT compilation (kotlin.source.rs compiles the
reply as a Kotlin script because Kotlin refuses object/interface/enum class as LOCAL
declarations inside a wrapper fn). Under "programs are whole programs" the model writes
fun main() in an ordinary .kt file and the whole problem disappears.

## 6. The missing exception header - LOCATED AND FIXED
Defect: org/teavm/runtime/ExceptionHandling.java (teavm-core 0.12.3), throwException:
        if (stackFrame == null) { ... printStack(); abort(); } else { jumpToFrame(...); }
and printStack() (lines 44-78) walks the shadow stack printing "\tat ..." lines AND NOTHING
ELSE. TeaVM's own TThrowable.printStackTrace(PrintStream) (lines 204-221) DOES print
getClass().getName() + ": " + message + frames - the WASI backend just does not use it,
because the uncaught path is @Unmanaged (no shadow-stack bookkeeping, no allocation).
Confirmed by raw bytes: the buffer starts at "\tat Prog.boom" with NO preceding newline,
so printStackTrace never ran.

Thread.setDefaultUncaughtExceptionHandler is NOT the answer - measured (t4/):
  "handler installed: Prog$main$lambda$_1_0@1\n\tat Prog.main(Prog.java:6)\n\tat GgEntry.run(GgEntry.java:16)\n"
It is installed fine and NEVER CONSULTED. throwException walks the shadow stack for a catch
clause and, finding none, goes straight to printStack(); abort(). It never asks Thread.
Route is dead - AND it would have been interception under ruling 2 anyway.

The fix that DOES work, WITHOUT A FORK - measured (t5/, override/):
TeaVM resolves org/teavm/runtime/ExceptionHandling FROM THE CLASSPATH IT IS GIVEN. Put gg's
own copy earlier in setClassPathEntries and it wins. No patched jar, no rebuilt TeaVM.
FIRST ATTEMPT FAILED and the failure is the constraint:
    Console.printString(e.getClass().getName());   // virtual call
  -> built cleanly, then at run time: "Caused by: wasm trap: indirect call type mismatch"
  The unmanaged throw path cannot make a virtual call through getClass().
SECOND ATTEMPT WORKS - drop getClass(), keep getMessage():
    public static void printHeader() {
        Throwable e = thrownException;
        if (e == null) { return; }
        String message = e.getMessage();
        if (message != null) { Console.printString(message); }
        else { Console.printString("(no message)"); }
        Console.printString(NEWLINE);
    }
  Output:
    hello, gg - the host answered: <contents of notes.txt, served by the wasmtime host>
    the model's own message
    	at Prog.boom(Prog.java:16)
    	at Prog.boom(Prog.java:18)   x3
    	at Prog.main(Prog.java:11)
    	at GgEntry.run(GgEntry.java:16)
The MESSAGE is recovered. The exception TYPE NAME is still open: RuntimeClass has a
`RuntimeObjectPtr name` field (RuntimeClass.java:65) and printStack already renders
StringPtr.value in unmanaged code, so it is reachable by the same mechanism printStack
already uses - it needs a Structure reinterpret, not a virtual call. Not yet demonstrated.
Is this interception under ruling 2? I say no: gg adds no catch, changes no control flow,
and learns of the failure only through the runtime's own stderr. What it changes is what the
runtime PRINTS when it kills the program. But it IS a vendored copy of a third-party runtime
file, and that is a real cost.

## 7. Maintenance - THE WALL (from the upstream-research probe; re-verification queued)
- WEBASSEMBLY_WASI AND THE WHOLE MVP-WASM BACKEND behind it were deleted in TeaVM 0.14.0
  (2026-05-02), ~12,275 lines. NOT "the WASI glue on a surviving backend" - the non-GC
  WebAssembly compiler went with it.
- 0.13.1 is the LAST release that has it, and is STRICTLY BETTER than 0.12.3 for gg: it
  bundles ASM 9.8, which reads Java 25 class files.
- 0.12.3's ceiling is real: on JDK 25 the WASI target fails EVEN WITH --release 21. gg pins
  Temurin 21 today so it is fine today; a JDK bump is not free.
- Master's targets are {JAVASCRIPT, WEBASSEMBLY_GC, C}. Stated reasoning for the removal is
  that the target "failed to gain any adoption"; the standing recommendation for non-browser
  hosts is now the C target.
- WEBASSEMBLY_GC is not a substitute: it exports main as a (ref null extern) global and needs
  11 teavmJso.* imports - a JS object model gg would write itself.
Exposure of pinning: a dead compiler backend receiving no fixes, whose ASM ceiling caps the
JDK gg may install, in a repo whose whole point is that two runs differ in the language and
nothing else.
Escape hatch being measured: TeaVM's C target survives on master and IS maintained; wasi-sdk
clang is already in gg's image for the C++ arm. Probe in flight.

## 8. Open / TODO
- [ ] Kotlin/Wasm wasmWasi error-surface re-check - probe in flight, result NOT YET IN.
- [ ] TeaVM C target -> wasi-sdk clang escape hatch - probe in flight, result NOT YET IN.
- [ ] Exception TYPE NAME in the header (message already recovered).
- [ ] Re-verify the 0.14.0 removal SHA / line count / 0.13.1 ASM version directly.
- [ ] Component::new instantiation cost for a ~333 KB component (Rust arm: ~9 ms / ~25 KB).

================================================================================
SECOND SESSION — verified upstream facts + remaining probes
================================================================================

## 9. TeaVM removal — VERIFIED DIRECTLY (git clone of konsoletyper/teavm)
TWO commits, both Alexey Andreev, both first appearing in tag 0.14.0:
  d83fab4aed31b011b33fc171e2f868ca2eb0fe54  2026-03-14
    "Remove legacy Wasm and WASI backends"
    body: "Note that this does not remove code of these backends entirely, but
           removes them from build system and tooling. Actual implementations
           will be removed by later commits."
    56 files changed, 54 insertions(+), 910 deletions(-)   <- tooling/plugins/JUnit/tests
  c552cbb9f23c58eece7d040e876d6b7d2b595cac  2026-04-14
    "Remove old Wasm backend code"
    94 files changed, 43 insertions(+), 12740 deletions(-) <- the compiler
    breakdown of the 12,740:
      10,685  the MVP-wasm BACKEND PROPER (bytecode -> wasm compiler)
       1,222  the wasm runtime + WASI glue
         833  everything else
=> ~13,650 lines across the two. It is NOT "thin WASI glue on a surviving backend":
   the entire non-GC WebAssembly compiler went with it. Restoring only the WASI
   target is not possible; the backend it stood on no longer exists.

MAINTAINER'S REASONING, verbatim from the 0.14.0 release notes
(https://github.com/konsoletyper/teavm/releases/tag/0.14.0):
  "Old (non-GC) WebAssembly backend, as well as WASI backend, were removed from
   the project. They failed to gain any adoption. In the meantime Web WebAssembly
   GC surpasses WebAssembly MVP in all aspects. Also, WebAssembly GC has gained
   immediate adoption after first publication a couple of years ago. This makes it
   pointless to invest time into these backends, so they were removed."
=> "pointless to invest time into these backends". There is no commit restoring it
   (0 matches for restore/re-add wasi across all history).

Release dates (git tag dates):
  0.12.3  2025-07-09   <- gg's current pin
  0.13.1  2026-02-21   <- LAST release with WEBASSEMBLY_WASI
  0.14.0  2026-05-02   <- removal lands
  0.15.0  2026-06-04
Repo is very much alive: last commit 2026-07-28, 167 commits in the last 6 months,
53 of them touching backend/wasm since 0.13.1 - ALL of that work is WasmGC.
No 0.12.x release after 0.12.3 and no 0.13.x after 0.13.1: both lines are closed.

## 10. gg should pin 0.13.1, NOT 0.12.3 — measured
0.13.1 has WEBASSEMBLY_WASI (verified from the tag's TeaVMTargetType.java AND from
javap on the published jar). The whole probe rebuilds on it unchanged:
  INFO: Classes compiled: 149 / Methods compiled: 1463 / teavm errors: 0 / real 0m1.267s
  314306 t6/out/prog.wasm ; 335117 t6/c.wasm
  same 5 imports, same 3 exports, identical stack trace:
    at Prog.boom(Prog.java:16) ... at Prog.main(Prog.java:11)

THE JDK CEILING IS REAL, and 0.13.1 lifts it. Same sources, same --release 21 for
BOTH the model program AND the driver; only the TeaVM version differs:
  JDK 25 (openjdk 25.0.3) + TeaVM 0.12.3 ->
     Exception in thread "main" org.teavm.tooling.builder.BuildException:
     java.lang.IllegalArgumentException: Unsupported class file major version 69
  JDK 25 (openjdk 25.0.3) + TeaVM 0.13.1 ->
     INFO: Output file successfully built / Classes compiled: 149 / teavm errors: 0
=> pinning 0.12.3 caps the JDK gg may install at <= 24. 0.13.1 does not.

## 11. Component::new cost - measured
14.2 / 15.1 / 16.0 ms for the 333 KB component (3 runs, release build).
Compare the Rust arm's documented ~9 ms at ~25 KB. Acceptable.

## 12. Kotlin/Wasm wasmWasi re-check - FAILS ruling 2 under EVERY flag
16 flag combinations built and run under a wasmtime-45 host with a capturing stderr:
  m_baseline, m_asserts, m_debugfriendly, m_debuginfo, m_debuginfo_dwarf,
  m_debuginfo_dwarf_friendly, m_dwarf, m_everything_debug, m_kclassfqn,
  m_newexcproposal, m_nojstag, m_rangechecks, m_sourcemap, m_wat,
  m_traps, m_traps_plus_debug
GUEST STDERR = 0 BYTES ON ALL SIXTEEN.
 - 14 of them: Display: "thrown Wasm exception". No message. downcast::<Trap> = None,
   downcast::<WasmBacktrace> = None. The payload IS reachable via wasmtime's
   ThrownException as a struct, but it is a struct of FuncRefs (a vtable), not text.
 - -Xwasm-use-traps-instead-of-exceptions (m_traps, m_traps_plus_debug) DOES give a
   wasmtime backtrace with the MODEL'S OWN FUNCTION NAMES:
       0: 0x3deee - deepestFrameNamedByTheModel   at ./.:2:21
       1: 0x3deff - middleFrame                   at ./.:6:31
       2: 0x3df23 - main                          at ./.:11:8
   but the file is "./." (useless) and there is still NO exception type and NO message.
The full -Xwasm flag surface at Kotlin 2.4.10 was enumerated and every plausible one
tried: -Xwasm-debug-info, -Xwasm-debug-friendly, -Xwasm-generate-dwarf,
-Xwasm-generate-wat, -Xwasm-enable-asserts, -Xwasm-enable-array-range-checks,
-Xwasm-kclass-fqn, -Xwasm-no-jstag, -Xwasm-use-new-exception-proposal,
-Xwasm-use-traps-instead-of-exceptions, -Xwasm-source-map-*.
WITH AN EXPLICIT CATCH (which ruling 1 forbids gg from adding), printStackTrace()
DOES write to stderr - but only the header, with an EMPTY stack:
    catch.err: "IllegalStateException: the model's own message: n was 6\n"
    stackTraceToString=[IllegalStateException: the model's own message: n was 6\n\n]
=> Kotlin/Wasm has the EXACT OPPOSITE gap from TeaVM: header but no frames, and only
   via interception. TeaVM gives frames-with-file-and-line and (with the patch) the
   message. Kotlin/Wasm can never give a file or a line.

## 13. The TeaVM C-backend escape hatch - NOT TURNKEY. It is a port.
TeaVM emits C fine and fast: 305 files / 959,599 bytes in 1.13 s (target C).
Compiling it with gg's own wasi-sdk clang to wasm32-wasip1 hits a wall list:
 1. setjmp.h: "Setjmp/longjmp support requires Exception handling support ... compile
    with `-mllvm -wasm-enable-sjlj` and use an engine that implements the Exception
    handling proposal."  PASSABLE: -mllvm -wasm-enable-sjlj works, and wasmtime 45 has
    Config::wasm_exceptions (gg's Cargo.toml already discusses it for Foray).
 2. -DTEAVM_USE_SETJMP=0 is NOT an alternative: the GENERATED CLASS CODE then fails with
      Prog.java:5:5: error: use of undeclared identifier 'TEAVM_UNREACHABLE'
    because that macro exists only in the setjmp branch of exceptions.h. So the wasm
    Exception Handling proposal is MANDATORY for this route.
 3. date.c (192 lines): "variable has incomplete type 'struct tm'" x19. TeaVM assumes a
    POSIX <time.h> where struct tm is unconditionally complete; wasi-libc gates it behind
    __NEED_struct_tm via bits/alltypes.h. Adding #include <time.h> does not fix it.
 4. fiber.c (95 lines): timer_t, struct sigaction, SIGRTMIN, sigset_t.
    wasi-libc HAS NONE OF THESE and -lwasi-emulated-signal does not provide them.
    Must be rewritten or stubbed (stubbing removes TeaVM's fiber/async support).
 5. Earlier in the same sweep: <pwd.h>, <dirent.h>, <utime.h>, mmap and signal use in
    memory.c / file.c.
With -mllvm -wasm-enable-sjlj + the WASI emulation defines, 26 of 151 translation units
still fail; once date.c/fiber.c are dealt with the generated class code compiles.
=> The escape hatch EXISTS but costs gg an owned WASI port of TeaVM's C runtime
   (several files, a few hundred lines), forever, with no upstream to take it back -
   plus turning on the wasm Exception Handling proposal in gg's engine for this arm.
   That is not a fallback anyone should count on being cheap.

## 14. Exception type name in the header - NOT recovered
Message: recovered (see section 6). Type name: no.
Attempt: read RuntimeClass.name via a Structure reinterpret in the unmanaged path:
    RuntimeObject ptr = Address.ofObject(e).toStructure();
    RuntimeClass cls = RuntimeClass.getClass(ptr);
    StringPtr namePtr = Address.ofObject(cls.name).toStructure();
No trap (the reinterpret is safe) but namePtr.value is null:
    "(unknown class): the model's own message"
Reason, from TClass.java:232-247: RuntimeClass.name is a lazily populated CACHE slot
(setNameCache/getNameCacheLowLevel, @PluggableDependency(ClassDependencyListener)); the
name string is only emitted into the binary when dependency analysis records that a
class's name is needed. Nothing in a model's program calls getClass().getName().
The earlier managed attempt (Console.printString(e.getClass().getName())) built clean and
trapped at run time with "wasm trap: indirect call type mismatch".
=> Recovering the type name needs more TeaVM surgery than one vendored file. The MESSAGE
   plus the FULL located stack trace is what this route delivers.

ANSWERED LATER, IN gg's OWN GENERATED ENTRY CLASS, not in the vendored file. TeaVM's
ClassDependencyListener emits a class's name string only where dependency analysis sees
`getName()` reached with that class value, and a `.class` constant on a REACHABLE path is
enough to record it. `GgEntry` therefore carries `Class<?>[] SPELLABLE`, built past a
`System.getProperty` guard (so nothing folds it away) and walked from the world's `run` in a
loop that runs zero times. Measured through the production route: `values.get(7)` past the
end of an `ArrayList` printed `an exception carrying no message` before, and
`java.lang.IndexOutOfBoundsException` after, with the same five correct frames. A method
merely PRESERVED by `setClassesToPreserve` and called by nobody is not analysed at all —
measured, the same probe as an unreferenced `spellable()` changed nothing. See
`crates/gg/src/sandbox/language/java.compile.rs`.
