// Wireworm — the whole build, driven the way a player drives it.
//
// Every check here stands the REAL runtime up over a canvas and a keyboard of
// its own and presses keys at it, so what is checked is the game a browser would
// run: the bindings, the screens they move between, the cues the events raise,
// and the mute bit the runtime owns.

import { beforeAll, describe, expect, test } from "vitest";
import {
  BANNER_TIME,
  CHARGE_MAX,
  CURSOR_Y_MAX,
  CURSOR_Y_MIN,
  ENDING_ITEMS,
  PAUSE_ITEMS,
  START_LIVES,
  TITLE_ITEMS,
  TOTAL_LEVELS,
  tileCX,
  tileCY,
  wormStepInterval,
} from "./constants";
import type { Sprites } from "./assets";
import {
  createRig,
  loadTestSprites,
  startPlaying,
  type Rig,
} from "./harness.test-support";

let sprites: Sprites;

beforeAll(async () => {
  sprites = await loadTestSprites();
});

/** A frame, so a press is read and acted on. */
function frame(rig: Rig): void {
  rig.runtime.advance(1 / 60, 1);
}

/** Press a key and run the frame that reads it. */
function tap(rig: Rig, code: string): void {
  rig.press(code);
  frame(rig);
}

/** A rig on the title screen, off the wall clock. */
function onTitle(): Rig {
  const rig = createRig(sprites);
  rig.debug.reset();
  return rig;
}

/** A rig on a live, empty board with the world gates off. */
function posed(level = 1): Rig {
  const rig = createRig(sprites);
  startPlaying(rig, level);
  return rig;
}

describe("the title screen", () => {
  test("the game opens on the title, with the first item highlighted", () => {
    const rig = onTitle();
    const shot = rig.debug.snapshot();
    expect(shot.screen).toBe("title");
    expect(shot.menuIndex).toBe(0);
    rig.dispose();
  });

  test("the highlight moves and wraps at both ends", () => {
    const rig = onTitle();
    tap(rig, "ArrowDown");
    expect(rig.debug.snapshot().menuIndex).toBe(1);
    tap(rig, "ArrowDown");
    expect(rig.debug.snapshot().menuIndex).toBe(0);
    tap(rig, "ArrowUp");
    expect(rig.debug.snapshot().menuIndex).toBe(TITLE_ITEMS.length - 1);
    rig.dispose();
  });

  test("moving the highlight sounds the menu cue, once per move", () => {
    const rig = onTitle();
    rig.press("Space");
    frame(rig);
    rig.debug.reset();
    rig.audio.reset();
    tap(rig, "ArrowDown");
    expect(rig.audio.started()).toBe(1);
    rig.dispose();
  });

  test("confirming DESCEND opens a run at level 1 with three lives", () => {
    const rig = onTitle();
    tap(rig, "Enter");
    const shot = rig.debug.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.level).toBe(1);
    expect(shot.reachedLevel).toBe(1);
    expect(shot.lives).toBe(START_LIVES);
    expect(shot.score).toBe(0);
    expect(shot.nodes.length).toBeGreaterThan(0);
    rig.dispose();
  });

  test("Space confirms exactly as Enter does", () => {
    const rig = onTitle();
    tap(rig, "Space");
    expect(rig.debug.snapshot().screen).toBe("playing");
    rig.dispose();
  });

  test("confirming HOW TO PLAY opens the how-to screen, and back returns", () => {
    const rig = onTitle();
    tap(rig, "ArrowDown");
    tap(rig, "Enter");
    expect(rig.debug.snapshot().screen).toBe("howto");
    tap(rig, "Escape");
    const shot = rig.debug.snapshot();
    expect(shot.screen).toBe("title");
    // The return selects the entry it left from (specs/ui.md).
    expect(shot.menuIndex).toBe(TITLE_ITEMS.indexOf("HOW TO PLAY"));
    rig.dispose();
  });

  test("back does nothing on the title screen", () => {
    const rig = onTitle();
    tap(rig, "Escape");
    expect(rig.debug.snapshot().screen).toBe("title");
    rig.dispose();
  });
});

