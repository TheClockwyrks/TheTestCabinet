// Unit tests for the `[audio] packs` lint's pure core. Hermetic: every case builds a
// throwaway pack registry and a throwaway catalog on disk, and nothing here reads the
// committed `containers/sample-packs/` or touches the network.
//
//   node --test scripts/lib/audio-packs.test.mjs

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

import { normalizedKey, profileId } from "./audio-store.mjs";
import {
  checkRepository,
  checkVersion,
  discoverVersions,
  loadRegistry,
  parseRef,
} from "./audio-packs.mjs";

const scratch = mkdtempSync(join(tmpdir(), "audio-packs-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
/** A fresh scratch directory. */
function tmpDir() {
  const dir = join(scratch, `case-${(counter += 1)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write `text` to `path`, creating the directories it needs. */
function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}

/** A 64-hex clip id derived from `seed`, so a fixture reads legibly. */
function clipId(seed) {
  return seed.repeat(64).slice(0, 64);
}

const KICK = clipId("a1");
const PIANO = clipId("b2");

/**
 * A pack registry holding `combat-core@0.1.0` (a sample pack, one clip) and
 * `gm-lite@0.1.0` (an instrument bank, one clip), plus the object lock that
 * publishes both clips. Returns the paths and the normalized key of each clip.
 */
function fixtureRegistry({
  publish = [KICK, PIANO],
  gmLiteVersion = "0.1.0",
} = {}) {
  const packsDir = join(tmpDir(), "sample-packs");
  write(
    join(packsDir, "clips.toml"),
    [KICK, PIANO]
      .map(
        (id) =>
          `[[clip]]\nid = "${id}"\nlicense = "CC0-1.0"\n` +
          `source_url = "https://example.invalid/${id}.wav"\n`,
      )
      .join("\n"),
  );
  write(
    join(packsDir, "combat-core.toml"),
    'name = "combat-core"\nversion = "0.1.0"\nkind = "sample-pack"\n' +
      "[normalize]\nsample_rate = 44100\nchannels = 1\n" +
      `[[entry]]\nclip = "${KICK}"\nname = "kick"\n`,
  );
  write(
    join(packsDir, "gm-lite.toml"),
    `name = "gm-lite"\nversion = "${gmLiteVersion}"\nkind = "instrument-bank"\n` +
      "[normalize]\nsample_rate = 44100\nchannels = 2\n" +
      `[[entry]]\nclip = "${PIANO}"\nname = "piano"\n`,
  );

  const registry = loadRegistry({ packsDir });
  const lock = {};
  for (const id of publish) {
    const pack =
      id === KICK ? registry.get("combat-core") : registry.get("gm-lite");
    lock[normalizedKey(id, pack.profile_id)] = {
      bucket: "test-cabinet-audio",
      sha256: id,
      bytes: 1,
    };
  }
  const objectsLockPath = join(packsDir, "objects.lock.json");
  write(objectsLockPath, `${JSON.stringify(lock, null, 2)}\n`);
  return { packsDir, objectsLockPath, registry, lock };
}

/** A version record of the shape `discoverVersions` produces. */
function version(overrides = {}) {
  return {
    id: "test-cases/full-stack/medium/gantry/v1.0.0",
    dir: "/nowhere",
    manifestPath: "/nowhere/test-case.toml",
    frozen: false,
    testType: "full-stack",
    assetKind: "sprite",
    packs: null,
    ...overrides,
  };
}

describe("parseRef", () => {
  it("splits a pinned ref into its two halves", () => {
    assert.deepEqual(parseRef("gm-lite@0.1.0"), {
      name: "gm-lite",
      version: "0.1.0",
    });
  });

  it("refuses anything that is not two non-empty halves", () => {
    for (const bad of ["gm-lite", "gm-lite@", "@0.1.0", "", 7, undefined]) {
      assert.equal(parseRef(bad), null, `${JSON.stringify(bad)} is not a ref`);
    }
  });
});

describe("loadRegistry", () => {
  it("keys every committed pack by name and derives its clip object keys", () => {
    const { registry } = fixtureRegistry();
    assert.deepEqual([...registry.keys()].sort(), ["combat-core", "gm-lite"]);
    const bank = registry.get("gm-lite");
    assert.equal(bank.kind, "instrument-bank");
    assert.equal(bank.version, "0.1.0");
    // The key is derived from the pack's own normalize profile, not restated, so the
    // lint and the publisher can never disagree about what "published" means.
    assert.deepEqual(bank.normalizedKeys, [
      { clip: PIANO, key: normalizedKey(PIANO, profileId(bank.normalize)) },
    ]);
  });
});

describe("the declaration rule", () => {
  it("requires a declaration on a full-stack version that is not frozen", () => {
    const { registry, lock } = fixtureRegistry();
    const { errors } = checkVersion(version(), registry, lock);
    assert.deepEqual(errors, [
      "test-cases/full-stack/medium/gantry/v1.0.0: a full-stack version that is not " +
        "frozen must declare [audio] packs (the full set, or the subset this case needs)",
    ]);
  });

  it("requires it on every game jam, in the jam's own wording", () => {
    const { registry, lock } = fixtureRegistry();
    const { errors } = checkVersion(
      version({ id: "game-jams/band-of-bots/v1.0.0", testType: "game-jam" }),
      registry,
      lock,
    );
    assert.equal(errors.length, 1);
    assert.match(
      errors[0],
      /a game-jam version that is not frozen must declare/,
    );
  });

  it("exempts a frozen version, which cannot be edited and takes the pinned default", () => {
    const { registry, lock } = fixtureRegistry();
    const { errors } = checkVersion(version({ frozen: true }), registry, lock);
    assert.deepEqual(errors, []);
  });

  it("does not ask a type that produces no audio to declare one", () => {
    const { registry, lock } = fixtureRegistry();
    for (const testType of ["end-to-end", "adversarial", "performance"]) {
      const { errors } = checkVersion(version({ testType }), registry, lock);
      assert.deepEqual(errors, [], testType);
    }
  });
});

describe("resolving a declared ref against the registry", () => {
  it("accepts a subset and reports the defaults its order resolves to", () => {
    const { registry, lock } = fixtureRegistry();
    const { errors, defaults } = checkVersion(
      version({ packs: ["combat-core@0.1.0", "gm-lite@0.1.0"] }),
      registry,
      lock,
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(defaults, {
      "sample-pack": "combat-core@0.1.0",
      "instrument-bank": "gm-lite@0.1.0",
    });
  });

  it("names a pack the registry does not hold", () => {
    const { registry, lock } = fixtureRegistry();
    const { errors } = checkVersion(
      version({
        id: "test-cases/full-stack/easy/facet/v1.0.0",
        packs: ["gm-lit@0.1.0"],
      }),
      registry,
      lock,
    );
    assert.deepEqual(errors, [
      "test-cases/full-stack/easy/facet/v1.0.0: audio.packs names `gm-lit@0.1.0`; " +
        "containers/sample-packs/ has no pack `gm-lit`",
    ]);
  });

  it("refuses a version the pack manifest does not carry", () => {
    const { registry, lock } = fixtureRegistry();
    const { errors } = checkVersion(
      version({
        id: "test-cases/full-stack/easy/facet/v1.0.0",
        packs: ["gm-lite@0.2.0"],
      }),
      registry,
      lock,
    );
    assert.deepEqual(errors, [
      "test-cases/full-stack/easy/facet/v1.0.0: audio.packs pins `gm-lite@0.2.0`; " +
        "containers/sample-packs/gm-lite.toml is version 0.1.0",
    ]);
  });

  it("refuses a pack whose clips have not been published", () => {
    // The rule that keeps a case from declaring a pack staging could not assemble:
    // the clip is in the registry but its normalized object was never uploaded.
    const { registry, lock } = fixtureRegistry({ publish: [KICK] });
    const { errors } = checkVersion(
      version({
        id: "test-cases/full-stack/easy/facet/v1.0.0",
        packs: ["gm-lite@0.1.0"],
      }),
      registry,
      lock,
    );
    assert.equal(errors.length, 1);
    assert.match(
      errors[0],
      new RegExp(
        `audio\\.packs names \`gm-lite@0\\.1\\.0\`, whose clip ${PIANO} is not published: ` +
          "containers/sample-packs/objects\\.lock\\.json has no record of normalized/",
      ),
    );
  });

  it("holds an audio asset-generation case to a pack of its own kind", () => {
    const { registry, lock } = fixtureRegistry();
    const music = checkVersion(
      version({
        id: "test-cases/asset-generation/medium/lofi-study/v1.0.0",
        testType: "asset-generation",
        assetKind: "music",
        packs: ["combat-core@0.1.0"],
      }),
      registry,
      lock,
    );
    assert.deepEqual(music.errors, [
      "test-cases/asset-generation/medium/lofi-study/v1.0.0: a `music` case's pack must " +
        "be an instrument-bank; `combat-core` is a sample-pack",
    ]);

    const effect = checkVersion(
      version({
        id: "test-cases/asset-generation/medium/thunderhead-broadside/v1.0.0",
        testType: "asset-generation",
        assetKind: "sfx-sample",
        packs: ["gm-lite@0.1.0"],
      }),
      registry,
      lock,
    );
    assert.deepEqual(effect.errors, [
      "test-cases/asset-generation/medium/thunderhead-broadside/v1.0.0: a `sfx-sample` " +
        "case's pack must be a sample-pack; `gm-lite` is an instrument-bank",
    ]);
  });

  it("leaves a malformed ref to manifest resolution rather than reporting it twice", () => {
    const { registry, lock } = fixtureRegistry();
    const { errors } = checkVersion(
      version({ packs: ["gm-lite"] }),
      registry,
      lock,
    );
    assert.deepEqual(errors, []);
  });
});

