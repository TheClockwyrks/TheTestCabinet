# Ironbound Theme — music brief

You are composing the **faction theme** for the **Ironbound**, one of the three
rival powers in *Thunderhead*, a real-time fleet-command game fought across a
cloud sea. This short cue captures the Ironbound's identity — it plays for the
player as they consider or command this power. Sequence it note by note as
instrument tracks over the `gm-lite` instrument bank, one operation at a time.

## Who the Ironbound are

A low, **industrial** power of riveted iron, coal-smoke, and gunpowder. Their
ships are heavy, slow, and hard to kill, and they win by **out-lasting and
out-grinding** a foe — thick armor, damage-control crews, and an attrition economy
of cheap, steady reinforcements. They are the sound of the **forge and the
foundry**: mass, weight, soot, and unstoppable momentum.

## The mood to capture

- A **heavy industrial war-march** — ponderous, mechanical, and **relentless**.
  Think hammering iron, grinding machinery, and the slow, crushing advance of
  something too massive to stop.
- **Dark, weighty, and menacing.** A low, gritty, minor or modal color; brooding
  and martial rather than bright or heroic. It should feel like iron and coal
  smoke, not polished steel.
- **Driven by a low, pounding pulse** — a marching, on-the-beat foundation that
  gives the cue its crushing, inexorable drive. Weight and momentum are the whole
  point.

The exact key, tempo, meter, and structure are **yours** — choose what best
delivers that heavy, grinding, industrial march.

## The clip

- **44100 Hz, stereo**, about **30 seconds** long. Aim to fill most of the clip
  without exceeding the **30000 ms** cap.
- It should **come to rest so it can repeat** — this cue may play on a loop while
  the player dwells on the Ironbound, so land the end so it returns cleanly to the
  opening with no jarring seam.
- Output is **stereo** — anchor the low, pounding foundation in the center for
  weight and give the fuller voices width.

## Instrumentation

Voice the cue from the **`gm-lite` instrument bank** (named `gm-lite@0.1.0` in
this case) — a general-MIDI-flavoured palette with orchestral strings, brass, and
woodwinds, keys, mallets and bells, synths, and a drum kit. **Which** voices you
use, and how you combine them to conjure a heavy industrial march, is entirely
your choice. Because you **cannot hear** the clip, inspect the bank's instrument
list and each instrument's character before naming it on a track (see the `music`
binary's help for how to browse the bank), and reason from the names and the
piano-roll — a melodic instrument is pitch-shifted per note, a percussion one-shot
plays at its native pitch.

## Working the tool

The only way to make sound is the `music` binary already on your `PATH`. It is
the sole channel: you build the cue by calling it **one operation at a time**, and
the ordered list of operations you issue — recorded to `actions.json` — is the
**authoritative output that is scored**, not any file you write by hand. Anything
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
rendered clip within the 30000 ms cap. When the cue captures the Ironbound's heavy,
grinding identity, stop: the recorded `actions.json` is your finished submission.
