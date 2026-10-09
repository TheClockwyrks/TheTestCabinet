// The Vitest project a suite's validators run as. The Spec Cabinet wrote
// this file when the version grew its first validator and never rewrites
// it, so widen it as the project needs.
//
// The project is rooted at this directory and runs standalone from it, in
// browser mode against the served build: the runner names the build's base URL
// in the environment, and the fallback below is what an author serving a build
// themselves gets. It needs `vitest` and `@vitest/browser-playwright`, at the
// same version, installed in the tree it runs in.
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const baseUrl = process.env.TCAB_VALIDATOR_BASE_URL ?? "http://127.0.0.1:4173/";
// The `globalThis` property the implementation sets the debug API root on,
// which `debug-api.toml` declares. Named by the runner so the project reads
// its own suite's handle rather than a literal copy of it.
const debugApiHandle = process.env.TCAB_DEBUG_API_HANDLE ?? "__carom";

// The served build is reached through this project's own server under this path,
// so the page the tests run in loads it same-origin.
const buildPath = "/__tcab_build__/";

// The setup file that loads the served build into the document each test file
// runs in, before the test file itself is imported. The plugin below serves it,
// so it is not a file of the project.
const loaderFile = `${import.meta.dirname}/__tcab_served_build__.js`;
const loader = `
const buildPath = ${JSON.stringify(buildPath)};
const baseUrl = ${JSON.stringify(baseUrl)};
const handle = ${JSON.stringify(debugApiHandle)};
const index = new URL(buildPath, location.href);
// A URL the build names from the root of its own origin is under buildPath here.
const served = (url) =>
  url.startsWith("/") && !url.startsWith("//")
    ? new URL(buildPath + url.slice(1), location.href).href
    : new URL(url, index).href;

const response = await fetch(index);
if (!response.ok) {
  throw new Error("the build served at " + baseUrl + " could not be loaded: HTTP " + response.status);
}
const page = new DOMParser().parseFromString(await response.text(), "text/html");
for (const element of Array.from(page.querySelectorAll("[src], [href]"))) {
  for (const name of ["src", "href"]) {
    const value = element.getAttribute(name);
    if (value !== null && value.startsWith("/") && !value.startsWith("//")) {
      element.setAttribute(name, served(value));
    }
  }
}

// Every other relative URL the build names resolves against the served build
// rather than against this page.
const base = document.createElement("base");
base.href = index.href;
document.head.prepend(base);

const scripts = [];
for (const [from, to] of [[page.head, document.head], [page.body, document.body]]) {
  for (const node of Array.from(from.children)) {
    if (node.tagName === "BASE") continue;
    if (node.tagName === "SCRIPT") {
      scripts.push(node);
      continue;
    }
    to.appendChild(document.importNode(node, true));
  }
}
for (const script of scripts) {
  const src = script.getAttribute("src");
  if (script.type === "module" && src !== null) {
    await import(/* @vite-ignore */ served(src));
    continue;
  }
  const element = document.createElement("script");
  for (const attribute of Array.from(script.attributes)) {
    element.setAttribute(attribute.name, attribute.value);
  }
  element.textContent = script.textContent;
  const loaded =
    src === null
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
          element.onload = resolve;
          element.onerror = () => reject(new Error("the served build's script " + src + " failed to load"));
        });
  document.body.appendChild(element);
  await loaded;
}

// The root may be set once the build has finished starting rather than while its
// scripts evaluate, so it is waited for, and a build that never sets it says so.
if (handle !== null) {
  const deadline = performance.now() + 10000;
  while (globalThis[handle] === undefined) {
    if (performance.now() > deadline) {
      throw new Error("the served build set no debug API root on globalThis." + handle);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
`;

declare module "vitest" {
  export interface ProvidedContext {
    /** The `globalThis` property the served build sets the debug API root on. */
    debugApiHandle: string;
  }
}

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    {
      name: "tcab-served-build",
      resolveId: (id) =>
        id === loaderFile || id.endsWith("/__tcab_served_build__.js")
          ? loaderFile
          : undefined,
      load: (id) =>
        id === loaderFile ? { code: loader, map: { mappings: "" } } : undefined,
    },
  ],
  server: {
    proxy: {
      [buildPath]: {
        target: baseUrl,
        changeOrigin: true,
        rewrite: (path) => path.slice(buildPath.length - 1),
      },
    },
  },
  test: {
    include: ["**/*.test.ts"],
    setupFiles: [loaderFile],
    // What each test reads with `inject("debugApiHandle")`.
    provide: { debugApiHandle },
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
