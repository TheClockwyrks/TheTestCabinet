# Cinematic Trailer Cue — music brief

You are composing an **epic orchestral trailer cue** — the kind of grand, heroic
music that scores the teaser trailer for a blockbuster. It is about **30 seconds**
long, and its whole job is to take a listener from stillness to spectacle: it opens
quiet and tense, builds relentlessly, and crests on a huge climax before letting go.
Sequence it note by note as instrument tracks over the `cinematic` instrument bank,
one operation at a time.

## The mood to capture

- **Epic and heroic.** Grand, sweeping, larger than life — soaring brass, full
  choir, and a wide orchestral bed. This is the sound of a blockbuster teaser: it
  should feel enormous and emotional, the kind of music that promises something
  momentous.
- **A build from tension to triumph.** Begin **sparse and tense** — a lone voice
  (a solo cello, or an oboe) over hushed tremolo strings and a low, distant choir,
  holding its breath. Then **layer force in**: rising staccato and pizzicato string
  ostinatos, heroic french-horn lines, and drum hits that grow more frequent and
  more forceful, gathering momentum toward the peak.
- **A full climax, then release.** Crest on a **full choir-and-brass climax** —
  choir, horns, low brass, and trumpet together over the whole orchestra, capped by
  a cymbal — the payoff the build has been promising. Then give it a **short
  resolving tail**: a beat or two that lands the ending and lets the sound settle.

This cue **builds to an ending — it does not need to loop.** Shape the arc so the
climax clearly arrives near the end and the tail resolves it.

The exact key, tempo, meter, and structure are **yours** — choose what best carries
that rise from tense stillness to heroic climax.

## The clip

- **44100 Hz, stereo**, about **30 seconds** long. Aim to fill most of the clip
  without exceeding the **30000 ms** cap, and pace the build so the climax lands
  near the end with time for a short tail.
- **Reserve headroom.** Keep the sparse opening genuinely quiet so the climax has
  somewhere to grow — the contrast between the hushed start and the full-orchestra
  peak is the point. Don't let the whole cue sit at full volume.
- Output is **stereo** — use a **huge, wide** image, spreading the orchestra across
  the field so the ensemble sounds enormous and enveloping, with a real sense of
  space and depth.

## Instrumentation

Voice the cue from the **`cinematic` instrument bank** (named `cinematic@0.1.0`
here) — a curated orchestral palette built for exactly this kind of trailer music.
It offers:

- **Strings:** `tremolo_strings` (hushed, shivering tension), `string_ensemble`
  (a full sustained bed), `solo_cello` (a lone, singing melodic voice),
  `pizzicato_strings` (plucked, staccato — good for driving ostinatos).
- **Brass:** `horns` (heroic french horns), `trumpet` (bright, fanfare-like), and
  `low_brass` (weight and power beneath the ensemble).
- **Choir:** `choir_aah` and `choir_ooh` — massed voices, from a low distant hum to
  a soaring climax.
- **Woodwinds:** `oboe` (a plaintive, reedy solo color) and `flute` (bright and
  airy above the strings).
- **Keys and plucked:** `celesta` (glinting bell-like sparkle) and `harp`
  (sweeping glissandos and arpeggios).
- **Percussion:** an orchestral kit — `taiko` and `bass_drum` for deep, thunderous
  hits that punctuate the build, and `cymbal` to crown the climax.

**Which** of these voices you use, and how you layer them into a rising orchestral
arc, is entirely your choice. Because you **cannot hear** the clip, inspect the
bank's instrument list and each instrument's character before naming it on a track
(see the `music` binary's help for how to browse the bank), and reason from the
names and the piano-roll — a melodic instrument is pitch-shifted per note, a
percussion one-shot plays at its native pitch.

## Working the tool

The only way to make sound is the `music` binary already on your `PATH`. It is the
sole channel: you build the cue by calling it **one operation at a time**, and the
ordered list of operations you issue — recorded to `actions.json` — is the
**authoritative output**, not any file you write by hand. Anything produced another
way is discarded.

Unlike a drawing tool, `music` does **not** re-render after every call — rendering
is a separate, on-request step. Set the tempo and meter, `define-track` your
instruments, `add-note` the events, and shape each track with `set-track-fx`
(gain, pan, reverb); then run **`music render`** to mix the cue to `music.wav`, draw
the **waveform + spectrogram + piano-roll** preview, and emit the portable
`music.mid` score. **Read the preview after you render** — the piano-roll shows your
notes and the waveform shows the amplitude envelope, so you can confirm the build
rises and the climax peaks — to judge your progress and decide what to add next.
You must call `render` yourself to see anything.

Run `music --help` to list every operation and `music <operation> --help` for one
operation's exact flags — that help text is the authoritative contract. Keep the
rendered clip within the 30000 ms cap. When the cue delivers an epic orchestral
trailer — sparse and tense to a full heroic climax and a resolving tail — stop: the
recorded `actions.json` is the finished output.
