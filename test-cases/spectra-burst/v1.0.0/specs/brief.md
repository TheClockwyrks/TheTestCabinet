# Spectra Burst — particle-effect brief

You are authoring the **drone-burst**, the screen-space explosion VFX for
*Spectra*, a two-band formation shooter. It is the flash a swarm drone throws
when the player's fire pops it — a sharp neon detonation that punches for a
fraction of a second and is gone. You are authoring a **single 2D particle
effect**: a **planar, screen-space** system that plays flat against the game's
dark field, with **no depth**.

## The field

- **128×128 pixels**, planar. The effect plays in a flat 2D field; there is no
  `z` — positions, directions, and forces are all in the screen plane. `x`
  increases to the right, `y` increases **up**.
- The detonation is **centered** in the field — the drone pops in place — and
  throws outward roughly **radially symmetric** in all directions, filling most
  of the frame at its widest without clipping the edges.
- **Duration is 700 ms**, and the effect is a **one-shot**: it bursts at the
  start and **decays to a completely empty field** by the end. Nothing loops and
  nothing lingers past the duration.
- It composites over the game's **dark field** (`#0b1020`); the preview clears to
  transparent, but author the colors to read as **bright neon on dark**.

## Palette

Author the effect in only these colors — the Spectra neon two-band palette. A
reviewer judges the effect against this list, so keep every emitter, gradient,
and flash inside it:

| Role | Hex |
| --- | --- |
| Flash / spark hot core | `#ffffff` |
| Cyan band | `#34e2ff` |
| Magenta band | `#ff4ec7` |

The two spectral bands read by **color** here — cyan and magenta — exactly as
they do on the ships: this is the same two-band identity, thrown as light.

## The effect

The burst reads, at a glance, as a **sharp neon detonation** and is built from
**three overlaid elements**, all firing from the center at t = 0:

- **Flash core** — a bright, overexposed **white-to-cyan** bloom at the center. It
  is the hottest, largest thing on screen for the first instant and the fastest to
  die: it snaps on at full brightness and fades out within roughly the first
  ~120 ms, shrinking as it fades. This is the "hit" — the punch of light.
- **Ring shockwave** — a thin **cyan** ring that expands outward from the center. It
  starts small and tight at the detonation point and grows quickly to near the edge
  of the field, thinning and fading as it expands so it reads as a single clean
  expanding shock front. It is spent — faded to nothing — by roughly the halfway
  mark (~350 ms).
- **Radial spark streaks** — a scatter of small **cyan and magenta** sparks thrown
  **outward in every direction** from the center, stretched along their velocity so
  they read as short streaks, not dots. Roughly half carry the cyan band and half
  the magenta band. They launch fast, **decelerate** as they fly (drag), and
  **fade and shrink** as they die, the last of them gone by the end of the 700 ms.
  Their hot ends read white before settling into their band color.

## Lifecycle over the 700 ms

Author the timing so it reads as one detonation, described here in real terms
against the duration:

- **0–120 ms — detonation.** The flash core blooms white-hot and the ring
  shockwave and all the spark streaks launch together from the center. This is the
  hardest, brightest moment.
- **120–350 ms — expansion.** The flash is gone; the ring races outward, thinning
  and fading; the sparks fan out across the field, slowing under drag and beginning
  to fade, their color settling from white into cyan or magenta.
- **350–700 ms — decay.** The ring is spent; the remaining sparks dim, shrink, and
  wink out one by one until the field is **empty**. The one-shot is over.

## Emitters and forces (conceptual)

You author a **system** — emitters, forces, and per-particle curves — not
individual particles; think of it the way a real particle editor (Niagara, VFX
Graph) is authored. Shape it, conceptually, as:

- a **flash emitter**: a single short burst of one or a few large, very
  short-lived particles at the center;
- a **shockwave emitter**: a burst that forms the expanding ring — pushed outward
  from the center so it grows into a thinning ring;
- **two spark emitters**, one **cyan** and one **magenta**: point bursts at the
  center that launch many particles radially outward (a full, wide cone) at high
  speed with some spread, so the two bands intermix in the scatter;

with forces that read as an explosion: a **radial push** outward from the center
and **drag** to decelerate the sparks over their life. This is a screen-space
detonation, so there is **no gravity** pulling it one way — keep it radially
symmetric. Author these as *intent*: read `particle-2d --help` for the exact
emitter, force, and curve flags.

## Color, opacity, and size curves

Over each particle's normalized life:

- **Flash:** color runs **white `#ffffff` → cyan `#34e2ff`**; opacity is bright
  immediately then fades out fast (an ease-out fade); size starts large and
  shrinks.
- **Ring:** color **cyan `#34e2ff`**; opacity fades out as it expands; size grows
  over life so the ring expands, with its stroke thinning.
- **Cyan sparks:** color **white `#ffffff` → cyan `#34e2ff`** (a hot end cooling
  into the band); opacity holds then fades at death; size shrinks as it dies.
- **Magenta sparks:** color **white `#ffffff` → magenta `#ff4ec7`**; same opacity
  and size behavior as the cyan sparks.

## How the tool behaves

The `particle-2d` binary already on your `PATH` is the **only** channel for
shaping this effect — you build the system by calling it **one operation at a
time**, and the ordered list of operations you issue, recorded to `actions.json`,
is the **authoritative output**. You are authoring a **system** (emitters, forces,
per-particle curves), **not** placing individual particles: the review UI and a
game **simulate it live** from the system you author.

Run `particle-2d --help` to list every operation and `particle-2d <operation>
--help` for one operation's exact flags — that help text is the authoritative
contract. When you are ready to see your progress — and, importantly, **before you
finish** — run `particle-2d render`: it simulates the system over the 700 ms,
writes the preview GIF, and **emits the `system.json` the run's result is built
from**. An effect you never render leaves an empty system, which is recorded as
empty, so render before you stop. The field dimensions, duration, and fps are
already seeded alongside the workspace — no operation needs those flags.

Because the effect is **simulated live**, it **varies slightly from one play to the
next** — the sparks scatter differently each time. That is correct for an
explosion: author it so the *character* — flash, ring, radial burst, in the neon
two-band palette — **reads the same across every replay**, rather than depending on
any one frozen arrangement of particles.
