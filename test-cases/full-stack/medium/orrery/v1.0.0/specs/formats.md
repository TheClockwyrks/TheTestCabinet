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
  "filaments": [{ "a": [0, 0], "b": [1, 0], "weight": 1 }],
  "repeat": { "vector": [1, 0], "link": { "a": [0, 0], "b": [1, 0], "weight": 1 } }
}
```

- `motes` is non-empty. Each entry places one mote type at `(q, r)`, and no
  two entries share a hex. `type` is any member of `MOTES` in
  `specs/field.md`.
- `filaments` lists the links. Each joins two distinct mote hexes of this
  molecule that are adjacent, `weight` is `1` or `3`, and no pair appears
  twice. The list may be empty and the pattern need not be connected as
  authored, though a rise spawns and a set matches whole constellations, so
  reagents and plain products are connected in practice.
- `repeat` appears on repeating products alone, and is absent otherwise. Its
  `vector` is a non-zero hex offset, and `link` names the filament joining
  each copy to the next: `a` is a mote hex of the pattern, `b` minus the
  vector is a mote hex of the pattern, and the two land adjacent. What a
  repeating set accepts is defined in `specs/sigils.md`.

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
      "filaments": [{ "a": [0, 0], "b": [1, 0], "weight": 1 }]
    }
  ],
  "permitted": ["arm", "bind"],
  "target": 6
}
```

- `name` is the challenge's display name, non-empty.
- `reagents` and `products` are non-empty lists of molecules. A reagent never
  carries `repeat`.
- `permitted` lists the part kinds the tray offers, in any order and without
  duplicates, from the mechanism and sigil kinds of `PARTS` in
  `specs/parts.md`; `rise` and `set` are never listed, because the tray
  derives them from the reagents and products. The derived tray,
  `permitted` plus one entry per reagent and per product, holds at most
  `TRAY_MAX` (`16`) entries.
- `target` is the tally every set must reach, at least `1`. Every challenge
  in this game uses `CONSTELLATION_TARGET` (`6`).

A challenge is well formed when all of the above hold and every pattern fits
the field: some placement of each reagent and product lies entirely on it.

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
    { "kind": "track", "cells": [[0, 2], [1, 2], [2, 2]], "closed": false }
  ]
}
```

Every part carries `kind`. The rest varies by class:

| Class | Keys |
| --- | --- |
| Arms and wheels | `q`, `r`, `rotation` (`0` to `5`), `length` (`1` to `3`; wheels always `1`), `tape`. |
| `track` | `cells`, the path in order, and `closed`. |
| Sigils | `q`, `r`, `rotation`. |
| `rise`, `set` | `q`, `r`, `rotation`, and `index`: which reagent or product, from `0`. |

A `tape` is a list whose entries are instruction names from
`specs/instructions.md` or `null` for a blank. The two macros never appear;
a solution carries what they expand to.

A solution is legal for a challenge when every part is a permitted kind or a
rise or set the challenge derives, every placement rule of `specs/parts.md`
holds across the whole list, and every rise and set index exists. Legality
does not require completeness: a solution may omit rises, sets, or
everything, exactly as a hand-built machine may. Loading and reading
solutions is defined in `specs/instrumentation.md`, and the stored solutions
a build ships are named in `specs/modes/campaign.md` and
`specs/modes/extras.md`.