describe("discovery", () => {
  /** A catalog holding one full-stack case, one frozen one, and one jam. */
  function fixtureCatalog() {
    const root = tmpDir();
    write(
      join(root, "test-cases/full-stack/medium/gantry/v1.0.0/test-case.toml"),
      'slug = "gantry"\ntype = "full-stack"\n' +
        '[audio]\npacks = ["combat-core@0.1.0"]\n',
    );
    write(
      join(root, "test-cases/full-stack/easy/coil/v1.0.0/test-case.toml"),
      'slug = "coil"\ntype = "full-stack"\n',
    );
    write(join(root, "test-cases/full-stack/easy/coil/v1.0.0/.frozen"), "");
    write(
      join(root, "test-cases/end-to-end/easy/pong/v1.0.0/test-case.toml"),
      'slug = "pong"\n',
    );
    write(
      join(root, "game-jams/band-of-bots/v1.0.0/game-jam.toml"),
      'slug = "band-of-bots"\n[audio]\npacks = []\n',
    );
    return root;
  }

  it("reads every version's type, frozen-ness, and declaration", () => {
    const found = discoverVersions({ root: fixtureCatalog() });
    assert.deepEqual(
      found.map((v) => [v.id, v.testType, v.frozen, v.packs]),
      [
        ["game-jams/band-of-bots/v1.0.0", "game-jam", false, []],
        ["test-cases/end-to-end/easy/pong/v1.0.0", "end-to-end", false, null],
        ["test-cases/full-stack/easy/coil/v1.0.0", "full-stack", true, null],
        [
          "test-cases/full-stack/medium/gantry/v1.0.0",
          "full-stack",
          false,
          ["combat-core@0.1.0"],
        ],
      ],
    );
  });

  it("checks the whole catalog in one pass", () => {
    const { packsDir, objectsLockPath } = fixtureRegistry();
    const { errors, versions } = checkRepository({
      root: fixtureCatalog(),
      packsDir,
      objectsLockPath,
    });
    // The frozen version is exempt, the end-to-end case declares nothing, the jam
    // declares an explicit empty set, and the full-stack case resolves.
    assert.deepEqual(errors, []);
    const gantry = versions.find((v) => v.id.endsWith("gantry/v1.0.0"));
    assert.deepEqual(gantry.defaults, { "sample-pack": "combat-core@0.1.0" });
  });
});
