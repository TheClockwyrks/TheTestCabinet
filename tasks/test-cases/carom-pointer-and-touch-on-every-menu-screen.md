# Carom Grades Pointer And Touch On Every Menu Screen

`test-cases/end-to-end/easy/carom/v3.0.0` grades each pointer and touch behavior
on each menu screen its specification drives.

## Current behaviour

`specs/ui.md` drives four menu screens, `title`, `howto`, `paused`, and
`matchover`, by the keyboard, by a mouse, and by touch, over the items that
screen shows.

`test-case.toml` gives the `pointer` category three items and the `touch`
category three, and grades all six on the title menu alone. Both category
comments state the choice openly, the `pointer` one as "Each is graded on the
title menu, where the entries confirm to screens a check can read straight off
`screen`."

That is a reachability argument. A build that wires its pointer and touch
handling into the title menu and leaves the other three menu screens on the
keyboard alone is an ordinary half-finished build, and it scores exactly what a
build that wired all four scores. Whether a screen's menu is in the hit test,
whether a gesture's confirm reaches that screen's own entry table, and whether
that screen pairs the two edges are decided separately per screen in a build the
case never tells how to divide its input code.

`pointer/slide-off-cancels` is also posed so that a build reading no pointer at
all satisfies it for free. It presses inside one item and releases inside
another, and the only reading it takes is that `screen` stayed on the title, so
nothing in it distinguishes a build that paired the two edges from one with no
mouse code. `touch/drag-cancels` already reads the selection that followed the
contact alongside the screen, and is the shape the pointer point wants.

## Design

`test-cases/end-to-end/easy/spectra/v2.0.0` carried the same structure and the
same title-only argument, and now grades the six behaviors on each of its three
menu screens. Give carom the same treatment against its four.

Each id is screen-qualified, matching the `title-`, `howto-` and `pause-`
convention carom's own `navigation` category already uses. The screens past the
title are posed through the debug API by a shared helper per screen in each
`validation/<engine>/harness.ts`, so a check reads the effect of a confirm on a
screen whose entries land somewhere other than `screen`.

Each cancel item lands on the item the highlight already holds, travels to
another and releases or lifts there, and reads back both that the screen held and
that the highlight followed. That pair of readings is one a build with no pointer
or touch code cannot produce.

The manifest comments argue the new scope, every count the case states about its
own checklist matches the manifest, and each new output has captured baselines.

## Done when

- [ ] Each pointer and touch behavior is graded on each menu screen driven.
- [ ] Each cancel item reads that the screen held and that the highlight followed.
- [ ] Each new item has a script under every engine project and captured baselines.
- [ ] Every count the case states about its own checklist matches the manifest.
- [ ] Gates green.