describe("the keys the cursor answers to", () => {
  /** Hold a key for a fifth of a second on a live board and report the move. */
  function held(
    code: string,
    from: { x: number; y: number },
  ): {
    x: number;
    y: number;
  } {
    const rig = posed();
    rig.debug.setCursor(from.x, from.y);
    rig.down(code);
    rig.runtime.advance(0.2, 12);
    rig.up(code);
    const cursor = rig.debug.snapshot().cursor;
    rig.dispose();
    return { x: cursor.x, y: cursor.y };
  }

  const mid = { x: 640, y: 688 };

  test("the left keys lower the cursor's x and hold its y", () => {
    for (const code of ["ArrowLeft", "KeyA"]) {
      const at = held(code, mid);
      expect(at.x).toBeLessThan(mid.x);
      expect(at.y).toBe(mid.y);
    }
  });

  test("the right keys raise the cursor's x and hold its y", () => {
    for (const code of ["ArrowRight", "KeyD"]) {
      const at = held(code, mid);
      expect(at.x).toBeGreaterThan(mid.x);
      expect(at.y).toBe(mid.y);
    }
  });

  test("the up keys lower the cursor's y inside the band", () => {
    for (const code of ["ArrowUp", "KeyW"]) {
      const at = held(code, { x: 640, y: CURSOR_Y_MAX });
      expect(at.y).toBe(CURSOR_Y_MIN);
      expect(at.x).toBe(640);
    }
  });

  test("the down keys raise the cursor's y inside the band", () => {
    for (const code of ["ArrowDown", "KeyS"]) {
      const at = held(code, { x: 640, y: CURSOR_Y_MIN });
      expect(at.y).toBe(CURSOR_Y_MAX);
      expect(at.x).toBe(640);
    }
  });

  test("releasing a movement key stops the cursor", () => {
    const rig = posed();
    rig.debug.setCursor(640, 688);
    rig.down("ArrowRight");
    rig.runtime.advance(0.2, 12);
    rig.up("ArrowRight");
    const rested = rig.debug.snapshot().cursor.x;
    rig.runtime.advance(0.5, 30);
    expect(rig.debug.snapshot().cursor.x).toBe(rested);
    rig.dispose();
  });

  test("Space fires a bolt in the cursor's column", () => {
    const rig = posed();
    rig.debug.setCursor(tileCX(20), 688);
    rig.debug.setFireCooldown(0);
    rig.down("Space");
    frame(rig);
    rig.up("Space");
    const bolts = rig.debug.snapshot().bolts;
    expect(bolts).toHaveLength(1);
    expect(bolts[0].x).toBe(tileCX(20));
    rig.dispose();
  });
});

describe("pausing", () => {
  test("either pause key opens the pause screen during play", () => {
    for (const code of ["KeyP", "Escape"]) {
      const rig = posed();
      tap(rig, code);
      expect(rig.debug.snapshot().screen).toBe("paused");
      rig.dispose();
    }
  });

  test("a paused game is exactly where it was paused", () => {
    const rig = posed();
    rig.debug.addWorm(4, 9);
    rig.debug.addFoe("glitch", tileCX(20), tileCY(9));
    tap(rig, "KeyP");
    const before = rig.debug.snapshot();
    rig.audio.reset();
    rig.runtime.advance(1, 60);
    const after = rig.debug.snapshot();
    expect(after.worms).toEqual(before.worms);
    expect(after.foes).toEqual(before.foes);
    expect(rig.audio.started()).toBe(0);
    rig.dispose();
  });

  test("the back binding resumes, leaving the board as it was", () => {
    const rig = posed();
    rig.debug.addWorm(4, 9);
    tap(rig, "KeyP");
    const paused = rig.debug.snapshot().worms[0].segments[0];
    tap(rig, "Escape");
    expect(rig.debug.snapshot().screen).toBe("playing");
    expect(rig.debug.snapshot().worms[0].segments[0]).toEqual(paused);
    rig.dispose();
  });

  test("RESUME returns to play", () => {
    const rig = posed();
    tap(rig, "KeyP");
    expect(rig.debug.snapshot().menuIndex).toBe(0);
    tap(rig, "Enter");
    expect(rig.debug.snapshot().screen).toBe("playing");
    rig.dispose();
  });

  test("RESTART begins a fresh run", () => {
    const rig = posed(5);
    rig.debug.setLives(1);
    rig.debug.setScore(9000);
    tap(rig, "KeyP");
    tap(rig, "ArrowDown");
    tap(rig, "Enter");
    const shot = rig.debug.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.level).toBe(1);
    expect(shot.lives).toBe(START_LIVES);
    expect(shot.score).toBe(0);
    rig.dispose();
  });

  test("QUIT TO MENU returns to the title", () => {
    const rig = posed();
    tap(rig, "KeyP");
    tap(rig, "ArrowDown");
    tap(rig, "ArrowDown");
    expect(rig.debug.snapshot().menuIndex).toBe(PAUSE_ITEMS.length - 1);
    tap(rig, "Enter");
    const shot = rig.debug.snapshot();
    expect(shot.screen).toBe("title");
    expect(shot.menuIndex).toBe(0);
    rig.dispose();
  });
});

