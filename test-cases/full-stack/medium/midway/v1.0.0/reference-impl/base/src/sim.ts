// Midway — the simulation orchestrator (specs/flow.md §6; DESIGN.md §6, valence's sim.ts).
//
// The Game owns the whole park state — the World, guests, staff, attractions, scenery, the
// Ledger, the live rating, the day clock — and advances it on a fixed step in one
// reproducible order (day clock -> arrivals -> guests -> attractions -> staff -> rating ->
// economy -> tallies). It closes the feedback loop the game is about: happy guests lift the
// rating, the rating drives arrivals, arrivals fund the park. The tool/command methods
// mutate the park (lay path, place, hire, price, demolish) and recompute the graph only on
// an edit. It is DOM-free and drives identically from the browser and the balance harness.

import {
  COLS,
  RIDES,
  ROWS,
  SCENERY,
  STALLS,
  STAFF,
  TILE,
  TUNE,
} from "./constants";
import type { RideKind, SceneryKind, StaffKind, StallKind, ToolKind } from "./constants";
import { MODE, type Mode } from "./mode";
import { Rng } from "./rng";
import {
  advancePath,
  canPlaceFootprint,
  canPlacePath,
  cellOfPx,
  centerCameraOn,
  clampCamera,
  findPath,
  footprintEntrance,
  gateRegion,
  idx,
  isWalkable,
  makeWorld,
  nearestPathTile,
  recomputeAppeal,
  recomputeConnectivity,
  regionAt,
  tileAt,
  tileCenter,
} from "./park";
import { applyHappiness, chooseAction, judgeAdmission, stepDesires, type GuestEnv, type RestTile } from "./guests";
import { breakDown, stepAttraction, type RideCtx } from "./rides";
import { assignZone, stepStaff, wageBill, type StaffCtx } from "./staff";
import { bankruptcyStep, chargeDaily, earn, makeLedger, spend } from "./economy";
import {
  arrivalRateFor,
  cleanlinessFrom,
  computeRatingTarget,
  easeRating,
  reliabilityFrom,
  varietyScore,
} from "./rating";
import type {
  Attraction,
  Camera,
  Cell,
  Cue,
  FxEvent,
  GameState,
  Guest,
  Ledger,
  Notification,
  Scenery,
  SpeedSetting,
  Staff,
  StaffZone,
  Tool,
  World,
} from "./types";

const START_RATING = 50; // opening reputation, so a trickle arrives before the loop spins up
const UNMET_PENALTY = 2.2; // happiness/sec bled by a pressing, unreachable desire
const NEUTRAL_HAPPINESS = 60; // stand-in average when the park is empty

export type Selection = "none" | "attraction" | "guest" | "staff";
type ArrivalsMode = "auto" | "on" | "off";
type PriceTarget = number | "admission" | RideKind | StallKind;

export class Game {
  readonly mode: Mode;
  world: World;
  guests: Guest[] = [];
  staff: Staff[] = [];
  attractions: Attraction[] = [];
  scenery: Scenery[] = [];
  ledger: Ledger;

  rating = START_RATING;
  ratingTarget = START_RATING;
  cleanliness = 100;
  variety = 0;
  reliability = 100;

  day = 1;
  dayT = 0;
  peakGuests = 0;
  admissionPrice = TUNE.economy.admission;

  tool: Tool = { kind: "path", buildRide: null, buildStall: null, buildScenery: null, staffKind: null };
  selection: Selection = "none";
  selectedId = -1;

  state: GameState = "title";
  paused = false; // in-place (Space) pause; distinct from the "paused" GameState (Esc menu)
  speed: SpeedSetting = 1;

  milestones = new Set<string>();
  notifications: Notification[] = [];
  fxQueue: FxEvent[] = [];
  sndQueue: Cue[] = [];
  pointerX = -1;
  pointerY = -1;

  rng: Rng;
  private nextId = 1;
  private arrivalAccum = 0;
  private arrivalsMode: ArrivalsMode = "auto";
  private lowCashAlarmT = 0;
  private pathMemo = new Map<string, Cell[] | null>();
  private restTiles: RestTile[] = [];
  private connectedTiles: Cell[] = [];
  private guestEnv: GuestEnv;

  constructor(mode: Mode = MODE, seed = 0x51ade) {
    this.mode = mode;
    this.rng = new Rng(seed);
    this.world = makeWorld();
    this.ledger = makeLedger(mode.startCash);
    this.guestEnv = this.buildEnv();
    this.recomputeAll();
  }

