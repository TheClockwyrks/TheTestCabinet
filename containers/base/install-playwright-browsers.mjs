#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

function requireRegistry() {
  const npmPrefix = process.env.NPM_CONFIG_PREFIX || "/usr/local";
  const candidates = [
    path.join(npmPrefix, "lib/node_modules/playwright-core/lib/server/registry/index.js"),
    path.join(npmPrefix, "lib/node_modules/playwright/node_modules/playwright-core/lib/server/registry/index.js"),
    "/usr/local/lib/node_modules/playwright-core/lib/server/registry/index.js",
    "/usr/local/lib/node_modules/playwright/node_modules/playwright-core/lib/server/registry/index.js",
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { path: candidate, module: require(candidate) };
    }
  }

  throw new Error(`could not find Playwright registry module; tried:\n${candidates.join("\n")}`);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function download(urls, zipPath) {
  let lastError = null;
  for (const url of urls) {
    const result = spawnSync(
      "curl",
      ["-L", "--fail", "--retry", "3", "--connect-timeout", "30", "--output", zipPath, url],
      { stdio: "inherit" },
    );
    if (result.status === 0) {
      return;
    }
    lastError = `${url} failed with exit code ${result.status}`;
  }
  throw new Error(lastError || "no download URLs available");
}

function markerPath(browserDirectory) {
  return path.join(browserDirectory, "INSTALLATION_COMPLETE");
}

const { path: registryPath, module: registryModule } = requireRegistry();
const { registry } = registryModule;
const packagePath = path.dirname(path.dirname(path.dirname(path.dirname(registryPath))));
const browsers = new Map(registry._executables.map((executable) => [executable.name, executable]));
const targets = ["chromium", "chromium-headless-shell", "ffmpeg"];

for (const target of targets) {
  const executable = browsers.get(target);
  if (!executable) {
    throw new Error(`Playwright registry does not contain ${target}`);
  }
  if (!executable.downloadURLs?.length) {
    throw new Error(`Playwright registry does not provide download URLs for ${target}`);
  }

  const directory = executable.directory;
  const zipPath = path.join(os.tmpdir(), `${target}.zip`);

  fs.rmSync(directory, { recursive: true, force: true });
  fs.rmSync(zipPath, { force: true });
  fs.mkdirSync(path.dirname(directory), { recursive: true });

  console.log(`Installing ${target} into ${directory}`);
  download(executable.downloadURLs, zipPath);
  fs.mkdirSync(directory, { recursive: true });
  run("unzip", ["-q", zipPath, "-d", directory]);
  fs.rmSync(zipPath, { force: true });

  const executablePath = executable.executablePath?.("node");
  if (executablePath && fs.existsSync(executablePath)) {
    fs.chmodSync(executablePath, 0o755);
  }
  fs.writeFileSync(markerPath(directory), "");
}

const linksDir = path.join(path.dirname(browsers.get("chromium").directory), ".links");
fs.mkdirSync(linksDir, { recursive: true });
fs.writeFileSync(path.join(linksDir, createHash("sha1").update(packagePath).digest("hex")), packagePath);
