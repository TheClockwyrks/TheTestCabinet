Introduced.

Arc Foundry ships with a deterministic, steppable core and a `window.__foundry`
debugging and automation API and debug overlay (`specs/instrumentation.md`), a
required part of every build: the simulation advances on an external fixed timestep
(a manual clock the API can drive), all randomness runs off a seedable generator, and
the API can set up any board or wave through the game's real systems and read the full
state back. This is what makes the game's mechanics driveable and inspectable from
code, and it is framed throughout as an ordinary developer affordance of the game.

The specification is fully self-contained and split by concern (overview, board,
enemies, towers, build, flow, modes, controls, assets, instrumentation, proof), with
the SALVAGE campaign start folded into `specs/flow.md`. The reviewer checklist is
organized into categories, with the mechanical points backed by automated checks that
drive the debug API against a posed scenario and read the outcome back, while the
produced art, the electrical effects, and the audio stay judged by eye.
