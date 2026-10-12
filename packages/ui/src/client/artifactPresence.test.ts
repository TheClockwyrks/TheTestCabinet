import { describe, expect, it } from "vitest";
import type { RunSummary } from "@clockwyrks/run-record/snapshot";
import {
  ARTIFACTS_NOT_STORED_LABEL,
  ARTIFACTS_RECLAIMED_LABEL,
  artifactsNotStored,
  artifactsReclaimed,
  markArtifactsNotStored,
  publishedSourceDownload,
  runDownload,
  unpublishableArtifactsLabel,
} from "./artifactPresence";

// A card carrying only an id: presence is keyed on nothing else.
function card(id: string): RunSummary {
  return { id, publishedAt: "" } as unknown as RunSummary;
}

describe("artifact presence on a summary card", () => {
  it("marks exactly the cards the backend named as not stored", () => {
    const [kept, lost] = markArtifactsNotStored(
      [card("kept"), card("lost")],
      ["lost"],
    );
    expect(artifactsNotStored(kept!)).toBe(false);
    expect(artifactsNotStored(lost!)).toBe(true);
  });

  it("reads a card nothing was said about as not known to be missing", () => {
    // Unknown is not "missing": a run a backend has not reconciled, and every card
    // from a source that does not track presence, stays publishable-looking.
    expect(artifactsNotStored(card("unknown"))).toBe(false);
  });

  it("hands the cards back untouched when the page names none", () => {
    const cards = [card("a"), card("b")];
    for (const none of [undefined, null, []]) {
      expect(markArtifactsNotStored(cards, none)).toBe(cards);
    }
  });

  it("leaves the card it was given unmarked", () => {
    const original = card("lost");
    markArtifactsNotStored([original], ["lost"]);
    expect(artifactsNotStored(original)).toBe(false);
  });

  it("ignores an id that is not on the page", () => {
    const [only] = markArtifactsNotStored([card("a")], ["elsewhere"]);
    expect(artifactsNotStored(only!)).toBe(false);
  });
});

describe("a reclaimed tree on a summary card", () => {
  it("marks a reclaimed run as reclaimed and never as lost", () => {
    const [kept, lost, removed] = markArtifactsNotStored(
      [card("kept"), card("lost"), card("removed")],
      ["lost"],
      ["removed"],
    );
    expect(artifactsReclaimed(removed!)).toBe(true);
    expect(artifactsNotStored(removed!)).toBe(false);
    expect(artifactsReclaimed(lost!)).toBe(false);
    expect(artifactsNotStored(lost!)).toBe(true);
    expect(artifactsReclaimed(kept!)).toBe(false);
    expect(artifactsNotStored(kept!)).toBe(false);
  });

  it("reads a run named in both lists as reclaimed", () => {
    // The backend never does this. A console still must not call a tree that
    // was removed on purpose a lost one.
    const [both] = markArtifactsNotStored([card("both")], ["both"], ["both"]);
    expect(artifactsReclaimed(both!)).toBe(true);
    expect(artifactsNotStored(both!)).toBe(false);
  });

  it("marks reclaimed runs on a page that names no lost ones", () => {
    for (const none of [undefined, null, []]) {
      const [removed] = markArtifactsNotStored([card("r")], none, ["r"]);
      expect(artifactsReclaimed(removed!)).toBe(true);
    }
  });

  it("hands the cards back untouched from a backend that names neither", () => {
    const cards = [card("a")];
    expect(markArtifactsNotStored(cards, null, null)).toBe(cards);
    expect(markArtifactsNotStored(cards, [], undefined)).toBe(cards);
  });

  it("says why either kind of run cannot be published", () => {
    const [kept, lost, removed] = markArtifactsNotStored(
      [card("kept"), card("lost"), card("removed")],
      ["lost"],
      ["removed"],
    );
    expect(unpublishableArtifactsLabel(kept!)).toBeNull();
    expect(unpublishableArtifactsLabel(lost!)).toBe(ARTIFACTS_NOT_STORED_LABEL);
    expect(unpublishableArtifactsLabel(removed!)).toBe(
      ARTIFACTS_RECLAIMED_LABEL,
    );
    expect(ARTIFACTS_RECLAIMED_LABEL).toContain(
      "artifacts were removed after the retention period",
    );
  });
});

