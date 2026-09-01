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

- It is well formed under `specs/formats.md`, with `target`
  `CONSTELLATION_TARGET` (`6`), and carries an original name of its own.
- It is solvable: the build ships a reference solution for it, in the
  solution format, that is legal, places every rise and set, and whose run
  completes without faulting. The reference solutions are part of the build,
  reachable through the surface `specs/instrumentation.md` defines, and are
  never shown as part of play.
- Difficulty rises across the course. Early challenges are solvable with a
  handful of parts and short tapes; later ones ask for real machinery.

Across the course as a whole, every part kind in `PARTS` appears in at least
one challenge's tray, and every part kind is placed by at least one reference
solution. The course, taken end to end, exercises the entire machine
vocabulary: every sigil, every arm variant, the wheel, the piston, and track.

## A course worth playing

A legal course is the floor, not the goal. The campaign is where a player
learns this game, so its design is part of the work:

- Introduce ideas one at a time, and put each new sigil or mechanism in a
  challenge that is about that idea before it appears in crowds.
- Make the player deduce. A challenge whose machine is dictated by the tray
  teaches less than one with two shapes of answer.
- Vary the pressure. Some challenges should be about reach and geometry, some
  about timing several arms, some about transmutation chains.
- Let products build on earlier ones, so the course reads as one ascent
  rather than a list.
- End with a challenge that earns the word finale.

## Progression

- Challenge `1` is unlocked from the start. Every other challenge begins
  locked.
- Completing challenge `n` unlocks challenge `n + 1`. A challenge stays
  unlocked, and stays marked solved, for the rest of the session.
- Completing a challenge again is a replay. Each challenge keeps its records:
  the best `cost`, the best `cycles`, and the best `area` over the session's
  completed runs of it, each metric independently.
- Machines persist per challenge for the session, as `specs/editor.md`
  states. Progress and records are not carried between sessions.

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

A solved row also shows its records. One row is highlighted, drawn distinctly
from the rest. On arriving at the screen the highlight sits on the challenge
most recently entered or solved, and on challenge `1` before any has been
entered.

`up` and `down` move the highlight by one row, wrapping at both ends.
`confirm` on an unlocked or solved challenge opens it in the editor;
`confirm` on a locked one does nothing. `back` returns to the title.

Completing a challenge shows the solved panel `specs/ui.md` defines, whose
choices lead onward: the next challenge, the same machine again, or back to
this screen.
