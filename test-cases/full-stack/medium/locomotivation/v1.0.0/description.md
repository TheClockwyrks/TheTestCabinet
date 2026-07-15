**Locomotivation** is a full-stack test case: the model builds a complete,
browser-playable arcade game **and** produces every sprite, animation, particle
effect, and sound it uses, with the asset-generation tools on the run image's
`PATH`.

The game is a dash across a working rail interlocking, shown from a **¾ overhead
angle** (think Stardew Valley) so the worker and the trains are real, directional
sprites — a character with a walk cycle for each facing, trains with a visible
side and top — rather than flat top-down icons. You are a yard worker whose shift
is to haul **color-matched freight** between dispensers and
their matching drop zones — but the yard is alive with **trains** running fixed,
telegraphed schedules, and touching any part of one, sides included, is instantly
fatal (the Frogger contract). The tension is the load: the freight you carry
**slows you down**, and past a threshold you lose your sprint entirely, so every
pickup is a wager on the crossings you still have to make. You can drop cargo to
save yourself, but cargo left on the rails is smashed by the next train; you have
a **shift clock** and **three lives**; some freight is a one-of-a-kind package
that ends the level if you lose it; and when a level offers one, an optional
**last train** departs exactly as the shift ends — board its rideable flat-top
cars for a large bonus, or watch it leave.

The design is intentionally original rather than a reskin of a single reference,
so the specification defines the whole game from scratch: the carry-weight speed
curve and recharging sprint, the three train kinds and their telegraphing, the
three cargo archetypes and color-matched delivery, the drop and
destructible-cargo rules, forced bridge/refuge commitment sections and light
junction switches, the shift-clock-and-lives fail model, the derived last-train
bonus, and a six-level campaign that ramps in difficulty and is beatable
throughout.

Because it is full-stack, the model must also draw the **animated worker** (its
headline asset) and the **trains**, author the environment tiles, color-coded
cargo, dispensers, drop zones and signals, produce the particle VFX — above all
the **required** shatter when a train destroys cargo — and synthesize the yard's
audio, then wire it all into the running game. The run is judged on both the
simulation and the produced presentation, and the overall rating is the worse of
the two.
