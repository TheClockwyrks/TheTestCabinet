// instrumentation/snapshot-shape — the whole documented reading, field for field.
//
// specs/instrumentation.md § Snapshot shape writes `snapshot()` out as one object
// literal and then fixes it: "The shape is fixed and every field is present
// whatever the screen... A field the current screen does not use reports the value
// it is holding rather than going missing." Every other validator in this suite
// reads that object, so a field that is missing, misnamed, or holding something
// other than what the literal says fails whatever point happened to read it. This
// is the check that names the field instead.
//
// THE WORLD EXERCISES EVERY BRANCH THE SHAPE HAS. A snapshot's optional halves are
// only readable when something is standing in them, so the scenario stands the lot:
// members of all three materials, a slew ring, a counterweight, a load in the yard
// with a pad of its own, a tape carrying both step kinds, and a run in progress with
// a load on the hook, some ticks of run clock behind it and a solve's forces in it.
// A snapshot taken over an empty title screen would type-check on lists that are
// empty and unions that are `null`, and would decide almost nothing.
//
// The two unions the scenario cannot stand up at once are read as unions:
// `checkResult` is documented as a result "or `null`", and `run.cause` as a cause or
// `null` — a running run has none. Each is accepted either way and its contents
// checked when it is there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength, fail } from "../assert";
import { HOIST_MAX_RATE, HOIST_START, SITE_COUNT } from "../constants";
import {
  MINIMAL_CRANE,
  addOneLoad,
  createHarness,
  openSite,
  poseCrane,
  runTicks,
  startRun,
  type CraneDesign,
  type Harness,
} from "../harness";

/**
 * The minimal crane, plus the two parts it does not carry.
 *
 * A cable between two arm nodes — `(2, 4, 0)` is a top-flange node and
 * `(4, 4, 0)` the rail tip — so it joins the arm to nothing and is refused by
 * none of `specs/structure.md`'s rules; and a counterweight on an anchor, "a node
 * the structure uses", where it weighs on the ground rather than on the crane.
 * Between them the structure carries a member of every material, a ring, and a
 * counterweight, which is every branch `structure` has.
 */
const CRANE: CraneDesign = {
  ...MINIMAL_CRANE,
  name: "Minimal, with a cable and a counterweight",
  counterweights: [[0, 0, 0]],
  members: [...MINIMAL_CRANE.members, [[2, 4, 0], [4, 4, 0], "cable"]],
};

