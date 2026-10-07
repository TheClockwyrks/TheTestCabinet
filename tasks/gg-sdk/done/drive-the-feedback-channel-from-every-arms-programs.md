# Drive the feedback channel from every arm's programs

The `feedback` interface is the channel every program on every arm reports back
through, and each arm reaches it in its own spelling. Give all eleven arms a short
program-level test per behaviour the interface carries.

## Current state

The interface is `crates/gg/wit/gg-sandbox.wit:1060`: `log` (`:1099`),
`note-return` (`:1108`), `report-deferred` (`:1116`), `report-error` (`:1131`) and
`report-module-error` (`:1139`). Its host is
`crates/gg/src/sandbox/membrane/capture.rs:237` onwards, under three ceilings —
`MAX_LOG_LINES` (`:39`), `MAX_LOG_BYTES` (`:43`) and `MAX_LOG_LINE_BYTES` (`:47`).
The WIT's own note at `:1096` says `log` is the only channel a program has for
showing gg a value, so every logging line in every arm's tests already crosses it.

`report-error` is held to one standard on every arm by gate G8,
`crates/gg/src/sandbox/language/g8.rs:1`, which drives five failure shapes through
each arm's real preparation and real run and reads them back through the
production renderer. It is covered and stays out of this work.

The other four are asserted host-side in
`crates/gg/src/sandbox/membrane/capture.test.rs` — the line cut at `:34`, the tail
and its count at `:47`-`:59`, the byte budget at `:71`, the character boundary at
`:95`, and `report_deferred`'s first-one-wins at `:316`. Program-level, the picture
is thinner: `report-module-error` is driven from a program on the Python arm alone
(`crates/gg/src/sandbox/language/python.substrate.test.rs:1062`-`:1075`), and the
two facts about a program's own ending are asserted on TypeScript alone — that a
value-carrying end is a `tsc` diagnostic rather than a discard
(`crates/gg/src/sandbox.test.rs:823`) and that deferred work is drained inside the
turn so `deferred_note` stays none (`crates/gg/src/sandbox.test.rs:466`-`:476`).

How a module reaches a program splits the arms in two, and that split decides what
`report-module-error` means on each. Python evaluates a module at import time and
reports a throw through the interface (`python.substrate.test.rs:1070`); Ruby's
guest does the same at `packages/gg-sandbox-ruby/src/shim.js:632`. The compiled
arms link a module into the program, so a module that fails is refused at prepare
instead — `crates/gg/src/sandbox/language/java.substrate.test.rs:627` asserts that
shape, with the diagnostic located in the module's own file.

Each arm's harness is its own, and every test below reuses it:
`crates/gg/src/sandbox.test.rs:36` (`run`) and `:130` (`logs`) for TypeScript, with
`run_with_modules` at `:1244`; `javascript.substrate.test.rs:55` and `:105`;
`python.substrate.test.rs:188`, `:206` and `run_with_modules` at `:194`;
`ruby.substrate.test.rs:240` and `:256`; `purescript.substrate.test.rs:164` and
`:169`; and `run`/`logs` at `:247`/`:252` in each of
`java.substrate.test.rs`, `kotlin.substrate.test.rs`, `csharp.substrate.test.rs`,
with the same pair at `cpp.substrate.test.rs:180`, `rust.substrate.test.rs:215` and
`swift.substrate.test.rs:190`.

The logging spelling a model writes differs per arm: `console.log` on TypeScript,
JavaScript and PureScript (`Console.log`), `print` on Python, `puts` on Ruby,
`Console.WriteLine` on C#, `Gg.log` on Java, `gg.log` on Kotlin and Swift, and
`gg::log` on Rust and C++.

## Design

Each arm gets a new submodule, `crates/gg/src/sandbox/language/<arm>.feedback.test.rs`,
declared beside that arm's existing test submodules — `rust.rs:614`, `kotlin.rs:593`,
`java.rs:643`, `swift.rs:576`, `cpp.rs:735`, `csharp.rs:628`, `python.rs:472`,
`ruby.rs:494`, `purescript.rs:646`, `javascript.rs:214` and `typescript.rs:69` — and
reusing that arm's `run` and `logs`. One short function per case below, per arm:
every arm gets its own test of each case rather than one function walking the arms.

TypeScript's rows here are the same tests the `feedback` section of
[the TypeScript session-side issue](drive-ggs-session-side-sdk-modules-from-typescript-programs.md)
asks for. They are written once, in `typescript.feedback.test.rs`, and that issue's
section is satisfied by them.

### What `log` keeps

| Test | What it drives |
| --- | --- |
| `a_logged_line_reaches_gg_verbatim` | one call in the arm's own spelling; `logs` holds exactly that string |
| `a_line_carrying_newlines_stays_one_entry` | a string with two embedded newlines; `logs` has one element, newlines intact |
| `a_line_over_the_byte_cap_is_cut_on_a_character_boundary` | a multi-byte string over `MAX_LOG_LINE_BYTES`; the kept line is valid text and is at most the cap plus the ellipsis |
| `logging_past_the_line_cap_keeps_the_tail_and_counts_the_rest` | a loop of `MAX_LOG_LINES` plus five lines; `logs` holds the last of them and `logs_suppressed` is five |
| `logging_past_the_byte_cap_evicts_from_the_front` | fewer, larger lines totalling over `MAX_LOG_BYTES`; the kept lines are the last written and `logs_suppressed` counts the rest |

### What a program's end carries

| Test | What it drives |
| --- | --- |
| `a_program_that_ends_with_a_value_hands_gg_nothing` | the arm's spelling of ending with a value; `returned_value` is false, and where the arm's toolchain refuses the program instead, the located diagnostic is what the model reads |
| `work_a_program_defers_runs_inside_the_turn` | the arm's own idiom for later work, scheduling one gg call; the call's tool is in the recorded names and `deferred_note` is none. Where the toolchain refuses the idiom, the test asserts that refusal, which is the same fact stated by the language |

### A module that fails

| Test | What it drives |
| --- | --- |
| `a_module_that_fails_while_loading_is_named_and_the_program_runs_on` | for TypeScript, JavaScript, Python and Ruby: a module whose body throws, beside a module that works; `module_errors` names the failing key and carries the runtime's own words, the working module's export is readable, and the program logs its own line |
| `a_module_that_cannot_be_built_is_refused_at_its_own_line` | for PureScript, Java, Kotlin, Rust, Swift, C++ and C#: a module that does not build; the prepare failure names the module's key and its own line, and no program runs |

## Done when

- [ ] Each of the eleven arms has a `<arm>.feedback.test.rs` submodule declared
      beside its existing test submodules and holding one short function per case
      above.
- [ ] Every test reaches the interface through a real program in the arm's own
      logging spelling, against a synthesized response.
- [ ] `crates/gg/src/sandbox/membrane/capture.rs` names, beside each of the four
      behaviours, the per-arm file that drives it from a program.
- [ ] No test in the new submodules reaches a model or a provider.
- [ ] Gates green.
