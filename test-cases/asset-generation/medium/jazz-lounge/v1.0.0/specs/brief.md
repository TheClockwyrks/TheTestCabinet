# Jazz Lounge Loop — music brief

You are composing a **smooth late-night jazz lounge loop** — a short background cue
for a dim, intimate cocktail bar in the small hours. It plays low under the
conversation while the room lingers: cool, unhurried, and sophisticated. Sequence it
note by note as instrument tracks over the `gm-lite` instrument bank, one operation
at a time.

## The mood to capture

- **Smooth late-night lounge jazz.** A relaxed, easy piece with a gentle **swing**
  feel — the eighth notes loping rather than marching. It should sound like a small
  combo playing quietly in a velvet-and-low-light room after hours: intimate, warm,
  and cool, never loud, busy, or aggressive.
- **A walking bass and a soft groove.** Underneath it all, a **walking bass line**
  strolls through the changes, one note stepping to the next, while a light,
  **brushed-kit-style** groove keeps unobtrusive time — soft snare and hushed hats
  rather than hard backbeats. The rhythm should breathe and swing, not sit stiff and
  quantized.
- **Warm comping under a laid-back melody.** A warm electric-piano lays down **lush,
  jazzy chords** — sevenths and richer extensions, with smooth voice leading — comping
  behind the lead. Over it, a **laid-back melody** — a cool saxophone or a mellow
  muted trumpet in character — carries a singable line that **breathes and trades
  phrases** with the piano, leaving space rather than playing wall to wall.

The exact key, tempo, meter, and structure are **yours** — choose what best delivers
that smooth, swinging, intimate lounge character.

## The clip

- **44100 Hz, stereo**, about **30 seconds** long. Aim to fill most of the clip
  without exceeding the **30000 ms** cap.
- It should **come to rest so it can repeat** — this cue may play on a loop as
  quiet background, so settle the end so it returns cleanly to the opening with no
  jarring seam.
- Output is **stereo** — use a wide, warm image that gives the kit, bass, piano, and
  lead their own space, with a sense of depth, as if you are sitting a few tables
  from the band.

## Instrumentation

Voice the cue from the **`gm-lite` instrument bank** (named `gm-lite@0.1.0` here) — a
general-MIDI-flavoured palette. It offers keys and mallets and bells (a grand piano,
an **electric piano**, a music box, marimba, vibraphone, and glockenspiel), guitars
(nylon and electric) and an **electric bass**, orchestral strings (violin, cello, a
string ensemble), brass (**trumpet**, trombone, French horn), woodwinds (flute,
clarinet, **saxophone**), a pair of synths (a lead and a pad), and a **drum kit**
(kick, snare, closed hat, clap, tom, and crash). A warm Rhodes-style electric piano,
the electric bass for the walk, the saxophone or trumpet for the lead, and the kit's
snare and hats for the brushed groove all sit naturally in this style — but **which**
voices you use, and how you combine them for that lounge color, is entirely your
choice. Because you **cannot hear** the clip, inspect the bank's instrument list and
each instrument's character before naming it on a track (see the `music` binary's
help for how to browse the bank), and reason from the names and the piano-roll — a
melodic instrument is pitch-shifted per note, a percussion one-shot plays at its
native pitch.

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
rendered clip within the 30000 ms cap. When the cue captures the smooth, swinging,
late-night lounge character, stop: the recorded `actions.json` is the finished output.
