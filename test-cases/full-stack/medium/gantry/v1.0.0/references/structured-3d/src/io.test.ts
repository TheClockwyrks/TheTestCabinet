import { describe, expect, it } from "vitest";
import type { World } from "@test-cabinet/structured-3d";
import { MUSIC_CUE, silentIo, worldIo } from "./io";

/** A world whose cue bus records what it was asked to do. */
function fakeWorld(): {
  world: World;
  played: string[];
  looping: Set<string>;
  muted: boolean;
} {
  const record = {
    played: [] as string[],
    looping: new Set<string>(),
    muted: false,
  };
  const audio = {
    play: (cue: string) => record.played.push(cue),
    loop: (cue: string) => record.looping.add(cue),
    stop: (cue: string) => record.looping.delete(cue),
    place: () => {},
    looping: (cue: string) => record.looping.has(cue),
    setMuted: (value: boolean) => {
      record.muted = value;
    },
    muted: () => record.muted,
  };
  return { world: { audio } as unknown as World, ...record };
}

describe("worldIo", () => {
  it("plays a cue through the world's bus", () => {
    const fake = fakeWorld();
    const io = worldIo(() => fake.world);
    io.playCue("place");
    expect(fake.played).toEqual(["place"]);
  });

  it("starts and stops the one loop and the music bed", () => {
    const fake = fakeWorld();
    const io = worldIo(() => fake.world);
    io.setMotor(true);
    io.setMusic(true);
    expect([...fake.looping].sort()).toEqual([MUSIC_CUE, "motor"].sort());
    io.setMotor(false);
    io.setMusic(false);
    expect([...fake.looping]).toEqual([]);
  });

  it("toggles the engine's mute bit and reports it", () => {
    const fake = fakeWorld();
    const io = worldIo(() => fake.world);
    expect(io.muted()).toBe(false);
    io.toggleMute();
    expect(io.muted()).toBe(true);
    io.toggleMute();
    expect(io.muted()).toBe(false);
  });

  it("reads the world at each call rather than holding one", () => {
    let fake = fakeWorld();
    const io = worldIo(() => fake.world);
    io.playCue("place");
    const first = fake;
    fake = fakeWorld();
    io.playCue("delete");
    expect(first.played).toEqual(["place"]);
    expect(fake.played).toEqual(["delete"]);
  });
});

describe("silentIo", () => {
  it("sounds nothing and still carries a mute bit", () => {
    const io = silentIo();
    io.playCue("break");
    io.setMotor(true);
    io.setMusic(true);
    expect(io.muted()).toBe(false);
    io.toggleMute();
    expect(io.muted()).toBe(true);
  });
});
