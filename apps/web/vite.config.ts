import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
// The test block below is Vitest's, and `vitest/config` is the entry point that
// declares it alongside Vite's own options.
import { configDefaults, defineConfig } from "vitest/config";

/**
 * The web app's build, its development server and its test run.
 *
 * Every client is a build of this app, so what is configured here is what the
 * browser build and every build made from it carry.
 */

/** The port the development server binds when `PORT_VARIABLE` names none. */
const DEV_SERVER_PORT = 1430;

/**
 * The port the server binds, which `/api` is proxied to when
 * `SERVER_URL_VARIABLE` names no other server.
 *
 * It is the port the server's crate binds when `BIND` names none, so the server
 * and this development server meet with nothing configured.
 */
const SERVER_PORT = 8080;

/** The variable naming another port for the development server. */
// prettier-ignore
const PORT_VARIABLE = "THE_TEST_CABINET_WEB_PORT";

/** The variable naming another server for `/api`, as an HTTP address. */
// prettier-ignore
const SERVER_URL_VARIABLE = "THE_TEST_CABINET_BACKEND_URL";

/** The test files the browser project owns, which the jsdom project skips. */
const BROWSER_TESTS = "src/**/*.browser.test.{ts,tsx}";

/** The engines the devcontainer installs, which the browser suite runs in. */
const ENGINES = ["chromium", "firefox", "webkit"] as const;

/** A viewport size the app is designed for. */
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

/**
 * The `classname` every JUnit case carries, which with the case's name is the
 * key the `ci` project's metrics record a test under.
 *
 * The file name alone is not a key: the browser project runs one file once per
 * instance (three engines times two viewport sizes), so six cases would share
 * it and five of the six timings would be merged away. `displayName` is the
 * project a case ran under, `jsdom` or the browser project's per-instance name,
 * which tells the six apart and stays the same from run to run.
 */
const CLASSNAME_TEMPLATE = "{displayName}/{filename}";

/** A variable's value, or nothing where it is unset or empty. */
function configured(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

/** The port the development server binds, taken from the environment. */
function devPort(): number {
  const value = configured(PORT_VARIABLE);
  if (value === undefined) {
    return DEV_SERVER_PORT;
  }

  // A port is the whole of the value or nothing: `Number()` reads the string
  // entire, where `parseInt` would take the leading digits of `5173x` and call
  // that a port.
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError(`${PORT_VARIABLE} is not a port number: ${value}`);
  }

  return port;
}

/**
 * The server `/api` is proxied to, taken from the environment.
 *
 * The server speaks plain HTTP on this machine unless the variable names
 * another, such as one running in a cluster behind a forwarded port.
 */
function serverUrl(): string {
  return configured(SERVER_URL_VARIABLE) ?? `http://127.0.0.1:${SERVER_PORT}`;
}

/**
 * The directory a gate run wants this suite's machine-readable results in.
 *
 * `ci/gates/web-test.py` and `ci/gates/web-browser-test.py` run the suite with
 * the `CI_GATE_ARTIFACTS` their runner names. Without it, which is every plain
 * `npm test` and `npm run test:browser`, the suite writes no report and
 * collects no coverage.
 */
const artifacts = configured("CI_GATE_ARTIFACTS");

/**
 * Whether the gate asking for artifacts also wants coverage.
 *
 * Coverage belongs to the jsdom project, which is where the app's behaviour is
 * stated. `ci/gates/web-browser-test.py` sets this to `0` so the engines are
 * never instrumented: it wants the JUnit report alone.
 */
const coverage = process.env.CI_GATE_COVERAGE !== "0";

/**
 * Where the browser instance named `instance` leaves what a test attached,
 * which includes the screenshot an engine takes of a test that failed.
 *
 * The screenshot is named after the file and the test alone, so six instances
 * running one file would write over each other's in one directory: each
 * instance is given a directory of its own. Under a gate that names
 * `CI_GATE_ARTIFACTS` they go there, which is the directory the pipeline
 * publishes, and otherwise beneath Vitest's own `.vitest/attachments`.
 */