  // ---- Lifecycle --------------------------------------------------------------
  start(): void {
    this.world = makeWorld();
    this.ledger = makeLedger(this.mode.startCash);
    this.guests = [];
    this.staff = [];
    this.attractions = [];
    this.scenery = [];
    this.rating = START_RATING;
    this.ratingTarget = START_RATING;
    this.cleanliness = 100;
    this.variety = 0;
    this.reliability = 100;
    this.day = 1;
    this.dayT = 0;
    this.peakGuests = 0;
    this.admissionPrice = TUNE.economy.admission;
    this.tool = { kind: "path", buildRide: null, buildStall: null, buildScenery: null, staffKind: null };
    this.selection = "none";
    this.selectedId = -1;
    this.paused = false;
    this.speed = 1;
    this.milestones.clear();
    this.notifications = [];
    this.fxQueue = [];
    this.sndQueue = [];
    this.nextId = 1;
    this.arrivalAccum = 0;
    this.arrivalsMode = "auto";
    this.lowCashAlarmT = 0;
    this.recomputeAll();
    this.state = "playing";
  }

  newPark(): void {
    this.start();
  }
  restart(): void {
    this.start();
  }
  setState(s: GameState): void {
    this.state = s;
  }
  cycleSpeed(): void {
    this.speed = (this.speed >= 3 ? 1 : this.speed + 1) as SpeedSetting;
  }
  togglePause(): void {
    if (this.state === "playing") this.paused = !this.paused;
  }

  // ---- Fixed simulation step (DESIGN.md §6, in order) -------------------------
  fixedStep(dt: number): void {
    if (this.state !== "playing" || this.paused) return;
    this.dayClock(dt);
    this.arrivals(dt);
    this.stepGuests(dt);
    this.stepAttractionsAll(dt);
    this.stepStaffAll(dt);
    this.ratingStep(dt);
    this.economyStep(dt);
    this.tallies(dt);
  }

  private dayClock(dt: number): void {
    this.dayT += dt;
    if (this.dayT < TUNE.daySeconds) return;
    this.dayT -= TUNE.daySeconds;
    this.day++;
    chargeDaily(this.ledger, this.upkeepTotal, this.wageBillTotal);
    if (TUNE.milestones.days.includes(this.day)) {
      this.notify(`${this.day} DAYS OPERATED`, true);
      this.fireworks();
    }
    if (this.rating >= 90 && !this.milestones.has("five-star")) {
      this.milestones.add("five-star");
      this.notify("FIRST 5-STAR DAY!", true);
      this.fireworks();
    }
  }

  private arrivals(dt: number): void {
    if (this.arrivalsMode === "off") return;
    const rate = this.arrivalsMode === "on" ? TUNE.rating.arrivalMax : arrivalRateFor(this.rating);
    this.arrivalAccum += (rate / TUNE.daySeconds) * dt;
    while (this.arrivalAccum >= 1) {
      this.arrivalAccum -= 1;
      if (this.guests.length >= TUNE.rating.concurrentCap) break;
      this.trySpawnGuest(false);
    }
  }

  private trySpawnGuest(force: boolean): void {
    const wallet = this.rng.range(TUNE.guests.walletMin, TUNE.guests.walletMax);
    if (!force && !judgeAdmission(this.admissionPrice, wallet, this.rating)) return; // balks at the gate
    earn(this.ledger, this.admissionPrice);
    const c = tileCenter(this.world.gate);
    const g: Guest = {
      id: this.nextId++,
      x: c.x,
      y: c.y,
      tile: { col: this.world.gate.col, row: this.world.gate.row },
      path: [],
      pathIdx: 0,
      speed: TUNE.guests.speed,
      facing: 1,
      desires: {
        thrill: this.rng.range(30, 70),
        hunger: this.rng.range(20, 55),
        thirst: this.rng.range(20, 55),
        bladder: this.rng.range(10, 40),
        energy: 100,
      },
      thirstBoostTimer: 0,
      bladderBoostTimer: 0,
      wallet: Math.max(0, wallet - this.admissionPrice),
      happiness: TUNE.guests.startHappiness,
      admissionPaid: true,
      state: "entering",
      mood: "walk",
      animT: this.rng.range(0, 1),
      targetId: -1,
      targetKind: "none",
      waitTimer: 0,
      actTimer: 0,
      reviewGiven: false,
    };
    this.guests.push(g);
  }

