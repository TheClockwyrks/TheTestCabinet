The **Lattice transport belt** is the animated conveyor surface the renderer for
**Lattice** — a deterministic grid-based factory simulation — draws under every
belt tile. It exists in two forms — the **straight** segment that runs across a
tile and the **curve** where the same belt turns 90 degrees — each drawn at
**three upgrade tiers**: a base belt, a faster reinforced belt, and the fastest,
most advanced belt. This asset-generation case asks a model to draw all of them as
one **sprite sheet** using only the drawing tool, one operation at a time: for each
tier, eight separate 32×32 frames of a straight, East-flowing belt tile and eight
of a corner tile whose flow enters West and leaves South, for forty-eight frames in
all. In each form the whole surface — dark metal with rails, tread blades patterned
across it, and a central row of accent chevrons painted on it — scrolls downstream
by a fixed step each frame, so the belt itself reads as moving rather than a static
floor with sliding arrows. It is one belt whose full width carries two items side
by side, not two belts.

What makes this one case rather than six is that everything has to read as **one
belt**. Within a tier the two forms have to join: a factory puts a straight belt
against a corner and expects a single conveyor changing direction, so they must be
built from one construction language, the curve's mouths must present the straight
belt's cross-section edge for edge, and both must scroll in phase. Across the tiers
the belt has to read as **one family progressively upgraded**: the three share the
same metal body, cross-section, and silhouette, and differ only by their accent
color (amber, then red-orange, then blue-cyan), their rising mechanical detail
(reinforcement, finer tread, a subtle energy glow), and their loop's playback speed
— so a higher tier is unmistakably the same belt, only faster and more refined.

The recorded operations are regenerated into each frame, which a reviewer judges
against the brief. The heaviest weight goes to the joining and family properties —
each tier told apart at a glance, all three reading as one belt, each form joining
flush and in phase within its tier — alongside the seamless scrolling loops, the
belt surface itself moving (tread blades scrolling, not just the arrows), the clean
90-degree turn, the chevrons pointing along travel in both forms, the single
continuous surface, and the horizontal tileability of the straight segment. The six
per-tier `belt-flow` and `curve-flow` sequences play back as live animations in the
review UI, each at its tier's rate, so the rising speed reads directly.
