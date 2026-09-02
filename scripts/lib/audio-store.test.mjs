// Unit tests for the audio clip store's data model. Hermetic: every case works on
// temporary files, and nothing here touches the network, ffmpeg, or R2.
//
//   node --test scripts/lib/audio-store.test.mjs

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  normalizedKey,
  profileId,
  readClips,
  readObjectsLock,
  readPack,
  resolveEntry,
  sourceKey,
  writeClips,
  writeObjectsLock,
} from "./audio-store.mjs";

const dir = mkdtempSync(join(tmpdir(), "audio-store-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

let counter = 0;
/** Write `text` to a fresh file in the scratch dir and return its path. */
function tmpFile(text, ext = ".toml") {
  const path = join(dir, `case-${counter++}${ext}`);
  writeFileSync(path, text, "utf8");
  return path;
}

const ID_A = "a".repeat(64);
const ID_B = "b".repeat(64);

const REGISTRY = `
[[clip]]
id = "${ID_A}"
license = "CC0-1.0"
source_url = "https://cdn.freesound.org/previews/68/68447_871124-hq.ogg"
freesound_id = 68447
root_note = 68

[[clip]]
id = "${ID_B}"
license = "CC0-1.0"
source_url = "https://cdn.freesound.org/previews/347/347422_4551235-hq.ogg"
`;

const GM_PROFILE = {
  sample_rate: 44100,
  channels: 2,
  loudness_lufs: -20.0,
  true_peak_dbfs: -1.0,
  trim_silence: true,
  max_duration_ms: 5000,
};

describe("profileId", () => {
  it("hashes exactly the documented canonical encoding", () => {
    const expected = createHash("sha256")
      .update("44100|2|-20|-1|true|5000", "utf8")
      .digest("hex")
      .slice(0, 16);
    assert.equal(profileId(GM_PROFILE), expected);
    assert.match(profileId(GM_PROFILE), /^[0-9a-f]{16}$/);
  });

  it("is independent of key order", () => {
    const reordered = {
      max_duration_ms: 5000,
      trim_silence: true,
      channels: 2,
      true_peak_dbfs: -1.0,
      sample_rate: 44100,
      loudness_lufs: -20.0,
    };
    assert.equal(profileId(reordered), profileId(GM_PROFILE));
  });

  it("is independent of numeric formatting", () => {
    const respelled = {
      ...GM_PROFILE,
      sample_rate: 44100,
      loudness_lufs: -20,
      true_peak_dbfs: -1.0,
      max_duration_ms: 5e3,
    };
    assert.equal(profileId(respelled), profileId(GM_PROFILE));
    assert.equal(
      profileId({ ...GM_PROFILE, true_peak_dbfs: -0 }),
      profileId({ ...GM_PROFILE, true_peak_dbfs: 0 }),
    );
  });

  it("fills the same defaults for an omitted field as for its default value", () => {
    assert.equal(profileId({}), profileId({ sample_rate: 44100 }));
    assert.equal(
      profileId({ channels: 1 }),
      profileId({
        sample_rate: 44100,
        channels: 1,
        loudness_lufs: -23,
        true_peak_dbfs: -1,
        trim_silence: true,
        max_duration_ms: 5000,
      }),
    );
  });

  it("changes when any field changes", () => {
    const base = profileId(GM_PROFILE);
    for (const [field, value] of [
      ["sample_rate", 48000],
      ["channels", 1],
      ["loudness_lufs", -23],
      ["true_peak_dbfs", -1.5],
      ["trim_silence", false],
      ["max_duration_ms", 4000],
    ]) {
      assert.notEqual(
        profileId({ ...GM_PROFILE, [field]: value }),
        base,
        field,
      );
    }
  });

  it("rejects a structurally invalid profile", () => {
    assert.throws(
      () => profileId({ ...GM_PROFILE, channels: 3 }),
      /channels must be 1 or 2/,
    );
    assert.throws(
      () => profileId({ ...GM_PROFILE, sample_rate: 44100.5 }),
      /sample_rate must be a positive integer/,
    );
    assert.throws(
      () => profileId({ ...GM_PROFILE, trim_silence: "yes" }),
      /trim_silence must be a boolean/,
    );
  });
});

describe("object keys", () => {
  it("names the source and normalized objects", () => {
    assert.equal(sourceKey(ID_A), `sources/${ID_A}`);
    assert.equal(
      normalizedKey(ID_A, "0123456789abcdef"),
      `normalized/${ID_A}/0123456789abcdef.wav`,
    );
  });

  it("rejects an id that is not a clip id", () => {
    assert.throws(() => sourceKey("A".repeat(64)), /64 lowercase hex/);
    assert.throws(() => normalizedKey(ID_A, "nope"), /16 lowercase hex/);
  });
});

describe("readClips", () => {
  it("reads a valid registry", () => {
    const clips = readClips(tmpFile(REGISTRY));
    assert.equal(clips.size, 2);
    assert.equal(clips.get(ID_A).root_note, 68);
    assert.equal(clips.get(ID_A).freesound_id, 68447);
    assert.equal(clips.get(ID_B).root_note, undefined);
  });

  it("rejects an id that is not 64 lowercase hex", () => {
    assert.throws(
      () =>
        readClips(
          tmpFile(
            `[[clip]]\nid = "abc"\nlicense = "CC0-1.0"\nsource_url = "u"\n`,
          ),
        ),
      /id must be 64 lowercase hex/,
    );
    assert.throws(
      () =>
        readClips(
          tmpFile(
            `[[clip]]\nid = "${"A".repeat(64)}"\nlicense = "CC0-1.0"\nsource_url = "u"\n`,
          ),
        ),
      /id must be 64 lowercase hex/,
    );
  });

  it("rejects a duplicate id", () => {
    assert.throws(
      () => readClips(tmpFile(REGISTRY + REGISTRY)),
      /duplicate clip id/,
    );
  });

  it("rejects a missing license or source_url", () => {
    assert.throws(
      () => readClips(tmpFile(`[[clip]]\nid = "${ID_A}"\nsource_url = "u"\n`)),
      /missing required string field "license"/,
    );
    assert.throws(
      () =>
        readClips(tmpFile(`[[clip]]\nid = "${ID_A}"\nlicense = "CC0-1.0"\n`)),
      /missing required string field "source_url"/,
    );
  });

  it("rejects a root_note outside 0..127 or non-integer", () => {
    const withNote = (note) =>
      tmpFile(
        `[[clip]]\nid = "${ID_A}"\nlicense = "CC0-1.0"\nsource_url = "u"\nroot_note = ${note}\n`,
      );
    assert.throws(
      () => readClips(withNote(128)),
      /root_note must be a MIDI integer 0\.\.127/,
    );
    assert.throws(
      () => readClips(withNote(-1)),
      /root_note must be a MIDI integer 0\.\.127/,
    );
    assert.throws(
      () => readClips(withNote("60.5")),
      /root_note must be a MIDI integer 0\.\.127/,
    );
    assert.equal(readClips(withNote(0)).get(ID_A).root_note, 0);
    assert.equal(readClips(withNote(127)).get(ID_A).root_note, 127);
  });

  it("reports the offending file when the TOML does not parse", () => {
    const path = tmpFile("id = \n");
    assert.throws(() => readClips(path), new RegExp(`parsing ${path}`));
  });
});

describe("writeClips", () => {
  it("sorts by id and round-trips", () => {
    const path = join(dir, "written-clips.toml");
    writeClips(
      [
        { id: ID_B, license: "CC0-1.0", source_url: "b" },
        { id: ID_A, license: "CC0-1.0", source_url: "a", root_note: 68 },
      ],
      path,
    );
    const clips = readClips(path);
    assert.deepEqual([...clips.keys()], [ID_A, ID_B]);
    assert.equal(clips.get(ID_A).root_note, 68);
    // Writing what was read is a no-op, so a rewrite never churns the diff.
    const before = readClips(path);
    writeClips(before, path);
    assert.deepEqual([...readClips(path).keys()], [ID_A, ID_B]);
  });

  it("rejects a duplicate id", () => {
    assert.throws(
      () =>
        writeClips(
          [
            { id: ID_A, license: "CC0-1.0", source_url: "a" },
            { id: ID_A, license: "CC0-1.0", source_url: "a" },
          ],
          join(dir, "dupe.toml"),
        ),
      /duplicate clip id/,
    );
  });
});

describe("the object lock", () => {
  it("reads a missing lock as empty", () => {
    assert.deepEqual(readObjectsLock(join(dir, "absent.lock.json")), {});
  });

  it("writes keys sorted", () => {
    const path = join(dir, "objects.lock.json");
    writeObjectsLock(
      {
        [normalizedKey(ID_B, "0123456789abcdef")]: {
          bucket: "b",
          sha256: ID_B,
          bytes: 2,
        },
        [sourceKey(ID_A)]: { bucket: "b", sha256: ID_A, bytes: 1 },
      },
      path,
    );
    const lock = readObjectsLock(path);
    assert.deepEqual(Object.keys(lock), [
      `normalized/${ID_B}/0123456789abcdef.wav`,
      `sources/${ID_A}`,
    ]);
    assert.equal(lock[sourceKey(ID_A)].bytes, 1);
  });

  it("rejects a lock that is not an object", () => {
    assert.throws(
      () => readObjectsLock(tmpFile("[1, 2]", ".json")),
      /expected a JSON object/,
    );
  });
});

describe("readPack", () => {
  const clips = readClips(tmpFile(REGISTRY));

  const PACK = `
name = "gm-lite"
version = "0.2.0"
kind = "instrument-bank"

[normalize]
sample_rate = 44100
channels = 2
loudness_lufs = -20.0
true_peak_dbfs = -1.0
trim_silence = true
max_duration_ms = 5000

[[entry]]
clip = "${ID_A}"
name = "grand_piano"
tags = ["keys", "piano"]
description = "A single sustained acoustic grand-piano note."

[[entry]]
clip = "${ID_B}"
name = "music_box"
tags = ["keys"]
description = "A delicate music-box note."
root_note = 88
pitched = false
`;

  it("parses the new format", () => {
    const pack = readPack(tmpFile(PACK), clips);
    assert.equal(pack.name, "gm-lite");
    assert.equal(pack.version, "0.2.0");
    assert.equal(pack.kind, "instrument-bank");
    assert.equal(pack.profile_id, profileId(GM_PROFILE));
    assert.deepEqual(
      pack.entries.map((e) => e.name),
      ["grand_piano", "music_box"],
    );
    assert.deepEqual(pack.entries[0].tags, ["keys", "piano"]);
  });

  it("rejects the old format by name, with the migration", () => {
    const legacy = `
name = "gm-lite"
version = "0.1.0"
kind = "instrument-bank"

[[instrument]]
name = "grand_piano"
license = "CC0-1.0"
url = "https://cdn.freesound.org/previews/68/68447_871124-hq.ogg"
sha256 = "${ID_A}"
`;
    assert.throws(
      () => readPack(tmpFile(legacy), clips),
      (err) => {
        assert.match(err.message, /legacy pack format/);
        assert.match(err.message, /\[\[sample\]\] \/ \[\[instrument\]\]/);
        assert.match(err.message, /clips\.toml/);
        assert.match(err.message, /\[\[entry\]\]/);
        return true;
      },
    );
    assert.throws(
      () =>
        readPack(
          tmpFile(legacy.replace("[[instrument]]", "[[sample]]")),
          clips,
        ),
      /legacy pack format/,
    );
  });

  it("rejects an entry carrying url, sha256 or license", () => {
    for (const field of ["url", "sha256", "license"]) {
      const bad = PACK.replace(
        `name = "grand_piano"`,
        `name = "grand_piano"\n${field} = "x"`,
      );
      assert.throws(
        () => readPack(tmpFile(bad), clips),
        new RegExp(`"${field}" belongs to the clip`),
      );
    }
  });

  it("rejects an entry naming a clip absent from the registry", () => {
    const bad = PACK.replace(ID_B, "c".repeat(64));
    assert.throws(
      () => readPack(tmpFile(bad), clips),
      /is not in the clip registry/,
    );
  });

  it("rejects a duplicate entry name", () => {
    const bad = PACK.replace(`name = "music_box"`, `name = "grand_piano"`);
    assert.throws(() => readPack(tmpFile(bad), clips), /duplicate entry name/);
  });

  it("rejects a pack with no entries, an unknown kind, or a bad clip id", () => {
    assert.throws(
      () =>
        readPack(
          tmpFile(`name = "p"\nversion = "1"\nkind = "sample-pack"\n`),
          clips,
        ),
      /no \[\[entry\]\] tables/,
    );
    assert.throws(
      () =>
        readPack(
          tmpFile(PACK.replace("instrument-bank", "instrument_bank")),
          clips,
        ),
      /kind must be one of/,
    );
    assert.throws(
      () => readPack(tmpFile(PACK.replace(ID_A, "nope")), clips),
      /clip must be a 64 lowercase hex clip id/,
    );
  });

  it("defaults kind and the normalize profile", () => {
    const pack = readPack(
      tmpFile(
        `name = "p"\nversion = "1"\n\n[[entry]]\nclip = "${ID_A}"\nname = "a"\n`,
      ),
      clips,
    );
    assert.equal(pack.kind, "sample-pack");
    assert.equal(pack.profile_id, profileId({}));
  });
});

describe("resolveEntry", () => {
  const clips = readClips(tmpFile(REGISTRY));
  const pack = readPack(
    tmpFile(`
name = "gm-lite"
version = "0.2.0"
kind = "instrument-bank"

[normalize]
sample_rate = 44100
channels = 2
loudness_lufs = -20.0
true_peak_dbfs = -1.0
trim_silence = true
max_duration_ms = 5000

[[entry]]
clip = "${ID_A}"
name = "grand_piano"

[[entry]]
clip = "${ID_A}"
name = "detuned_piano"
root_note = 60
pitched = false
`),
    clips,
  );

  it("takes root_note from the registry by default", () => {
    const resolved = resolveEntry(pack, pack.entries[0], clips);
    assert.equal(resolved.root_note, 68);
    assert.equal(resolved.pitched, true);
    assert.equal(resolved.license, "CC0-1.0");
    assert.equal(resolved.source_key, sourceKey(ID_A));
    assert.equal(resolved.normalized_key, normalizedKey(ID_A, pack.profile_id));
  });

  it("lets the pack override root_note and pitched", () => {
    const resolved = resolveEntry(pack, pack.entries[1], clips);
    assert.equal(resolved.root_note, 60);
    assert.equal(resolved.pitched, false);
    // Two names for one clip resolve to the same object.
    assert.equal(
      resolved.normalized_key,
      resolveEntry(pack, pack.entries[0], clips).normalized_key,
    );
  });

  it("leaves root_note undefined when neither side declares one", () => {
    const other = readPack(
      tmpFile(
        `name = "p"\nversion = "1"\n\n[[entry]]\nclip = "${ID_B}"\nname = "b"\n`,
      ),
      clips,
    );
    assert.equal(
      resolveEntry(other, other.entries[0], clips).root_note,
      undefined,
    );
  });
});