function attachmentsFor(instance: string): string {
  return `${artifacts ?? ".vitest"}/attachments/${instance}`;
}

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind every interface, so a phone on the same network opens a development
    // build at the host machine's address.
    host: true,
    port: devPort(),
    // A taken port fails the start rather than moving to another one, so the
    // port a browser was pointed at is always the port that is serving.
    strictPort: true,
    // The server answers every route under the same prefix, so a page reads
    // the same address whether this server or the server itself is serving it.
    proxy: {
      // `ws` carries a WebSocket under `/api` through the same proxy the JSON
      // routes take, and `xfwd` states the address the browser asked for,
      // which is the address a server hands back to a client that is to reach
      // it again.
      "/api": {
        target: serverUrl(),
        changeOrigin: true,
        ws: true,
        xfwd: true,
      },
    },
  },
  test: {
    /*
     * Two projects, because the app is checked in two places. Almost every
     * test states what a screen renders, which jsdom answers in a fraction of
     * the time a browser takes. The rest state what only a browser knows: what
     * the cascade resolves a color to, which layout a viewport width selects,
     * and whether the document overflows its width. The file name is what
     * decides which project a test belongs to, so the two file sets never
     * overlap.
     */
    projects: [
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          globals: true,
          setupFiles: ["src/test/setup.ts"],
          include: ["src/**/*.test.{ts,tsx}"],
          // The browser suite is named by the same glob, and its scaffolding
          // is the opposite of this project's, so it is taken back out here.
          exclude: [...configDefaults.exclude, BROWSER_TESTS],
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          globals: true,
          setupFiles: ["src/test/browser-setup.ts"],
          include: [BROWSER_TESTS],
          /*
           * One file at a time per instance. Every file run in parallel opens
           * a page of its own in each of the six instances, and the threads
           * three engines spawn for them outgrow a container's process limit
           * well before they outgrow its memory, which crashes a page rather
           * than failing a test.
           */
          fileParallelism: false,
          browser: {
            enabled: true,
            /*
             * Every page mounts the WebGL synthwave scene behind its content
             * unless the browser asks for reduced motion, and a headless engine
             * on a machine without a GPU rasterizes that scene in software on
             * the page's main thread. On a pipeline agent, six instances
             * sharing two cores, the thread is then blocked for seconds at a
             * stretch: a row's arrival outlasts a `findByRole` timeout, and a
             * real pointer click outlasts the test. Nothing here states what
             * the scene renders, so every context asks for reduced motion,
             * which the backdrop answers with its static CSS fallback. The
             * option is the provider's, not an instance's: an instance's
             * `contextOptions` is not read.
             */
            provider: playwright({
              contextOptions: { reducedMotion: "reduce" },
            }),
            // Nothing here watches a browser render, in a pipeline or under a
            // developer, so no window is opened.
            headless: true,
            /*
             * One instance per engine per viewport size, because neither size
             * is primary and an instance is what fixes the width a test
             * renders at. Chromium and Firefox are themselves, and WebKit is
             * the engine Safari is built on, which is as close as a Linux
             * machine reaches Safari.
             */
            instances: ENGINES.flatMap((browser) =>
              VIEWPORTS.map(({ name, width, height }) => ({
                browser,
                name: `${browser}-${name}`,
                viewport: { width, height },
                attachmentsDir: attachmentsFor(`${browser}-${name}`),
              })),
            ),
          },
        },
      },
    ],
    /*
     * Reporters and coverage belong to the whole run rather than to a project,
     * so they are stated here, and both gates that run a project of this
     * configuration ask for their reports the same way: by naming a directory
     * in `CI_GATE_ARTIFACTS`. `ci/gates/web-browser-test.py` additionally sets
     * `CI_GATE_COVERAGE=0`, so the engines are never instrumented. The file
     * names are the ones `metrics collect` reads: `junit.xml`, and the
     * `coverage-summary.json` istanbul's `json-summary` reporter writes.
     */
    ...(artifacts !== undefined && {
      reporters: [
        "default",
        ["junit", { classnameTemplate: CLASSNAME_TEMPLATE }] as const,
      ],
      outputFile: { junit: `${artifacts}/junit.xml` },
      ...(coverage && {
        coverage: {
          enabled: true,
          provider: "v8" as const,
          // Every source, so a file no test imports counts as uncovered
          // instead of dropping out of the total.
          include: ["src/**/*.{ts,tsx}"],
          exclude: ["src/**/*.test.{ts,tsx}", "src/test/**"],
          reporter: ["json-summary"],
          reportsDirectory: artifacts,
          // The directory is the gate's, and the JUnit report shares it.
          clean: false,
        },
      }),
    }),
  },
});