  // ---- Guests -----------------------------------------------------------------
  private stepGuests(dt: number): void {
    const env = this.guestEnv;
    const survivors: Guest[] = [];
    for (const g of this.guests) {
      g.animT += dt;
      stepDesires(g, dt);
      let despawn = false;
      switch (g.state) {
        case "entering":
        case "wandering":
          this.decideAndRoute(g, env);
          break;
        case "walking":
          despawn = this.stepWalking(g, dt, false);
          break;
        case "leaving":
          despawn = this.stepWalking(g, dt, true);
          break;
        case "queuing":
        case "buying":
          this.stepWaiting(g, dt);
          break;
        case "resting":
          this.stepResting(g, dt);
          break;
        case "riding":
          break; // rides.ts owns riders until unload
      }
      this.applyPressingPenalty(g, dt);
      this.setMood(g);
      if (!despawn) survivors.push(g);
    }
    if (survivors.length !== this.guests.length) this.guests = survivors;
  }

  private decideAndRoute(g: Guest, env: GuestEnv): void {
    const region = this.guestRegion(g);
    const decision = chooseAction(g, region, env);
    switch (decision.kind) {
      case "leave":
        this.routeToGate(g);
        return;
      case "wander":
        if (!this.routeWander(g)) this.routeToGate(g);
        return;
      case "bench": {
        const path = this.pathTo(g.tile, decision.cell);
        if (!path) {
          this.routeWander(g) || this.routeToGate(g);
          return;
        }
        this.setRoute(g, path, "bench", -1);
        return;
      }
      case "ride":
      case "stall": {
        const a = this.attractionById(decision.id);
        if (!a || !a.connected) {
          this.routeWander(g) || this.routeToGate(g);
          return;
        }
        const path = this.pathTo(g.tile, a.entrance);
        if (!path) {
          this.routeWander(g) || this.routeToGate(g);
          return;
        }
        this.setRoute(g, path, decision.kind, a.id);
        return;
      }
    }
  }

  private setRoute(g: Guest, path: Cell[], kind: Guest["targetKind"], id: number): void {
    g.path = path;
    g.pathIdx = 1; // index 0 is the tile it stands on
    g.state = "walking";
    g.targetKind = kind;
    g.targetId = id;
  }

  // Advance a walking/leaving guest; returns true when it should despawn (left the park).
  private stepWalking(g: Guest, dt: number, leaving: boolean): boolean {
    const { arrived, tilesCrossed } = advancePath(g, dt);
    if (tilesCrossed > 0) {
      g.desires.energy = Math.max(0, g.desires.energy - TUNE.guests.energyPerTile * tilesCrossed);
      this.walkEnvironment(g, tilesCrossed);
    }
    this.tileHappiness(g, dt);
    if (!arrived) return false;
    if (leaving) {
      this.registerReview(g);
      return true;
    }
    return this.onArrive(g);
  }

  private onArrive(g: Guest): boolean {
    switch (g.targetKind) {
      case "ride": {
        const a = this.attractionById(g.targetId);
        if (a && a.connected && a.state !== "broken") {
          a.queue.push(g.id);
          g.state = "queuing";
          g.waitTimer = 0;
        } else {
          g.state = "wandering";
        }
        return false;
      }
      case "stall": {
        const a = this.attractionById(g.targetId);
        if (a && a.connected) {
          a.queue.push(g.id);
          g.state = "buying";
          g.waitTimer = 0;
        } else {
          g.state = "wandering";
        }
        return false;
      }
      case "bench":
        g.state = "resting";
        g.actTimer = this.rng.range(2, 4);
        return false;
      default:
        g.state = "wandering";
        return false;
    }
  }

  private stepWaiting(g: Guest, dt: number): void {
    g.waitTimer += dt;
    if (g.waitTimer <= TUNE.guests.patience) return;
    applyHappiness(g, -TUNE.guests.queueWaitPenalty * dt);
    if (g.waitTimer > TUNE.guests.patience * 1.5) this.bailQueue(g); // gave up on the line
  }

  private bailQueue(g: Guest): void {
    const a = this.attractionById(g.targetId);
    if (a) {
      const i = a.queue.indexOf(g.id);
      if (i >= 0) a.queue.splice(i, 1);
    }
    applyHappiness(g, -TUNE.guests.overpricePenalty * 0.5);
    g.state = "wandering";
    g.targetKind = "none";
    g.targetId = -1;
    g.waitTimer = 0;
  }

