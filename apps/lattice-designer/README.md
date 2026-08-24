# Lattice Factory Designer

A drag-and-drop authoring tool for [Lattice](../../test-cases/performance/hard/lattice)
factory layouts. Lay a factory out by hand, watch it run through the **real**
`lattice-core` engine, and either open/save the case's own scenarios in place or
export the design as a fresh `scenario.json`.

This is a **dev-only tool**, not part of the shipped product. Its purpose is to cut
the time it takes to design a factory that exercises exactly the components you want
to test a model on. It designs the _layout_ and its timeline; it does not score,
measure fuel, or generate expected state — after saving a scored scenario you still
have to re-solve its oracle and regenerate the playback bundle (see **Saving a scored
scenario** below).

## Run it

```sh
npm install                       # once, from the repo root (adds this workspace)
npm run dev -w @test-cabinet/lattice-designer
```

Then open the printed URL (defaults to <http://localhost:1431>).

## Using it

- **Open** — pick a scenario from the toolbar's file menu to load the case's own
  `cases/*.json` (`small`, `medium`, `large`) onto the board, grid and all. The
  layout is normalised into the editor's model, and placement order is preserved —
  the scenario contract reads that order as the order of the canonical state.
- **Save** — writes the open scenario back to the same file. It lights up only when
  the design differs from what is on disk, so opening a file and saving it unedited
  is impossible (and would be a no-op: the round trip is byte-for-byte identical).
- **Place** — pick a component in the left palette, set its options (belt tier;
  source item / lane / period; machine recipe), and left-click a tile. Belts paint
  in a stroke if you drag. Press **R** (or the Rotate button) to change facing.
  A belt's **tier** is a real throughput choice, not a recolour — the palette names
  each tier with its speed (`slow` 32 u/tick, `fast` 64, `express` 96) and how long
  it takes an item to cross one tile.
- **Delete** — right-click a component. Anything riding it disappears too (the sim
  replays from the component list, so there is no stale item state to clean up).
- **Edit** — the **Select** tool: click a placed component to edit it in the right
  inspector.
- **Watch** — the factory simulates continuously through `lattice-core`. Any edit
  replays the preview window from an empty start, so a component starts working the
  moment it has what it needs.
- **Export** — **Export** (download) or **Copy**, for a design that is not one of
  the case's committed scenarios. A fresh design's `ticks`/`snapshots` start as
  placeholders (evenly spaced quarters); an opened scenario keeps its own.
- **Timeline** — `ticks` and `snapshots` are shown in the toolbar and edited by
  hand. They are never regenerated behind your back, because a scored schedule is
  not derivable: the case grades at quarter/half/end **plus** two ticks inside the
  browser-playback window (`1250`/`2500`). A schedule the engine would reject —
  empty, out of order, or past the end — blocks the save and says why.

## Saving a scored scenario

Saving writes the layout. It does **not** update anything derived from it, and a
scored scenario has two such things. After saving `medium` or `large`, from the
case's version folder:

```sh
# from test-cases/performance/hard/lattice/v1.0.0/
lattice solve --scenario cases/<name>.json --out cases/<name>.out  # the answer key
node replay/assets/gen-reference.mjs                               # playback bundle

# from the repo root
node scripts/vendor-lattice-assets.mjs                             # re-vendor to the UI
```

Then re-check the fuel gate (the transport reference under the ceiling, naive over
it) — `test-case.toml` documents the commands and the current figures. A layout
change with a stale `.out` fails every correct submission, which is exactly the
failure this tool makes easy to cause.

## How it reuses the engine

There is no second simulation here. The tool aliases straight to the console UI's
Lattice player (`@test-cabinet/ui`'s `pages/runs/lattice`) for:

- the **engine** — `lattice-core` compiled to wasm (the same one the CLI, validator,
  and run player use), stepped through its playback ABI;
- the **renderer** and sprite sheet — so a factory here draws pixel-identically to a
  run's playback.

"Live" editing is **reset-and-replay**: on each edit the design is projected to a
scenario, the engine is reloaded from empty, and the preview window is stepped into a
frame cache the render loop interpolates over and loops. The known cost is that
editing (and the loop wrap) restarts the window from empty; a future live-edit engine
ABI is what removes that.

## Reading and writing files

The browser cannot touch the repository, so the **vite dev server** does the file
I/O, through a small plugin (`scenario-api.ts`) mounted only under `vite dev`:

| Route | What it does |
| --- | --- |
| `GET /api/scenarios` | lists the case's `cases/*.json` with grid, timeline, and component count |
| `GET /api/scenarios/<name>` | reads one scenario |
| `PUT /api/scenarios/<name>` | overwrites it with the request body |

The write surface is deliberately narrow: only files that **already exist** directly
inside that one folder can be read or written — no traversal, no creating new files
in the scored set. A body that is not valid JSON is refused rather than written. A
statically built bundle has no dev server, so the open/save controls simply do not
appear and Export/Copy remains.
