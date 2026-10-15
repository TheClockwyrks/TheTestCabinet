// The progress reporter the validator runner hands vitest (`vitest_validator.rs`).
//
// The runner bounds every suite FILE, and it can only do that from outside the
// worker running it: vitest's own test timeout is a timer in the same thread as
// the check, and a build whose frame never returns holds that thread. So the
// runner needs two facts as they happen rather than once the whole run is over —
// when a file started, and what it reported when it finished — and this reporter
// appends each of them to the file `TCAB_VITEST_PROGRESS_FILE` names, one JSON
// object per line.
//
//   {"event":"start","file":"/abs/validation/x.test.ts","testTimeout":300000}
//   {"event":"collected","file":"/abs/validation/x.test.ts","tests":1}
//   {"event":"end","report":{ the JSON reporter's per-file entry }}
//   {"event":"done"}
//
// `start` carries the test timeout the file's project resolved, which is the
// runner's limit on each check in the file: it enforces the allowance the case
// already declares, from outside the thread a hung build holds. `collected` carries
// how many checks the file holds. A worker sends it without waiting for it to
// arrive, so it may never come from a file that hangs at once; the runner counts one
// check until it does, which is what nearly every validator file holds.
//
// Every line is written synchronously, from vitest's main process. That is what
// makes the stream trustworthy at the moment the runner stops a stuck file: a line
// already appended is on disk whatever happens to the process next, and the main
// process is never the one a build's frame is holding. `start` comes from
// `onTestModuleQueued`, which a worker AWAITS before it imports the file, so a file
// cannot be running without its `start` already written. A worker's per-test
// updates, by contrast, are batched on a timer the stuck thread would never fire,
// which is why nothing here is keyed on a test starting.
//
// An `end` line carries exactly the per-file entry vitest's JSON reporter writes
// (`name`, `message`, `assertionResults`), so the runner reads one shape whichever
// way a result reached it. `done` is written once the run has reported everything,
// so a stream without it is a run that ended before it finished reporting.

import { appendFileSync } from "node:fs";

/** The JSON reporter's spelling of a task's state, so the two shapes agree. */
const STATUS = {
  fail: "failed",
  only: "pending",
  pass: "passed",
  run: "pending",
  skip: "skipped",
  todo: "todo",
  queued: "pending",
};

/** Every test under `task`, in declared order. */
function testsOf(task) {
  if (task.type === "test") return [task];
  return (task.tasks ?? []).flatMap(testsOf);
}

/** The JSON reporter's entry for the file `file` (a vitest `File` task). */
function fileReport(file) {
  return {
    name: file.filepath,
    message: file.result?.errors?.[0]?.message ?? "",
    assertionResults: testsOf(file).map((test) => {
      const ancestors = [];
      for (let suite = test.suite; suite; suite = suite.suite) {
        ancestors.unshift(suite.name);
      }
      return {
        fullName: test.name
          ? [...ancestors, test.name].join(" ")
          : ancestors.join(" "),
        title: test.name,
        status: STATUS[test.result?.state || test.mode] || "skipped",
        failureMessages:
          test.result?.errors?.map((error) => error.stack || error.message) ??
          [],
      };
    }),
  };
}

export default class ProgressReporter {
  path = process.env.TCAB_VITEST_PROGRESS_FILE;
  reported = new Set();
  done = false;

  write(event) {
    if (this.path) appendFileSync(this.path, `${JSON.stringify(event)}\n`);
  }

  end(file) {
    if (this.reported.has(file.filepath)) return;
    this.reported.add(file.filepath);
    this.write({ event: "end", report: fileReport(file) });
  }

  finish(files) {
    if (this.done) return;
    // A file that failed before vitest ever ended it — a module that would not
    // load — is still reported, exactly as the JSON reporter would have.
    for (const file of files) this.end(file);
    this.done = true;
    this.write({ event: "done" });
  }

  onTestModuleQueued(testModule) {
    const config = testModule.project?.config ?? {};
    this.write({
      event: "start",
      file: testModule.moduleId,
      testTimeout: config.testTimeout,
    });
  }

  onTestModuleCollected(testModule) {
    this.write({
      event: "collected",
      file: testModule.moduleId,
      tests: testsOf(testModule.task).length,
    });
  }

  onTestModuleEnd(testModule) {
    this.end(testModule.task);
  }

  onTestRunEnd(testModules) {
    this.finish(testModules.map((testModule) => testModule.task));
  }
}