describe("the end screens", () => {
  test("PLAY AGAIN begins a fresh run and MENU returns to the title", () => {
    for (const [index, screen] of ENDING_ITEMS.entries()) {
      const rig = posed(6);
      rig.debug.setScreen("gameover");
      rig.debug.setMenuIndex(0);
      for (let i = 0; i < index; i += 1) tap(rig, "ArrowDown");
      tap(rig, "Enter");
      const shot = rig.debug.snapshot();
      expect(screen.length).toBeGreaterThan(0);
      if (index === 0) {
        expect(shot.screen).toBe("playing");
        expect(shot.level).toBe(1);
        expect(shot.lives).toBe(START_LIVES);
        expect(shot.score).toBe(0);
      } else {
        expect(shot.screen).toBe("title");
        expect(shot.menuIndex).toBe(0);
      }
      rig.dispose();
    }
  });
});

describe("mute", () => {
  test("the mute key flips the runtime's bit, and the snapshot reports it", () => {
    const rig = posed();
    expect(rig.debug.snapshot().muted).toBe(false);
    tap(rig, "KeyM");
    expect(rig.debug.snapshot().muted).toBe(true);
    tap(rig, "KeyM");
    expect(rig.debug.snapshot().muted).toBe(false);
    rig.dispose();
  });

  test("a muted game emits nothing at all and stays fully playable", () => {
    const rig = posed();
    tap(rig, "KeyM");
    rig.audio.reset();
    // Firing, cutting a segment, and moving a menu selection.
    rig.debug.addWorm(20, 12);
    rig.debug.setCursor(tileCX(20), 688);
    rig.debug.setWormStepping(rig.debug.snapshot().worms[0].id, false);
    rig.down("Space");
    rig.runtime.advance(0.4, 24);
    rig.up("Space");
    expect(rig.debug.snapshot().worms).toEqual([]);
    rig.debug.setScreen("title");
    tap(rig, "ArrowDown");
    expect(rig.audio.started()).toBe(0);
    expect(rig.debug.snapshot().muted).toBe(true);
    rig.dispose();
  });
});

describe("the cues each event raises", () => {
  /** How many sounds one frame of the driven game emitted. */
  function sounded(rig: Rig, seconds = 1 / 60): number {
    rig.audio.reset();
    rig.runtime.advance(seconds, 1);
    return rig.audio.started();
  }

  test("a bolt fired sounds on the frame it appears, and not before", () => {
    const rig = posed();
    rig.debug.setFireCooldown(0);
    expect(sounded(rig)).toBe(0);
    rig.down("Space");
    expect(sounded(rig)).toBe(1);
    rig.up("Space");
    rig.debug.clearBolts();
    expect(sounded(rig)).toBe(0);
    rig.dispose();
  });

  test("cutting a segment sounds on the frame it is removed", () => {
    const rig = posed();
    rig.debug.addWorm(20, 18);
    // A second worm, so removing the first shortens the board rather than
    // clearing the level, which would sound a cue of its own.
    rig.debug.addWorm(4, 4);
    for (const worm of rig.debug.snapshot().worms) {
      rig.debug.setWormStepping(worm.id, false);
    }
    rig.debug.addBolt(tileCX(20), 704);
    // The bolt is below the segment; the frame that reaches it is the one that
    // sounds.
    let heard = 0;
    for (let i = 0; i < 12; i += 1) heard += sounded(rig, 0.01);
    expect(rig.debug.snapshot().worms).toHaveLength(1);
    expect(heard).toBe(1);
    rig.dispose();
  });

  test("a node reaching critical sounds once", () => {
    const rig = posed();
    rig.debug.setNode(6, 9, 2);
    rig.debug.addWorm(5, 9);
    const heard = sounded(rig, wormStepInterval(1));
    expect(rig.debug.snapshot().nodes[0].charge).toBe(CHARGE_MAX);
    expect(heard).toBe(1);
    rig.dispose();
  });

  test("a discharge sounds on the frame the chain runs", () => {
    const rig = posed();
    rig.debug.setNode(20, 18, CHARGE_MAX);
    rig.debug.addBolt(tileCX(20), 704);
    let heard = 0;
    for (let i = 0; i < 12; i += 1) heard += sounded(rig, 0.01);
    expect(rig.debug.snapshot().nodes).toEqual([]);
    expect(heard).toBe(1);
    rig.dispose();
  });

  test("a foe destroyed sounds on the frame it leaves the roster", () => {
    const rig = posed();
    rig.debug.addFoe("glitch", tileCX(20), tileCY(18));
    rig.debug.setFoeTravel(rig.debug.snapshot().foes[0].id, false);
    rig.debug.addBolt(tileCX(20), 704);
    let heard = 0;
    for (let i = 0; i < 12; i += 1) heard += sounded(rig, 0.01);
    expect(rig.debug.snapshot().foes).toEqual([]);
    expect(heard).toBe(1);
    rig.dispose();
  });

  test("a life lost sounds on the frame lives falls", () => {
    const rig = posed();
    rig.debug.setCursorContact(true);
    rig.debug.setCursor(tileCX(20), 688);
    rig.debug.addWorm(20, 18);
    rig.debug.setWormStepping(rig.debug.snapshot().worms[0].id, false);
    const heard = sounded(rig);
    expect(rig.debug.snapshot().lives).toBe(START_LIVES - 1);
    expect(heard).toBe(1);
    rig.dispose();
  });

  test("a level cleared sounds, and the last level sounds the win too", () => {
    const clearing = posed(4);
    clearing.debug.addWorm(20, 18);
    clearing.debug.setWormStepping(
      clearing.debug.snapshot().worms[0].id,
      false,
    );
    clearing.debug.addBolt(tileCX(20), 704);
    let heard = 0;
    for (let i = 0; i < 12; i += 1) heard += sounded(clearing, 0.01);
    expect(clearing.debug.snapshot().level).toBe(5);
    // The cut and the clear are two events on one frame, and each sounds once.
    expect(heard).toBe(2);
    clearing.dispose();

    const winning = posed(TOTAL_LEVELS);
    winning.debug.addWorm(20, 18);
    winning.debug.setWormStepping(winning.debug.snapshot().worms[0].id, false);
    winning.debug.addBolt(tileCX(20), 704);
    let won = 0;
    for (let i = 0; i < 12; i += 1) won += sounded(winning, 0.01);
    expect(winning.debug.snapshot().screen).toBe("victory");
    // The cut, the clear, and the win.
    expect(won).toBe(3);
    winning.dispose();
  });

  test("losing the last life sounds the loss as well", () => {
    const rig = posed(7);
    rig.debug.setLives(1);
    rig.debug.setCursorContact(true);
    rig.debug.setCursor(tileCX(20), 688);
    rig.debug.addWorm(20, 18);
    rig.debug.setWormStepping(rig.debug.snapshot().worms[0].id, false);
    const heard = sounded(rig);
    const shot = rig.debug.snapshot();
    expect(shot.screen).toBe("gameover");
    expect(shot.lives).toBe(0);
    expect(shot.reachedLevel).toBe(7);
    expect(heard).toBe(2);
    rig.dispose();
  });
});

