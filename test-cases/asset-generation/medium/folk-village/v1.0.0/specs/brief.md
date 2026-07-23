# Folk Village Theme — music brief

You are composing a **warm pastoral acoustic-folk theme** for a peaceful village or
town. This short cue plays as gentle ambient music while the listener wanders a
sunlit square, so it should feel cozy, wholesome, and welcoming — a piece of music
that says *home*. Sequence it note by note as instrument tracks over the `gm-lite`
instrument bank, one operation at a time.

## The scene to capture

A small, tranquil village on a warm afternoon: cottages and market stalls, neighbors
chatting, sunlight over a town square. The music is the sound of belonging and ease
— rustic, hand-made, and unhurried, with an honest acoustic-folk heart.

## The mood to capture

- **Warm and pastoral.** A gentle acoustic-folk cue built on a fingerpicked nylon
  guitar with a lilting melody sung over it — the kind of tune a small band might
  play in a village square. It should feel sunlit, natural, and hand-made rather
  than synthetic, electronic, or grand.
- **Cozy and wholesome.** Tender, inviting, and gently rustic — a feeling of
  community, comfort, and home. Keep it easygoing and heartfelt, not tense,
  driving, melancholy, or epic.
- **Alive with a gentle pulse.** Let a soft hand-percussion-style pulse and the
  guitar's steady fingerpicking give the cue an easy, lilting motion, so it ambles
  along warmly instead of sitting static or marching stiffly.

The exact key, tempo, meter, and structure are **yours** — choose what best delivers
that warm, pastoral, cozy character.

## The clip

- **44100 Hz, stereo**, about **30 seconds** long. Aim to fill most of the clip
  without exceeding the **30000 ms** cap.
- It should **come to rest so it can repeat** — this cue may play on a loop while
  the listener lingers in the village, so land the end so it returns cleanly to the
  opening with no jarring seam.
- Output is **stereo** — use a natural, open image that gives the acoustic ensemble
  room to breathe, with a sense of space and depth.

## Instrumentation

Voice the cue from the **`gm-lite` instrument bank** (named `gm-lite@0.1.0` here) —
a general-MIDI-flavoured palette. It carries a grand piano, electric piano, and a
music box; nylon and electric guitars and an electric bass; the orchestral strings
violin, cello, and a string ensemble; the brass trumpet, trombone, and french horn;
the woodwinds flute, clarinet, and saxophone; the mallets and bells marimba,
vibraphone, and glockenspiel; a synth lead and synth pad; and a drum kit (kick,
snare, closed hat, clap, tom, and crash). A **fingerpicked nylon guitar** foundation
and a **lilting flute or clarinet** melody, with **soft sustained strings**
underneath and a **gentle percussive pulse**, fit this brief naturally — but
**which** voices you use, and how you combine them into a warm acoustic ensemble, is
entirely your choice. Because you **cannot hear** the clip, inspect the bank's
instrument list and each instrument's character before naming it on a track (see the
`music` binary's help for how to browse the bank), and reason from the names and the
piano-roll — a melodic instrument is pitch-shifted per note, a percussion one-shot
plays at its native pitch.

## Working the tool

The only way to make sound is the `music` binary already on your `PATH`. It is the
sole channel: you build the cue by calling it **one operation at a time**, and the
ordered list of operations you issue — recorded to `actions.json` — is the
**authoritative output**, not any file you write by hand. Anything produced another
way is discarded.

Unlike a drawing tool, `music` does **not** re-render after every call — rendering
is a separate, on-request step. Set the tempo and meter, `define-track` your
instruments, `add-note` the events, and shape each track with `set-track-fx` (gain,
pan, reverb); then run **`music render`** to mix the cue to `music.wav`, draw the
**waveform + spectrogram + piano-roll** preview, and emit the portable `music.mid`
score. **Read the preview after you render** — the piano-roll shows your notes and
the waveform shows the amplitude envelope — to judge your progress and decide what
to add next. You must call `render` yourself to see anything.

Run `music --help` to list every operation and `music <operation> --help` for one
operation's exact flags — that help text is the authoritative contract. Keep the
rendered clip within the 30000 ms cap. When the cue captures the warm, pastoral folk
village identity, stop: the recorded `actions.json` is the finished output.
