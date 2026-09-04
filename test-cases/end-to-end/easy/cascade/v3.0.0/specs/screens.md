# Cascade — The screens and the HUD

This file defines the four screens the game moves between, what each one shows,
and the three controls of the HUD. The rectangles these controls answer are in
`specs/controls.md`, and the table the `playing` screen draws is in
`specs/table.md`. Every piece of screen copy below carries the name this
specification gives it, and the literal text it names is the text that is drawn.

Every piece of text a screen shows is legible against whatever sits behind it at
the logical stage size. The palette, the type, and the layout of each screen are
yours.

## The screens

The game is on exactly one of four screens at a time, and it opens on `title`.

| Screen | What it is |
| --- | --- |
| `title` | The opening screen, and where the game starts. |
| `howto` | How to play. |
| `playing` | Live play on the table. |
| `won` | The victory cascade and the message that follows it. |

### `title`

| Element | Constant | Content |
| --- | --- | --- |
| Title | `TITLE_TEXT` | `CASCADE` |
| Tagline | `TAGLINE_TEXT` | `KLONDIKE SOLITAIRE` |
| Items | `TITLE_ITEMS` | `NEW GAME`, `HOW TO PLAY`, in that order |
| Deal-mode label | `DEAL_MODE_LABEL` | This build's label, as `specs/stock.md` states |

Each item's label is drawn inside the rectangle `specs/controls.md` fixes for it,
`NEW GAME` in `TITLE_NEW_GAME` and `HOW TO PLAY` in `TITLE_HOW_TO`. The
deal-mode label is drawn somewhere on the screen so a player sees which deal the
game is played with.

| Item | Does |
| --- | --- |
| `NEW GAME` | Deals a fresh game, as `specs/deal.md` states, and moves to `playing`. |
| `HOW TO PLAY` | Moves to `howto`. |

The table may show behind the screen, dimmed or otherwise quieted, if that suits
the look you design.

### `howto`

How to play, written in a player's words rather than as rules of a system. It
covers:

- the goal, which is to build all four foundations from Ace to King;
- that a column builds down in rank and alternates in color, and that only a King
  fills an empty column;
- that the stock turns cards onto the waste and recycles when it runs out;
- how a card is moved, and that a card is sent home by double-clicking it.

Whatever wording it uses, the screen carries each of these four tokens as a
standalone word: `ACE`, `KING`, `STOCK`, and `DOUBLE-CLICK`.

The screen carries one control, labelled `HOWTO_BACK_LABEL` (`BACK`) and drawn
inside the `HOWTO_BACK` rectangle. It returns to `title`.

### `playing`

The live table. It draws all thirteen piles at the anchors `specs/table.md`
fixes, the run in hand and the highlighted drop target `specs/controls.md`
describes, and the HUD below.

### `won`

Reached by the win, as `specs/victory.md` states. The victory cascade runs over
the table, and once it is done the screen shows `WIN_TEXT` (`YOU WIN`) over the
painted table. A press deals a fresh game and returns to `playing`, as
`specs/victory.md` states.

## The HUD

The HUD occupies the strip `specs/table.md` fixes along the bottom of the table,
so it never overlaps a pile. It is drawn on the `playing` screen and carries
three controls and one label.

| Item | Constant | Rectangle | Does |
| --- | --- | --- | --- |
| `NEW GAME` | `HUD_ITEMS[0]` | `HUD_NEW_GAME` | Deals a fresh game and stays on `playing`. |
| `MENU` | `HUD_ITEMS[1]` | `HUD_MENU` | Returns to `title`. |
| `SOUND` | `HUD_ITEMS[2]` | `HUD_SOUND` | Toggles muting, as `specs/audio.md` states. |

`HUD_ITEMS` is `["NEW GAME", "MENU", "SOUND"]`, and each label is drawn inside
its own rectangle. `DEAL_MODE_LABEL` is drawn in the strip as well, so the deal
mode is visible throughout play.

The HUD carries nothing else. There is no score, no move counter, and no clock.

## Out of scope

- Other patience games. This build is the Klondike this specification describes.
- A score, a timer, statistics, hints, an auto-solver, and undo.
- Persistence of a game or a setting between sessions. Each session starts fresh.
- Network, online, or multiplayer play, and gamepad input.
