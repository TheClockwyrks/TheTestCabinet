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
C#     using Gg;        →  Files.WriteFile(…)     unshortened  Gg.Files.WriteFile(…)
Rust   use gg::files;   →  files::read_file(…)    unshortened  gg::files::read_file(…)
```

Both are the form their arm is converting to. PureScript is the one arm holding
the condition today, with a program writing `import Gg.Files as Gg.Files` for
every module it calls. Every other arm puts its SDK in a program's scope before
the program compiles, through a prelude, a precompiled header, a re-exported
import, a `global using` or a scope handed to an evaluator, and each arm's page
states which of those its own is.

What survives a converted arm without a line is package availability: a classpath
entry, an extern prelude, an include path, a linked archive. That is how a
compiler is told the library exists, and it declares no name. A
[documentation view](/gg/responses-as-code/views/) quotes the line beside the
symbol it reaches, and says the symbol is in scope already on an arm with no line
to write.

## What a refused call raises

A refused call raises the arm's own gg failure type, the one every failed call
raises. It carries three fields.

- `code` is `unavailable`.
- `tool` carries the key of the operation the program reached for: `read_file`
  for `gg.files.readFile`, `read_text_file` for `gg.files.readTextFile`. The
  field's name belongs to the failure type every call shares; what a refusal
  puts in it is an operation key, so a `catch` branches on the call that was
  refused rather than on prose.
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

Nine arms record an uncaught refusal as `program_unknown_name`, and the host
decides that from the failure's code rather than from the guest's own reading.
Two arms report differently.

- C# reports every uncaught managed exception with kind `other` and no code, so
  an uncaught refusal is recorded as `program_throw`, as is an uncaught
  `not-found`.
- Swift's guest shell has no top-level `throws` context to wrap, so an uncaught
  error arrives as a sandbox trap.

The refusal itself is recorded identically on all eleven arms, so a study
counting what an agent reached for and was not granted reads the refusal roster
rather than the turn's error type.

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
