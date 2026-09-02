# Orrery — Campaign

Campaign is one of the two ways to play, reached from the `CAMPAIGN` item on
the title menu. It is a course of hand-designed challenges worked through in
order, and designing that course is part of this build: the challenges are
yours to author, to the requirements below. The other way to play is the
fixed Extras set of `specs/modes/extras.md`.

The rules of play are the same everywhere: a challenge opens the editor of
`specs/editor.md`, machines run under `specs/simulation.md`, and a challenge
is solved by a run that completes. This file defines the course, its
progression, and its select screen. Every figure and every piece of screen
copy below carries the name this specification gives it.

## The course

The campaign holds between `CAMPAIGN_MIN` (`8`) and `CAMPAIGN_MAX` (`16`)
challenges, authored as fixed data in the challenge format of
`specs/formats.md` and shipped in the build. The count is yours to choose
within those bounds; the set is the same in every session, in a fixed order,
numbered from `1`.

Every challenge of the course satisfies all of the following:

- It is well formed under `specs/formats.md` and carries a name of its own,
  distinct from every other challenge's in the course.
- It is solvable: the build ships a reference solution for it, in the
  solution format, that is legal, places every rise and set, and whose run
  completes without faulting within `CAMPAIGN_REFERENCE_CYCLES` (`600`)
  cycles of the run's start. The reference solutions are part of the build
  and are reachable only through the surface `specs/instrumentation.md`
  defines.
- Difficulty rises across the course. The reference solution for challenge
  `1` places at most `CAMPAIGN_OPENER_PARTS` (`3`) parts, the reference
  solution for the last challenge places at least `CAMPAIGN_FINALE_PARTS`
  (`8`) parts, and no challenge's reference solution places fewer parts than
  the reference solution two challenges before it.

Across the course as a whole, every part kind in `PARTS` appears in at least
one challenge's tray, and every part kind is placed by at least one reference
solution.

## Course design

- A sigil or mechanism appears first in a challenge whose solution turns on
  it, and appears beside others only in later challenges.
- A challenge's tray admits at least two machines that complete it.
- The course covers all three kinds of pressure across its challenges: reach
  and geometry, timing several arms against one shared period, and chains of
  transmutation.
- A product delivered by an earlier challenge appears as a reagent or a
  product of a later one.
- The last challenge of the course asks for more parts and a longer tape than
  any before it.

## Progression

- Challenge `1` is unlocked from the start. Every other challenge begins
  locked.
- Completing challenge `n` unlocks challenge `n + 1` when the course holds
  one. A challenge stays unlocked, and stays marked solved, for the rest of
  the session.
- Completing a challenge again is a replay. Each challenge keeps its records:
  the lowest `cost`, the lowest `cycles`, and the lowest `area` over the
  session's completed runs of it, each metric independently.
- Machines persist per challenge for the session, as `specs/editor.md`
  states.

## The select screen

Choosing `CAMPAIGN` on the title menu goes to the select screen in campaign
mode. It lists every challenge of the course, in order, each row showing its
number, its name, and its state, with the state readable without relying on
hue alone:

| State | Meaning |
| --- | --- |
| locked | Not yet reached. Cannot be entered. |
| unlocked | Reached and not yet solved. Can be entered. |
| solved | Completed at least once. Can be entered again. |

A solved row also shows its three records, `cost`, `cycles`, and `area`, each
labelled. An unsolved row shows none. One row is highlighted, drawn
distinctly from the rest. On arriving at the screen the highlight sits on the
challenge most recently entered or solved, and on challenge `1` before any
has been entered.

`up` and `down` move the highlight by one row, wrapping at both ends.
`confirm` on an unlocked or solved challenge opens it in the editor;
`confirm` on a locked one does nothing. `back` returns to the title.

Completing a challenge shows the solved panel `specs/ui.md` defines.
