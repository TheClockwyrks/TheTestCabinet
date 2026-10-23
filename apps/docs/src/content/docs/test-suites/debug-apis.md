---
title: "Debug APIs"
---

Debug APIs are the mechanism by which validators drive and validate an
implementation. A validator puts the implementation into the state a requirement
describes, then reads that state back to decide the requirement. Both halves go
exclusively through the debug API.

## API Structure

Debug APIs are defined in the test suite itself as structured data. This ensures
that test suites can be validated and all invariants for test suites themselves
can be enforced programmatically.

A debug API is a single root object. The implementation sets that object on
`globalThis` under the property name the suite declares as its `handle`, on
every engine. Validators reach the whole tree through it.

The root object consists of either functions or other debug API objects,
allowing debug APIs to be organized into modules. A debug API object therefore
can be represented as a tree whose leaf nodes are debug API objects defining
functions only.

Each function is a query or a command. A query reports state and leaves the
implementation unchanged. A command changes state and reports nothing. Declaring
which one a function is lets a suite state that its read surface is complete
independently of its control surface, and lets a validator's setup be told apart
from its assertions.

## The debug API files

A suite version declares exactly one debug API whenever it declares a test case
type whose requirements are decided by validators driving an implementation the
model wrote. Those types are `end-to-end` and `full-stack`. A suite version
declaring neither declares no debug API.

`debug-api.toml` at the root of the suite tree declares the root module. A
field that is itself a debug API module lives in its own `.toml` file, and the
parent references it by path.

```toml
# debug-api.toml
handle = "__carom"            # required; the globalThis property the root is set on
description = "The Carom debug surface."

[[module]]
name = "ball"                 # the property name the module is reached by
path = "debug-api/ball.toml"  # the file declaring it
description = "The live ball."
```

```toml
# debug-api/ball.toml
description = "The live ball."

[[function]]
name = "state"
kind = "query"
signature = "state(index: number): BallState"
description = "Reports the live ball state."

[[function.parameter]]
name = "index"
description = "Zero-based ball index."

[[function]]
name = "place"
kind = "command"
signature = "place(position: Vector2): void"
description = "Moves the ball to a field-space position."

[[function.parameter]]
name = "position"
description = "The field-space position to move the ball to."

[[module]]
name = "spin"
path = "debug-api/ball/spin.toml"
description = "Ball spin."
```

Module files live under `debug-api/`, and paths are relative to the version
folder. Each module file is referenced by exactly one parent, so the files form
the same tree the debug API does.

## Module keys

- `handle` is declared by `debug-api.toml` alone. It is the property name the
  implementation sets the root object on `globalThis` under.
- `description` states what the module covers.
- `[[module]]` declares a child module, giving the `name` it is reached by, the
  `path` to the file declaring it, and a `description`. A module declaring a
  `[[module]]` table is an interior node; a module declaring only functions is a
  leaf.

## Function keys

- `name` is the property name the function is called by, unique within its
  module.
- `kind` is `query` or `command`.
- `signature` is the function's TypeScript signature, carried as a string. It is
  copied through verbatim.
- `description` states what the function reports, for a query, or what it
  changes, for a command.
- `[[function.parameter]]` documents one parameter, giving its `name` and a
  `description`. A function documents as many of its parameters as are worth
  describing.

## Configuring state

A validator decides one requirement, which means reaching the exact state that
requirement describes. Commands are how it gets there. A suite declares a
command for every state a requirement is written against, so that a validator
arranges the state directly rather than by playing the game into it.

Commands cover placing entities, setting scores and timers, selecting a game
mode, and advancing the simulation by an exact amount. A command's effect is
immediate and complete when it returns, so a validator issues its setup
commands, steps the simulation, and reads the result back through queries
without waiting on the implementation.

Declaring a command obliges an implementation to honour it at any point a
validator may call it. An implementation that accepts a command and applies it
partially fails the requirements whose validators depend on it.

## Generated declaration

The Spec Cabinet assembles the validator-facing TypeScript declaration for the
tree by nesting the module structure and emitting each function's `signature`
string. The declaration is derived output and is regenerated from the debug API
files rather than hand-edited.
