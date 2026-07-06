# Spectra Laser — synthesis brief

You are synthesizing the **laser-fire sound effect** for the **player's
resonator-fighter** in *Spectra*, a two-band formation shooter. The player flies
along the bottom of the screen and fires this shot **upward** at a swarm of drones,
many times a second. This is the fighter's primary weapon sound — the one the
player hears constantly — so it must be **short, bright, and instantly readable as
a laser**. Build it from **oscillators and noise alone: no samples, no recordings.**

## The sound

A crisp, synthetic **"pew"** — a fast pitch-down zap:

- **Bright and energetic**, arcade-retro, chiptune-adjacent — the neon voice of
  *Spectra*. It should read as overtly electronic, not organic or recorded.
- **Snappy and tight**: an instant, percussive onset and a quick fall to silence.
  Because the fighter fires it in rapid bursts, it must not feel sluggish or ring
  on. The whole event is a fraction of a second.
- Its motion is a **downward pitch sweep** — the tone starts high and bright and
  drops fast, the classic falling "zap" that gives an arcade laser its sense of a
  bolt leaving the ship.

## The output

- **Mono**, single channel — a small UI/weapon SFX, not a spatial or stereo sound.
- **44.1 kHz** sample rate.
- **No longer than 800 ms.** That is the hard cap on the rendered clip, but the
  sound itself should be much shorter — a tight laser blip runs roughly **120–250
  ms** from attack to silence, with the rest of the budget simply unused. Do not
  stretch the sound to fill the cap.
- The clip must be **audibly present** — not silent, and not driven so hard it
  clips into distortion.

## The envelope and timing

Shape both amplitude and pitch over the short life of the shot:

- **Amplitude:** a **sharp transient attack** — an immediate, near-instant onset
  with no perceptible fade-in — followed by a **quick decay** to silence. Think a
  fast attack (a couple of milliseconds), a short body, and a rapid release; no
  sustained hold and no long tail. The waveform should show a spike at the front
  that falls away cleanly.
- **Pitch:** a **fast downward sweep** across the body of the sound — begin bright
  and high (roughly the upper register, e.g. around 1.5–2 kHz) and slide down
  quickly (toward a few hundred Hz) over the decay. On the spectrogram this reads
  as a bright band that dives from top to bottom over the clip's length. The pitch
  fall and the amplitude decay run together, so the shot brightens on the attack
  and darkens as it dies.

## The synth graph — conceptually

You have a modular synth: oscillator and noise **voices** on a timeline, each
shaped by an amplitude envelope, a pitch sweep, and modulation, routed through
filters and effects. Build the pew by **layering a few simple voices** rather than
reaching for one complex one:

- A **main tonal voice** carrying the zap — a bright oscillator (a `saw`, `square`,
  or `triangle` gives more harmonic bite than a pure `sine`), with the **downward
  pitch sweep** applied to it and a fast attack / quick decay envelope. This is the
  core of the sound.
- A short **noise transient** stacked at the very start — a brief burst of filtered
  noise (a few milliseconds, high-passed so it reads as a bright *tick* rather than
  a low thud) to give the attack a crisp, percussive edge. Keep it short and quiet
  relative to the tonal voice.
- Optional **shaping** to taste, if it serves the sound: a **filter sweep** (e.g. a
  low-pass whose cutoff falls with the pitch to darken the tail), a little **FM** on
  the tonal voice for a metallic, more synthetic timbre, or a touch of **distortion
  or bitcrush** for arcade grit. Use these to sharpen the character, not to bury it.

The reasoning under test is choosing and stacking these voices so the result reads
as a laser; the brief names the ingredients, not exact numbers — pick the
frequencies, envelope times, and levels that make the best-sounding shot.

## Working the tool

Build the clip up in sensible layers — lay down the main tonal voice, give it its
envelope and downward pitch sweep, add the noise transient on the attack, then any
filtering or FM. The binary **records** every operation but only **renders** on the
`render` command, so call `sfx-synth render` to mix the clip down and redraw
`waveform.png` (waveform + spectrogram) whenever you want to check your progress —
that preview is the only way to see the sound, since you cannot hear it. Run
`sfx-synth --help` for the available operations (adding oscillator and noise voices,
amplitude envelopes, pitch sweeps, filters, FM, distortion/bitcrush, bus and master
effects, and `render`) and `sfx-synth <operation> --help` for each one's exact
flags. Keep the whole event well within the **800 ms** cap and the **mono, 44.1
kHz** format.