  private stepResting(g: Guest, dt: number): void {
    g.actTimer -= dt;
    g.desires.energy = Math.min(TUNE.guests.benchRestore, g.desires.energy + 40 * dt);
    applyHappiness(g, TUNE.guests.restHappy * dt);
    if (g.actTimer <= 0) g.state = "wandering";
  }

  // Happiness from the tile a guest stands on: clean, appealing paths lift; litter sours.
  private tileHappiness(g: Guest, dt: number): void {
    const t = tileAt(this.world, g.tile.col, g.tile.row);
    if (!t) return;
    applyHappiness(g, TUNE.guests.appealBonus * t.appeal * dt - TUNE.guests.litterPenalty * t.litter * dt);
  }

  // Guests drop a little litter as they walk — the light background source; stalls are the
  // heavy source (rides.ts). Kept low so a single janitor can hold a modest park clean and
  // an unstaffed one still visibly grimes up over time.
  private walkEnvironment(g: Guest, tilesCrossed: number): void {
    for (let i = 0; i < tilesCrossed; i++) {
      if (this.rng.chance(0.05)) this.addLitter(g.tile.col, g.tile.row, 0.02);
    }
  }

  // A pressing desire with nowhere to satisfy it grinds a guest's mood down.
  private applyPressingPenalty(g: Guest, dt: number): void {
    if (g.state === "riding" || g.state === "resting") return;
    const worst = Math.max(g.desires.bladder, g.desires.hunger, g.desires.thirst);
    if (worst > 75) applyHappiness(g, -UNMET_PENALTY * ((worst - 75) / 25) * dt);
  }

  private setMood(g: Guest): void {
    if (g.state === "buying") {
      const a = this.attractionById(g.targetId);
      g.mood = a && a.kind === "food" ? "eating" : "walk";
      return;
    }
    if (g.happiness < 35) g.mood = "angry";
    else if (g.happiness > 78) g.mood = "happy";
    else g.mood = "walk";
  }

  private routeToGate(g: Guest): void {
    const path = this.pathTo(g.tile, this.world.gate);
    if (!path) {
      this.registerReview(g);
      g.state = "leaving";
      g.path = [];
      g.pathIdx = 0;
      // stranded with no way home: leave the review now; tallies() will drop it via despawn
      g.actTimer = -1;
      return;
    }
    g.path = path;
    g.pathIdx = 1;
    g.state = "leaving";
    g.targetKind = "gate";
    g.targetId = -1;
  }

  private routeWander(g: Guest): boolean {
    if (this.connectedTiles.length === 0) return false;
    const to = this.connectedTiles[this.rng.int(0, this.connectedTiles.length - 1)]!;
    const path = this.pathTo(g.tile, to);
    if (!path || path.length <= 1) return false;
    this.setRoute(g, path, "none", -1);
    return true;
  }

  // A departing guest leaves a review that nudges the live rating (happy up, angry down).
  private registerReview(g: Guest): void {
    if (g.reviewGiven) return;
    g.reviewGiven = true;
    const nudge = ((g.happiness - 50) / 50) * 0.4;
    this.rating = Math.max(0, Math.min(100, this.rating + nudge));
  }

  private guestRegion(g: Guest): number {
    const r = regionAt(this.world, g.tile.col, g.tile.row);
    return r >= 0 ? r : gateRegion(this.world);
  }

  // ---- Attractions ------------------------------------------------------------
  private stepAttractionsAll(dt: number): void {
    const ctx = this.rideCtx();
    for (const a of this.attractions) stepAttraction(a, dt, ctx);
  }

  private rideCtx(): RideCtx {
    const byId = this.guestIndex();
    return {
      world: this.world,
      guestById: (id) => byId.get(id),
      earn: (amount) => earn(this.ledger, amount),
      snd: (cue) => this.sndQueue.push(cue),
      fx: (kind, x, y) => this.fxQueue.push({ kind, x, y }),
      addLitter: (col, row, amt) => this.addLitter(col, row, amt),
      rng: this.rng,
    };
  }

  // ---- Staff ------------------------------------------------------------------
  private stepStaffAll(dt: number): void {
    const ctx: StaffCtx = {
      world: this.world,
      attractions: this.attractions,
      guests: this.guests,
      findPath: (from, to) => this.pathTo(from, to),
      fx: (kind, x, y) => this.fxQueue.push({ kind, x, y }),
      snd: (cue) => this.sndQueue.push(cue),
      spend: (amount) => spend(this.ledger, amount),
      rng: this.rng,
    };
    for (const s of this.staff) stepStaff(s, dt, ctx);
  }

