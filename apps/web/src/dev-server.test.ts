import type { Connect, ViteDevServer } from "vite";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_IDENTITY,
  IDENTITY_HEADER,
  IDENTITY_PATH,
  devIdentity,
  devProxy,
} from "./dev-server";

/**
 * The development server's stand-in for the edge: the three service paths it
 * proxies, the identity header each request carries, and the identity it
 * answers the console with.
 */

/** The header a proxied request carries, as the proxy sets it. */
const HEADER = IDENTITY_HEADER.toLowerCase();

describe("the development proxy", () => {
  it("proxies the three service paths to the forwarded local services", () => {
    const proxy = devProxy({});

    expect(new Set(Object.keys(proxy))).toEqual(
      new Set(["/api", "/arena", "/artifacts"]),
    );
    expect(proxy["/api"]?.target).toBe("http://127.0.0.1:8787");
    expect(proxy["/artifacts"]?.target).toBe("http://127.0.0.1:8790");
    expect(proxy["/arena"]?.target).toBe("http://127.0.0.1:8791");
  });

  it("adds the local identity header, dev@local by default", () => {
    const proxy = devProxy({});

    expect(IDENTITY_HEADER).toBe("Cf-Access-Authenticated-User-Email");
    expect(DEFAULT_IDENTITY).toBe("dev@local");
    for (const options of Object.values(proxy)) {
      expect(options.headers).toEqual({ [HEADER]: "dev@local" });
      // The live streams take the same header through the upgrade.
      expect(options.ws).toBe(true);
    }
  });

  it("takes each target and the identity from the environment", () => {
    const proxy = devProxy({
      TCAB_PROXY_BACKEND: "http://10.0.0.1:1",
      TCAB_PROXY_ARTIFACTS: "http://10.0.0.1:2",
      TCAB_PROXY_ARENA: "http://10.0.0.1:3",
      TCAB_PROXY_IDENTITY: "ada@clockwyrks.com",
    });

    expect(proxy["/api"]?.target).toBe("http://10.0.0.1:1");
    expect(proxy["/artifacts"]?.target).toBe("http://10.0.0.1:2");
    expect(proxy["/arena"]?.target).toBe("http://10.0.0.1:3");
    expect(proxy["/api"]?.headers).toEqual({ [HEADER]: "ada@clockwyrks.com" });
  });

  it("reads an empty variable as unset", () => {
    const proxy = devProxy({ TCAB_PROXY_BACKEND: "", TCAB_PROXY_IDENTITY: "" });

    expect(proxy["/api"]?.target).toBe("http://127.0.0.1:8787");
    expect(proxy["/api"]?.headers).toEqual({ [HEADER]: "dev@local" });
  });
});

/** The response the middleware writes for the identity path. */
function answer(env: Record<string, string>): {
  path: string;
  body: unknown;
  type: unknown;
} {
  let path = "";
  let handler: Connect.SimpleHandleFunction | undefined;
  const server = {
    middlewares: {
      use: (route: string, fn: Connect.SimpleHandleFunction) => {
        path = route;
        handler = fn;
      },
    },
  } as unknown as ViteDevServer;
  const plugin = devIdentity(env);
  const configure = plugin.configureServer;
  if (typeof configure !== "function") throw new Error("no configureServer");
  void configure.call({} as never, server);

  const setHeader = vi.fn();
  const end = vi.fn();
  handler?.({} as never, { setHeader, end } as never);
  return {
    path,
    type: setHeader.mock.calls[0],
    body: JSON.parse(String(end.mock.calls[0]?.[0])),
  };
}

describe("the development identity", () => {
  it("answers the edge's identity path with the identity it presents", () => {
    const { path, body, type } = answer({});

    expect(path).toBe(IDENTITY_PATH);
    expect(path).toBe("/cdn-cgi/access/get-identity");
    expect(type).toEqual(["content-type", "application/json"]);
    expect(body).toEqual({ email: "dev@local" });
  });

  it("answers with the configured identity", () => {
    expect(answer({ TCAB_PROXY_IDENTITY: "ada@clockwyrks.com" }).body).toEqual({
      email: "ada@clockwyrks.com",
    });
  });
});
