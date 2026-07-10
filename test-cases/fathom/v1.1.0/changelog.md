Reworked the variants around Fathom's signature **sensing** system. The three
mode variants (Murk, Reserve, Beam) are dropped; the case now offers two dives
that share everything but how you read the dark:

- **Base (Trench)** — unchanged: a remembered fog of war, line-of-sight passive
  light, and a corridor-flooding sonar pulse.
- **Kindle** (new) — replaces the fog of war with a light you feed by eating. Your
  kindle-glow is a wide radial bubble that senses only the *rock* around you
  (bending around corners), swelling as you graze and guttering when you stop;
  nothing is remembered, and the plankton and predators inside the glow are found
  only by a small line-of-sight light pocket or a sonar ping.

Each variant now seeds its own self-contained `specs/sensing.md`, and the common
specs no longer reference "modes" or any other variant — the model always sees one
coherent sensing model. The shared single-dive menu makes the `title` reference
common to both variants.
