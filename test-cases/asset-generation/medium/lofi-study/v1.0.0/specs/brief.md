# Lo-Fi Study Beat — music brief

You are composing a **lo-fi hip-hop study beat**: a short, chilled instrumental
loop meant to sit quietly in the background while someone reads, works, or studies
late into the night. Sequence it note by note as instrument tracks over the
`gm-lite` instrument bank, one operation at a time.

## The mood to capture

- **A laid-back head-nod groove.** A soft, unhurried drum beat — a rounded kick, a
  gentle snare or rim on the backbeat, and easy hats — sitting a touch behind the
  pulse so it feels relaxed rather than tight or driving. This is a beat to nod to,
  not to dance to.
- **Mellow, jazzy keys.** A warm electric-piano chord loop built on soft
  **7th chords** and gentle color — the kind of hazy jazz harmony that repeats a
  short progression and never resolves too hard. It should feel cozy and a little
  wistful.
- **Round, supportive bass.** A smooth bass line that locks with the kick and
  outlines the chords without ever getting busy or bright — the floor the whole cue
  rests on.
- **Sparse mallet sparkle.** Occasional, spacious motifs from a mallet or bell
  voice (vibraphone or glockenspiel) drifting over the top — a few notes here and
  there, leaving air around them, never crowding the groove.

The whole thing is **warm, nostalgic, and hazy** — a rainy window, a desk lamp,
late-night studying. Keep it calm and spacious. The exact key, tempo, meter, and
chord progression are **yours** — choose what best delivers that relaxed, cozy
character (a slow-ish, downtempo pulse suits the style).

## The clip

- **44100 Hz, stereo**, about **30 seconds** long. Aim to fill most of the clip
  without exceeding the **30000 ms** cap.
- It must **loop seamlessly** — this beat plays on repeat under a long study
  session, so land the end so the groove returns cleanly to the opening with no
  click, gap, or jarring seam, holding its pocket the whole way through.
- Output is **stereo** — use a soft, wide image that gives the keys and mallets
  space across the field, with a sense of warmth and air.

## Instrumentation

Voice the cue from the **`gm-lite` instrument bank** (named `gm-lite@0.1.0`
here) — a general-MIDI-flavored palette. It offers keys (**grand_piano**,
**electric_piano**, **music_box**), guitars (**nylon_guitar**,
**electric_guitar**), a **bass_electric** bass, orchestral strings
(**violin**, **cello**, **string_ensemble**), brass (**trumpet**, **trombone**,
**french_horn**), woodwinds (**flute**, **clarinet**, **saxophone**), mallets and
bells (**marimba**, **vibraphone**, **glockenspiel**), synths (**synth_lead**,
**synth_pad**), and a drum kit (**drum_kick**, **drum_snare**,
**drum_hat_closed**, **drum_clap**, **drum_tom**, **drum_crash**). The
electric-piano and mallet voices are a natural fit for this style, but **which**
voices you use, and how you combine them, is entirely your choice. Because you
**cannot hear** the clip, inspect the bank's instrument list and each instrument's
character before naming it on a track (see the `music` binary's help for how to
browse the bank), and reason from the names and the piano-roll — a melodic
instrument is pitch-shifted per note, a percussion one-shot plays at its native
pitch.

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
rendered clip within the 30000 ms cap. When the cue reads as a warm, hazy,
unhurried lo-fi study beat that loops cleanly, stop: the recorded `actions.json` is
the finished output.
