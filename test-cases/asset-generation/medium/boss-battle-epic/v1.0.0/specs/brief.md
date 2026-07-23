# Epic Boss Battle — music brief

You are composing an **epic boss-battle theme** — a short, loopable orchestral
combat cue for a towering final-boss encounter. This is the music that plays while
the player fights the biggest, most dangerous adversary in the game: a
high-stakes, life-or-death showdown. Sequence it note by note as instrument tracks
over the `cinematic` instrument bank, one operation at a time.

## What it is

The **theme for a final boss** — a colossal, menacing foe the player has been
building toward. The moment the fight begins, this cue should tell them the stakes
just went through the roof: they are outmatched, the pressure is on, and every
second counts. It is the sound of **dread and adrenaline** — dark, driving, and
relentless, propulsive enough to carry a long fight without ever letting up.

## The mood to capture

- **Dark, driving, and menacing.** A relentless low percussive pulse — a pounding
  taiko/bass-drum heartbeat — under aggressive low-brass stabs and tense tremolo
  strings. It should feel threatening and unstoppable, the theme of an enemy far
  bigger than the player, not a heroic fanfare or a gentle underscore.
- **High-stakes and taut.** Keep it on edge: a biting, insistent ostinato, ominous
  choir swells rising and falling, and cymbal accents punctuating the turns. The
  cue should feel like a fight the player might lose — charged with dread, never
  calm, resolved, or triumphant.
- **Propulsive and relentless.** Carry unbroken forward momentum — the low pulse
  never stops, the ostinato keeps churning, so the cue drives the battle onward and
  raises the adrenaline as it goes.

The exact key, tempo, meter, and structure are **yours** — choose what best
delivers that dark, driving, high-stakes character. A fast, insistent tempo and a
minor or otherwise ominous tonality tend to suit a boss fight, but the choice is
yours.

## The clip

- **44100 Hz, stereo**, about **30 seconds** long. Aim to fill most of the clip
  without exceeding the **30000 ms** cap.
- It should **loop cleanly** — this cue plays on repeat for the length of a
  sustained boss fight, so land the end so it returns cleanly to the opening with
  no click, gap, or jarring seam each time around.
- Output is **stereo** — use a wide, powerful image: give the percussion weight and
  let the brass and strings spread across the field with a sense of space and depth.

## Instrumentation

Voice the cue from the **`cinematic` instrument bank** (named `cinematic@0.1.0`
here) — an orchestral palette built for film-score writing. It offers, among
others:

- **Strings:** `tremolo_strings`, `string_ensemble`, `solo_cello`,
  `pizzicato_strings`.
- **Brass:** `horns`, `low_brass`, `trumpet`.
- **Choir:** `choir_aah`, `choir_ooh`.
- **Woodwinds:** `oboe`, `flute`.
- **Keys, mallets, and plucked:** `celesta`, `harp`.
- **Orchestral percussion:** `taiko`, `bass_drum`, `cymbal`.

**Which** voices you use, and how you combine them to conjure driving orchestral
menace, is entirely your choice. Because you **cannot hear** the clip, inspect the
bank's instrument list and each instrument's character before naming it on a track
(see the `music` binary's help for how to browse the bank), and reason from the
names and the piano-roll — a melodic instrument is pitch-shifted per note, a
percussion one-shot plays at its native pitch.

## Working the tool

The only way to make sound is the `music` binary already on your `PATH`. It is
the sole channel: you build the cue by calling it **one operation at a time**, and
the ordered list of operations you issue — recorded to `actions.json` — is the
**authoritative output**, not any file you write by hand. Anything produced
another way is discarded.

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
rendered clip within the 30000 ms cap. When the cue captures the boss battle's
dark, driving, menacing identity, stop: the recorded `actions.json` is the finished
output.
