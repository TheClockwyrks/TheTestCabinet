# Explosion Animation — drawing brief

You are drawing a classic hand-drawn cartoon **explosion**, a **sprite sheet** of
seven frames meant to **play once** as a punchy one-shot boom. It is a single
blast that erupts from a point, swells into a fireball, and then settles into
thinning smoke — the kind of snappy, stylized detonation you would see punctuate a
2D action game or a cartoon.

The whole animation runs **hot-to-cool**: it starts white-hot, warms through
yellow and orange, and cools to grey smoke, ending nearly clear. Every frame is
drawn on a fully **transparent** background so it composites over whatever is
behind it.

## Compositing — a blast on transparency

Every frame is drawn on a fully **transparent** background.

- The only opaque pixels are the explosion itself; do **not** fill the background.
- Keep everything in the **palette** below — no other colors.

## The frames

- Each frame is its own **48×48-pixel** image with a transparent background.
  Origin is the top-left; `x` increases to the right, `y` increases downward
  (0–47). Anchor the blast to the **center of the frame** (around x 24, y 24); it
  grows outward from that point and later dissipates in place, staying within the
  frame with a little margin.
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **7 frames, numbered 0–6**, and they play in order, once.

## What goes in each frame

One blast, told across seven stages. It should grow from tiny to big and then thin
out, with the color temperature dropping steadily frame to frame:

| Frame | Stage | What it looks like |
| --- | --- | --- |
| 0 | **Ignition spark** | Small and tight — a bright pinpoint flash with a few short radiating spark lines at the center. Mostly flash and hot yellow. |
| 1 | **White-hot flash core** | A bright, round white-hot core at full intensity, ringed by hot yellow — the peak of the flash, still fairly compact. |
| 2 | **Expanding fireball** | The core blooms into a bigger fireball: a white-hot center, a hot-yellow body, and an orange rim with a few **jagged flame tongues** licking outward. |
| 3 | **Fireball peak** | The fireball at its largest and most ragged — orange and deep-orange body, more and longer jagged tongues, the white core shrinking, the first dark debris flecks appearing. |
| 4 | **Smoke-and-debris peak** | Fire past its peak: an ember-and-deep-orange heart wrapped in billowing grey smoke, with a scatter of dark debris flecks. Roughly the widest frame. |
| 5 | **Dissipating smoke** | Mostly grey smoke, spreading and breaking up, with only a small ember glow left at the heart. Softer, more gaps than solid. |
| 6 | **Nearly empty** | Almost clear — just a faint wisp or two of light-grey smoke thinning away. No fire left. |

Make it read as **one explosion**:

- A single blast **anchored to the same center** — it swells outward and settles
  back in place; it must **not** drift across the frame or split into unrelated
  shapes.
- The **hot-to-cool** progression is the point: frames 0–1 are white and yellow
  hot, 2–3 are orange and ember, 4 is fire giving way to smoke, and 5–6 are grey
  smoke fading out. Reserve the flash white for the earliest, hottest frames.
- The **fireball frames** (2–3) want **jagged, uneven flame tongues** around the
  rim — spiky and irregular, not a smooth circle — so it reads as fire, not a ball.
- The **decay** matters: smoke should spread and **thin to nearly nothing** by
  frame 6. The last frame is almost empty; don't leave a lingering fireball or cut
  off abruptly.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Flash — white-hot | `#fffdf2` |
| Hot yellow | `#ffe14a` |
| Orange | `#ff9c1a` |
| Deep orange | `#e5541a` |
| Ember (deep red) | `#8f2414` |
| Smoke — light grey | `#a2a2a8` |
| Smoke — dark grey | `#4c4c52` |

## Working the tool

Start at the center and build each frame outward: lay the largest hot mass first
(a filled circle for the core and fireball body), then ring it with the next
cooler color, then add detail on top — jagged flame tongues, debris flecks, and
the radiating spark lines of the first frame — with smaller shapes and single
pixels. Grow the radius frame to frame through the fireball, then swap the fire
colors for the smoke greys and let the shape spread and break up as it fades. Use
the filled-circle and rectangle operations for the round masses, and small shapes
or single pixels for tongues, sparks, and debris. Run `draw-sheet --help` for the
available operations and `draw-sheet <operation> --help` for each one's exact
flags. Call `draw-sheet` once per operation and read `frames/<index>.png` between
calls. Play the seven frames as a single boom in your head — spark, flash,
fireball, smoke, gone — and keep the blast centered and cooling the whole way
through.
