import { describe, expect, it } from "vitest";
import type { FrameInfo } from "./contract";
import { HOST_HANDLE, HOST_VERSION, installHost } from "./host";
import type { EngineHost, HostPorts } from "./host";

/** The frame port, over a counter a test can move by hand. */
function framePort(): { info: FrameInfo; port: HostPorts["frame"] } {
  const info: FrameInfo = { count: 0, timeMs: 0, lastDeltaMs: 0 };
  return { info, port: { info: () => ({ ...info }) } };
}

/** The diagnostics port, over sources a test supplies and a recorded overlay flag. */
function diagnosticsPort(sources: Record<string, unknown> = {}): {
  enabled: boolean[];
  port: HostPorts["diagnostics"];
} {
  const enabled: boolean[] = [];
  return {
    enabled,
    port: {
      read: () => ({ ...sources }),
      setEnabled: (value) => {
        enabled.push(value);
      },
    },
  };
}

/** A target plus the two ports, wired for the common case. */
function ports(sources?: Record<string, unknown>): HostPorts & {
  frameInfo: FrameInfo;
  overlayCalls: boolean[];
} {
  const frame = framePort();
  const diagnostics = diagnosticsPort(sources);
  return {
    target: {},
    frame: frame.port,
    diagnostics: diagnostics.port,
    frameInfo: frame.info,
    overlayCalls: diagnostics.enabled,
  };
}

/** The handle as a reader finds it, having checked that it is there at all. */
function published(target: Record<string, unknown>): EngineHost {
  const host = target[HOST_HANDLE];
  expect(host).toBeDefined();
  return host as EngineHost;
}

