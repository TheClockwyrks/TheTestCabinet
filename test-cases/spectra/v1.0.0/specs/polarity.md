# Spectra — Polarity: the two bands, the shield, and discharge (signature)

This file defines the signature systems of Spectra: the two bands, how a
matching shot destroys a drone and a mismatched shot does not, how your band
doubles as your shield, and the resonance meter and discharge. **Read this file
carefully.** It builds on the ship and bullets in `specs/playfield.md` and the
controls in `specs/controls.md`, and it cross-references the drones in
`specs/enemies.md`.

## The two bands

Everything that can be shot or can shoot is tuned to one of exactly **two
spectral bands**:

- **Cyan** (`#34e2ff`) and **Magenta** (`#ff4ec7`), drawn with the colors and
  glyphs from `specs/overview.md`.

Your ship holds **one** band at a time — its **current band** — and you **flip**
between the two with a single control (see `specs/controls.md`). The flip is
instant, but it imposes a brief **fire lockout** (below). The ship's glowing core
and the HUD polarity indicator always show the current band (see
`specs/playfield.md`).

## Your shots — match to destroy

When one of **your** bullets (`specs/controls.md`) touches a drone, whether it
destroys the drone depends only on the two bands:

- **Match** — the bullet's band equals the drone's current band: the drone is
  **destroyed** (for the Prism, the matching **layer** is destroyed; see
  `specs/enemies.md`), it scores (see `specs/flow.md`), and the bullet is
  consumed.
- **Mismatch** — the bullet's band is the opposite of the drone's current band:
  the drone is **not destroyed**, and the bullet is consumed. You cannot harm a
  drone of the band you are not currently tuned to. What **else** a mismatched
  shot does — whether it simply goes to waste or has a further effect — is defined
  by the active mode in `specs/mode.md`.

So to destroy a drone you must be tuned to **its** band. Because the formation
always holds **both** bands (`specs/playfield.md`), clearing a wave means
constantly flipping to match what you are firing at.

## Your band is your shield — same harmless, opposite lethal

Your current band is also your **hull's shield**. When an **enemy** bullet
(`specs/enemies.md`) reaches your ship:

- **Same band** as your current band: the bullet is **absorbed harmlessly** — no
  damage. Absorbing it **builds resonance** (below). Your ship is immune to fire
  of the band it is currently tuned to.
- **Opposite band** to your current band: the bullet **hits you** and costs a
  **life** (see Lives in `specs/flow.md`).

**Drone bodies are always dangerous.** Direct contact between your ship and any
drone's body costs a life **regardless of band** — you can never ride out a
collision by matching colors; only *bullets* are filtered by the shield.

This is the core tension of Spectra: the band that lets you **destroy** the drone
in front of you is the same band that decides **which incoming bullets can kill
you**. Tuning cyan to kill the cyan drones leaves you exposed to every magenta
bullet on the field, and the reverse. You are always choosing what you can hit
and what can hurt you at the same time.

## The flip and its cost

Flipping bands is free to do but not free to use:

- The flip itself is **instant** — the ship's band changes the moment you press
  the control, and the ship core and HUD indicator update immediately.
- Flipping imposes a **fire lockout of `0.30 s`**: for that window after a flip
  you **cannot fire**. So you cannot flip-and-shoot in the same instant — flipping
  to answer a new threat means a beat before you can punish it, and flipping
  defensively (to absorb an incoming volley) means you briefly cannot return fire.

The HUD does not need a separate lockout gauge; the brief inability to fire right
after a flip is the feedback.

## Resonance and the discharge

Good polarity play is rewarded with a **discharge**: a screen-clearing burst you
earn by managing your shield and your aim.

- **Resonance meter.** A value from `0` to `100`, shown as the center bar in the
  bottom HUD (`specs/playfield.md`). It rises when you:
  - **absorb** an enemy bullet of your current band (the shield rule above):
    **`+6`** each; and
  - land a **matching** kill on a drone: **`+4`** each (the Prism's core kill
    counts; a shell does not).
  It does not decay over time. It is **not** reset by losing a life.
- **Discharge ready.** When the meter reaches **`100`** the meter glows and a
  discharge is available. Pressing the discharge control (`specs/controls.md`)
  spends the **entire** meter (back to `0`) and fires the burst. If the meter is
  below `100` the control does nothing.
- **The burst.** A discharge emits an expanding wave from the ship that, over
  about **`0.5 s`**:
  - **destroys every drone currently out of formation** — every drone that is
    entering or diving (`specs/enemies.md`), of **either** band, scoring each as
    a diving kill; and
  - **clears every enemy bullet** on the field.
  - It does **not** touch drones still holding the formation (a Prism in formation
    keeps its layers). It is a defensive panic clear and a way to wipe a messy
    dive, not a way to empty the formation.

The discharge is your only band-blind weapon — it ignores the matching rule — so
it is the answer to a moment when both bands are bearing down at once and flipping
cannot save you. Spend it well; you must rebuild the meter from `0`.

## The three rules, together

Spectra's combat is three interlocking band rules:

- **Offense is matched:** you can only destroy a drone of your current band; a
  wrong-band shot never destroys it (`specs/mode.md` defines what else it does).
- **Defense is matched:** only opposite-band bullets can kill you; your own band
  is absorbed and feeds the discharge.
- **The field is mixed:** both bands are always present, so every moment forces
  a choice of which to be — and the flip that changes your aim also changes your
  shield, at the cost of a held beat of fire.
