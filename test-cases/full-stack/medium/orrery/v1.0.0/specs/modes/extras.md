# Orrery — Extras

Extras is one of the two ways to play, reached from the `EXTRAS` item on the
title menu. It is a fixed shelf of standalone challenges, open from the
start. The course itself is the campaign of `specs/modes/campaign.md`.

The rules of play are the same everywhere: a challenge opens the editor of
`specs/editor.md`, machines run under `specs/simulation.md`, and a challenge
is solved by a run that completes.

## The shelf

The Extras hold exactly `EXTRA_COUNT` (`10`) challenges, numbered `1` through
`10`. `specs/challenges.md` is authoritative for every one of them: build
each exactly as written there, in that order.

Every Extras challenge ships a reference solution under the requirement
`specs/modes/campaign.md` states for a course challenge, reachable through
the surface `specs/instrumentation.md` defines.

## Progression

- Every challenge is unlocked from the start and can be entered in any order.
- Completing a challenge marks it solved for the session, and each challenge
  keeps its records as `specs/modes/campaign.md` states.
- Machines persist per challenge for the session, as `specs/editor.md`
  states.

## The select screen

Choosing `EXTRAS` on the title menu goes to the select screen in extras mode.
It lists the ten challenges in order, each row showing its number, its name,
and whether it is solved, with solved readable without relying on hue alone.
Every row can be entered. The highlight, its movement, its resting position
on arrival, the records a solved row shows, and `confirm` and `back` are as
`specs/modes/campaign.md` states them.

Completing a challenge shows the solved panel `specs/ui.md` defines.
