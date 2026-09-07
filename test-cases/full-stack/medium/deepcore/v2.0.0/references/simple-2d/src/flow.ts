// Deepcore — the expedition's lifecycle, the surface camp, and the one place a
// named control is run (specs/expedition.md, specs/ui.md).
//
// Everything a player can choose reaches the game through `activate`: a menu
// item, a panel's button, a status-bar control, a click on a building, and the
// keys that stand for them. The debug surface's controls call the same functions
// this module does, so a scenario driven from code takes exactly the path a
// player's click takes.

import {
  CUES,
  MINER_H,
  MINER_W,
  SPAWN_COL,
  SURFACE_Y,
  TILE,
} from "./constants";
import type {
  BuildingId,
  ItemId,
  Mode,
  OreId,
  PanelId,
  ScreenName,
  TrackName,
  WorldSize,
} from "./constants";
import { cue } from "./audio";
import { recenterCamera } from "./camera";
import {
  buyFuel,
  buyRepair,
  buyUpgrade,
  dropOre,
  fillFuel,
  repairFull,
  sellCargo,
} from "./economy";
import { dismissNotice, note } from "./feedback";
import { atSurface, maxFuel, maxHull } from "./figures";
import { emptyCargo, emptyItems, startingTiers } from "./game";
import type { Miner } from "./game";
import { buyItem, coreGround, jettisonCoreSample, useItem } from "./items";
import { arrivalIndex } from "./menus";
import { minerCenterX } from "./physics";
import { allInstalled, fabricate } from "./rocket";
import { clearSave, hasSave, readSave, writeSave } from "./save";
import { Draws } from "./rng";
import type { Draft } from "./state";
import {
  BUILDING_H,
  BUILDING_REACH,
  BUILDING_W,
  DEFAULT_WORLD_SIZE,
  buildingPlace,
  CAMP_ORDER,
  coreRowFor,
} from "./tuning";
import {
  colCenterX,
  emptyMine,
  generateMine,
  resizeGrid,
  tileLeft,
} from "./world";

