# Thunderhead Theme — music brief

You are composing the **main-menu theme** for *Thunderhead*, a real-time,
combined-arms **fleet-command** game fought across an endless **cloud sea** of
mountainous islands. This is the piece that plays over the **title screen** while
the player sits at the menu — a long, grand, **cinematic overture** in the
tradition of the sweeping main-menu scores of naval- and fleet-command games, not
a short gameplay loop. It sets the mood of the whole game before a shot is fired:
a **cold, high war over a sea of cloud** — vast skies, looming conflict, gravity
and grandeur. It is **not** tied to any one power; it speaks for the game as a
whole.

## The clip

- **44100 Hz, stereo.** It is **3 to 5 minutes** long — a full main-title piece
  the player can leave running. Stay within the **300000 ms** cap.
- It must **loop cleanly**: it plays on repeat under the menu for as long as the
  player lingers, so the end has to flow back into the opening with no click, gap,
  or jarring harmonic seam. Land the close so it leads back to the top.
- Output is **stereo** — a wide, cinematic image (see *Stereo image* below).

## Mood and character

- **Grand, cinematic, and evocative.** Aim for the scale of a film or game
  main-title: sweeping and majestic, carrying both the **weight of a coming war**
  and a sense of **vast open sky**. It should feel serious and stirring, not
  frantic — this is the menu, contemplative and grand, not a battle cue.
- **A cold, high, martial world.** Let the tone reflect the setting — an austere,
  largely **dark or minor-leaning** color with room for a **hopeful or heroic
  lift**, so it feels like standing on the deck of a sky-warship looking out over
  the clouds. The exact key, mode, tempo, and meter are **yours** to choose; pick
  what best serves this mood.
- **Neutral to the powers.** Do not lean on the identity of any single faction —
  no one power's signature sound should dominate. This is the game's theme, above
  the three rival fleets.

## The arrangement over its length

Because this is a **long** piece, it must **develop** — do not repeat one idea for
five minutes. Give it an arc across its full length, for example:

- **an opening** that sets the scene and establishes the atmosphere;
- **a statement** of a strong, memorable main theme — the melody a player will
  come to associate with the game;
- **development and contrast** — take the material somewhere: reharmonize it,
  hand it between voices, shift the intensity, perhaps a quieter reflective middle
  before it gathers again;
- **a climactic restatement** at full scale;
- **a settling** back toward the opening so the loop point is seamless.

The specific structure is yours; the requirement is that the piece **grows and
breathes** over three-to-five minutes rather than vamping on a single loop.

## Instrumentation

Voice the piece from the **`gm-lite` instrument bank** (named `gm-lite@0.1.0` in
this case) — a general-MIDI-flavoured palette with orchestral strings, brass, and
woodwinds, keys, mallets and bells, synths, and a drum kit. **Which** voices you
use, and how you combine them, is entirely your choice: build whatever ensemble
best realizes a grand cinematic main-menu overture. Because you **cannot hear**
the clip, inspect the bank's instrument list and each instrument's character
before naming it on a track (see the `music` binary's help for how to browse the
bank), and reason from the names and the piano-roll — a melodic instrument is
pitch-shifted per note, a percussion one-shot plays at its native pitch.

## Stereo image

Give it a **wide, cinematic** stereo image with real depth — anchor the low
foundation and any percussion toward the center for weight, and spread the fuller
voices across the field for size and breadth. Keep the mix balanced across a long
dynamic arc: no clipping at the climaxes, and no single voice swamping the rest.

## Working the tool

The only way to make sound is the `music` binary already on your `PATH`. It is
the sole channel: you build the piece by calling it **one operation at a time**,
and the ordered list of operations you issue — recorded to `actions.json` — is the
**authoritative output that is scored**, not any file you write by hand. Anything
produced another way is discarded.

Unlike a drawing tool, `music` does **not** re-render after every call — rendering
is a separate, on-request step. Set the tempo and meter, `define-track` your
instruments, `add-note` the events, and shape each track with `set-track-fx`
(gain, pan, reverb); then run **`music render`** to mix the piece to `music.wav`,
draw the **waveform + spectrogram + piano-roll** preview, and emit the portable
`music.mid` score. **Read the preview after you render** — the piano-roll shows
your notes and the waveform shows the amplitude envelope — to judge your progress
and decide what to add next. You must call `render` yourself to see anything. On a
piece this long, render often and check the whole arc.

Run `music --help` to list every operation and `music <operation> --help` for one
operation's exact flags — that help text is the authoritative contract. Keep the
rendered clip within the 300000 ms cap. When the overture matches this brief and
loops cleanly, stop: the recorded `actions.json` is your finished submission.
