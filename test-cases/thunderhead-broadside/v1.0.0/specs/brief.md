# Thunderhead Broadside — audio brief

You are authoring the **main-gun broadside**, the heavy report a player's
**capital ship** fires in *Thunderhead*, a naval fleet-command game. When a
battleship's main battery salvos a target, this is the sound: a huge, layered
naval-gun report that lands with weight and rolls out into settling debris. You
are authoring a single **stereo** clip built by layering samples from the
`combat-core` sample pack.

## The output

- **44,100 Hz, stereo**, no longer than **4000 ms** (four seconds). The whole
  effect — from the first concussion to the last of the tail — must fit inside
  that cap and must not be silent.
- The clip is a finished waveform: a game plays this `.wav` directly. Build it to
  sound like a real recording, not a demo of individual samples.

## The character and role

It should read, blind, as a **capital-ship main gun firing** — a battleship's
16-inch main battery, not a rifle, a firework, or a generic explosion:

- **Big and concussive.** A hard percussive slam at the front — the pressure wave
  hitting you — followed immediately by an enormous low-end **boom** that you feel
  more than hear.
- **Metallic.** Under the blast, the ring of a vast steel barrel and turret — a
  resonant, hollow metal character that says *heavy gun*, not *TNT*.
- **Rolling out.** The report doesn't stop dead; it decays into a **rubble/debris
  tail** — masonry, grit, and shell fragments scattering and settling as the
  low-end rumble fades.

Dark and powerful, weighted to the low end, with a bright transient snap on top.

## Envelope and timing (within 4000 ms)

Shape it across the four seconds as a single event with four overlapping stages:

1. **Concussion transient (0 ms).** A sharp, percussive crack right at the top —
   the initial slam. Very short and bright, sitting on top of everything.
2. **Sub boom body (~0–1200 ms).** The deep low-frequency boom blooms just behind
   the transient and is the loudest, weightiest part — a soft onset swelling to a
   heavy low-end body that begins to decay after the first second.
3. **Barrel ring (~50–900 ms).** A metallic, resonant ring through the middle,
   layered over the boom — the turret and barrel resonating.
4. **Debris tail (~600–3600 ms).** As the boom decays, the rubble/debris scatter
   takes over and settles out, fading to silence before the cap. Let the low-end
   rumble and the debris overlap so there is no gap between body and tail.

The stages overlap — this is one continuous report, not four separate hits.

## The layers — composite from `combat-core`

You mix over the baked **`combat-core`** sample pack. Browse it first with
`sfx-sample list-samples` and `sfx-sample sample-info --name <name>` (you cannot
audition audio, so reason from each clip's tags, duration, and description), then
layer several clips into the effect. Useful ingredients in the pack for a
broadside include:

- **The gun body** — `cannon_body_heavy` (a heavy black-powder cannon report, a
  broadband blast with a strong low-mid body) as the core of the blast.
- **Low-end weight** — `boom_sub_rumble` (a deep sustained sub-bass rumble) and/or
  `boom_low_kick` (a short sub-bass boom with a soft attack) under the body to give
  it capital-ship size. Pitch or trim these for weight.
- **The concussion transient** — `impact_metal_dry` (a bright, very short metallic
  hit) or the pack's snap/click transient, placed at 0 ms on top for the initial
  slam.
- **The metallic ring** — `impact_metal_hollow` (a deep hollow resonant thunk) and
  `clang_metal` (a ringing iron clang with a decaying metallic tail) for the barrel
  and turret resonance.
- **The debris tail** — `debris_rubble` (bricks and masonry tumbling onto rubble, a
  gritty broadband scatter lasting a few seconds) fading out at the end.

These names are a starting point, not a required set — read the library yourself
and choose and combine what best serves the brief. Layer several clips; **time**
them against each other so the stages land in the order above; **gain-balance** so
the boom dominates and the transient cuts through; **pitch/trim/fade** for weight
and to remove gaps. You may add a **synth sub voice** (a low sine, ~40–55 Hz, with
a soft attack and long release) to reinforce the low end and glue the layers, and
use per-layer or bus filters, a touch of reverb, and gentle compression to fuse
everything into one report. Keep the peaks clear of harsh digital clipping.

## Stereo image

The clip is **stereo** — use the width on purpose:

- **Anchor the low end to the center** — the sub boom and body sit dead center so
  the weight is solid and mono-compatible.
- **Spread the concussion and the debris tail wide** — pan the transient and the
  rubble scatter across the field (and/or use a little stereo reverb) so the report
  feels huge and enveloping rather than a point source. Keep it balanced, not
  lopsided to one side.

## Working the tool

Build the clip up in sensible layers — browse the library, lay the gun body and
sub boom, add the concussion transient, the metallic ring, and the debris tail,
then balance, time, and process them. `sfx-sample` is the only way to shape sound;
it records every operation to `actions.json` and only re-renders when you run
`sfx-sample render`, which draws the waveform + spectrogram to `waveform.png`. Run
`sfx-sample --help` for the available operations (`list-samples`, `sample-info`,
`add-sample`, the synth `add-voice` family, filters, reverb/delay/compressor, and
`render`) and `sfx-sample <operation> --help` for each one's exact flags. Call
`sfx-sample` once per operation, and `render` and read `waveform.png` between
passes to judge the envelope and spectral content against this brief.
