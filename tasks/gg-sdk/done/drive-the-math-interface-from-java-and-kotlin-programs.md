# Drive the math interface from Java and Kotlin programs

The `math` interface is the set of host functions the JVM arms reach every time a
program writes `Math.sqrt` or `kotlin.math.atan2`. Drive each of them from a real
Java program and a real Kotlin program.

## Current state

The interface is `crates/gg/wit/gg-sandbox.wit:1247`: `sin`, `cos`, `tan`, `asin`,
`acos`, `atan`, `atan2` (`:1261`), `exp`, `log`, `pow`, `sqrt`, `ceil`, `floor` and
`random` (`:1280`). Its host is
`crates/gg/src/sandbox/membrane/math.rs:45`, and the header at `:1`-`:16` records
why it exists: TeaVM's `WEBASSEMBLY_WASI` backend emits `java.lang.Math`'s native
methods as core imports of a module named `teavmMath`, which a component cannot
resolve, so a `ClassHolderTransformer` in each arm's SDK jar rewrites that module
name to `test-cabinet:gg/math` on the way past.

Every function is a total function on `f64` with no failure mode, which the WIT
states at `:1244`: `log(-1)` is `NaN` here for the same reason it is `NaN` in Java,
and none of them returns an `api-error`. `random` is declared because the classlib
annotates a method with it, is not imported on this target, and is answered from
the same entropy source WASI's `random_get` reads
(`crates/gg/src/sandbox/membrane/math.rs:98`-`:117`).

The arithmetic itself is asserted host-side in
`crates/gg/src/sandbox/membrane/math.test.rs`: the fourteen values at `:30`, the
`atan2` argument order at `:50`-`:52`, the domain results at `:55` and `random`'s
range and spread at `:68`. That file's own header at `:3`-`:5` says the wiring is
proved by a real compiled program next door. One function is driven that way —
`sqrt(16.0)` inside a Kotlin program at
`crates/gg/src/sandbox/language/kotlin.substrate.test.rs:341` — and nothing on the
Java arm calls any of the fourteen. `java.surface.test.rs:1143` reaches
`Math.floorMod`, which the JVM computes itself and this interface does not carry.

`atan2` is the one whose failure is silent: it takes `y` first, as
`java.lang.Math` does, and a program whose arguments are transposed produces
reflected angles rather than an error.

Both arms' harnesses are the pair each substrate file exposes — `run` at
`crates/gg/src/sandbox/language/java.substrate.test.rs:247` and `logs` at `:252`,
with `whole` at `:76` building the compilation unit; and the same three at
`crates/gg/src/sandbox/language/kotlin.substrate.test.rs:247`, `:252` and `:75`.
Both go through the production prepare step and the production linker, so a program
here is compiled by the real JDK and TeaVM seconds before it runs.

A warm build on either arm costs 0.33–0.56 s
(`crates/gg/src/sandbox/language/java.compile.rs:16`) on top of a pooled JVM's cold
start (`:139`), and each `#[test]` is its own process under `cargo nextest`. The
case list below is priced at that rate deliberately: each function is one short
program and one assertion, which is what makes a failing row name the function that
broke.

## Design

Two new submodules — `crates/gg/src/sandbox/language/java.math.test.rs` declared
beside `java.rs:643`, and `crates/gg/src/sandbox/language/kotlin.math.test.rs`
declared beside `kotlin.rs:593` — each reusing its arm's `run`, `logs` and `whole`.
Each arm gets its own short test per case rather than one function walking both.

Every program logs its result through a fixed-decimal format, so the arm's default
rendering of a double is not the thing under test. The Java programs write
`Math.<name>` and the Kotlin programs write the `kotlin.math` spelling a model
reaches for, which is the route a Kotlin author actually takes to the same import.

| Test | The program | What it asserts |
| --- | --- | --- |
| `sin_is_answered_for_a_program` | `sin(0)` | `0.000` |
| `cos_is_answered_for_a_program` | `cos(0)` | `1.000` |
| `tan_is_answered_for_a_program` | `tan(0)` | `0.000` |
| `asin_is_answered_for_a_program` | `asin(1)` | half of pi, to three places |
| `acos_is_answered_for_a_program` | `acos(1)` | `0.000` |
| `atan_is_answered_for_a_program` | `atan(1)` | a quarter of pi, to three places |
| `atan2_takes_its_arguments_in_javas_own_order` | `atan2(1, 0)` and `atan2(0, 1)` | half of pi and zero; a transposition reads as the other value and this is the only place that shows |
| `exp_is_answered_for_a_program` | `exp(1)` | `2.718` |
| `log_is_answered_for_a_program` | `log(e)` | `1.000` |
| `pow_takes_its_base_before_its_power` | `pow(2, 10)` | `1024.000`, and `pow(10, 2)` is `100.000` in the same test so a transposition is visible |
| `sqrt_is_answered_for_a_program` | `sqrt(16)` | `4.000` |
| `ceil_is_answered_for_a_program` | `ceil(1.2)` | `2.000` |
| `floor_is_answered_for_a_program` | `floor(1.8)` | `1.000` |
| `random_answers_a_program_with_a_number_in_range` | eight draws | each is at least zero and under one, and they are not all the same value; no fixed value is asserted |
| `a_domain_result_is_a_number_rather_than_a_failure` | `log(-1)`, `sqrt(-1)`, `asin(2)` | the program runs to its end and logs its runtime's own rendering of not-a-number, and the outcome carries no program error |
| `a_program_mixing_math_with_a_gg_call_reaches_both` | one `pow` and one gg call in one program | the logged value and the recorded tool name, proving the rewritten import coexists with the wire |

The `sqrt` program at `kotlin.substrate.test.rs:341` stays where it is: it is part
of that file's Kotlin standard library walk and is proving something else.

The header note at `kotlin.substrate.test.rs:41` asks a reader to add a program to
an existing function rather than adding one. Revise it as part of this work to
scope it to the functions it describes, so it does not read as a rule against the
short focused tests these two files are made of, and give each new file a header
saying a case there is a function.

## Done when

- [ ] `crates/gg/src/sandbox/language/java.math.test.rs` and
      `crates/gg/src/sandbox/language/kotlin.math.test.rs` exist, are declared
      beside their arms' other test submodules, and hold one short function per
      case above.
- [ ] Each of the fourteen functions is driven from a real compiled program on both
      JVM arms.
- [ ] `atan2` and `pow` each have a test whose assertion fails on a transposition of
      their two arguments.
- [ ] `crates/gg/src/sandbox/membrane/math.test.rs`'s header names both new files as
      the wiring proof it defers to.
- [ ] The consolidation note at `kotlin.substrate.test.rs:41` is scoped to the
      functions it describes.
- [ ] No test in the new submodules reaches a model or a provider.
- [ ] Gates green.
