Introduced.

This version ships Deepcore with a debugging and automation surface so the build can be
driven and inspected from code:

- A required `window.__deepcore` debug and automation API and a read-only debug overlay
  (`specs/instrumentation.md`), backed by the deterministic, fixed-timestep, render-free,
  seedable core that `specs/controls.md` requires. Mine generation and all gameplay
  randomness run off a seedable generator, and the simulation advances on an external
  manual step (`autoStep` off) so a scripted scenario is exact and reproducible.
- The reviewer checklist is authored in the categories grammar (`[review] format = 2`),
  with mechanical items automatically validated by reporter-side scripts that drive the
  `window.__deepcore` handle to set up a scenario, run the real simulation forward, and
  read the outcome back. Subjective items (character animation, art, audio, feel) stay
  human-judged.

The specifications were also rewritten for clarity: they are fully self-contained, with
the debug/automation surface documented as an ordinary game feature.
