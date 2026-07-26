**Magic Pickup Sparkle** is a gentle, looping collectible marker — the enchanting
shimmer that hovers over a magic item or power-up to catch the eye and say *pick me
up*.

This asset-generation case asks a model to author it as a 64×64 screen-space
`particle-2d` effect using only the particle tool, one operation at a time: a soft
pulsing cyan glow at the center, small white four-point star sparkles that twinkle
in and out at varying positions around it, and a few slow rising violet motes, all
in a cool magical palette and looping seamlessly over one second. The model authors
a **system** — emitters, forces, and per-particle curves — not individual
particles; the review UI and a game **simulate it live** from the emitted
`system.json`, so it varies slightly from one play to the next. A reviewer judges
the *character* of the effect against the brief — its three elements, its gentle
one-second loop, and the cool magical palette — rather than any one frozen frame.
