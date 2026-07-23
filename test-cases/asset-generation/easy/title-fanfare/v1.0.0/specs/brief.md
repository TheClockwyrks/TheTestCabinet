# Upbeat Title Theme — music brief

You are composing the **title theme** for a casual game — the short cue that plays
under the main menu while the player looks at a bright, colorful title screen and
gets ready to press start. It sets the tone for the whole game before a single
level begins: friendly, cheerful, and inviting. Sequence it note by note as
instrument tracks over the `gm-lite` instrument bank, one operation at a time.

## The mood to capture

- **Bright and upbeat.** A sunny, cheerful, energetic cue — the colorful sound of
  a welcoming main menu, all optimism and good humor. It should feel warm and
  inviting the instant it starts, the kind of theme that makes a player smile
  before they've even begun.
- **Playful and bouncy.** A light, catchy melody that skips and bounces along,
  buoyed by a peppy pulse — fun and light on its feet, never plodding, heavy, or
  serious. A hook a player would happily hear loop a few times while they browse
  the menu.
- **A small triumphant lift.** Build toward a little "welcome in" moment — a
  satisfying rise or short fanfare-like high point that feels rewarding and warm,
  without turning grand, martial, or overblown. It is a celebration of arriving,
  kept light and friendly.

The exact key, tempo, meter, and structure are **yours** — choose what best
delivers that bright, bouncy, inviting character. Major keys and a brisk, springy
tempo tend to suit this kind of cue, but the shape is your call.

## The clip

- **44100 Hz, stereo**, about **20 seconds** long. Aim to fill most of the clip
  without exceeding the **20000 ms** cap.
- It should **come to rest so it can repeat** — this theme may play on a loop while
  the player lingers on the menu, so land the end so it returns cleanly to the
  opening with no jarring seam.
- Output is **stereo** — use an open, lively image that gives the melody, the
  chords, and the plucks room to spread across the field, with a sense of space and
  depth.

## Instrumentation

Voice the cue from the **`gm-lite` instrument bank** (named `gm-lite@0.1.0` here) —
a general-MIDI-flavoured palette. It offers **keys** (grand piano, electric piano,
music box), **guitars and bass** (nylon guitar, electric guitar, electric bass),
**orchestral strings** (violin, cello, string ensemble), **brass** (trumpet,
trombone, french horn), **woodwinds** (flute, clarinet, saxophone), **tuned
mallets and bells** (marimba, vibraphone, glockenspiel), **synths** (synth lead,
synth pad), and a **drum kit** (kick, snare, closed hat, clap, tom, crash). The
bright, bell-like mallets — marimba, glockenspiel, vibraphone — and a light plucked
guitar or pizzicato-style string, over a cheerful string bed and a peppy drum
bounce, tend to suit this cue well, but **which** voices you use, and how you
combine them, is entirely your choice. Because you **cannot hear** the clip, inspect
the bank's instrument list and each instrument's character before naming it on a
track (see the `music` binary's help for how to browse the bank), and reason from
the names and the piano-roll — a melodic instrument is pitch-shifted per note, a
percussion one-shot plays at its native pitch.

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
rendered clip within the 20000 ms cap. When the cue captures the theme's bright,
bouncy, inviting identity, stop: the recorded `actions.json` is the finished output.
