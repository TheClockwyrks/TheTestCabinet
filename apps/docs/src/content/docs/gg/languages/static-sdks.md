---
title: "Static SDKs"
---

Every arm's SDK is static: every function it declares is compiled, linked and
callable in every program, whatever the run enabled, whatever role the agent was
dispatched in, and whatever capabilities it holds. Calling something the agent
was not granted returns a refusal from the host.

## Operations, bindings and grants

gg names every model-facing call an operation, under a `namespace.key` identity
of its own rather than any arm's spelling, and states once what buys it. That is
the operation's binding, and there are four kinds.

| Binding | What buys the operation |
| --- | --- |
| Capability | The agent holds the named gg capability, and its [allowlist](/gg/configurations/#granting-calls) names this operation. |
| Ending | The agent was dispatched in the named [ending role](/gg/ending-a-session/). |
| Machine | The agent stands in a [machine](/gg/fsms/) state with somewhere to go. Its one member is `delegation.transition_state`, which a configuration cannot grant. |
| Always | Every program has it. |

An agent's grant is the other half of the pair: the gg capability ids it was
given, the operation ids its allowlist grants, the ending role it was dispatched
in, and the machine state it stands in. Each kind of binding is answered by the
half of the grant that can answer it, and nothing falls back. An operation whose
capability is off stays refused however the allowlist reads, and an ending
belonging to another role stays refused for an agent holding every capability gg
has.

The tool vocabulary decides none of this. A program's grant is stated in
operation ids from end to end, and a gg tool name is neither writable in a
program nor readable by this gate.

`crates/gg/src/sandbox/operations.rs` carries the operations table and the
predicate over it, so the membrane's grant and the documentation runtime's are
built from one list. A gg capability id is written down in that table and nowhere
else: an SDK declares none and a signature catalogue carries none.

## The compile-time surface and the discovery surface

The compile-time surface is the language's. Every function is in the SDK, so a
compiled arm compiles a call the agent cannot use and gg's TypeScript checker
type-checks one. The checker reads a program against the whole catalogue, so a
verdict depends on the program alone.

The discovery surface is the grant's. A documentation search returns only what
this agent may call, and a documentation view describes only what this agent may
call.

A program can therefore compile a call search would never have shown it. One
condition makes that safe, and an arm is registered under it:

:::note
No gg name is available unqualified without a line the model wrote. An import
may shorten a name, and nothing makes a name reachable that was not.
:::

The line is written in that language's own idiom, and shortening a name is what
it buys:

```text
TypeScript  import * as gg from "gg";        →  gg.files.readFile(…)
JavaScript  import * as gg from "gg";        →  gg.files.readFile(…)
PureScript  import Gg.Files as Gg.Files      →  Gg.Files.readFile(…)
Python      import gg                        →  gg.files.read_file(…)
Ruby        require "gg"                     →  GG::Files.read_file(…)
Rust        use gg::files;                   →  files::read_file(…)   unshortened  gg::files::read_file(…)
Java        import gg.files.Files;           →  Files.readFile(…)     unshortened  gg.files.Files.readFile(…)
Kotlin      import gg.files.*                →  readFile(…)           unshortened  gg.files.readFile(…)
Swift       import gg                        →  files.readFile(…)     unshortened  gg.files.readFile(…)
C++         #include <gg/files.hpp>          →  gg::files::read_file(…)
C#          using Gg;                        →  Files.ReadFile(…)     unshortened  Gg.Files.ReadFile(…)
```

Every arm holds the condition, and every module of every arm states its own line.
The lines differ in what they buy: a C++ `#include` declares a name rather than
shortening one, a Swift `import gg` is the one line that reaches gg's Swift module
at all, and a Python program writes `import gg` and then the fully-qualified name
the documentation is keyed by.

What an arm may be given without a line is package availability: a classpath
entry, an extern, an include path, a linked archive. That is how a compiler is
told the library exists, and it declares no name. A
[documentation view](/gg/responses-as-code/views/) quotes the line beside the
symbol it reaches.

## What a refused call raises

A refused call raises the arm's own gg failure type, the one every failed call
raises. It carries three fields.

- `code` is `unavailable`.
- `operation` carries the key of the operation the program reached for:
  `read_file` for `gg.files.readFile`, `read_text_file` for
  `gg.files.readTextFile`, so a `catch` branches on that key.
- `message` says the call is not available, written in this program's own
  spelling of it.

The message says what is unavailable and, where the agent has one, which call to
make instead. It says nothing about what would unlock the call. The profile was
fixed before the session began and no program can edit it, so naming the missing
capability or allowlist entry would describe the one thing in the model's
situation it cannot change, and invite it to spend a turn trying.

A capability or allowlist gate has no alternative to offer:

```
`gg.programs.history` is not available.
```

An [ending call](/gg/ending-a-session/) belonging to another role does, so an
agent that reached for the wrong one ends its session on the next line:

```
`gg.session.finish` is not available. Use `gg.session.approve` or
`gg.session.requestChanges` instead.
```

## The turn error for an uncaught refusal

The refusal is recorded identically on all eleven arms, so a study counting what
an agent reached for and was not granted reads the refusal roster. The
[turn error type](/gg/telemetry/turn-outcomes/) an uncaught refusal ends the turn
with is an arm-by-arm answer, because it is decided by how the arm's runtime
kills a program that does not catch one.

An arm whose guest reports the throw to the host before it dies carries the
failure's code across, and the host files the turn as `program_unknown_name`. An
arm whose program dies the way its runtime kills it reports nothing to the host
and the turn is filed as `sandbox_trap`. C# reports every uncaught managed
exception with kind `other` and no code, so its refusals are filed as
`program_throw`.

`crates/gg/src/sandbox/language/g8.rs` carries the eleven-arm table of what each
arm files each failure shape as, and every cell of it is driven.

## Argument lowering on the interpreted arms

On TypeScript, JavaScript, Python and Ruby a call's arguments are lowered inside
the guest, before the call crosses into the host, and the gate sits on the host
side of that crossing. A call that is both refused and malformed therefore
fails on the malformed half, inside the guest, and reaches neither the host nor
the refusal roster. The other seven arms are compiled, so an argument of the
wrong type is a compile error and no program runs at all.

## What the guest is handed

The guest's `run` export takes the operation ids this agent is granted, its
ending kind and the program-library flag. Every guest ignores all three, because
the membrane answers the question each of them was for. They stay in the WIT
world because all eleven guests implement it.
