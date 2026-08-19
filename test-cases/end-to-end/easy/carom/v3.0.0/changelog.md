## The case supports the Simple 2D engine

A run now selects an **engine** — the runtime the produced game is built on —
alongside its model, harness, and variant, and this version declares two:
`none`, the runtime-less baseline every earlier version of Carom assumed, and
`simple-2d`. What the case declares is support and nothing else. An engine is not
part of the game: it ships its own documentation from its own package, seeded
into the run beside the specs, so nothing under this version describes an
engine's API and nothing here falls out of date when one changes.

Under `none` the case asks for exactly the game `v2.1.0` asked for. The build
writes its own frame loop, reads its own keyboard events, drives its own Web
Audio graph, and draws its own debug overlay, and the rendered prompt is
unchanged to the byte.

## What the engine owns, and what the build still owns

Under `simple-2d` four surfaces the build used to write for itself belong to the
engine instead: the frame loop, which hands the game the real elapsed time of
each frame rather than the mandated fixed timestep; keyboard input, registered as
named actions and read as held values and consumed edges rather than out of key
events; audio, played as named cues on the engine's bus rather than through a
hand-built oscillator graph; and the debug overlay, drawn by the engine from the
diagnostic sources the game registers.

What stays the build's is the game. `window.__carom` still carries `reset`,
`snapshot`, and the control operations that pose a scenario — `startMatch`,
`serve`, `setScore`, `setPaddle`, `setBall`, `setAiControl`, and gyre's
`setObstacleClock` — because each of those speaks about Carom's own world, which
no engine can know about. What they no longer sit beside are `step`,
`setAutoStep`, `keyDown`, `keyUp`, and `press`: the engine's host interface
drives the clock and the actions, so the build is not asked for them twice.

## A tick means the same thing under both engines

`tick_hz` stays 120, and the sameness is the point. Under `none` it is the fixed
simulation timestep the specification mandates. Under `simple-2d` the engine
mandates no timestep at all, and 120 Hz is the rate the engine host's manual
clock steps at by default, so one step is one scheduled frame of 1/120 of a
second. Holding the two equal is what keeps every tick-counted assertion in this
case's validation saying the same thing whichever runtime is underneath: 120
steps is a second of game time either way.

## Scoring

No review item, weight, domain, reference, or proof was added, removed, or
renumbered, so this version's total declared weight is `v2.1.0`'s and a score
recorded under `simple-2d` is computed against exactly the checklist a score
under `none` is. The seeded specification branches on the selected engine, but
only to say which of these surfaces the build itself supplies; what the finished
game must do is unchanged, and so is what a reviewer grades it against.

## The reference implementation is addressed per engine

The build a reference implementation demonstrates is a genuinely different build
under each engine, so the variant key is now keyed by engine slug. The `base`
variant carries both: `reference-impl/base`, carried forward unchanged, for
`none`, and a new `reference-impl-simple-2d/base` written against the engine.
Validation baselines follow the same split, captured from the engine's own
reference implementation. `gyre` and `multi` have their `none` builds only for
now and keep the single-implementation form until their engine builds are
authored.
