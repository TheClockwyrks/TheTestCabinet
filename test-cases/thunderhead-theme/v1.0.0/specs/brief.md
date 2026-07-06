# Thunderhead Theme — music brief

You are composing the **Thunderhead battle theme**: a short, looping **naval
battle cue** for *Thunderhead*, a real-time fleet-command game. It plays under a
fleet engagement — sky-warships and battleships trading broadsides across a cloud
sea — so it must be a **driving, militaristic minor-key** piece: relentless
forward motion, a determined martial melody, and a sense of building tension.
Sequence it **note by note as instrument tracks** over the `gm-lite` instrument
bank, one operation at a time.

## The clip

- **44100 Hz, stereo**, at most **8000 ms** long. Write the whole cue to fit
  inside that cap — roughly **four bars** at the tempo below.
- It must **loop cleanly**: it will play on repeat under gameplay, so the end has
  to flow back into the opening downbeat with no click, gap, or jarring harmonic
  seam. Land the final bar so it leads back to the top.
- Output is **stereo** — place the voices deliberately across the image (see
  *Stereo image* below).

## Tempo and key

- **Minor key** — pick a clear one (e.g. **D minor** or **E minor**) and stay in
  it. The mode carries the militaristic, tense character.
- **Fast and driving** — around **128–140 BPM** in **4/4**. Four bars at this
  tempo is a little under eight seconds; keep the whole cue within the cap.
- Move the harmony over the four bars so it **pushes toward the dominant** by the
  end, then resolves back to the tonic at the loop point — that tension-and-return
  is what makes it feel like it is tightening rather than repeating one static bar.

## The instrument tracks

Voice the cue from the **`gm-lite` instrument bank** (named
`gm-lite@0.1.0` in this case). Define a track per part with
`define-track --instrument <name>`, using the real instrument names the bank
carries. A good, idiomatic arrangement for this cue:

| Track | gm-lite instrument | Part |
| --- | --- | --- |
| Bass | `bass_electric` | The steady low pulse — a driving root-note bass line on the beat, the cue's foundation. |
| Low percussion | `drum_tom` (with `drum_kick`) | Timpani-like low hits on the downbeats reinforcing the pulse; the marching drive. |
| Strings | `string_ensemble` | A warm sustained pad holding the minor harmony under everything (double the low line with `cello` for weight if you like). |
| Melody | `french_horn` (or `trumpet`) | The determined, martial melodic line stated over the pulse — the theme you remember. |
| Counter-line | `trumpet` (or `violin`) | A rising answer that enters as the tension builds toward the loop. |

These are suggestions, not a fixed rig — the bank also carries `violin`, `cello`,
`trombone`, `viola`-less strings via `string_ensemble`, `grand_piano`,
`marimba`, `glockenspiel`, `drum_snare`, and more. Choose voices that serve a
**driving minor naval battle theme**; a mellow horn or a bright trumpet reads as
militaristic, low strings and bass give the pulse its weight, and a snare or tom
adds march. Because you **cannot hear** the clip, read the bank's instrument
list and each instrument's character before naming it, and reason from the names
and the piano-roll — a melodic instrument is pitch-shifted per note, a percussion
one-shot plays at its native pitch.

## The arrangement over the length

Shape the four bars so the cue **grows**:

- **Bars 1–2 — establish.** Lay the low pulse (bass + low percussion) and the
  string pad on the tonic minor, and state the main melodic line. Set the driving
  character immediately.
- **Bars 3–4 — build.** Thicken the texture: bring in the counter-line, lift the
  strings, and push the harmony toward the dominant so the energy tightens.
- **The loop.** End the fourth bar on a chord that leads straight back to the
  opening tonic downbeat, so the seam is inaudible on repeat.

## Stereo image

Anchor the **pulse** — bass and low percussion — in the **center** for weight.
Spread the **strings** wide across the left and right for size, and place the
**melody** and **counter-line** slightly off-center on opposite sides so they read
as distinct voices. Keep the mix balanced with no clipping and no single voice
swamping the rest.

## Working the tool

The only way to make sound is the `music` binary already on your `PATH`. It is
the sole channel: you build the cue by calling it **one operation at a time**, and
the ordered list of operations you issue — recorded to `actions.json` — is the
**authoritative output that is scored**, not any file you write by hand. Anything
produced another way is discarded.

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
rendered clip within the 8000 ms cap. When the cue matches this brief and loops
cleanly, stop: the recorded `actions.json` is your finished submission.