const SCREENS = [
  "title",
  "howto",
  "select",
  "build",
  "program",
  "run",
  "results",
];
const TOOLS = ["strut", "cable", "rail", "ring", "counterweight", "delete"];
const MATERIALS = ["strut", "cable", "rail"];
const CLASSES = ["crate", "container", "drum"];
const AXES = ["slew", "trolley", "hoist", "grip"];
const RUN_PHASES = ["idle", "running", "cleared", "failed"];
const LOAD_PHASES = ["waiting", "attached", "placed", "lost"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports every field specs/instrumentation.md lists, with its documented type", async () => {
  // The opening `reset` leaves every site's stored structure and tape empty and
  // `openSite` keeps them (specs/state.md), so only the site's own yard has to be
  // cleared — and `addOneLoad` clears the loads itself.
  await openSite(h, 0);
  await h.debug.clearObstacles();
  await poseCrane(h, CRANE);
  await addOneLoad(
    h,
    "crate",
    40,
    { x: 6, y: 2, z: 0, yaw: 0 },
    { x: -6, y: 2, z: 0, yaw: 90 },
  );
  // The tape poses apply on the tape editor's own screen
  // (specs/instrumentation.md), and `startRun` poses the `run` action, which the
  // program screen carries as well as the build screen.
  await h.debug.setScreen("program");
  await h.debug.addMoveStep("hoist", HOIST_START + 2, HOIST_MAX_RATE);
  await h.debug.addActionStep("attach");
  const started = await startRun(h);
  assertLength(
    started.program,
    2,
    "the steps the tape took: the move step and the action step, so the " +
      "reading covers both kinds",
  );
  await runTicks(h, 5);
  await h.debug.setLoadPhase(0, "attached");

  const s = (await h.snapshot()) as unknown as Record<string, unknown>;
  const problems: string[] = [];
  const check = new Shape(problems);

  check.number(s.version, "version");
  check.oneOf(s.screen, SCREENS, "screen");
  check.number(s.menuIndex, "menuIndex");
  check.number(s.siteIndex, "siteIndex");
  check.list(s.cleared, "cleared", (one, at) => check.boolean(one, at));
  check.list(s.best, "best", (one, at) =>
    check.orNull(one, at, (score, where) => {
      const it = check.object(score, where);
      if (it === null) return;
      check.number(it.cost, `${where}.cost`);
      check.number(it.time, `${where}.time`);
    }),
  );
  if (Array.isArray(s.cleared) && s.cleared.length !== SITE_COUNT) {
    problems.push(`cleared carries ${s.cleared.length} entries, one per site`);
  }
  if (Array.isArray(s.best) && s.best.length !== SITE_COUNT) {
    problems.push(`best carries ${s.best.length} entries, one per site`);
  }

  const site = check.object(s.site, "site");
  if (site !== null) {
    check.string(site.name, "site.name");
    const envelope = check.object(site.envelope, "site.envelope");
    if (envelope !== null) {
      check.vec3(envelope.min, "site.envelope.min");
      check.vec3(envelope.max, "site.envelope.max");
    }
    check.list(site.anchors, "site.anchors", (one, at) => check.vec3(one, at));
    check.number(site.budget, "site.budget");
    const par = check.object(site.par, "site.par");
    if (par !== null) {
      check.number(par.cost, "site.par.cost");
      check.number(par.time, "site.par.time");
    }
    check.list(site.loads, "site.loads", (one, at) => {
      const load = check.object(one, at);
      if (load === null) return;
      check.oneOf(load.class, CLASSES, `${at}.class`);
      check.number(load.mass, `${at}.mass`);
      check.pose(load.from, `${at}.from`);
      check.pose(load.to, `${at}.to`);
    });
    check.list(site.obstacles, "site.obstacles", (one, at) => {
      const box = check.object(one, at);
      if (box === null) return;
      check.vec3(box.min, `${at}.min`);
      check.vec3(box.size, `${at}.size`);
    });
  }

  check.oneOf(s.tool, TOOLS, "tool");
  check.orNull(s.pendingNode, "pendingNode", (node, at) =>
    check.vec3(node, at),
  );
  check.number(s.historyDepth, "historyDepth");

  const camera = check.object(s.camera, "camera");
  if (camera !== null) {
    check.number(camera.yaw, "camera.yaw");
    check.number(camera.pitch, "camera.pitch");
    check.number(camera.dist, "camera.dist");
  }

  const pointer = check.object(s.pointer, "pointer");
  if (pointer !== null) {
    check.number(pointer.x, "pointer.x");
    check.number(pointer.y, "pointer.y");
    check.boolean(pointer.down, "pointer.down");
    check.number(pointer.pressX, "pointer.pressX");
    check.number(pointer.pressY, "pointer.pressY");
    check.boolean(pointer.dragging, "pointer.dragging");
  }

  const pick = check.object(s.pick, "pick");
  if (pick !== null) {
    check.orNull(pick.node, "pick.node", (node, at) => check.vec3(node, at));
    check.orNull(pick.member, "pick.member", (id, at) => check.number(id, at));
  }

  const structure = check.object(s.structure, "structure");
  if (structure !== null) {
    check.list(structure.members, "structure.members", (one, at) => {
      const member = check.object(one, at);
      if (member === null) return;
      check.number(member.id, `${at}.id`);
      check.vec3(member.a, `${at}.a`);
      check.vec3(member.b, `${at}.b`);
      check.oneOf(member.material, MATERIALS, `${at}.material`);
    });
    check.number(structure.nextMemberId, "structure.nextMemberId");
    check.orNull(structure.ring, "structure.ring", (ring, at) => {
      const held = check.object(ring, at);
      if (held !== null) check.vec3(held.corner, `${at}.corner`);
    });
    check.list(
      structure.counterweights,
      "structure.counterweights",
      (one, at) => check.vec3(one, at),
    );
    check.number(structure.cost, "structure.cost");
    check.list(structure.issues, "structure.issues", (one, at) =>
      check.string(one, at),
    );
  }

  check.list(s.program, "program", (one, at) => {
    const step = check.object(one, at);
    if (step === null) return;
    if (step.kind === "move") {
      check.list(step.commands, `${at}.commands`, (command, where) => {
        const held = check.object(command, where);
        if (held === null) return;
        check.oneOf(held.axis, AXES, `${where}.axis`);
        check.number(held.target, `${where}.target`);
        check.number(held.rate, `${where}.rate`);
      });
    } else if (step.kind === "action") {
      check.oneOf(step.action, ["attach", "release"], `${at}.action`);
    } else {
      problems.push(`${at}.kind is ${show(step.kind)}, not "move" or "action"`);
    }
  });

  check.orNull(s.checkResult, "checkResult", (result, at) =>
    check.checkShape(result, at),
  );

  const run = check.object(s.run, "run");
  if (run !== null) {
    check.oneOf(run.phase, RUN_PHASES, "run.phase");
    check.orNull(run.cause, "run.cause", (cause, at) =>
      check.string(cause, at),
    );
    check.number(run.tick, "run.tick");
    check.number(run.time, "run.time");
    check.number(run.speedIndex, "run.speedIndex");
    check.number(run.stepIndex, "run.stepIndex");
    check.boolean(run.stepLive, "run.stepLive");
    const axes = check.object(run.axes, "run.axes");
    if (axes !== null) {
      for (const name of AXES) {
        const axis = check.object(axes[name], `run.axes.${name}`);
        if (axis === null) continue;
        check.number(axis.value, `run.axes.${name}.value`);
        check.number(axis.rate, `run.axes.${name}.rate`);
        check.orNull(axis.command, `run.axes.${name}.command`, (cmd, at) => {
          const held = check.object(cmd, at);
          if (held === null) return;
          check.number(held.target, `${at}.target`);
          check.number(held.rate, `${at}.rate`);
        });
      }
    }
    check.vec3(run.pivot, "run.pivot");
    const bob = check.object(run.bob, "run.bob");
    if (bob !== null) {
      check.vec3(bob.pos, "run.bob.pos");
      check.vec3(bob.vel, "run.bob.vel");
    }
    check.orNull(run.attached, "run.attached", (index, at) =>
      check.number(index, at),
    );
    check.list(run.loads, "run.loads", (one, at) => {
      const load = check.object(one, at);
      if (load === null) return;
      check.oneOf(load.phase, LOAD_PHASES, `${at}.phase`);
      check.vec3(load.pos, `${at}.pos`);
      check.number(load.yaw, `${at}.yaw`);
    });
    check.list(run.forces, "run.forces", (one, at) => {
      const force = check.object(one, at);
      if (force === null) return;
      check.number(force.id, `${at}.id`);
      check.number(force.force, `${at}.force`);
      check.number(force.utilization, `${at}.utilization`);
    });
    check.list(run.broken, "run.broken", (one, at) => check.number(one, at));
  }

  check.boolean(s.muted, "muted");
  check.number(s.simTime, "simTime");

  if (problems.length > 0) {
    fail(
      "every field of the Snapshot shape block of specs/instrumentation.md, " +
        "present and of its documented type",
      `${problems.length} field(s): ${problems.join("; ")}`,
    );
  }

  // And the scenario really did stand every branch up, so the walk above read
  // them rather than skipping past empty lists.
  assertEqual(s.screen, "run", "the screen a started run shows");
  assertGreaterThan(
    (s.run as { tick: number }).tick,
    0,
    "the ticks of run clock behind the reading",
  );

  await h.capture(
    "snapshot-shape",
    "The run the whole documented snapshot was read over",
  );
});

