**Rain Downpour** is a looping heavy-rain weather effect — a steady, driving
downpour that can play over any scene as a full-frame overlay.

This asset-generation case asks a model to author it as a 128×128 screen-space
`particle-2d` effect using only the particle tool, one operation at a time: many
thin, fast, near-vertical rain streaks stretched along their velocity with a slight
wind slant, plus occasional tiny near-white splash flecks where drops reach the
bottom edge, all in a cool desaturated palette. The model authors a **system** —
emitters, forces, and per-particle curves — not individual particles; the review UI
and a game **simulate it live** from the emitted `system.json`, so it varies
slightly from one play to the next and loops seamlessly. A reviewer judges the
*character* of the effect against the brief — its two elements, its steady seamless
fall over the duration, and the cool desaturated rain palette — rather than any one
frozen frame.
