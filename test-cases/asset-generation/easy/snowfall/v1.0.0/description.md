**Ambient Snowfall** is a gentle, looping winter weather layer — a calm, continuous
field of soft white snowflakes drifting down and swaying on a light breeze.

This asset-generation case asks a model to author it as a 128×128 screen-space
`particle-2d` effect using only the particle tool, one operation at a time: many
soft-edged flakes of varied sizes falling slowly downward with a gentle side-to-side
sway, smaller flakes falling slower for a parallax sense of depth, a few slowly
twinkling or rotating, all in a cool white and pale-blue palette. The model authors
a **system** — emitters, forces, and per-particle curves — not individual flakes;
the review UI and a game **simulate it live** from the emitted `system.json`, so the
snow varies slightly from one play to the next and must loop seamlessly. A reviewer
judges the *character* of the effect against the brief — its soft varied flakes, its
slow drift and sway, its parallax, and its clean continuous loop — rather than any
one frozen frame.