describe("installHost", () => {
  it("publishes the handle under the name the engine catalogue declares", () => {
    const p = ports();

    installHost(p);

    expect(HOST_HANDLE).toBe("__tcabEngine");
    expect(Object.keys(p.target)).toEqual([HOST_HANDLE]);
  });

  it("reports the version the page was built with", () => {
    const p = ports();
    installHost(p);

    expect(published(p.target).version).toBe(HOST_VERSION);
    // The drop of the driving operations was a contract change, so a reader that
    // knows only version 1 must be able to tell the two handles apart.
    expect(HOST_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("carries observation and the overlay switch alone", () => {
    const p = ports();
    installHost(p);

    expect(Object.keys(published(p.target)).sort()).toEqual([
      "diagnostics",
      "frame",
      "setOverlay",
      "version",
    ]);
  });

  it("reads the live frame counter rather than a value sampled at install", () => {
    const p = ports();
    installHost(p);
    const host = published(p.target);

    expect(host.frame()).toEqual({ count: 0, timeMs: 0, lastDeltaMs: 0 });

    p.frameInfo.count = 3;
    p.frameInfo.timeMs = 48;
    p.frameInfo.lastDeltaMs = 16;

    expect(host.frame()).toEqual({ count: 3, timeMs: 48, lastDeltaMs: 16 });
  });
});

describe("the uninstaller", () => {
  it("removes the handle it published", () => {
    const p = ports();

    const uninstall = installHost(p);
    uninstall();

    expect(HOST_HANDLE in p.target).toBe(false);
  });

  it("is idempotent, since teardown races", () => {
    const p = ports();

    const uninstall = installHost(p);
    uninstall();
    uninstall();

    expect(HOST_HANDLE in p.target).toBe(false);
  });

  it("leaves a replacement in place when a superseded engine is destroyed", () => {
    // The order teardown actually happens in: the new engine is created first and
    // the old one disposed of afterwards, so the page must stay published by the
    // engine that is running.
    const p = ports();

    const uninstallFirst = installHost(p);
    const first = published(p.target);
    installHost(p);
    const second = published(p.target);
    uninstallFirst();

    expect(second).not.toBe(first);
    expect(p.target[HOST_HANDLE]).toBe(second);
  });

  it("hands teardown back to the replacement's own uninstaller", () => {
    const p = ports();

    const uninstallFirst = installHost(p);
    const uninstallSecond = installHost(p);
    uninstallFirst();
    uninstallSecond();

    expect(HOST_HANDLE in p.target).toBe(false);
  });
});

describe("installing over an existing handle", () => {
  it("replaces it rather than throwing, so the running engine owns the page", () => {
    const p = ports();
    installHost(p);
    const first = published(p.target);

    expect(() => installHost(p)).not.toThrow();
    expect(p.target[HOST_HANDLE]).not.toBe(first);
    expect(Object.keys(p.target)).toEqual([HOST_HANDLE]);
  });

  it("replaces a handle the page put there by other means", () => {
    const p = ports();
    p.target[HOST_HANDLE] = { version: 0 };

    installHost(p);

    expect(published(p.target).version).toBe(HOST_VERSION);
  });
});

describe("EngineHost.diagnostics", () => {
  it("passes plain values through untouched", () => {
    const p = ports({
      score: 42,
      mode: "serve",
      alive: true,
      ball: { x: 1.5, y: -2 },
      trail: [1, 2, 3],
      none: null,
    });
    installHost(p);

    expect(published(p.target).diagnostics()).toEqual({
      score: 42,
      mode: "serve",
      alive: true,
      ball: { x: 1.5, y: -2 },
      trail: [1, 2, 3],
      none: null,
    });
  });

  it("degrades a value with no JSON encoding to null rather than dropping the name", () => {
    // A reader must still see that the source exists and reported something that
    // could not be represented, which is different from the source being absent.
    const p = ports({
      fn: () => 1,
      sym: Symbol("s"),
      missing: undefined,
      notANumber: Number.NaN,
      unbounded: Number.POSITIVE_INFINITY,
    });
    installHost(p);

    const values = published(p.target).diagnostics();
    expect(Object.keys(values).sort()).toEqual([
      "fn",
      "missing",
      "notANumber",
      "sym",
      "unbounded",
    ]);
    for (const value of Object.values(values)) expect(value).toBeNull();
  });

  it("degrades a value that cannot be encoded to its string form", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic["self"] = cyclic;
    const p = ports({ cyclic, huge: 10n });
    installHost(p);

    const values = published(p.target).diagnostics();
    expect(values["cyclic"]).toBe(String(cyclic));
    expect(values["huge"]).toBe("10");
  });

  it("contains one bad source rather than losing the whole read", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    const p = ports({ before: 1, cyclic, after: 2 });
    installHost(p);

    const values = published(p.target).diagnostics();
    expect(values["before"]).toBe(1);
    expect(values["after"]).toBe(2);
  });

  it("reduces values nested inside an object a source returns", () => {
    const p = ports({ state: { keep: 1, drop: () => 1 } });
    installHost(p);

    expect(published(p.target).diagnostics()).toEqual({ state: { keep: 1 } });
  });

  it("hands back a fresh object each call, disowned from the registry's own", () => {
    const sources: Record<string, unknown> = { score: 1 };
    const p = ports(sources);
    installHost(p);
    const host = published(p.target);

    const first = host.diagnostics();
    first["score"] = 99;
    sources["score"] = 2;

    expect(host.diagnostics()).toEqual({ score: 2 });
  });

  it("records nothing between reads, so repeated reads cannot grow the handle", () => {
    const p = ports({ score: 1 });
    installHost(p);
    const host = published(p.target);

    for (let i = 0; i < 500; i++) host.frame();
    for (let i = 0; i < 500; i++) host.diagnostics();

    expect(Object.keys(host.diagnostics())).toEqual(["score"]);
    expect(Object.keys(published(p.target)).length).toBe(4);
  });

  it("reads independently of whether the overlay is visible", () => {
    const p = ports({ score: 7 });
    installHost(p);
    const host = published(p.target);

    expect(host.diagnostics()).toEqual({ score: 7 });
    host.setOverlay(true);
    expect(host.diagnostics()).toEqual({ score: 7 });
  });
});

describe("EngineHost.setOverlay", () => {
  it("passes a boolean straight through", () => {
    const p = ports();
    installHost(p);
    const host = published(p.target);

    host.setOverlay(true);
    host.setOverlay(false);

    expect(p.overlayCalls).toEqual([true, false]);
  });

  it("coerces what a console or a page evaluation actually hands it", () => {
    const p = ports();
    installHost(p);
    const host = published(p.target);
    const loose = host.setOverlay as (enabled: unknown) => void;

    for (const value of [1, "on", {}, [], "false"]) loose(value);
    for (const value of [0, "", null, undefined, Number.NaN]) loose(value);

    expect(p.overlayCalls).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
