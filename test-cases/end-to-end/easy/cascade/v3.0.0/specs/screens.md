# Cascade — The screens and the HUD

This file defines the four screens the game moves between, what each one shows,
and the three controls of the HUD. The controls each screen carries and how the
menus over them are driven are in `specs/controls.md`, and the table the
`playing` screen draws is in `specs/table.md`. Every piece of screen copy below
carries the name this specification gives it, and the literal text it names is
the text that is drawn.

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

There is no pause screen. The game is untimed and nothing on the table moves
between one gesture and the next, so play carries nothing to interrupt: leaving a
game for the title is the whole of stepping away from it.

### `title`

| Element | Constant | Content |
| --- | --- | --- |
| Title | `TITLE_TEXT` | `CASCADE` |
| Tagline | `TAGLINE_TEXT` | `KLONDIKE SOLITAIRE` |
| Items | `TITLE_ITEMS` | `NEW GAME`, `HOW TO PLAY`, in that order |
| Deal-mode label | `DEAL_MODE_LABEL` | This build's label, as `specs/stock.md` states |

The two items are the title's menu, in that order. The deal-mode label is drawn
somewhere on the screen so a player sees which deal the game is played with.

| Item | Does |
| --- | --- |
| `NEW GAME` | Deals a fresh game, as `specs/deal.md` states, and moves to `playing`. |
| `HOW TO PLAY` | Moves to `howto`. |

Activating either item sets `titleIndex` to that item's index, so `titleIndex` is
`0` after `NEW GAME` and `1` after `HOW TO PLAY`.

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

The screen carries one control, labelled `HOWTO_BACK_LABEL` (`BACK`). Activating
it returns to `title`. It is the screen's only item, so `menuIndex` is `0`
throughout.

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

| Item | Constant | Does |
| --- | --- | --- |
| `NEW GAME` | `HUD_ITEMS[0]` | Deals a fresh game and stays on `playing`. |
| `MENU` | `HUD_ITEMS[1]` | Returns to `title`. |
| `SOUND` | `HUD_ITEMS[2]` | Toggles muting, as `specs/audio.md` states. |

`HUD_ITEMS` is `["NEW GAME", "MENU", "SOUND"]`. The three are the HUD's menu, in
that order. Every deal that begins play selects the first of them, so `menuIndex`
is `0` when a fresh game starts. `DEAL_MODE_LABEL` is drawn in the strip as well,
so the deal mode is visible throughout play.

The HUD carries nothing else. There is no score, no move counter, and no clock.

## Returning to the title

`BACK` on the how-to screen and `MENU` on the HUD both return to `title` with
`menuIndex` set to `titleIndex`, the title entry last activated. So leaving the
how-to screen returns to `title` with `HOW TO PLAY` selected, and leaving a game
returns with the entry that started that game selected.