  // ---- Rating -----------------------------------------------------------------
  private ratingStep(dt: number): void {
    const dtDays = dt / TUNE.daySeconds;
    const avgHappiness = this.avgHappiness;
    this.cleanliness = cleanlinessFrom(this.avgLitter);
    const distinct = this.distinctConnectedRideKinds;
    this.variety = varietyScore(distinct);
    const totalRides = this.attractions.filter((a) => a.category === "ride").length;
    const broken = this.attractions.filter((a) => a.category === "ride" && a.state === "broken").length;
    this.reliability = reliabilityFrom(totalRides, broken);
    this.ratingTarget = computeRatingTarget(avgHappiness, this.cleanliness, this.variety, this.reliability);
    this.rating = easeRating(this.rating, this.ratingTarget, dtDays);
  }

  // ---- Economy ----------------------------------------------------------------
  private economyStep(dt: number): void {
    const bankrupt = bankruptcyStep(this.ledger, dt);
    if (this.ledger.cash < 0) {
      this.lowCashAlarmT -= dt;
      if (this.lowCashAlarmT <= 0) {
        this.sndQueue.push("alarm");
        this.lowCashAlarmT = 3;
      }
    } else {
      this.lowCashAlarmT = 0;
    }
    if (bankrupt) this.state = "gameover";
  }

  private tallies(dt: number): void {
    this.peakGuests = Math.max(this.peakGuests, this.guests.length);
    for (const n of this.notifications) n.ttl -= dt;
    if (this.notifications.some((n) => n.ttl <= 0)) this.notifications = this.notifications.filter((n) => n.ttl > 0);

    if (!this.milestones.has("first-ride") && this.attractions.some((a) => a.category === "ride" && a.connected)) {
      this.milestones.add("first-ride");
      this.notify("FIRST RIDE OPEN!", true);
    }
    if (!this.milestones.has("first-stall") && this.attractions.some((a) => a.category === "stall" && a.connected)) {
      this.milestones.add("first-stall");
      this.notify("FIRST STALL OPEN!", true);
    }
    if (!this.milestones.has("guest-count") && this.guests.length >= TUNE.milestones.guestCount) {
      this.milestones.add("guest-count");
      this.notify(`${TUNE.milestones.guestCount} GUESTS AT ONCE!`, true);
      this.fireworks();
    }
  }

  private notify(text: string, good: boolean): void {
    this.notifications.push({ text, ttl: 4, good });
  }

  fireworks(): void {
    const cam = this.world.camera;
    const viewW = this.viewW;
    const viewH = this.viewH;
    this.fxQueue.push({ kind: "fireworks", x: cam.x + viewW / 2, y: cam.y + viewH / 2 });
  }

  // ---- Tool commands ----------------------------------------------------------
  // Lay a run of path tiles (the path tool drags a run); each legal, affordable tile is
  // paved. Returns how many were laid.
  layPath(cells: Iterable<[number, number]> | Cell[]): number {
    let laid = 0;
    for (const cell of cells) {
      const col = Array.isArray(cell) ? cell[0]! : cell.col;
      const row = Array.isArray(cell) ? cell[1]! : cell.row;
      if (!canPlacePath(this.world, col, row)) continue;
      if (this.ledger.cash < TUNE.economy.pathCost) break; // can't afford another tile
      spend(this.ledger, TUNE.economy.pathCost);
      this.world.tiles[idx(col, row)]!.kind = "path";
      laid++;
    }
    if (laid > 0) this.recomputeAll();
    return laid;
  }

  // Place a ride or stall at a footprint top-left (its entrance snaps to an adjacent path).
  placeAttraction(kind: RideKind | StallKind, col: number, row: number): boolean {
    const isRide = kind in RIDES;
    const def = isRide ? RIDES[kind as RideKind] : STALLS[kind as StallKind];
    if (!canPlaceFootprint(this.world, col, row, def.w, def.h)) return false;
    if (this.ledger.cash < def.cost) return false;
    spend(this.ledger, def.cost);
    const id = this.nextId++;
    const rideDef = isRide ? RIDES[kind as RideKind] : null;
    const stallDef = isRide ? null : STALLS[kind as StallKind];
    const a: Attraction = {
      id,
      category: isRide ? "ride" : "stall",
      kind,
      col,
      row,
      w: def.w,
      h: def.h,
      entrance: { col, row: row + def.h },
      connected: false,
      price: def.price,
      upkeep: def.upkeep,
      capacity: rideDef ? rideDef.capacity : 0,
      rideDuration: rideDef ? rideDef.rideDuration : 0,
      thrill: rideDef ? rideDef.thrill : 0,
      state: "idle",
      runTimer: 0,
      loadTimer: 0,
      riders: [],
      queue: [],
      breakdownAccum: 0,
      brokenTimer: 0,
      inspectTimer: 0,
      serves: stallDef ? stallDef.serves : "thrill",
      sellTimer: 0,
      steam: stallDef ? stallDef.steam : false,
      takings: 0,
      takingsWindow: [],
      animT: 0,
    };
    this.markFootprint(col, row, def.w, def.h, id);
    this.attractions.push(a);
    this.recomputeAll();
    this.select("attraction", id);
    return true;
  }

