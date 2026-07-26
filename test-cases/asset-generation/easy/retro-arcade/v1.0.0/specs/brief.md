# Retro Arcade Loop — music brief

You are composing a short **background music loop** for a fast-paced retro arcade
action game — the cue that plays under the action while the player chases a high
score. It needs to be upbeat, energetic, and unmistakably arcade. Sequence it note
by note as instrument tracks over the `synthwave` instrument bank, one operation at
a time.

## The mood to capture

- **Upbeat and adrenal.** Fast, driving, and full of momentum — the sound of an
  80s arcade cabinet lit up mid high-score run. It should make the player lean in
  and go faster.
- **Chiptune flavor.** A bright, retro game-soundtrack character: a bouncy
  square-wave lead, snappy staccato phrasing, and crisp electronic drums. Punchy
  and playful, not lush or orchestral.
- **Driving and propulsive.** A punchy synth bass and a quick electronic drum
  groove lock together to push the cue relentlessly forward, with snappy pluck or
  bell counter-melodies threading through to keep the energy up. Nothing should
  sag or drift.

The exact key, tempo, meter, and structure are **yours** — choose what best
delivers that fast, punchy, arcade character. (A brisk tempo and a tight, repeating
groove tend to suit this kind of cue.)

## The clip

- **44100 Hz, stereo**, about **25 seconds** long. Aim to fill most of the clip
  without exceeding the **25000 ms** cap.
- It must **loop seamlessly** — this cue plays on repeat under sustained play, so
  land the end so it returns cleanly to the opening with no click, gap, or jarring
  seam at the loop point.
- Output is **stereo** — use a clean, punchy image with real width: spread the
  parts across the field so the lead, bass, groove, and counter-melodies each have
  their own space, with no clipping and no one voice swamping the rest.

## Instrumentation

Voice the cue from the **`synthwave` instrument bank** (named `synthwave@0.1.0`
here) — a palette of vintage-synth voices built for exactly this kind of music. It
offers bright lead and melody voices (a `square_lead`, a `pluck`, an `fm_bell`),
bass voices (a punchy `synth_bass` and a deep `sub_bass`), warm chord and sustain
pads (`warm_pad`, `analog_pad`, `synth_strings`, and a `synth_brass`), and an
electronic drum machine (`kick_808`, `snare_electronic`, `clap`, `hat_closed`,
`hat_open`, `tom_electronic`). **Which** voices you use, and how you combine them
into a driving chiptune loop, is entirely your choice — though a square lead, a
punchy synth bass, and the drum machine are a natural fit for the arcade sound.

Because you **cannot hear** the clip, inspect the bank's instrument list and each
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
rendered clip within the 25000 ms cap. When the cue captures the upbeat, punchy
arcade identity and loops cleanly, stop: the recorded `actions.json` is the
finished output.
