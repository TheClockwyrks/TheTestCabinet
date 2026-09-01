# Orrery — Challenge and solution formats

This file defines the two JSON documents the game speaks: a challenge, which
states a puzzle, and a solution, which states a machine. The fixed challenges
in `specs/challenges.md` are written in the challenge format, the build's own
campaign is authored in it, and the debugging surface in
`specs/instrumentation.md` accepts and returns both formats. Both are plain
JSON: objects, arrays, strings, whole numbers, and booleans.

## Molecules

A molecule pattern describes a shape of motes in the relative hex coordinates
of `specs/field.md`:

```json
{
  "motes": [{ "q": 0, "r": 0, "type": "luna" }],
  "filaments": [{ "a": { "q": 0, "r": 0 }, "b": { "q": 1, "r": 0 }, "weight": 1 }],
  "repeat": {
    "vector": { "q": 1, "r": 0 },
    "link": { "a": { "q": 0, "r": 0 }, "b": { "q": 1, "r": 0 }, "weight": 1 }
  }
}
```

- `motes` is non-empty. Each entry places one mote type at `(q, r)`, and no
  two entries share a hex. `type` is any member of `MOTES` in
  `specs/field.md`.
- `filaments` lists the links. Each joins two distinct mote hexes of this
  molecule that are adjacent, `weight` is `1` or `3`, and no pair appears
  twice. The list may be empty. Every molecule pattern is connected: its motes
  and filaments form one constellation, so a one-mote pattern carries no
  filament and every larger pattern carries enough to join every mote.
- `repeat` appears on repeating products alone, and is absent otherwise. Its
  `vector` is a non-zero hex offset, and `link` names the filament joining
  each copy to the next: `a` is a mote hex of the pattern, `b` minus `vector`
  is a mote hex of the pattern, and `a` and `b` are adjacent. `link`'s
  `weight` is `1` or `3` like any filament, and the pattern and the pattern
  translated once by `vector` share no hex. A reader treats an absent `repeat`
  and a `repeat` of `null` alike. What a repeating set accepts is defined in
  `specs/sigils.md`.

## Challenges

```json
{
  "name": "Twin Moons",
  "reagents": [{ "motes": [{ "q": 0, "r": 0, "type": "luna" }], "filaments": [] }],
  "products": [
    {
      "motes": [
        { "q": 0, "r": 0, "type": "luna" },
        { "q": 1, "r": 0, "type": "luna" }
      ],
      "filaments": [{ "a": { "q": 0, "r": 0 }, "b": { "q": 1, "r": 0 }, "weight": 1 }]
    }
  ],
  "permitted": ["arm", "bind"],
  "target": 6
}
```

- `name` is the challenge's display name, `1` to `NAME_MAX` (`32`) characters.
- `reagents` and `products` are non-empty lists of molecules.
- `permitted` is non-empty and lists the part kinds the tray offers, in any
  order and without duplicates. Each entry is one of the kinds of `PARTS` in
  `specs/parts.md` up to and including `void`. The tray derives one `rise` per
  reagent and one `set` per product. The derived tray, `permitted` plus one
  entry per reagent and per product, holds at most `TRAY_MAX` (`16`) entries.
- `target` is the tally every set must reach, at least `1`. Every challenge
  in this game uses `CONSTELLATION_TARGET` (`6`).

A challenge is well formed when all of the above hold and every pattern fits
the field. Some placement of each reagent lies entirely on the field, and some
placement of each product's footprint lies entirely on the field. A set's
footprint is defined in `specs/parts.md`.

## Solutions

A solution is a machine for a given challenge: the placed parts with their
poses and tapes.

```json
{
  "parts": [
    { "kind": "rise", "index": 0, "q": -2, "r": 0, "rotation": 0 },
    { "kind": "set", "index": 0, "q": 2, "r": 0, "rotation": 0 },
    {
      "kind": "arm",
      "q": 0,
      "r": 0,
      "rotation": 3,
      "length": 2,
      "tape": [
        "grab", "rotate-cw", "rotate-cw", "rotate-cw",
        "drop", "rotate-ccw", "rotate-ccw", "rotate-ccw"
      ]
    },
    {
      "kind": "track",
      "cells": [{ "q": 0, "r": 2 }, { "q": 1, "r": 2 }, { "q": 2, "r": 2 }],
      "closed": false
    }
  ]
}
```

Every part carries `kind`. The rest varies by class:

| Class | Keys |
| --- | --- |
| Arms and wheels | `q`, `r`, `rotation` (`0` to `5`), `length` (`1` to `3`; wheels always `1`), `tape`. |
| `track` | `cells`, the path in order, and `closed`. A track carries no `q`, `r`, or `rotation`; its anchor is the first cell of `cells` and its rotation is `0`. |
| Sigils | `q`, `r`, `rotation`. |
| `rise`, `set` | `q`, `r`, `rotation`, and `index`: which reagent or product, from `0`. |

The order of `parts` is the machine's placement order, which fixes the tape
panel's row order and the part indices the debug surface reports.

A `tape` is a list whose entries are instruction names from `INSTRUCTIONS` in
`specs/instructions.md` or `null` for a blank. Its last entry is an
instruction, and an entirely blank tape is the empty list. A tape may hold any
number of entries. Every arm and wheel carries a `tape`, possibly empty.

A solution is legal for a challenge when every part is a permitted kind or a
rise or set the challenge derives, every placement rule of `specs/parts.md`
holds across the whole list, and every rise and set index exists. A legal
solution may omit any part, the rises and sets included, and `parts` may be
empty. Loading and reading solutions is defined in `specs/instrumentation.md`,
and the stored solutions a build ships are named in `specs/modes/campaign.md`
and `specs/modes/extras.md`.
