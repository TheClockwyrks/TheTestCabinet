# Showcase capture driver

`base.showcase-capture.test.ts` (re)records the `base` variant's
`showcase/base/expedition.json.gz` replay and its two stills from the
`structured-2d` reference implementation, playing a REAL expedition: the title
menu is walked with the confirm key, a shaft is sunk from the camp with `down`
held through whole runs of rows, every vein the shaft wall shows is cut out
sideways, the dig turns around when the cargo bay fills or the fuel gauge says
the climb home is only just affordable, the loaded haul is flown out of the
shaft, and the sale at the Ore Market pays for the tank that gets refilled at
the Fuel Depot.

What the driver touches on the debug surface is input and readings, and nothing
else:

| Call                                    | Why it is not a pose                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `reset()`                               | Leaves the game on its title screen, exactly as a launched build opens; the mine the expedition then generates is the game's own.          |
| `snapshot()`, `tileAt()`, `buildings()` | Readings. They change nothing.                                                                                                             |
| `sell()`, `fillFuel()`                  | The named counterparts of the two panel controls a player clicks. Each runs the game's own rule for that control on the game as it stands. |

Everything else is keys, held and released through the engine's own input. No
cell is posed, no ore is placed, and no fuel, hull or Credit is set: the mine is
the one the game generated, every unit in the bay was drilled out of a wall, and
the fuel left at the surface is what the descent and the climb actually cost.

## Running it

Capture from a PRIVATE copy of the reference, never from the reference
directory itself: `tcab capture-baselines` runs `npm ci`, `npm run build` and
the whole validator project in place there, so anything else living in it is
destroyed, and a concurrent `npm ci` corrupts the install for both.

```sh
WORK=/tmp/deepcore-showcase-capture
REF=test-cases/full-stack/medium/deepcore/v2.0.0/references/structured-2d
CASE=test-cases/full-stack/medium/deepcore/v2.0.0

rm -rf "$WORK" && mkdir -p "$WORK"
cp -r "$REF"/src "$REF"/assets "$REF"/public "$WORK"/
cp "$REF"/package.json "$REF"/tsconfig.json "$REF"/vite.config.ts \
  "$REF"/vitest.config.ts "$REF"/index.html "$WORK"/
ln -s "$PWD/$REF/node_modules" "$WORK"/node_modules
cp -r "$CASE"/validation/structured-2d "$WORK"/validation
cp "$CASE"/showcase/capture/base.showcase-capture.test.ts \
  "$WORK"/validation/showcase-capture.test.ts

# Let the capture keep more frames than the validators' 300-frame replay cap.
sed -i 's/^const MAX_REPLAY_FRAMES = 300;$/const MAX_REPLAY_FRAMES = Number(\
  process.env.TCAB_SHOWCASE_MAX_REPLAY_FRAMES ?? "300",\
);/' "$WORK"/validation/harness.ts

cd "$WORK"
TCAB_VALIDATION_MEDIA_DIR=/tmp/deepcore-showcase-out \
  TCAB_SHOWCASE_MAX_REPLAY_FRAMES=1200 \
  npx vitest run --config validation/vitest.config.ts \
  validation/showcase-capture.test.ts
```

The outputs land under
`$TCAB_VALIDATION_MEDIA_DIR/validation/showcase-capture.test.ts/`, and the last
line of the log names the winning take and what each of its files is committed
as:

| Take file            | Committed as                        |
| -------------------- | ----------------------------------- |
| `take-NN.json.gz`    | `showcase/base/expedition.json.gz`  |
| `take-NN-shaft.png`  | `showcase/base/loaded-at-depth.png` |
| `take-NN-market.png` | `showcase/base/the-haul-priced.png` |

Delete `$WORK` afterwards. It is a copy, so nothing in the case or the reference
depends on it.

## How the audition works

Every expedition opens on a mine the game generates afresh, so no take can be
played twice. Each take is therefore played under the recorder and judged as it
stands, the files of every take are kept, and the driver names the winner. The
take that was judged is the take that was recorded, and the losers' files are
simply not committed.

The judge scores what makes this game read in one clip: the bay filled, the load
carried, the Credits the haul paid, the hull brought home intact, a clip inside
the length bounds, the loop closed by refuelling, and above all a THIN fuel
margin at the surface. Deepcore's hook is fuel spent going down against ore
weight coming up, so a climb that lands with a quarter tank scores and one that
lands with two-thirds does not. An empty tank at the surface is a stranding by
another name and is punished as one.

## The knobs

| Variable                          | Default | What it does                                                                                  |
| --------------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `TCAB_SHOWCASE_MAX_REPLAY_FRAMES` | `300`   | The harness's replay cap, patched above to read it.                                           |
| `TCAB_SHOWCASE_TAKES`             | `24`    | How many takes are auditioned. One take is one generated mine and one expedition.             |
| `TCAB_SHOWCASE_DEPTH`             | `44`    | How far down the plan looks. The turnaround is decided by the bay and the gauge, not by this. |
| `TCAB_SHOWCASE_RESERVE_PER_ROW`   | `1.25`  | Fuel per row held back for the climb home.                                                    |
| `TCAB_SHOWCASE_RESERVE_FLOOR`     | `6`     | Fuel held back on top of that, for the drift off the shaft.                                   |
| `TCAB_SHOWCASE_EXIT_Y`            | `-20`   | The height the climb's thrust is cut at, in world units above the camp ground line.           |
| `TCAB_SHOWCASE_MIN_SECONDS`       | `24`    | Clips shorter than this are judged unwatchable.                                               |
| `TCAB_SHOWCASE_MAX_SECONDS`       | `40`    | And longer than this.                                                                         |

## Two traps this driver is written around

**`miner.row` is not an arrival signal.** It flips PART-WAY through a down cut,
while the target cell is still solid, so a driver that releases `down` there lets
collision push the miner back onto the cell it was cutting and pays for the row
twice. This driver holds `down` across whole runs of rows and ends each hold on
the frame the target cell actually reads as tunnel.

**A miner that lets go of thrust over its own shaft falls back down it.** The
climb therefore carries the box clear of the camp ground line before the drift
starts. It also stops the burn early rather than thrusting to the top of the arc:
a fall from the top of a full burn lands above `IMPACT_SAFE_SPEED` and costs hull
that the take is then judged down for.

## The replay's frame rate

At 60 Hz this game's recording runs about 3 KB a frame compressed, because the
mine scrolls continuously and so almost nothing between two frames is the same
draw. A whole take of this length recorded at 60 fps is therefore over six
megabytes, which is a slow first entry for a catalog preview. The harness thins
by an integral stride, so a cap of `1200` on a 2,324-frame take keeps every
second frame: 1,162 frames, playing at their real speed at 30 fps, in about three
and a half megabytes. The next stride down, at a cap of `1100`, gives 20 fps and
2.1 MB, which is too coarse for the climb.

The take itself is always PLAYED at 60 Hz whatever the cap. The drill lands a hit
every `0.125` seconds, which 60 divides exactly and 30 does not, and the same
expedition played at 30 Hz spends enough extra fuel on the way down to strand the
miner on the way up.

## What is committed

The committed take was recorded by an earlier form of this driver, which
auditioned twenty-four takes without the recorder and played the winner again
under it; it has not been re-recorded since the driver took its present shape.
At a cap of `1200` it is: a shaft sunk from the camp to row 32 (160 m), the bay
filled to 15 of 15 slots at 244 kg, four ores worth 1,024 Credits on the counter,
the hull untouched, and the climb landing on 12 of 100 fuel — 38.7 seconds end to
end. It scored 191 against a field whose
next best was 180.
