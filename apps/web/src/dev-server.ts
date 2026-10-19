import type { Plugin, ProxyOptions } from "vite";

/**
 * The development server's proxy and the identity it presents.
 *
 * In a deployment the edge serves every service at a path of the console's
 * origin and adds the signed-in person's Access assertion to each request. The
 * development server stands in for the edge: it proxies the same paths to the
 * forwarded local services and adds the local identity header, which a local
 * service, verifying no assertion, records as the caller
 * (components/web/overview.md, "Configuration"; components/auth/overview.md).
 *
 * It is read by `vite.config.ts` and never imported by the app.
 */

/**
 * The services the development server proxies, each at the path the edge
 * serves it under in a deployment, and the address it is reached at by default:
 * the port `make -C deployments/local local-forward` holds it on. A variable
 * of the same name in the environment or in a gitignored
 * `.env.development.local` aims a path elsewhere.
 */
export const PROXIED_SERVICES = [
  { path: "/api", variable: "TCAB_PROXY_BACKEND", port: 8787 },
  { path: "/artifacts", variable: "TCAB_PROXY_ARTIFACTS", port: 8790 },
  { path: "/arena", variable: "TCAB_PROXY_ARENA", port: 8791 },
] as const;

/**
 * The header a local service takes the caller's identity from. A local service
 * verifies no Access assertion and records the identity this header presents,
 * which is what the edge's assertion carries in a deployment.
 */
export const IDENTITY_HEADER = "Cf-Access-Authenticated-User-Email";

/** The identity the development server presents when none is configured. */
export const DEFAULT_IDENTITY = "dev@local";

/** The variable naming another identity for the development server to present. */
export const IDENTITY_VARIABLE = "TCAB_PROXY_IDENTITY";

/**
 * The path of the origin the edge answers with the signed-in person's identity
 * (Cloudflare Access's `get-identity`), which the console reads to recognise its
 * own work. The development server answers it with the identity it presents.
 */
export const IDENTITY_PATH = "/cdn-cgi/access/get-identity";

/** A variable's value from the loaded environment, or nothing where unset. */
function fromEnv(
  env: Readonly<Record<string, string>>,
  name: string,
): string | undefined {
  const value = env[name];
  return value === undefined || value === "" ? undefined : value;
}

/**
 * The development server's proxy: each of {@link PROXIED_SERVICES} at its
 * path, every request carrying {@link IDENTITY_HEADER}.
 *
 * `env` is what Vite loaded for the mode, the process environment over the
 * `.env*` files, so a value in `.env.development.local` reaches it. The header
 * is set on every proxied request, the WebSocket upgrades included, and
 * replaces any the browser sent, so the identity a local service records is
 * always the one configured here.
 */
export function devProxy(
  env: Readonly<Record<string, string>>,
): Record<string, ProxyOptions> {
  const identity = fromEnv(env, IDENTITY_VARIABLE) ?? DEFAULT_IDENTITY;
  return Object.fromEntries(
    PROXIED_SERVICES.map(({ path, variable, port }) => [
      path,
      {
        target: fromEnv(env, variable) ?? `http://127.0.0.1:${String(port)}`,
        changeOrigin: true,
        // `ws` carries a WebSocket under the path through the same proxy the
        // JSON routes take, and `xfwd` states the address the browser asked
        // for, which is the address a server hands back to a client that is
        // to reach it again.
        ws: true,
        xfwd: true,
        // Lower case, the spelling the proxy copies the browser's headers
        // under, so this replaces a header the browser sent rather than
        // sitting beside it.
        headers: { [IDENTITY_HEADER.toLowerCase()]: identity },
      },
    ]),
  );
}

/**
 * Answers {@link IDENTITY_PATH} the way the edge does, with the identity the
 * proxy presents, so the console recognises its own work in development too.
 */
export function devIdentity(env: Readonly<Record<string, string>>): Plugin {
  const email = fromEnv(env, IDENTITY_VARIABLE) ?? DEFAULT_IDENTITY;
  return {
    name: "tcab-dev-identity",
    configureServer(server) {
      server.middlewares.use(IDENTITY_PATH, (_request, response) => {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ email }));
      });
    },
  };
}