/** A building's footprint in world units, as the debug surface reports it. */
export interface BuildingBox {
  readonly id: BuildingId;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Every building's footprint. Two footprints are far past `BUILDING_GAP` apart. */
export function buildings(): readonly BuildingBox[] {
  return CAMP_ORDER.map((id) => {
    const place = buildingPlace(id);
    return {
      id,
      x: tileLeft(place.col) + TILE / 2 - BUILDING_W / 2,
      y: SURFACE_Y - BUILDING_H,
      w: BUILDING_W,
      h: BUILDING_H,
    };
  });
}

/**
 * The building the miner is standing at, or `null`.
 *
 * The camp spaces its six four columns apart, so `320` units separate two
 * footprints of `BUILDING_W` and the clear ground between them is far past
 * `BUILDING_GAP`; the reach below is narrower than that gap, so at most one
 * building is ever in reach.
 */
export function nearbyBuilding(miner: Miner): BuildingId | null {
  if (!atSurface(miner)) return null;
  const mx = minerCenterX(miner);
  let best: BuildingId | null = null;
  let bestD = BUILDING_REACH;
  for (const id of CAMP_ORDER) {
    const place = buildingPlace(id);
    const d = Math.abs(tileLeft(place.col) + TILE / 2 - mx);
    if (d <= bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

// ---- Panels --------------------------------------------------------------

/** Open a building's panel, which is only possible at the camp. */
export function openPanel(d: Draft, panel: PanelId): void {
  if (d.screen !== "in-mine" || d.dying || d.launchAnim !== null) return;
  if (panel !== "inventory" && !atSurface(d.miner)) return;
  d.panel = panel;
}

/** Close whatever panel is open. */
export function closePanel(d: Draft): void {
  d.panel = null;
}

/** Open and close the inventory, which opens anywhere. */
export function toggleInventory(d: Draft): void {
  if (d.screen !== "in-mine" || d.dying || d.launchAnim !== null) return;
  d.panel = d.panel === "inventory" ? null : "inventory";
}

/** Open the pause menu, or close an open panel (specs/controls.md). */
export function openPauseMenu(d: Draft): void {
  // specs/modes.md: play does not resume from a death, so once one has been
  // taken nothing puts the mine back in front of the player.
  if (d.screen !== "in-mine" || d.dying) return;
  if (d.panel) {
    closePanel(d);
    return;
  }
  d.menuIndex = 0;
  d.screen = "paused";
}

/** Activate the building the miner is standing at. */
export function activateNearbyBuilding(d: Draft): void {
  const id = nearbyBuilding(d.miner);
  if (!id) return;
  if (id === "save-pad") trySave(d);
  else openPanel(d, id);
}

// ---- The expedition ------------------------------------------------------

/** Everything that belongs to a moment rather than to the expedition. */
function clearTransients(d: Draft): void {
  d.panel = null;
  d.dying = null;
  d.launchAnim = null;
  d.hurtT = 0;
  d.notes = [];
  d.shakeT = 0;
  d.shakeAmp = 0;
  d.notice = null;
  d.noticesFired = { gas: false, lava: false };
  d.gasSeepIndex = 0;
  d.gasSeepCd = 0;
  d.drillFxCd = 0;
  d.thrustFxCd = 0;
  d.lavaFxCd = 0;
  d.miner.travel = true;
  d.miner.drill = true;
}

/** Stand the miner on the camp ground above `SPAWN_COL`, at rest, facing east. */
export function placeAtSpawn(d: Draft): void {
  const m = d.miner;
  m.x = colCenterX(SPAWN_COL, MINER_W);
  m.y = SURFACE_Y - MINER_H;
  m.vx = 0;
  m.vy = 0;
  m.facing = "east";
  m.state = "idle";
  m.drilling = null;
}

/**
 * Move to size-select with the expedition's mode set to the one chosen
 * (specs/ui.md), holding it until a size is picked.
 */
export function chooseMode(d: Draft, mode: Mode): void {
  d.mode = mode;
  d.pendingMode = mode;
  d.menuIndex = 0;
  d.screen = "size-select";
}

/** Start a fresh expedition, which abandons any existing save. */
export function newExpedition(d: Draft, mode: Mode, size: WorldSize): void {
  clearSave();
  d.hasSave = hasSave();
  d.mode = mode;
  d.worldSize = size;
  d.coreRow = coreRowFor(size);
  const mine = generateMine(Draws.fresh(), d.coreRow);
  d.grid = mine.grid;
  d.nodes = mine.nodes.map((node) => ({ ...node }));
  d.credits = 0;
  d.creditsEarned = 0;
  d.cargo = emptyCargo();
  d.satchel = { resonite: 0, cryenite: 0, coreSample: false };
  d.tiers = startingTiers();
  d.installed = [];
  d.items = emptyItems();
  d.groundItems = [];
  d.coreTimer = null;
  d.deepestDepthMeters = 0;
  d.elapsedSeconds = 0;
  d.summary = null;
  d.deathCause = null;
  clearTransients(d);
  placeAtSpawn(d);
  d.miner.fuel = maxFuel(d.tiers);
  d.miner.hull = maxHull(d.tiers);
  recenterCamera(d);
  d.menuIndex = 0;
  d.screen = "in-mine";
}

/** Whether the expedition may be saved right now. */
export function canSave(d: Draft): boolean {
  return atSurface(d.miner) && d.coreTimer === null && coreGround(d) === null;
}

/** Save from the Save Pad, with a note either way. */
export function trySave(d: Draft): boolean {
  if (d.screen !== "in-mine" || d.dying || d.launchAnim !== null) return false;
  if (!atSurface(d.miner)) {
    note(d, "NO SAVE PAD HERE");
    return false;
  }
  if (!canSave(d)) {
    note(d, "CAN'T SAVE — UNSTABLE CORE SAMPLE ACTIVE");
    return false;
  }
  const ok = writeSave({
    version: 1,
    mode: d.mode,
    size: d.worldSize,
    credits: d.credits,
    creditsEarned: d.creditsEarned,
    tiers: { ...d.tiers },
    installed: [...d.installed],
    items: { ...d.items },
    cargo: { ...d.cargo },
    satchel: { resonite: d.satchel.resonite, cryenite: d.satchel.cryenite },
    grid: d.grid,
    nodes: d.nodes.map((node) => ({ ...node })),
    deepestDepthMeters: d.deepestDepthMeters,
    elapsedSeconds: d.elapsedSeconds,
    fuel: d.miner.fuel,
    hull: d.miner.hull,
  });
  d.hasSave = hasSave();
  if (ok) {
    cue(d, CUES.fabricate);
    note(d, "EXPEDITION SAVED");
  } else {
    note(d, "SAVE FAILED");
  }
  return ok;
}

/** Restore the save, placing the miner back on the surface. */
export function loadExpedition(d: Draft): boolean {
  const data = readSave();
  if (!data) return false;
  d.mode = data.mode;
  d.worldSize = data.size ?? DEFAULT_WORLD_SIZE;
  d.coreRow = coreRowFor(d.worldSize);
  d.grid = data.grid;
  d.nodes = data.nodes.map((node) => ({ ...node }));
  d.credits = data.credits;
  d.creditsEarned = data.creditsEarned;
  d.cargo = { ...emptyCargo(), ...data.cargo };
  d.satchel = {
    resonite: data.satchel.resonite,
    cryenite: data.satchel.cryenite,
    coreSample: false,
  };
  d.tiers = { ...startingTiers(), ...data.tiers };
  d.installed = [...data.installed];
  d.items = { ...emptyItems(), ...data.items };
  d.groundItems = [];
  d.coreTimer = null;
  d.deepestDepthMeters = data.deepestDepthMeters;
  d.elapsedSeconds = data.elapsedSeconds;
  d.summary = null;
  d.deathCause = null;
  clearTransients(d);
  placeAtSpawn(d);
  d.miner.fuel = Math.min(maxFuel(d.tiers), data.fuel);
  d.miner.hull = Math.min(maxHull(d.tiers), data.hull);
  recenterCamera(d);
  d.menuIndex = 0;
  d.screen = "in-mine";
  return true;
}

/**
 * Resize the mine onto `d.coreRow`, the way an array is resized. Every cell the
 * old depth and the new one share comes through untouched, rows past the new
 * depth go along with the material nodes that sat in them, and rows the old depth
 * did not reach open as an empty mine's. Nothing is generated.
 */
export function resizeMine(d: Draft): void {
  d.grid = resizeGrid(d.grid, d.coreRow);
  d.nodes = d.nodes.filter((node) => node.row < d.coreRow);
}

/** Empty the mine, leaving the border, the camp, and the Core chamber standing. */
export function clearMine(d: Draft): void {
  d.grid = emptyMine(d.coreRow);
  d.nodes = [];
}

/** Replace every cell with a freshly generated mine at the current world size. */
export function regenerateMine(d: Draft): void {
  const mine = generateMine(Draws.fresh(), d.coreRow);
  d.grid = mine.grid;
  d.nodes = mine.nodes.map((node) => ({ ...node }));
}

/** Begin the launch, which the Victory screen follows. */
export function startLaunch(d: Draft): boolean {
  if (!allInstalled(d.installed)) {
    note(d, "THE ROCKET IS NOT COMPLETE");
    return false;
  }
  if (d.launchAnim !== null) return false;
  d.panel = null;
  d.launchAnim = 0;
  d.thrustFxCd = 0;
  cue(d, CUES.launch);
  return true;
}

// ---- The one place a named control is run --------------------------------

/**
 * Run one named control. Every path a player has into the game — a menu item, a
 * panel button, a status-bar control, a click on a building, and the keys that
 * stand for them — arrives here, so a control behaves identically however it was
 * chosen.
 */
export function activate(d: Draft, action: string): void {
  if (action.startsWith("nav:")) {
    const to = action.slice(4) as ScreenName;
    d.menuIndex = arrivalIndex(d.screen, to, d.mode, d.hasSave);
    d.screen = to;
    return;
  }
  if (action.startsWith("mode:")) {
    chooseMode(d, action.slice(5) === "hardcore" ? "hardcore" : "standard");
    return;
  }
  if (action.startsWith("size:")) {
    newExpedition(d, d.pendingMode, action.slice(5) as WorldSize);
    return;
  }
  if (action.startsWith("open:")) {
    openPanel(d, action.slice(5) as PanelId);
    return;
  }
  if (action.startsWith("buy:")) {
    buyUpgrade(d, action.slice(4) as TrackName);
    return;
  }
  if (action.startsWith("drop:")) {
    dropOre(d, action.slice(5) as OreId);
    return;
  }
  if (action.startsWith("buyitem:")) {
    buyItem(d, action.slice(8) as ItemId);
    return;
  }
  if (action.startsWith("useitem:")) {
    useItem(d, action.slice(8) as ItemId);
    return;
  }
  switch (action) {
    case "buyfuel:increment":
      buyFuel(d);
      break;
    case "buyfuel:full":
      fillFuel(d);
      break;
    case "buyrepair:increment":
      buyRepair(d);
      break;
    case "buyrepair:full":
      repairFull(d);
      break;
    case "again":
    case "restart":
      newExpedition(d, d.mode, d.worldSize);
      break;
    case "continue":
      loadExpedition(d);
      break;
    case "save":
      trySave(d);
      break;
    case "resume":
      d.screen = "in-mine";
      break;
    case "sys:pause":
      openPauseMenu(d);
      break;
    case "sys:inventory":
      toggleInventory(d);
      break;
    case "jettison":
      jettisonCoreSample(d);
      break;
    case "notice:dismiss":
      dismissNotice(d);
      break;
    case "panel:close":
      closePanel(d);
      break;
    case "sell":
      sellCargo(d);
      break;
    case "fabricate":
      fabricate(d);
      break;
    case "launch":
      startLaunch(d);
      break;
    default:
      break;
  }
}
