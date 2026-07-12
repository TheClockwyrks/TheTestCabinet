**Junction** is a top-down transit-and-utility city builder. You look straight down on a
patch of land and grow a city on it: you **zone** buildable land for homes, shops, and
industry, you lay the **roads and rail** that carry citizens to work and goods to market,
and you run the **power and water** that let it all develop. You never place a building —
zoned land raises its own, and grows through density tiers, but only where it is
connected, served, and worth building on.

Its defining tension is that **everything is connected**. A zone develops only with road
access and both utilities; each neighborhood added loads the roads its citizens commute
on, and an overloaded link **congests** and slows every trip across it (the *Mini Metro*
flow pressure); industry drives the jobs that grow housing but poisons the land around it,
dropping its value and holding development down; and every road, rail, pipe, and wire
charges upkeep against a treasury a too-fast or too-sprawling city drains into the red.
Underneath sit several interacting systems: a self-developing zoned map, a transit
network with real congestion, power and water networks, an RCI demand economy with
pollution and land-value feedback, and a budget that ends the game in bankruptcy.

Junction is also a **full-stack case** with a twist: the model under test must **produce
the game's own assets during the run** — the zone/transit/utility sprites and vehicles,
the animated signal/construction/vehicle sheets, the pollution/dust/fireworks particle
overlays, and the sound and music — with the six asset-generation tools on the run image's
`PATH`, **and author the entire simulation in Rust compiled to WebAssembly** behind a
JS/TS view layer (the compiled `.wasm` committed as a build input), then build the game
around it all. It is inspired by city sims like *SimCity* and the flow-pressure of *Mini
Metro* but is entirely its own: an original name, look, and system set, and its own scope.