  placeScenery(kind: SceneryKind, col: number, row: number): boolean {
    const def = SCENERY[kind];
    if (!canPlaceFootprint(this.world, col, row, def.w, def.h)) return false;
    if (this.ledger.cash < def.cost) return false;
    spend(this.ledger, def.cost);
    const id = this.nextId++;
    this.scenery.push({ id, kind, col, row, w: def.w, h: def.h });
    this.markFootprint(col, row, def.w, def.h, id);
    this.recomputeAll();
    return true;
  }

  // Hire a staff member and drop it onto the nearest path tile (staff walk the network).
  hireStaff(kind: StaffKind, col: number, row: number): boolean {
    const def = STAFF[kind];
    const spot = nearestPathTile(this.world, col, row) ?? { col: this.world.gate.col, row: this.world.gate.row };
    const c = tileCenter(spot);
    const s: Staff = {
      id: this.nextId++,
      kind,
      x: c.x,
      y: c.y,
      tile: { col: spot.col, row: spot.row },
      path: [],
      pathIdx: 0,
      speed: TUNE.guests.speed * 1.15,
      facing: 1,
      state: "idle",
      workTimer: 0,
      targetId: -1,
      zone: null,
      wage: def.wage,
      animT: this.rng.range(0, 1),
    };
    this.staff.push(s);
    this.select("staff", s.id);
    return true;
  }

  assignStaff(id: number, zone: StaffZone | null): void {
    const s = this.staff.find((x) => x.id === id);
    if (s) assignZone(s, zone);
  }

  // Set a price: the gate admission, a single attraction by id, or every attraction of a kind.
  setPrice(target: PriceTarget, price: number): void {
    const p = Math.max(0, Math.round(price));
    if (target === "admission") {
      this.admissionPrice = p;
      return;
    }
    if (typeof target === "number") {
      const a = this.attractionById(target);
      if (a) a.price = p;
      return;
    }
    for (const a of this.attractions) if (a.kind === target) a.price = p;
  }

  // Clear the tile at (col,row) back to grass, refunding a fraction: a path tile, or the
  // whole ride/stall/scenery occupying it (specs/park.md, specs/economy.md).
  demolish(col: number, row: number): boolean {
    const t = tileAt(this.world, col, row);
    if (!t) return false;
    if (t.occupantId >= 0) {
      const a = this.attractionById(t.occupantId);
      if (a) {
        earn(this.ledger, Math.floor(this.buildCostOf(a) * TUNE.economy.demolishRefund));
        this.releaseGuestsOf(a);
        this.clearFootprint(a.col, a.row, a.w, a.h);
        this.attractions = this.attractions.filter((x) => x.id !== a.id);
      } else {
        const s = this.scenery.find((x) => x.id === t.occupantId);
        if (s) {
          earn(this.ledger, Math.floor(SCENERY[s.kind].cost * TUNE.economy.demolishRefund));
          this.clearFootprint(s.col, s.row, s.w, s.h);
          this.scenery = this.scenery.filter((x) => x.id !== s.id);
        }
      }
      this.recomputeAll();
      return true;
    }
    if (t.kind === "path") {
      earn(this.ledger, Math.floor(TUNE.economy.pathCost * TUNE.economy.demolishRefund));
      t.kind = "grass";
      t.litter = 0;
      this.recomputeAll();
      return true;
    }
    return false;
  }

  private releaseGuestsOf(a: Attraction): void {
    for (const g of this.guests) {
      if (g.targetId === a.id || a.queue.includes(g.id) || a.riders.includes(g.id)) {
        g.state = "wandering";
        g.targetKind = "none";
        g.targetId = -1;
        g.waitTimer = 0;
      }
    }
  }

