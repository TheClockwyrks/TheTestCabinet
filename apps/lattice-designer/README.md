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
npm run dev -w @clockwyrks/lattice-designer
```

Then open the printed URL (defaults to <http://localhost:1431>).

## The rule this tool is built to

**A change that can cost you work is staged and applied explicitly, and an apply
that would set components aside confirms first.**

There is no undo anywhere in the designer, so nothing here may act on a side effect
of you moving around. Concretely:

- **Nothing applies itself.** The board's `W`/`H` fields are a _draft_. Typing in
  them, tabbing out of them, clicking the canvas and walking away all change nothing
  at all — the board changes when you press **Apply** (or **Enter** inside a field,
  which is that same button reached from the keyboard). While the draft disagrees
  with the board, the fields are highlighted and the toolbar says both sizes, so the
  gap is never something you have to infer. **Esc** puts the draft back.
- **Anything that would cost components asks first**, through the designer's own
  modal — never the browser's `confirm()`, because the question needs more than a
  line of plain text. It names how many components leave the board, that they are
  not deleted, and that they are **not written when the file is saved**. Cancelling
  leaves the board, the components and the selection exactly as they were: the
  resize is planned before the question and thrown away if the answer is no.
- **Nothing is deleted to make it fit.** A smaller board, and a file loaded onto a
  board too small for it, both **set aside** what does not fit rather than dropping
  it; growing the board brings it back, in place and in order.
- **Controls that cost nothing stay live.** A belt's tier, a source's period, a
  machine's recipe, the palette's settings, play/pause and speed all apply as you
  change them. Making the whole tool modal for changes that are free would be worse
  than the defect it guarded against.

## Using it

- **Open** — pick a scenario from the toolbar's file menu to load the case's own
  `cases/*.json` (`small`, `medium`, `large`) onto the board, grid and all. The
  layout is normalised into the editor's model, and placement order is preserved —
  the scenario contract reads that order as the order of the canonical state.
- **Import here** — loads a scenario's components onto the **current** board
  instead of adopting its grid. Anything whose footprint falls outside is **set
  aside**, not dropped — grow the board afterwards and the rest comes in, with no
  need to import again. Whatever file is open stays the save target.
- **Save** — writes the open scenario back to the same file. It lights up only when
  the design differs from what is on disk, so opening a file and saving it unedited
  is impossible (and would be a no-op: the round trip is byte-for-byte identical).
  Saving while components are **set aside** asks first: the file gets what is on the
  board, and it is the only copy that survives closing the tab.
- **Board size** — `W`/`H` are a draft and **Apply** is the action; the presets
  apply straight away, because a preset click is already the deliberate act the
  draft exists to require. Both routes ask the same question before taking anything
  off the board. Apply is greyed out, with the reason on hover, while the draft says
  nothing usable or names the size the board already is. Whatever no longer fits is
  **set aside** — the toolbar says how many — and comes back when the board grows
  over it again, keeping its place in the order. Set-aside components are not
  exported, so save at the size you mean.
- **Place** — pick a component in the left palette, set its options (belt tier;
  source item / lane / period; machine recipe), and left-click a tile. Belts paint
  in a stroke if you drag. Press **R** (or the Rotate button) to change facing.
  A belt's **tier** is a real throughput choice, not a recolour — the palette names
  each tier with its speed (`slow` 32 u/tick, `fast` 64, `express` 96) and how long
  it takes an item to cross one tile.
- **Delete** — right-click a component, or use the inspector's Delete button.
  Anything riding it disappears too (the sim replays from the component list, so
  there is no stale item state to clean up). These really are immediate: one
  component, aimed at deliberately, is the one case where a dialog would cost more
  than it saves. **Clear**, which empties the whole board, asks first — and so does
  **Open** or **Import here** when it would replace work nothing else holds a copy
  of.
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
  browser-playback window (`1250`/`2500`). Both fields apply on leaving them or on
  **Enter**, with **Esc** to abandon the edit, and an emptied one is read as an
  abandoned edit rather than as a request for an empty schedule. They hold their
  typing rather than committing per keystroke — a run length must not pass through
  `1` on the way to `100000` — but they are not staged behind an Apply like the
  board size is, because applying one costs nothing: it overwrites a number you can
  simply retype, and takes no components with it. A schedule the
  engine would reject — empty, out of order, or past the end — blocks the save and
  says why.

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
Lattice player (`@clockwyrks/ui`'s `pages/runs/lattice`) for:

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

| Route                       | What it does                                                             |
| --------------------------- | ------------------------------------------------------------------------ |
| `GET /api/scenarios`        | lists the case's `cases/*.json` with grid, timeline, and component count |
| `GET /api/scenarios/<name>` | reads one scenario                                                       |
| `PUT /api/scenarios/<name>` | overwrites it with the request body                                      |

The write surface is deliberately narrow: only files that **already exist** directly
inside that one folder can be read or written — no traversal, no creating new files
in the scored set. A body that is not valid JSON is refused rather than written. A
statically built bundle has no dev server, so the open/save controls simply do not
appear and Export/Copy remains.
