**Confetti Pop** is a celebratory confetti burst — a party popper going off: a pop
at the center throws many small, colorful confetti pieces up and outward, they
tumble and spin, then flutter down under gravity and air drag before fading away.

This asset-generation case asks a model to author it as a 128×128 screen-space
`particle-2d` effect using only the particle tool, one operation at a time: a joyful
pop that launches confetti in a wide fan, which arcs over and flutters down —
swaying side to side under drag and fading — to a nearly empty field over about 1.5
seconds. The pieces read as small stretched rectangles or ribbons in a festive
multi-color palette (red, blue, green, yellow, pink, cyan). The model authors a
**system** — emitters, forces, and per-particle curves — not individual particles;
the review UI and a game **simulate it live** from the emitted `system.json`, so it
varies slightly from one play to the next. A reviewer judges the *character* of the
effect against the brief — its pop, its lifecycle over the duration, and its
cheerful color mix — rather than any one frozen frame.
