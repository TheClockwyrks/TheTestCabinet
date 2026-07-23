# Ambient Exploration — music brief

You are composing a **calm, spacious ambient exploration cue** — a short piece of
atmospheric music that plays under a quiet moment of discovery, as a listener drifts
through a vast, still landscape and takes it in. This cue is the sound of that
moment: serene, mysterious, and full of gentle wonder. Sequence it note by note as
instrument tracks over the `gm-lite` instrument bank, one operation at a time.

## The mood to capture

- **Calm and spacious.** Unhurried and weightless — a slow, evolving bed that
  breathes rather than drives, with plenty of air between events. Long sustains,
  soft attacks, and space to let each sound bloom and decay. Nothing busy, tense,
  or insistent.
- **Wonder and gentle mystery.** A sense of awe before something vast and quiet —
  a landscape opening up, inviting exploration. Curious and a little unknown,
  beautiful without being sentimental. Not melancholy, not ominous, not
  triumphant — simply serene and lightly mysterious.
- **Slowly evolving and drifting.** The texture should keep changing, gently.
  Sustained pad and string beds swell, shift, and overlap underneath while sparse
  motifs float over the top and fade, so the cue drifts and unfolds across its
  length rather than repeating one static chord. Keep percussion **minimal or
  absent** — if you use any, let it be the faintest pulse or shimmer, never a beat
  that drives the piece.

The exact key, tempo, meter, and structure are **yours** — choose what best
delivers that calm, spacious, wonder-struck character.

## The clip

- **44100 Hz, stereo**, about **30 seconds** long. Aim to fill most of the clip
  without exceeding the **30000 ms** cap.
- It should **loop with no audible seam** — this cue may repeat under long stretches
  of quiet exploration, so land the end so it flows cleanly back to the opening with
  no click, gap, or jarring change.
- Output is **stereo** — use a wide, deep, enveloping image that lets the pads and
  motifs spread across the field, with a real sense of space and depth.

## Instrumentation

Voice the cue from the **`gm-lite` instrument bank** (named `gm-lite@0.1.0` here) — a
general-MIDI-flavoured palette. Its melodic voices include a grand piano, electric
piano, and music box; nylon and electric guitars and an electric bass; the strings
violin, cello, and a full string ensemble; the brass trumpet, trombone, and french
horn; the woodwinds flute, clarinet, and saxophone; the mallets and bells marimba,
vibraphone, and glockenspiel; and two synths, a synth lead and a synth pad. It also
carries a drum kit (kick, snare, closed hat, clap, tom, and crash). For this cue the
sustaining, atmospheric voices — synth pad, string ensemble, and the softer keys and
bells — are the natural bed and the sparse floating motifs, but **which** voices you
use, and how you combine them into a deep, evolving ambient texture, is entirely your
choice.

Because you **cannot hear** the clip, inspect the bank's instrument list and each
instrument's character before naming it on a track (see the `music` binary's help for
how to browse the bank), and reason from the names and the piano-roll — a melodic
instrument is pitch-shifted per note, a percussion one-shot plays at its native
pitch.

## Working the tool

The only way to make sound is the `music` binary already on your `PATH`. It is the
sole channel: you build the cue by calling it **one operation at a time**, and the
ordered list of operations you issue — recorded to `actions.json` — is the
**authoritative output**, not any file you write by hand. Anything produced another
way is discarded.

Unlike a drawing tool, `music` does **not** re-render after every call — rendering is
a separate, on-request step. Set the tempo and meter, `define-track` your
instruments, `add-note` the events, and shape each track with `set-track-fx` (gain,
pan, reverb); then run **`music render`** to mix the cue to `music.wav`, draw the
**waveform + spectrogram + piano-roll** preview, and emit the portable `music.mid`
score. **Read the preview after you render** — the piano-roll shows your notes and
the waveform shows the amplitude envelope — to judge your progress and decide what to
add next. You must call `render` yourself to see anything.

Run `music --help` to list every operation and `music <operation> --help` for one
operation's exact flags — that help text is the authoritative contract. Keep the
rendered clip within the 30000 ms cap. When the cue captures a calm, spacious,
wonder-struck ambient character that loops cleanly, stop: the recorded `actions.json`
is the finished output.
