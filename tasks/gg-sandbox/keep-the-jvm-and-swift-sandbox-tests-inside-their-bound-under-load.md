# Keep the JVM and Swift sandbox tests inside their bound under load

Make the Kotlin and Swift sandbox tests finish well inside nextest's
termination bound when the machine is busy, by taking the repeated toolchain
work out of each test rather than by widening the bound.

## Current state

`.config/nextest.toml` terminates any test after two 60-second periods and
counts a test that fails once and passes on retry as failed. In a full
`cargo nextest run -p test-cabinet-gg` while another workspace build runs on
the machine, at a load average between 25 and 40, a shifting handful of
Kotlin and Swift tests reach that bound and fail the run:

- `sandbox::language::isolation::tests::gate::program::kotlin`
- `sandbox::language::kotlin::substrate::a_pooled_jvm_is_reused`
- `sandbox::language::kotlin::substrate::a_real_kotlin_program_runs_through_the_real_membrane`
- `sandbox::language::kotlin::substrate::an_uncaught_failure_reaches_the_model_in_its_runtimes_own_words`
- the Swift substrate group

Run alone under the same load they pass, taking between 31 and 117 seconds
each. Each one starts its own JVM or `swiftc` build from cold, so the time is
almost entirely the toolchain's and scales with whatever else the machine is
doing. The set of tests that reaches the bound differs from run to run, which
is what makes the suite unreliable rather than slow.

## Design

Every Kotlin test that needs a compiled program or a live JVM takes it from
one warm-up shared across the test binary, `kotlin::compile::warm` and the JVM
pool, rather than starting its own, and every Swift test that needs a built
program shares one build of the fixture sources. A test that measures pool
behaviour asserts on the JVM counters the module already exposes, `jvms_started`
and `live_jvms`, under an emptied pool it controls, and never on elapsed time.

Where a test still needs a cold start to prove its claim, the claim is tested
against a small configured limit rather than a real toolchain run, in line
with the sandbox's other limit tests.

The nextest bound stays where it is.

## Done when

- [ ] A full `cargo nextest run -p test-cabinet-gg` passes while another
      workspace build runs on the machine, with no Kotlin or Swift test marked
      slow.
- [ ] Each Kotlin and Swift substrate test finishes in a few seconds alone.
- [ ] `.config/nextest.toml` is unchanged.
- [ ] Gates green.
