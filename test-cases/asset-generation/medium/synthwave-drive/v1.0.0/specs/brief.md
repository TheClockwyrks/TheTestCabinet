# Synthwave Night Drive — music brief

You are composing a **retro-80s synthwave "night drive" loop** — a short,
atmospheric cue built to cruise on repeat. Picture an empty highway at night, city
lights streaking past, chrome and neon: cool, wistful, endless forward motion.
Sequence it note by note as instrument tracks over the `synthwave` instrument bank,
one operation at a time.

## The mood to capture

- **Neon and nostalgic.** The unmistakable retro-80s synthwave color — glowing,
  saturated, a little dreamlike — the sound of an analog synthesizer and a drum
  machine at midnight.
- **Cruising and driving.** A steady, propulsive pulse that never stalls: a
  four-on-the-floor electronic backbeat under a pulsing, arpeggiated bass, so the
  whole cue feels like it is moving down an open road at speed.
- **Wistful and cool.** Bittersweet and unhurried under the motion — a melody that
  longs for something just out of reach, laid over warm pads. Cool and reflective,
  not aggressive or euphoric.

The exact key, tempo, meter, and structure are **yours** — choose what best
delivers that neon, cruising, wistful character.

## The clip

- **44100 Hz, stereo**, about **30 seconds** long. Aim to fill most of the clip
  without exceeding the **30000 ms** cap.
- It should **loop seamlessly** — this cue plays on repeat, so land the end so the
  groove and pulse carry unbroken across the loop point, with no click, gap, or
  jarring seam when it returns to the opening.
- Output is **stereo** — use a wide, enveloping image that spreads the pads,
  arpeggio, and lead across the field, with a sense of space and depth.

## Instrumentation

Voice the cue from the **`synthwave` instrument bank** (named `synthwave@0.1.0`
here) — a palette of vintage-synth voices built for exactly this style:

- **Leads and plucks:** a bright `square_lead` and a short, percussive `pluck` for
  melodies and arpeggios.
- **Bass:** a punchy `synth_bass` and a deep, round `sub_bass` for the low end.
- **Pads:** a `warm_pad` and an `analog_pad` for glowing, sustained chords.
- **Color voices:** a glassy `fm_bell`, a `synth_brass` stab, and lush
  `synth_strings`.
- **Drum machine:** an electronic kit — `kick_808`, `snare_electronic`, `clap`,
  `hat_closed`, `hat_open`, and `tom_electronic` — for the backbeat.

**Which** of these you use, and how you combine them, is entirely your choice — but
the palette is built around a four-on-the-floor drum-machine groove, a pulsing bass,
warm pads, a saw/square lead, and glassy bell accents, so lean into that. Because
you **cannot hear** the clip, inspect the bank's instrument list and each
instrument's character before naming it on a track (see the `music` binary's help
for how to browse the bank), and reason from the names and the piano-roll — a
melodic instrument is pitch-shifted per note, a percussion one-shot plays at its
native pitch.

## Working the tool

The only way to make sound is the `music` binary already on your `PATH`. It is
the sole channel: you build the cue by calling it **one operation at a time**, and
the ordered list of operations you issue — recorded to `actions.json` — is the
**authoritative output**, not any file you write by hand. Anything produced another
way is discarded.

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
rendered clip within the 30000 ms cap. When the cue reads as a neon, cruising,
wistful synthwave night drive, stop: the recorded `actions.json` is the finished
output.
