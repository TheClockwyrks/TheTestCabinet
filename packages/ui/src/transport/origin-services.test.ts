import { describe, expect, it } from "vitest";

import {
  ARENA_PATH,
  ARTIFACTS_PATH,
  BACKEND_PATH,
  grafanaUrlForHost,
  snapshotUrlForHost,
} from "./origin-services";

describe("origin services", () => {
  it("serves the backend, artifacts and arena services at paths of the origin", () => {
    expect(BACKEND_PATH).toBe("/api");
    expect(ARTIFACTS_PATH).toBe("/artifacts");
    expect(ARENA_PATH).toBe("/arena");
  });

  it("derives Grafana from the console's hostname", () => {
    expect(grafanaUrlForHost("console.testcabinet.ai")).toBe(
      "https://grafana.testcabinet.ai",
    );
    expect(grafanaUrlForHost("console.staging.testcabinet.ai")).toBe(
      "https://grafana.staging.testcabinet.ai",
    );
  });

  it("derives the snapshot bucket from the console's hostname", () => {
    expect(snapshotUrlForHost("console.testcabinet.ai")).toBe(
      "https://snapshot.testcabinet.ai",
    );
    expect(snapshotUrlForHost("console.staging.testcabinet.ai")).toBe(
      "https://snapshot.staging.testcabinet.ai",
    );
  });

  it("offers neither on a host that is not a console's", () => {
    for (const host of [
      "127.0.0.1",
      "localhost",
      "testcabinet.ai",
      "staging.testcabinet.ai",
      "myconsole.testcabinet.ai",
      "console.",
      "",
    ]) {
      expect(grafanaUrlForHost(host)).toBeNull();
      expect(snapshotUrlForHost(host)).toBeNull();
    }
  });
});
