# Arc Foundry — `v2.0.0`

This is version `v2.0.0` of the **Arc Foundry** test case. The implemented game is
an electro-industrial tower defense in the GemTD family, played across a derelict
substation yard. A runaway surge of conductive scrap called the Load spills from a
feeder vent toward a grounding collector, and the player defends the yard by
feeding scrap into a press that stamps salvaged electrical components into
automated turrets.

`arc-foundry` is the catalog slug for this case, and the game's in-fiction title.
The random-build maze defense it descends from is an old form; the name, the
electro-industrial look, the component roster, the Load, and the electrical VFX
are original to The Test Cabinet.

This is a **full-stack** case. The model under test does not merely build the
game: it produces the game's own art, animation, particle effects, and audio
during the run, with the six asset-generation binaries on the
`test-cabinet-full-stack-2d` image's `PATH`, and then builds a game that loads
what it made. `specs/assets.md` is the production contract, and its
electrical-VFX section is the headline of what a run is judged on.

## Why this case

Arc Foundry is a `medium` case, and the difficulty is one of interacting systems
rather than of any single hard idea. The press rolls a random component type and
quality tier on placement; five rocks are placed per level and exactly one is kept
firing, the rest hardening into inert blockers; matched rolls climb a five-rung
quality ladder or fold into a combination tower by recipe. Every rock is also a
wall, so the same placement that decides the player's firepower also decides the
route the Load walks, and a never-seal rule refuses any placement that would fully
block a waypoint segment. A build that gets the roll right and the maze wrong, or
the maze right and the harvest wrong, is visibly broken in play.

On top of that sits a full asset-production pass. The eight base component types
across five tiers, a dozen combination towers, the Load roster and its boss, the
yard, twelve electrical particle systems, and the audio are all produced during
the run.

## Engines

Arc Foundry is designed for three engines, and seeds a different project for each:

| Engine | What the seeded project supplies |
| --- | --- |
| `none` | The toolchain configuration and `index.html`, and nothing else. There is no `src/`. The build writes the runtime, the frame loop and its delta time, the canvas fit, keyboard and pointer input, audio, asset loading, the diagnostics overlay and the `window.__foundry` surface, and then the game on top of it. The surface additionally carries the clock, because nothing outside the build owns it. |
| `simple-2d` | The [Simple 2D](/engines/simple-2d/) package, vendored at seed time, plus `src/constants.ts` and `src/main.ts`. The build writes `src/game.ts`: the state, the debug surface, and the game's update and render. The engine holds the state by value, so a pose takes the current state and returns the next, applied through `engine.apply`, and a reading takes the state and returns what it read. |
| `structured-2d` | The [Structured 2D](/engines/structured-2d/) package, vendored at seed time, plus the same two case-owned modules. The build writes `src/game.ts`: the game definition the engine drives, its mode, its live state class, its actors, and the debug surface its instance's `initialize` returns. The world is live, so a pose acts on it at the call and a reading returns plain data. |

Neither engine supplies pathfinding, collision response, or a seeded random
source, so the maze router, the never-seal test, the projectile flight, and the
scrap-press roll are the build's own work under every one of the three. All three
carry the produced-effect runtime `@test-cabinet/particle-runtime` as a baked-in
`file:` dependency, because every build plays its produced particle systems by
simulating them live.

## The single variant

Arc Foundry ships one variant, `base` (`variants/base.toml`): the standard SALVAGE
campaign. Difficulty is an in-game Easy/Medium/Hard menu that changes only the wave
count and how tough the Load grows, and the three maps are chosen on the
map-select screen, so neither is a variant. Every spec is common and seeded for
every run; the templates branch on `engine.slug` alone.

## Contents

| Path | Seeded to run? | Purpose |
| --- | --- | --- |
| `specs/` | Yes | The spec handed to the model, by concern. |
| `workspaces/` | Yes | The starter TypeScript project, `<engine>/`, seeded at the run root. |
| `references/` | No | The authored, correct build, one directory per engine. Never seeded. |
| `validation/` | No | The validator suites deciding every review point, `<engine>/`. |
| `validation-baseline/` | No | The baseline media, captured from each reference build. |
| `showcase/` | No | The variant's presentation media and description for the catalog, under `base/`, plus the capture driver that recorded them under `capture/`. |
| `prompt.hbs` | No | Rendered into the model's prompt; not seeded. |
| `test-case.toml` | No | Manifest: workspaces, engines, toolchain, specs, domains, review items. |
| `variants/` | No | One TOML file per variant (listed in `variants`). |
| `description.md` | No | The site-facing introduction on the case's detail page. |
| `changelog.md` | No | This version's entry in the case's changelog. |
| `README.md` | No | This overview. |

