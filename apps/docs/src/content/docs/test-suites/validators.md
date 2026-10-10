---
title: "Validators"
---

Validators programmatically verify an implementation. Functional requirements
require them, and each validator is claimed by exactly one requirement. A
requirement may claim multiple validators.

Validators are implemented more like unit tests than integration tests and must
run extremely quickly. The majority of validators for a test suite finish well
under one second.

## A validator is a function

A validator is a regular exported function that takes a debug API instance and
returns assertion results.

```ts
// validators/ball/constant-speed.ts
import type { CaromDebugApi, AssertionResult } from "../debug-api";

export default function constantSpeed(debug: CaromDebugApi): AssertionResult[] {
  debug.ball.place({ x: 0, y: 0 });
  debug.ball.launch({ x: 1, y: 0 });
  const before = debug.ball.state().speed;
  debug.sim.step(60);
  const after = debug.ball.state().speed;
  return [
    { name: "speed is unchanged after 60 ticks", passed: before === after },
  ];
}
```

An `AssertionResult` carries the assertion's `name`, whether it `passed`, and an
optional `detail` string explaining a failure. The Test Cabinet renders the
returned list, so a user sees each assertion that ran and its result.

## Callers

Two callers drive the same validator function.

The first is a Vitest test that tests the validator itself, driving it against a
known implementation so the suite proves the validator decides what it claims
to. The second is a Vitest test that validates a model's implementation, driving
the validator against the produced build during a run.

## Granularity

A validator returns one assertion result per condition it checks. An
implementation that satisfies two of three conditions is therefore distinguished
from one that satisfies none, while the requirement continues to name a single
validator module.

## Layout

Validators live under `validators/`, a complete Vitest project rooted at that
directory and configured by its own `vitest.config.ts`.

```text
validators/
  vitest.config.ts
  ball/constant-speed.ts        # the validator function
  ball/constant-speed.test.ts   # the validator's own test
```

A validator is identified by its module path relative to `validators/`, which is
exactly the string a requirement lists in its `validators` key. Each path is
claimed by exactly one requirement across the whole suite.

## Execution

The validator project runs against the static build the
[test case definition's](/test-suites/test-case-definition/) `[build]` commands
produce in the model's workspace. The build is served and the Vitest project
runs in browser mode against the served page, so a validator drives and observes
the running implementation in the same document that hosts it. The debug API
root is reached from that page's `globalThis` through the handle the debug API
declares.

`vitest.config.ts` declares `validators/` as the project root, the browser-mode
configuration the served build is loaded under, and the test include pattern
covering `<path>.test.ts` files under that root. The validator project runs
standalone from its own directory, so it declares everything it needs to locate
the served build itself.

## Driving the implementation

Every validator of a model-written implementation reaches it only through the
[debug API](/test-suites/debug-apis/). A validator issues the commands that
arrange the state its requirement describes, then reads that state back through
queries and decides the requirement on what it read.

The debug API is engine-independent, so a validator states the condition its
requirement describes rather than the mechanics of the engine under it. One set
of validators therefore serves every engine a test case runs on.

## What a result decides

A validator decides the requirement it is claimed by. A requirement passes for a
run when every validator claimed by it passes and every assertion those
validators return passed, and fails otherwise. Requirement outcomes are what a
test case result reports.

Non-functional requirements declare no validators and are graded by review
rather than by a test result.
