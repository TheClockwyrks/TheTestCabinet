# Volute — Machinery

This file defines the four machinery kinds, the marks that grant them, and the
rule that decides which one is active. The train, its advance, and its spacing
are in `specs/channel.md`, and what an extraction pays is in
`specs/extraction.md`.

## Marks

The cores of a level are counted in the order `specs/channel.md` gives them,
the twelve seeded at level start first and then each core the inlet emits. Every
`MARK_INTERVAL` (12) cores in that count, the 12th, 24th, 36th and so on, one
core carries a **mark**. The count restarts whenever a level starts, a level
restarted after a lost cell included.

A mark names one machinery kind, and the kinds follow a fixed cycle: `choke`,
`backflow`, `bore`, `sightline`, then `choke` again. The first mark of a level
names `choke`, and the cycle position restarts with the count.

A mark is drawn on the core carrying it and travels with that core wherever the
core moves. The four marks are distinguishable from one another and from an
unmarked core.

## Granting

A run extracted while it contains a marked core grants that core's machinery on
the tick of the extraction. When one extracted run carries more than one marked
core, each is granted in train order from the head, so the mark nearest the tail
decides what is left active. Extraction is the only source of a grant, and a
marked core a bore removes grants nothing.

## The four kinds

| Kind        | Effect                                                                                            | Duration |
| ----------- | ------------------------------------------------------------------------------------------------- | -------- |
| `choke`     | The feed speed is multiplied by `0.4`                                                             | `8` s    |
| `backflow`  | Every core moves toward the inlet at `BACKFLOW_SPEED` (`60`) units/s, and the inlet emits nothing | `5` s    |
| `bore`      | Every core within `BORE_RADIUS` (`90`) units of the extraction point is removed and scored        | instant  |
| `sightline` | The aim ray is drawn from the injector to the first core or field edge it meets                   | `12` s   |

## Choke

Choke multiplies the feed speed by `0.4` for as long as it is active.
It changes that rate alone: catch-up, recoil, merging, emission, and the rise
and bleed of pressure all hold at the rates they otherwise take.

## Backflow

While backflow is active every core on the channel moves toward the inlet at
`BACKFLOW_SPEED`, in place of the advance it would otherwise make, whatever
segment it belongs to, whatever the feed speed, and whatever recoil hold it
carries, and the inlet emits no core. Each core stops at the channel spacing
ahead of the core behind it, and the tail core stops at arc position `0`, so the
train packs against the inlet and holds there for the remainder of the duration.
A core standing below arc position `0` holds where it stands. Cores resume their
ordinary advance, and the inlet resumes emitting, on the tick backflow ends.

## Bore

Bore takes effect on the tick it is granted and occupies no time. The
**extraction point** is the field position the marked core held at the moment
its run was extracted, and bore removes every core whose center lies within
`BORE_RADIUS` of that point, measured as straight-line distance across the
field. Those cores are removed together and score as `specs/extraction.md`
states, and they cause no extraction of their own.

## Sightline

While sightline is active a ray is drawn from the injector's center along the
current aim heading. It ends where it first crosses the edge of a core, or at
the field edge when it crosses none. The ray is recomputed every tick, so it
follows the aim as the aim turns.

## The active machinery

At most one of `choke`, `backflow` and `sightline` is active at a time. A grant
of any of the three becomes the active machinery, replacing whatever was active
and starting its full duration afresh, including a grant of the kind already
active. Its remaining time falls with simulation time while play advances, and
the machinery ends the moment that time reaches `0`. `bore` never becomes the
active machinery and leaves the active machinery and its remaining time
untouched.
