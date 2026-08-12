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
| Tool | The run enabled the named gg tool. |
| Ending | The agent was dispatched in the named [ending role](/gg/ending-a-session/). |
| Capability | The agent holds the named gg capability. |
| Always | Every program has it. |

An agent's grant is the other half of the pair: the gg tools its run enabled,
the ending role it was dispatched in, and the gg capability ids it was given.
Each kind of binding is answered by the half of the grant that can answer it. A
withheld tool stays withheld for an agent holding every capability, and an
ending belonging to another role stays withheld for an agent holding every tool.

`crates/gg/src/sandbox/operations.rs` carries the operations table and the
predicate over it, and one helper there turns a run's resolved flags into the
capability ids a grant holds, so the membrane's grant and the documentation
runtime's are built from one list. A gg capability id is written down in that
table and nowhere else: an SDK declares none and a signature catalogue carries
none.

## The compile-time surface and the discovery surface

The compile-time surface is the language's. Every function is in the SDK, so a
compiled arm compiles a call the agent cannot use and gg's TypeScript checker
type-checks one. The checker reads a program against the whole catalogue, so a
verdict depends on the program alone.

The discovery surface is the grant's. A documentation search returns only what
this agent may call, and a documentation view describes only what this agent may
call.

A program can therefore compile a call search would never have shown it. One
condition makes that safe, and every arm holds it:

:::note
Every gg function is reached through a qualifier or an import that names gg. A
call the agent cannot make reads as a qualified path rather than as an ordinary
bare name.
:::

Per arm, the qualifier is held like this:

| Arm | How a call is written | What holds the condition |
| --- | --- | --- |
| TypeScript, JavaScript | `gg.files.readFile(…)` | The guest binds modules, and a gg function is a property of one. |
| Python | `files.read_file(…)`, `gg.files.read_file(…)` | The scope binds capability modules; the functions live on them. |
| Ruby | `GG::Files.read_file(…)` | Module functions on constants under `GG`. |
| Rust | `files::read_file(…)` | The prelude glob-imports the modules, not their contents. |
| C++ | `files::read_file(…)` | The prelude's `using namespace gg;` elides `gg::` and nothing else. |
| C# | `Files.ReadFile(…)` | `global using Gg;` puts the namespace in scope, and each module stays a type. |
| Java | `Files.readFile(…)` | One type-import-on-demand per module puts that module's class in scope. |
| Kotlin | `gg.files.readFile(…)` | A program writes the fully-qualified name, or imports it itself. |
| Swift | `files.readFile(…)` | `@_exported import gg` re-exports the module enums; the functions are inside them. |
| PureScript | `Gg.Files.readFile` | Modules are imported by the program. |

## What a withheld call raises

A withheld call raises the arm's own gg failure type, the one a failed tool
raises. It carries three fields.

- `code` is `unavailable`.
- `tool` is gg's own key for the operation: `read_file` for `gg.files.readFile`
  and `read_text_file` for `gg.files.readTextFile`. It is the operation's key
  rather than the gg tool the call would have dispatched, because several
  operations share one tool and a refusal has to say which of them the model
  reached for.
- `message` names what is missing, written in this program's own spelling of the
  call.

There is one sentence per kind of gate. A tool binding names the gg tool this
run's toolset leaves out:

```
`gg.files.readFile` is not available to you: it is bought by the gg tool
`read_file`, which this run's toolset does not offer.
```

A capability binding names the capability id and what holding it would buy:

```
`gg.programs.history` is not available to you: it is bought by the
`program-library` capability, which this agent was not given — this agent keeps
no library of the programs it has run.
```

An [ending call](/gg/ending-a-session/) belonging to another role names the
endings the agent does have, so an agent that reached for the wrong one ends its
session on the next line:

```
`gg.session.finish` is not available to you: you were dispatched to review
work, so your session ends with a verdict — `gg.session.approve`, or
`gg.session.requestChanges` naming every change the work needs.
```

## The turn error for an uncaught refusal

Nine arms record an uncaught refusal as `program_unknown_name`, and the host
decides that from the failure's code rather than from the guest's own reading.
Two arms report differently.

- C# reports every uncaught managed exception with kind `other` and no code, so
  an uncaught refusal is recorded as `program_throw`, as is an uncaught
  `not-found`.
- Swift's guest shell has no top-level `throws` context to wrap, so an uncaught
  error arrives as a sandbox trap.

The refusal itself is recorded identically on all eleven arms, so a
[toolset ablation](/gg/toolset-ablation/) counts withheld reaches from the
refusal roster rather than from the turn's error type.

## Argument lowering on the interpreted arms

On TypeScript, JavaScript, Python and Ruby a call's arguments are lowered inside
the guest, before the call crosses into the host, and the gate sits on the host
side of that crossing. A call that is both withheld and malformed therefore
fails on the malformed half, inside the guest, and reaches neither the host nor
the refusal roster. The other seven arms are compiled, so an argument of the
wrong type is a compile error and no program runs at all.

## What the guest is handed

The guest's `run` export takes the run's enabled tool names, the agent's ending
kind and the program-library flag. Every guest ignores all three, because the
membrane answers the question each of them was for. They stay in the WIT world
because all eleven guests implement it.
