**Arc Foundry** is an electro-industrial tower-defense game, and a faithful
take on GemTD at heart. A runaway surge of conductive scrap called the Load
spills across a derelict substation yard toward a grounding collector. You defend
your chosen map by feeding scrap into a press that stamps salvaged electrical
components into automated turrets. Every stamped component is also a wall, so you
build a maze the Load must crawl around, buying your turrets time to burn it down
before it grounds out.

Its defining idea is what happens at the press: you do not buy the component you
want. You place a rock that rolls a random component type and quality tier the
moment it lands, weighted low. Each level you place five rocks and keep exactly
one as a firing tower; every rock you do not keep or combine hardens into an
inert blocker that walls the yard but never fires. To keep more firepower you
combine matched rolls, an action you can take at will even mid-wave, folding
them up the five-rung quality ladder (Scrap, Tuned, Charged, Primed, and
Tesla-Prime) or folding a whole recipe into a combination tower. Base towers are
deliberately weak feedstock; the payoff is assembling combination towers, which
are specific recipes that fold into far stronger turrets with exotic abilities
like chain, splash, slow, burn, crit, multishot, and aura. Charge is scarce, so
which roll to keep, the maze you wall from the rest, the quality climb, and the
combos you build are the strategic heart of the game.

The Load follows an ordered chain of waypoints, taking the shortest open route
around your walls between each pair. A never-seal rule forbids fully blocking any
segment or encircling a waypoint, and a Filament flyer appears every fourth wave
to bypass the maze. Three maps pose three different mazing problems, and an
Easy/Medium/Hard menu changes only the wave count and how tough the Load grows.
After the final wave, an invincible Overload Dynamo walks the maze once, and the
total damage you deal it is your Maze Rating, the run's only score.

Arc Foundry is a reskin of the classic random-build maze defense, given an
original name, an electro-industrial look, and its own component roster, Load,
and VFX.

## What a model is given

A run receives the self-contained specification and a configured TypeScript
project to build inside: the Vite, Vitest, ESLint and Prettier toolchain, and the
page with its canvas. How much more it receives depends on the engine the run
selects. On an engine run the project also carries the runtime and the case-owned
modules that name every figure the specification fixes and stand the engine up,
and the run writes the game and its debug surface against them. On an engineless
run the project carries no source at all, and the run writes the runtime as well
as the game. Under all three the maze router, the never-seal test, the projectile
flight and the scrap-press roll are the run's own work: no engine supplies
pathfinding, collision response, or a random source.

What the run is not given is any art. This is a full-stack case, so it produces
the game's own assets during the run with the six asset-generation tools on the
image's `PATH`: the component sprites across all five quality tiers, the Load and
boss animations, the yard, the audio, and above all the electrical particle VFX —
arcs, spark showers, chain lightning leaping between coils, expanding discharge
rings — that carry the presentation. There are no seeded assets and no reference
mockups, so nothing shows the run a picture of the finished game. The
specification fixes the maze rules, the roll, the roster and the economy exactly,
and every review point is decided by a validator derived from those rules; the
reviewer's judgement goes into the domain ratings.
