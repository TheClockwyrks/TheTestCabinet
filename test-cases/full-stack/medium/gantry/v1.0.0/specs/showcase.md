# Gantry — The showcase

The finished game ships a showcase: the store-page presentation a player reads
before deciding to play it. It is a `showcase/` directory at the root of this
repository, committed with the rest of the project, holding a description of the
game and a short carousel of media captured from the game as it runs. This file
defines its contents.

## Layout

Every file of the showcase sits directly in `showcase/`, with no
subdirectories:

- `showcase/showcase.md`, the description.
- `showcase/showcase.toml`, the carousel.
- The media files the carousel and the description name.

## The description

`showcase/showcase.md` is Markdown written for a player: what Gantry is, how a
site goes from bare anchors to a rigged crane and a written tape, and what makes
a lift worth watching. Three to five short paragraphs, between 200 and 500 words
in all. It is strictly about playing the game; implementation, architecture, and
tooling stay out of it. It may embed images that sit beside it, referenced by
bare relative path (for example `![The yard](the-crane.png)`); every image it
embeds is a `.png` in `showcase/`.

## The carousel

`showcase/showcase.toml` lists the media in the order they are presented, one
`[[media]]` table per entry:

```toml
[[media]]
file = "gameplay.webm"
name = "One crate hoisted, carried, and set on its pad"

[[media]]
file = "the-crane.png"
name = "The finished crane, checked and inside budget"
```

- `file` names a file directly in `showcase/`, with no path separators. Every
  file the carousel names exists there, and each stays under 25 MiB.
- `name` is a caption of a few words, under sixty characters.
- The carousel holds three to five entries: one moving entry first, then two to
  four stills.

## What the media shows

The leading entry is a single continuous stretch of live play, fifteen seconds
or longer, of one site taken to a clear: a crane rigged on the build screen, a
tape written on the program screen, and the run played out with a load attached,
carried, and set down on its pad. It ends on the cleared run rather than
mid-swing.

The stills are frames of that same session, such as the checked crane on the
build screen, the load up at the jib with the members colored by their
utilization, or the last of the lift closing on the pad. Each still holds the
whole stage, at `1280 x 720` pixels or larger.

The crane on screen is built and driven through the game's own editor and tape,
and everything it does follows from the simulation of `specs/statics.md` and
`specs/rigging.md` under that tape. What a player sees is the built game drawing
the models this build produced, so the showcase presents the finished game as it
plays.

## Media

The file extension states what an entry is.

| Extension | Media                             |
| --------- | --------------------------------- |
| `.png`    | A screenshot of the running game. |
| `.webm`   | A video clip of the running game. |

The leading entry is a `.webm` clip recorded at 30 frames a second or better,
and the stills are `.png`. Gantry draws a 3D yard, so the clip is video: it is
the picture the player sees rather than a transcript of it. How screenshots and
clips are captured is the build's own business.