describe("a published run's source download", () => {
  const ZIP = "https://github.com/owner/repo/archive/refs/heads/main.zip";

  it("builds the released branch's zip archive for a GitHub repository", () => {
    for (const link of [
      "https://github.com/owner/repo",
      "https://github.com/owner/repo/",
      "https://github.com/owner/repo.git",
      "http://github.com/owner/repo",
      "https://www.github.com/owner/repo",
      "https://GitHub.com/owner/repo",
    ]) {
      expect(publishedSourceDownload(link), link).toEqual({
        href: ZIP,
        kind: "archive",
      });
    }
  });

  it("links the page itself for anything it cannot build an archive link for", () => {
    for (const link of [
      // Another host.
      "https://gitlab.com/owner/repo",
      "https://git.example.org/owner/repo",
      // A host that only looks like GitHub.
      "https://github.com.example.org/owner/repo",
      // GitHub, but not a plain owner/repository.
      "https://github.com/owner",
      "https://github.com/owner/repo/tree/some-branch",
    ]) {
      const download = publishedSourceDownload(link);
      expect(download?.kind, link).toBe("page");
      expect(download?.href.replace(/\/$/, ""), link).toBe(link);
    }
  });

  it("offers nothing for no link or one that is not a web address", () => {
    for (const link of [
      null,
      undefined,
      "",
      "owner/repo",
      "git@github.com:owner/repo.git",
      "javascript:alert(1)",
      "ftp://github.com/owner/repo",
    ]) {
      expect(publishedSourceDownload(link), String(link)).toBeNull();
    }
  });
});

describe("what a run's page downloads", () => {
  const treeUrl = "https://artifacts.test/runs/r/archive.tar.gz";
  const tree = { kind: "tree", href: treeUrl };
  const base = {
    published: false,
    artifactsStored: null,
    artifactsReclaimed: false,
    sourceRepo: null,
    treeUrl,
  };

  it("is an unpublished run's tree unless the tree is known to be gone", () => {
    expect(runDownload(base)).toEqual(tree);
    expect(runDownload({ ...base, artifactsStored: true })).toEqual(tree);
    expect(runDownload({ ...base, artifactsStored: false })).toBeNull();
    expect(
      runDownload({
        ...base,
        artifactsStored: false,
        artifactsReclaimed: true,
      }),
    ).toBeNull();
    // A record that says both stored and reclaimed is read as reclaimed.
    expect(
      runDownload({ ...base, artifactsStored: true, artifactsReclaimed: true }),
    ).toBeNull();
    expect(runDownload({ ...base, treeUrl: null })).toBeNull();
  });

  it("never offers an unpublished run its repository", () => {
    // A link on an unpublished record is not a release.
    expect(
      runDownload({
        ...base,
        artifactsStored: false,
        sourceRepo: "https://github.com/owner/repo",
      }),
    ).toBeNull();
  });

  it("is a published run's release, wherever its tree is", () => {
    const published = {
      ...base,
      published: true,
      sourceRepo: "https://github.com/owner/repo",
    };
    const archive = {
      kind: "archive",
      href: "https://github.com/owner/repo/archive/refs/heads/main.zip",
    };
    expect(runDownload(published)).toEqual(archive);
    expect(runDownload({ ...published, artifactsStored: true })).toEqual(
      archive,
    );
    expect(
      runDownload({
        ...published,
        artifactsStored: false,
        artifactsReclaimed: true,
        treeUrl: null,
      }),
    ).toEqual(archive);
  });

  it("is a published run's tree with no release, unless the tree is known to be gone", () => {
    const published = { ...base, published: true };
    expect(runDownload({ ...published, artifactsStored: true })).toEqual(tree);
    // A presence nothing has reported on is a tree that may well be there: every
    // run of a host whose backend holds no service token reads this way.
    expect(runDownload(published)).toEqual(tree);
    expect(runDownload({ ...published, treeUrl: null })).toBeNull();
    expect(runDownload({ ...published, artifactsStored: false })).toBeNull();
    expect(
      runDownload({
        ...published,
        artifactsStored: true,
        artifactsReclaimed: true,
      }),
    ).toBeNull();
    expect(
      runDownload({
        ...published,
        artifactsStored: false,
        artifactsReclaimed: true,
      }),
    ).toBeNull();
  });
});