describe("the run on the build's own clock", () => {
  test("a started run gives way from its banner to live play by itself", () => {
    const rig = onTitle();
    tap(rig, "Enter");
    expect(rig.debug.snapshot().phase).toBe("banner");
    rig.runtime.advance(BANNER_TIME + 0.05, 30);
    const shot = rig.debug.snapshot();
    expect(shot.phase).toBe("active");
    expect(shot.worms).toHaveLength(1);
    expect(shot.simTime).toBeGreaterThan(BANNER_TIME);
    rig.dispose();
  });

  test("a long run with every faculty on raises nothing", () => {
    const rig = createRig(sprites);
    rig.debug.reset();
    rig.debug.setScreen("title");
    rig.press("Enter");
    rig.debug.setLevel(6);
    rig.down("Space");
    rig.down("ArrowRight");
    // Forty seconds of game time with the worm, all three spawners, the contact
    // test and the player's own fire all running.
    for (let second = 0; second < 40; second += 1) {
      rig.runtime.advance(1, 30);
      const shot = rig.debug.snapshot();
      expect(shot.lives).toBeGreaterThanOrEqual(0);
      expect(shot.level).toBeGreaterThanOrEqual(1);
      expect(shot.level).toBeLessThanOrEqual(TOTAL_LEVELS);
      expect(shot.bolts.length).toBeLessThanOrEqual(3);
      for (const worm of shot.worms) {
        for (const segment of worm.segments) {
          expect(segment.c).toBeGreaterThanOrEqual(0);
          expect(segment.c).toBeLessThan(40);
          expect(segment.r).toBeGreaterThanOrEqual(0);
          expect(segment.r).toBeLessThan(20);
        }
      }
    }
    rig.up("Space");
    rig.up("ArrowRight");
    rig.dispose();
  });

  test("the overlay is off until the backtick key shows it", () => {
    const rig = posed();
    expect(rig.runtime.overlayVisible()).toBe(false);
    rig.press("Backquote");
    expect(rig.runtime.overlayVisible()).toBe(true);
    // A read-only view: the snapshot is the same either way.
    const before = JSON.stringify(rig.debug.snapshot());
    rig.runtime.advance(0, 1);
    expect(JSON.stringify(rig.debug.snapshot())).toBe(before);
    rig.press("Backquote");
    expect(rig.runtime.overlayVisible()).toBe(false);
    rig.dispose();
  });
});
