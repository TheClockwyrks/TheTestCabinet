---
title: "Game Design"
---

Since The Test Cabinet test cases are always based on games, The Spec Cabinet's
UI is designed to assist users in designing games. This functionality integrates
with The Spec Cabinet's agentic harness to allow agents to edit code, and builds
demonstrations on the development machine hosting The Spec Cabinet.

The Spec Cabinet generates mini-projects that visually demonstrate a game
mechanic directly within its UI. Users see a mechanic in action without setting
up and triggering that mechanic in-game themselves, so a mechanic can be
evaluated before a full implementation of the game exists.

## Mechanic demonstrations

A mechanic demonstration is a Vite project that builds to a static bundle. The
Spec Cabinet embeds that bundle directly in its UI, the same way a run's
produced implementation is played in The Test Cabinet's UI. A demonstration
implements only the code its mechanic needs, so it is a short sequence showing
what that mechanic looks like in practice and a different artifact from a
[reference implementation](/test-suites/reference-implementations/).

The demonstrations of a suite share one TypeScript library, so logic more than
one demonstration needs is written exactly once and every demonstration behaves
the same way where they overlap.

Demonstrations are suite content, authored in a draft under `demos/` and each
naming the specification whose mechanic it demonstrates. A demonstration builds
and plays from its draft, so a mechanic is evaluated while the rest of the draft
is still incomplete. A demonstration kept in a draft ships with every version
exported from it to The Test Cabinet's UI, where it explains to users how that
mechanic is expected to work. A demonstration that should not be kept is removed
from the draft. The on-disk format is owned by
[Demonstrations](/test-suites/demonstrations/).