function show(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "absent";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (typeof value === "object") return "an object";
  return `${typeof value} ${String(value)}`;
}

/** Field-by-field type checks, collecting what is wrong rather than throwing. */
class Shape {
  constructor(private readonly problems: string[]) {}

  number(value: unknown, at: string): void {
    if (typeof value !== "number") {
      this.problems.push(`${at} is ${show(value)}, not a number`);
    }
  }

  string(value: unknown, at: string): void {
    if (typeof value !== "string") {
      this.problems.push(`${at} is ${show(value)}, not a string`);
    }
  }

  boolean(value: unknown, at: string): void {
    if (typeof value !== "boolean") {
      this.problems.push(`${at} is ${show(value)}, not a boolean`);
    }
  }

  oneOf(value: unknown, allowed: readonly string[], at: string): void {
    if (typeof value !== "string" || !allowed.includes(value)) {
      this.problems.push(
        `${at} is ${show(value)}, not one of ${allowed.join(", ")}`,
      );
    }
  }

  object(value: unknown, at: string): Record<string, unknown> | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      this.problems.push(`${at} is ${show(value)}, not an object`);
      return null;
    }
    return value as Record<string, unknown>;
  }

  list(
    value: unknown,
    at: string,
    each: (item: unknown, where: string) => void,
  ): void {
    if (!Array.isArray(value)) {
      this.problems.push(`${at} is ${show(value)}, not an array`);
      return;
    }
    for (const [index, item] of value.entries()) each(item, `${at}[${index}]`);
  }

  orNull(
    value: unknown,
    at: string,
    present: (held: unknown, where: string) => void,
  ): void {
    if (value === null) return;
    if (value === undefined) {
      this.problems.push(`${at} is absent, and the field is never missing`);
      return;
    }
    present(value, at);
  }

  vec3(value: unknown, at: string): void {
    const held = this.object(value, at);
    if (held === null) return;
    this.number(held.x, `${at}.x`);
    this.number(held.y, `${at}.y`);
    this.number(held.z, `${at}.z`);
  }

  pose(value: unknown, at: string): void {
    this.vec3(value, at);
    const held = this.object(value, at);
    if (held !== null) this.number(held.yaw, `${at}.yaw`);
  }

  checkShape(value: unknown, at: string): void {
    const held = this.object(value, at);
    if (held === null) return;
    this.list(held.issues, `${at}.issues`, (one, where) =>
      this.string(one, where),
    );
    this.number(held.cost, `${at}.cost`);
    this.number(held.budget, `${at}.budget`);
    this.boolean(held.stable, `${at}.stable`);
    this.list(held.members, `${at}.members`, (one, where) => {
      const force = this.object(one, where);
      if (force === null) return;
      this.number(force.id, `${where}.id`);
      this.number(force.force, `${where}.force`);
      this.number(force.utilization, `${where}.utilization`);
    });
  }
}
