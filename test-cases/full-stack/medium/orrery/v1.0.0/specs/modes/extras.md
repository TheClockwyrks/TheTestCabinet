# Orrery — Extras

Extras is one of the two ways to play, reached from the `EXTRAS` item on the
title menu. It is a fixed shelf of standalone challenges, open from the
start, for a player who wants a particular kind of problem rather than a
course. The course itself is the campaign of `specs/modes/campaign.md`.

The rules of play are the same everywhere: a challenge opens the editor of
`specs/editor.md`, machines run under `specs/simulation.md`, and a challenge
is solved by a run that completes.

## The shelf

The Extras hold exactly `EXTRA_COUNT` (`10`) challenges, numbered `1` through
`10`. `specs/challenges.md` is authoritative for every one of them: build
each exactly as written there, in that order, with nothing substituted or
reworked.

Every Extras challenge ships a reference solution, exactly as the campaign's
challenges do: legal, complete, and completing without a fault when run,
reachable through the surface `specs/instrumentation.md` defines and never
shown as part of play.

## Progression

- Every challenge is unlocked from the start. There is no order to respect
  and nothing to unlock.
- Completing a challenge marks it solved for the session. Each challenge
  keeps its records: the best `cost`, the best `cycles`, and the best `area`
  over the session's completed runs of it, each metric independently.
- Machines persist per challenge for the session, as `specs/editor.md`
  states. Progress and records are not carried between sessions.

## The select screen

Choosing `EXTRAS` on the title menu goes to the select screen in extras mode.
It lists the ten challenges in order, each row showing its number, its name,
and whether it is solved, with solved readable without relying on hue alone.
A solved row also shows its records. One row is highlighted, drawn distinctly
from the rest. On arriving at the screen the highlight sits on the challenge
most recently entered or solved, and on challenge `1` before any has been
entered.

`up` and `down` move the highlight by one row, wrapping at both ends.
`confirm` opens the highlighted challenge in the editor. `back` returns to
the title.

Completing a challenge shows the solved panel `specs/ui.md` defines, whose
choices lead onward: the next challenge, the same machine again, or back to
this screen.
