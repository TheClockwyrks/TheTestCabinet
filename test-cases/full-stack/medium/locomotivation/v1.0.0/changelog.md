Introduced.

Locomotivation is a full-stack medium case: a ¾-overhead rail-yard hauling game
whose builder also produces every sprite, animation, particle effect, and sound
the game plays. It ships in the instrumented format: each build exposes a
`window.__loco` debug-and-automation API and a read-only debug overlay over a
deterministic, fixed-timestep, render-free core, and the reviewer checklist is
organized into scored categories whose objective items are decided by automated
validation scripts that drive that API (posing a scenario, stepping the real
simulation, and reading the outcome back), leaving feel, art, and audio to the
reviewer.