The specification is split across `specs/` by concern, and every file is seeded
for every run:

| Spec | Covers |
| --- | --- |
| `overview.md` | What is built, the runtime layer the build is handed, the stage geometry, the code quality, and the commands run over the finished repository. |
| `yard.md` | The tile grid, the four tile states, the structure footprint, the three maps, and placement legality. |
| `pathing.md` | The ordered waypoint chain, the open route of least length, the maze length, the never-seal rule, and flight. |
| `enemies.md` | The Load roster, the status effects a unit carries, how health scales by wave, and what a wave may hold. |
| `components.md` | The eight base component types, the ability vocabulary, the quality ladder, and the full stat tables. |
| `combinations.md` | The twelve combination towers, their recipes, and the upgrade track they climb. |
| `scrap-press.md` | The roll, the stamp allowance, the one-harvest rule, the two combines, and the refinement track. |
| `economy.md` | Charge, its two sources and its two sinks, and Grid Integrity. |
| `campaign.md` | The run, the build phase, the wave, the milestone waves, and the finale that produces the Maze Rating. |
| `difficulty.md` | The three difficulties and the four scaling constants each one sets. |
| `hud.md` | The status bar, the build panel and its inspector, the fixed-slot rule, and the two overlays. |
| `ui.md` | The eight screens, what each menu contains and where each choice leads, and the twelve audio cues. |
| `controls.md` | How simulation time advances, the pointer, the registered actions and their keys, and what each control commits. |
| `assets.md` | The asset-production contract: every asset, which binary produces it, the path it lands at, and how it is loaded. |
| `instrumentation.md` | The debug and automation surface, the snapshot shape, and the diagnostics overlay. |
| `showcase.md` | The `showcase/` directory the finished game ships: its description and its media carousel. |

## Assets and media

This is a full-stack case, so the game ships no pre-made art: `test-case.toml`
declares no `assets` list, and the build produces everything it draws and plays.
The build must be self-contained — it bundles the committed produced files and
runs with the generation binaries absent, so a build that regenerates its assets
at load time fails.

No reference mockup is seeded either. This version declares no `[[reference]]`
views, no `[[proof]]` artifacts and no `[[check]]` comparisons: nothing shows the
model a picture of the finished game, and every requirement reaches it as prose.
What the specs fix about the look is what must be visible — a quality tier reading
by more than color, a blocker reading as unmistakably dead, an escalation in the
firing VFX as the ladder climbs — and how it is drawn belongs to the build.

## Validation

This case is validator-rated: every point on the checklist carries a Vitest suite,
and the validators decide the functional rating through each point's failure cap.
A reviewer rates the run's aesthetics and may override a verdict.

The checklist runs to 287 points across 24 categories, one observable behavior
each, and each names the scoring domains its failure lowers. There are three:
`simulation` for how the foundry plays, `presentation` for the produced sprites,
animation cycles and electrical effects along with the code-drawn interface that
presents them, and `audio` for the twelve produced cues. A run's overall rating is
the worst across the three, and each domain takes the lowest failure cap among its
failing points.

`validation/` holds one project per engine, `validation/none/`,
`validation/simple-2d/` and `validation/structured-2d/`, each with a suite per
review point at `<category>/<id>.test.ts`. The `none` suites drive the built site
in Chromium through `window.__foundry`; the two engine projects run in process
against the vendored engine and reach the surface through `engine.debug`. The
three run the same scenarios and differ only in how they reach the build.

Every expected value a suite asserts comes from a figure the specs fix or from an
oracle recomputed beside the harness, never from a reference build: a validator
that passed on the reference and failed another spec-compliant build would be
worse than none.

`validation-baseline/<engine>/<variant>/` holds the media the same suites captured
from that engine's reference build, so a reviewer sees the build's evidence and
the reference's side by side.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/full-stack/medium/arc-foundry/v2.0.0/`). Each version is
self-contained and immutable once a run references it; design revisions land as
new version folders.
