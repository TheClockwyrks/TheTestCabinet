# Lattice Factory Designer

A drag-and-drop authoring tool for [Lattice](../../test-cases/performance/hard/lattice)
factory layouts. Lay a factory out by hand, watch it run through the **real**
`lattice-core` engine, and export the design as a `scenario.json`.

This is a **dev-only tool**, not part of the shipped product. Its purpose is to cut
the time it takes to design a factory that exercises exactly the components you want
to test a model on. It designs the _layout_; it does not score, measure fuel, or
generate expected state — that plumbing is reconstructed around the exported design
when the real case is wired.

## Run it

```sh
npm install                       # once, from the repo root (adds this workspace)
npm run dev -w @test-cabinet/lattice-designer
```

Then open the printed URL (defaults to <http://localhost:1431>).

## Using it

- **Place** — pick a component in the left palette, set its options (belt tier;
  source item / lane / period; machine recipe), and left-click a tile. Belts paint
  in a stroke if you drag. Press **R** (or the Rotate button) to change facing.
- **Delete** — right-click a component. Anything riding it disappears too (the sim
  replays from the component list, so there is no stale item state to clean up).
- **Edit** — the **Select** tool: click a placed component to edit it in the right
  inspector.
- **Watch** — the factory simulates continuously through `lattice-core`. Any edit
  replays the preview window from an empty start, so a component starts working the
  moment it has what it needs.
- **Export** — **Export scenario.json** (download) or **Copy**. The `ticks` and
  `snapshots` in the export are placeholders for the layout hand-off; set the real
  scored run length when wiring the case.

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
