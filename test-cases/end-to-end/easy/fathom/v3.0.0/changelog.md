## Fathom is a TypeScript project, on one of three engines

This version stops asking a model for a self-contained page built on top of a
bare `package.json` and asks it for a real project instead. A run is seeded with
a complete TypeScript workspace, with Vite, `tsc`, ESLint, Prettier and Vitest
already configured, an `index.html` holding the canvas, and the art under
`assets/`. How much of that project the model writes is what the engine decides.

Under [Simple 2D](/engines/simple-2d/) and [Structured
2D](/engines/structured-2d/) the workspace also carries the case-owned modules
around the game, `src/constants.ts` and `src/main.ts`, and the model writes
`src/game.ts` against them. Everything the specification fixes as a number, a
key binding, a cue name or a piece of screen copy has a name in
`src/constants.ts`, and the specs cite those names rather than restating the
figures. The engine owns the frame loop (which hands the game the real elapsed
time of each frame, never a mandated fixed timestep), the canvas fit, keyboard
input as named actions, audio as named cues, asset loading, and the debug
overlay; Structured 2D also owns rendering and the framework the game is written
inside. What stays the build's is Fathom itself: the maze, the fog of war, the
sensing, the creatures and everything drawn.

Under `none` the workspace is that toolchain and nothing else: configuration,
`index.html`, the art, and no `src/` at all. The model writes every line of what
runs, from the frame loop and its delta time up to the game.

## Three engines, one game

Because all three projects deliver the same game, the review items, the domains
and the checks that decide them are the same across engines, and a score
recorded under one engine is comparable with a score recorded under another. The
specs branch only where the deliverable differs, and the three validator suites
differ only in how they stand a build up. Each variant ships a reference
implementation per engine, under `references/<engine>/<variant>/`, and the
case's Reference tab offers a switch between them.

## Every review point is decided by a validator

The checklist is now entirely validator-rated. Every point carries a vitest
suite under `validation/<engine>/`, the domains its failure lowers, and how far
it lowers them, and nothing is left to a reviewer to decide from a screenshot.
Five points that had been backed by a reference view or a proof capture rather
than by a check were reconsidered on that basis: the stage fit, the seeded art
actually being what the game draws from, and the Lanternjaw's bulb surviving a
reveal are now decided by validators, while "the sonar is drawn as bulging arcs"
and "the audio plays gracefully" were dropped, because how the crest is styled
is the build's and gracefulness is not a claim a check can settle.

The reference screenshots and the proof captures are gone with them, and
`specs/proof.md` with those. Every piece of media a reviewer looks at is now
produced by the case's own validators, from scenarios the case controls, and the
same suites run against the reference build to produce the baseline they are
shown beside.

## Five domains instead of one

Earlier versions rated a run on a single `dive` domain, so any failure anywhere
was the whole score. A run is now rated on `navigation`, `sensing`, `predators`,
`progression` and `presentation` independently, and its overall rating is the
worst of the five, so a build whose maze generator is sound and whose Gloamfin
is not is told apart from one where it is the other way round.

## Checks pose the board they are about

A check used to hunt the build's own maze for the geometry it needed — a blind
corner, a long straight run, a junction — and grade whatever it found. The debug
surface now carries `setMaze`, which replaces the layout with a fixture written
in the same four characters the snapshot reports, and the checks pose the exact
board each one is about. A posed fixture is exempt from the maze's own validity
rules, so a check may pose a single hallway or a dead end without the build
refusing it, and posing one returns every predator to the den with the release
schedule suspended, so a posed scenario does not share its corridor with a
hunter that wandered in. The structural maze points are the exception, because
finding the shape in the build's own board is what those points are.

## A broken rule fails the point that owns it

A scenario poses a board and then measures one thing on it, and a defect
elsewhere in the build used to give way underneath every scenario that shared
the board. One predator swimming through rock failed fourteen points, thirteen
of which were about something else. Each point now takes a guard when its
scenario is arranged, and a point whose guard gives way for a reason another
point owns stands down through an unmet precondition instead of answering. Three
points own those reasons and fail for them: the forager honouring rock, the
predators honouring rock, and `setMaze` returning every predator to the den. A
reviewer reading a red line is therefore reading the rule that broke.

## The schedule is read from the schedule

Each predator now carries a `released` flag beside its `state`. `state` says
where a predator is; `released` says whether its turn has come, and neither
stands in for the other. The den's five-second stagger is spacing between
release times, measured on that flag, rather than between arrivals in the
corridor — the chamber is several tiles wide and nothing fixes which tile a
hunter waits on, so an arrival was never the schedule.

## Smaller contract changes

`setBrightness` now arms the one-second brightness hold in full, exactly as
eating a plankton does, so a posed brightness is steady for that window rather
than decaying out from under the check reading it. The sonar wavefront's speed
is pinned at fourteen corridor steps per second, where it had been left as "a
fraction of a second". Two new points were added: one owning the `setMaze`
housing contract, and one owning "predators keep to the corridors", asked in
both the shape a hunter must round and the shape it must sit still in.

## The specifications were rewritten

Every spec was rewritten against the current authoring guidelines. The prose
states what the finished build must be and do and nothing about how to build it:
no algorithms, no data structures, no decomposition, no coaching. Behavior that
a check reads is stated exactly or between explicit bounds, values are in the
game's own logical units throughout, and emphasis is reserved for the words that
would change the build if they were missed. The specification also gained
`specs/sensing.md`, which carries the fog of war, the light, the sonar and the
ink that had been folded into `specs/gameplay.md`, and `specs/state.md`, which
states the shape of the observable state the debug surface poses and reports.
