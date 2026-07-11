# Meridian Theme — music brief

You are composing the **faction theme** for the **Meridian**, one of the three
rival powers in *Thunderhead*, a real-time fleet-command game fought across a
cloud sea. This short cue captures the Meridian's identity — it plays for the
player as they consider or command this power. Sequence it note by note as
instrument tracks over the `gm-lite` instrument bank, one operation at a time.

## Who the Meridian are

A high, **elegant** power of seamless pearl-white hulls and cyan energy. Their
ships are few, expensive, fast, and lethal, and they win by **striking precisely
and never being where the return fire lands** — energy shields, high-velocity
guns, and aircraft that blink across the sky. They are the sound of **refinement,
speed, and clean energy**: cool, luminous, and precise, fighting from the high
ground.

## The mood to capture

- **Sleek, luminous, and precise.** A refined, futuristic cue that feels
  **elegant and agile** — bright, clean, and cool, with a sense of speed and
  poise. Think polished energy and effortless precision, not brute force.
- **High and shimmering.** Favor a brighter, airier register and a crystalline
  clarity — glassy, energized, cool-toned. It should gleam like pearl-white hulls
  and cyan light, not smolder.
- **Energized but controlled.** Carry a crisp, forward pulse and a graceful
  melodic poise — quick and lethal underneath, but composed and unhurried on the
  surface. Precision and grace over aggression.

The exact key, tempo, meter, and structure are **yours** — choose what best
delivers that sleek, luminous, precise elegance.

## The clip

- **44100 Hz, stereo**, about **30 seconds** long. Aim to fill most of the clip
  without exceeding the **30000 ms** cap.
- It should **come to rest so it can repeat** — this cue may play on a loop while
  the player dwells on the Meridian, so land the end so it returns cleanly to the
  opening with no jarring seam.
- Output is **stereo** — use a clean, precise image with air and width that suits
  the Meridian's poise; keep it deliberate rather than muddy.

## Instrumentation

Voice the cue from the **`gm-lite` instrument bank** (named `gm-lite@0.1.0`
here) — a general-MIDI-flavoured palette with orchestral strings, brass, and
woodwinds, keys, mallets and bells, synths, and a drum kit. **Which** voices you
use, and how you combine them to conjure sleek, luminous precision, is entirely
your choice. Because you **cannot hear** the clip, inspect the bank's instrument
list and each instrument's character before naming it on a track (see the `music`
binary's help for how to browse the bank), and reason from the names and the
piano-roll — a melodic instrument is pitch-shifted per note, a percussion one-shot
plays at its native pitch.

## Working the tool

The only way to make sound is the `music` binary already on your `PATH`. It is
the sole channel: you build the cue by calling it **one operation at a time**, and
the ordered list of operations you issue — recorded to `actions.json` — is the
**authoritative output**, not any file you write by hand. Anything
produced another way is discarded.

Unlike a drawing tool, `music` does **not** re-render after every call — rendering
is a separate, on-request step. Set the tempo and meter, `define-track` your
instruments, `add-note` the events, and shape each track with `set-track-fx`
(gain, pan, reverb); then run **`music render`** to mix the cue to `music.wav`,
draw the **waveform + spectrogram + piano-roll** preview, and emit the portable
`music.mid` score. **Read the preview after you render** — the piano-roll shows
your notes and the waveform shows the amplitude envelope — to judge your progress
and decide what to add next. You must call `render` yourself to see anything.

Run `music --help` to list every operation and `music <operation> --help` for one
operation's exact flags — that help text is the authoritative contract. Keep the
rendered clip within the 30000 ms cap. When the cue captures the Meridian's sleek,
luminous identity, stop: the recorded `actions.json` is the finished output.
