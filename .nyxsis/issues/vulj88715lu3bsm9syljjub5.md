---
format: nyxsis-issue
version: 2
id: vulj88715lu3bsm9syljjub5
zone: GGH
number: 1
title: Keep the JVM and Swift sandbox tests inside their bound under load
type: generic
state: open
created: 2026-10-13T21:12:15.98783677Z
---

In a full `cargo nextest run -p test-cabinet-gg` while another build runs on
the machine, a shifting handful of Kotlin and Swift sandbox tests reach
nextest's termination bound and fail the run, because each starts its own JVM
or `swiftc` build from cold. Run alone they pass. A flaky test is a failing
test: `.claude/skills/coding/SKILL.md`, and the sandbox's limits are described
in `apps/docs/src/content/docs/gg/execution-limits.md`.

The tests concerned are the Kotlin `isolation::tests::gate::program::kotlin`,
the `kotlin::substrate` group and the Swift substrate group.

## What is missing

Every Kotlin test that needs a compiled program or a live JVM takes it from
one warm-up shared across the test binary, `kotlin::compile::warm` and the
JVM pool, and every Swift test that needs a built program shares one build of
the fixture sources. A test of pool behaviour asserts on the `jvms_started`
and `live_jvms` counters under an emptied pool it controls, never on elapsed
time. A test that needs a cold start proves its claim against a small
configured limit rather than a real toolchain run. `.config/nextest.toml` is
unchanged.

## Verify

A full `cargo nextest run -p test-cabinet-gg` passes while another workspace
build runs on the machine, with no Kotlin or Swift test marked slow, and each
Kotlin and Swift substrate test finishes in a few seconds alone.