  // Select what is under a world-space point (for the inspector panel).
  selectAtWorld(wx: number, wy: number): void {
    const cell = cellOfPx(wx, wy);
    const t = tileAt(this.world, cell.col, cell.row);
    if (t && t.occupantId >= 0 && this.attractionById(t.occupantId)) {
      this.select("attraction", t.occupantId);
      return;
    }
    const guest = this.nearestEntity(this.guests, wx, wy, 16);
    if (guest) {
      this.select("guest", guest.id);
      return;
    }
    const worker = this.nearestEntity(this.staff, wx, wy, 16);
    if (worker) {
      this.select("staff", worker.id);
      return;
    }
    this.select("none", -1);
  }

  private nearestEntity<T extends { id: number; x: number; y: number }>(
    list: T[],
    wx: number,
    wy: number,
    maxDist: number,
  ): T | null {
    let best: T | null = null;
    let bestD = maxDist;
    for (const e of list) {
      const d = Math.hypot(e.x - wx, e.y - wy);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  private select(kind: Selection, id: number): void {
    this.selection = kind;
    this.selectedId = id;
  }

  // ---- Dev / balance-harness control surface (inert during normal play) -------
  devGrant(cash: number): void {
    this.ledger.cash = cash;
  }
  devDay(n: number): void {
    this.day = n;
  }
  devArrivals(on: boolean): void {
    this.arrivalsMode = on ? "on" : "off";
  }
  devArrivalsAuto(): void {
    this.arrivalsMode = "auto";
  }
  spawnGuests(n: number): void {
    for (let i = 0; i < n; i++) {
      if (this.guests.length >= TUNE.rating.concurrentCap) break;
      this.trySpawnGuest(true);
    }
  }
  breakRide(id?: number): void {
    const a = id !== undefined ? this.attractionById(id) : this.attractions.find((x) => x.category === "ride" && x.state !== "broken");
    if (a && a.category === "ride") breakDown(a, this.rideCtx());
  }
  litter(col: number, row: number, amt: number): void {
    this.addLitter(col, row, amt);
  }

  // ---- Graph / world upkeep ---------------------------------------------------
  private recomputeAll(): void {
    recomputeConnectivity(this.world);
    for (const a of this.attractions) {
      const e = footprintEntrance(this.world, a.col, a.row, a.w, a.h);
      if (e) {
        a.entrance = e;
        a.connected = tileAt(this.world, e.col, e.row)!.connected;
      } else {
        a.entrance = { col: a.col, row: a.row + a.h };
        a.connected = false;
      }
    }
    recomputeAppeal(this.world, this.scenery);
    this.rebuildRestTiles();
    this.rebuildConnectedTiles();
    this.pathMemo.clear();
    this.guestEnv = this.buildEnv();
    this.nudgeStranded();
  }

  private rebuildRestTiles(): void {
    const out: RestTile[] = [];
    for (const s of this.scenery) {
      if (!SCENERY[s.kind].rest) continue;
      for (const [dc, dr] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ] as const) {
        const col = s.col + dc;
        const row = s.row + dr;
        const t = tileAt(this.world, col, row);
        if (t && t.kind === "path") out.push({ cell: { col, row }, region: t.region });
      }
    }
    this.restTiles = out;
  }

  private rebuildConnectedTiles(): void {
    const out: Cell[] = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const t = this.world.tiles[idx(col, row)]!;
        if (t.kind === "path" && t.connected) out.push({ col, row });
      }
    }
    this.connectedTiles = out;
  }

  // Guests left off the walkable graph by a demolition are snapped back or sent home.
  private nudgeStranded(): void {
    for (const g of this.guests) {
      if (isWalkable(this.world, g.tile.col, g.tile.row)) {
        if ((g.targetKind === "ride" || g.targetKind === "stall") && !this.attractionById(g.targetId)) {
          g.state = "wandering";
          g.targetKind = "none";
          g.targetId = -1;
        }
        continue;
      }
      const np = nearestPathTile(this.world, g.tile.col, g.tile.row);
      if (np) {
        const c = tileCenter(np);
        g.x = c.x;
        g.y = c.y;
        g.tile = { col: np.col, row: np.row };
      }
      g.path = [];
      g.pathIdx = 0;
      g.state = "wandering";
      g.targetKind = "none";
      g.targetId = -1;
    }
    for (const s of this.staff) {
      if (isWalkable(this.world, s.tile.col, s.tile.row)) continue;
      const np = nearestPathTile(this.world, s.tile.col, s.tile.row);
      if (np) {
        const c = tileCenter(np);
        s.x = c.x;
        s.y = c.y;
        s.tile = { col: np.col, row: np.row };
      }
      s.path = [];
      s.pathIdx = 0;
      s.state = "idle";
      s.targetId = -1;
    }
  }

  private buildEnv(): GuestEnv {
    return {
      attractions: this.attractions,
      restTiles: this.restTiles,
      world: this.world,
      reachableAttr: (a, guestRegion) =>
        a.connected && regionAt(this.world, a.entrance.col, a.entrance.row) === guestRegion,
    };
  }

  private markFootprint(col: number, row: number, w: number, h: number, id: number): void {
    for (let r = row; r < row + h; r++) {
      for (let c = col; c < col + w; c++) this.world.tiles[idx(c, r)]!.occupantId = id;
    }
  }
  private clearFootprint(col: number, row: number, w: number, h: number): void {
    for (let r = row; r < row + h; r++) {
      for (let c = col; c < col + w; c++) this.world.tiles[idx(c, r)]!.occupantId = -1;
    }
  }

  private addLitter(col: number, row: number, amt: number): void {
    const t = tileAt(this.world, col, row);
    if (t && t.kind === "path") t.litter = Math.min(1, t.litter + amt);
  }

  private pathTo(from: Cell, to: Cell): Cell[] | null {
    const key = `${from.col},${from.row}>${to.col},${to.row}`;
    const cached = this.pathMemo.get(key);
    if (cached !== undefined) return cached;
    const path = findPath(this.world, from, to);
    this.pathMemo.set(key, path);
    return path;
  }

  private guestIndex(): Map<number, Guest> {
    const m = new Map<number, Guest>();
    for (const g of this.guests) m.set(g.id, g);
    return m;
  }

  private buildCostOf(a: Attraction): number {
    return a.category === "ride" ? RIDES[a.kind as RideKind].cost : STALLS[a.kind as StallKind].cost;
  }

  // ---- Camera -----------------------------------------------------------------
  panCamera(dxWorld: number, dyWorld: number): void {
    this.world.camera.x += dxWorld;
    this.world.camera.y += dyWorld;
    clampCamera(this.world.camera);
  }
  zoomCamera(factor: number): void {
    this.world.camera.zoom *= factor;
    clampCamera(this.world.camera);
  }
  centerOnGate(): void {
    centerCameraOn(this.world, this.world.gate.col * TILE + TILE / 2, (ROWS - 4) * TILE);
  }
  get camera(): Camera {
    return this.world.camera;
  }
  private get viewW(): number {
    return 1280 / this.world.camera.zoom;
  }
  private get viewH(): number {
    return (656 - 64) / this.world.camera.zoom;
  }

  // ---- Derived reads for the HUD / inspector ----------------------------------
  get guestCount(): number {
    return this.guests.length;
  }
  get avgHappiness(): number {
    if (this.guests.length === 0) return NEUTRAL_HAPPINESS;
    let sum = 0;
    for (const g of this.guests) sum += g.happiness;
    return sum / this.guests.length;
  }
  get avgLitter(): number {
    let sum = 0;
    let count = 0;
    for (const t of this.world.tiles) {
      if (t.kind === "path") {
        sum += t.litter;
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  }
  get distinctConnectedRideKinds(): number {
    const kinds = new Set<string>();
    for (const a of this.attractions) if (a.category === "ride" && a.connected) kinds.add(a.kind);
    return kinds.size;
  }
  get ratingStars(): number {
    return this.rating / 20;
  }
  get upkeepTotal(): number {
    return this.attractions.reduce((sum, a) => sum + a.upkeep, 0);
  }
  get wageBillTotal(): number {
    return wageBill(this.staff);
  }
  get brokenCount(): number {
    return this.attractions.filter((a) => a.category === "ride" && a.state === "broken").length;
  }
  attractionById(id: number): Attraction | undefined {
    return this.attractions.find((a) => a.id === id);
  }
  guestById(id: number): Guest | undefined {
    return this.guests.find((g) => g.id === id);
  }
  staffById(id: number): Staff | undefined {
    return this.staff.find((s) => s.id === id);
  }
  get selectedAttraction(): Attraction | null {
    return this.selection === "attraction" ? (this.attractionById(this.selectedId) ?? null) : null;
  }
  get selectedGuest(): Guest | null {
    return this.selection === "guest" ? (this.guestById(this.selectedId) ?? null) : null;
  }
  get selectedStaff(): Staff | null {
    return this.selection === "staff" ? (this.staffById(this.selectedId) ?? null) : null;
  }
}

export type { ToolKind };
