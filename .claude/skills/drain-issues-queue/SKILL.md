---
description: Describes the policies to follow when instructed to drain the issues queue.
name: drain-issues-queue
---

## Context

The standard development pattern within this repository is as follows:

- Manually test an implementation
- Put together a list of bugs, changes, and improvements that need to be made
- File and commit issues that covers the list
  - This process also updates documentation to match the intended design.
- Drain the issues queue
- Repeat

This skill covers how the issues queue should be drained. The `repo-tasks` skill
is mandatory reading when using this skill as it provides the policies that
govern how the `tasks/` folder is used.

## Scope

All issues are located under `tasks/` in the repo root. The "repo-tasks" skill
covers policies for issue files.

Whenever this skill is used, the expectation is that **ALL** open issues are to
be implemented. If any issues are to be excluded, they will be explicitly
mentioned when using this skill. If no issues are mentioned, then all open
issues are in scope.

## Policies

### Fully Autonomous Execution

While draining the issues queue, work fully autonomously. Defer anything that
requires user input to the end of the session rather than interrupting the
session to ask the user.

### Instruct Reviewers to Operate "Within Reason"

If a reviewer is instructed to adversarially review an item and look for issues,
reviewers will sometimes go to absurd lengths to find an issue, then raise the
complaint and waste time fixing an issue that is not actually a problem. This
also often leads to writing convoluted code to address a theoretical issue that
can't actually occur in practice.

Reviewers should only return feedback if addressing their feedback improves the
codebase.

### **NEVER** Override Documentation

This repo's documentation is used like k8s YAMLs in that they declare the state
that the code is supposed to be in. The task of implementing issues is to align
the code with the documentation, **NEVER** the other way around. Any agent that
edits documentation to match the code violates this policy and is effectively
performing unauthorized work as they're silently deleting aspects of the
intended design.

Agents *may* modify documentation to add clarifications, but are **NEVER**
allowed to make design decisions themselves. Additionally, changes to the
documentation may only be made to clarify the intended behavior or mandate a
specific implementation, **NEVER** to describe the current implementation.
Describing the code for the sake of documenting the code instead of to mandate
specific traits about the implementation inventing a second source of truth.

The documentation skill applies any time edits to the documentation are made.

### Do Not Interrupt on Blocked Issues

This skill is used when a large number of issues are open. If an issue requires
additional clarification and is reclassified as blocked, overall progress must
*not* be blocked. As long as other issues remain that don't rely on a blocked
issue and are open, progress should continue to be made. This ensures that all
blocked issues can be addressed as a batch instead of one at a time.

### Reclassifying Issues as Blocked

When filing issues, the expectation is that the documentation specifies the
necessary design details. However, the documentation does **NOT** attempt to
specify every last detail of the implementation as doing so would make the
documentation a second source of truth for the implementation. Instead, the
documentation *only* attempts to specify aspects of the design and drops down
to low level details only implementation details are a hard requirement.

Agents are explicitly **NOT** allowed to make design-level changes to the
documentation, so there needs to be a mechanism for an implementer to stop
without implementing a issue if there's an issue. For example, if the
documentation has contradictions or inconsistencies, an implementation cannot
satisfy the documented specification.

Workflows must be designed such that an agent may return without completing its
issue and signal that the issue is blocked. This **MUST** be accompanied by the
agent's explanation of why the issue is blocked, and the workflow **MUST** have
a reviewer verify the rationale. If the reviewer agrees, the reviewer must move
the issue to epic's `blocked/` folder, write the reason for why it's blocked
(what needs to be addressed to unblock the issue) into the issue, and commit the
updated issue. If the reviewer rejects the implementer's rationale, it must
provide the resolution and the workflow must run an implementer agent again. The
prior objection, the reviewer's rejection, and the reviewer's resolution must be
provided to the new implementation agent. This also means that implementers are
**NEVER** allowed to mark an issue as blocked themselves.

When configuring the reviewer agent in the workflow, make it very clear to the
reviewer that it must read the docs itself, verify the implementer's objection
(including checking for related docs that the implementer may have missed) and
reject any implementer objection that boils down to "the code doesn't match the
docs". Any such objection is immediately invalid as the entire point of issues
is to align the code with the docs, so reviewer prompts must be very clear that
the docs not matching the code is the *expected* state and that the implementer
is responsible for updating the code to match the docs (and never the other way
around). An implementer that objects on grounds that the docs don't match the
code indicates that the implementer has a fundamental lack of understanding of
the repository policies.

Other notes with respect to how this must be handled:

- Workflow scripts have no filesystem access, so enforcement of these rules must
  be handled through prompts instead of programmatically
- When returning to an implementer from a reviewer, **ALL** prior objections
  **AND** resolutions from previous implementer->reviewer cycles must be
  provided to the new implementer agent
  - This is what ensures that new implementers don't cause the workflow to get
    stuck in an infinite loop of the implementer repeatedly re-raising the same
    invalid complaint.
  - The workflow should have a high bound (e.g. 25) on the number of review
    cycles. This ensures that review cycles can't continue completely unbounded
    but should never be hit in practice. If this is hit, treat the workflow as
    having failed and handle it accordingly.
- If an issue is blocked, work that was previously performed for the issue
  should be discarded unless it can be cleanly committed.
- Agents are explicitly **banned** from filing new issues whose work includes
  making documentation changes. Agents are not allowed to make **ANY**
  documentation changes. If an agent thinks documentation needs to be changed,
  it needs to request that the issue it was assigned be reclassified as blocked
  and go through that process.

### Use Workflows

Workflows allow agent contexts to be automatically managed. Each time a workflow
transitions from one agent to another, a fresh context is created. This reduces
costs and improves performance at the cost of requiring rediscovery and being
lossy with respect to details determined during a session.

Reference the workflow authoring skill. In addition to its recommendations,
apply the following:

- Workflow agents cannot/should not run their own workflows
  - Instead of assigning a single agent to an issue, break the issue down across
    multiple agents in the workflow itself if the issue can be decomposed into
    self-contained steps.
  - **NEVER** assign a single agent multiple issues.
    - Each issue represents a unit of work. Use one agent per issue to ensure
      each issue starts with a fresh context. If multiple items are related and
      should be addressed as one, the items should be part of a single issue.
    - If issues are tightly coupled, configure one agent per issue and configure
      the workflow so that the output from each agent can be passed to the
      subsequent agent(s).
  - Consider scoping workflows to specific issues and chaining workflows instead
    of producing one monolithic workflow, or nesting workflows up to the allowed
    single level within the workflow itself.
- Prefer multiple concurrent workflows instead of parallel tracks within one
  workflow
  - Using a single workflow means you only get notified when the entire workflow
    completes. If one track takes substantially longer than the others, then
    total parallelism will be greatly reduced. If multiple workflows are used
    instead, you get notified after each track completes and can immediately
    begin the merge and/or kick off a new track instead of waiting for the
    longest track to complete.
- Prefer having agents write their results to disk ("pointers" instead of
  payloads)
  - This avoids length and/or complexity issues when returning output
  - This only applies if the agent output doesn't need to be branched on in the
    workflow script itself
- Agent output should be kept terse
  - Long rambling output doesn't provide more useful information, it just takes
    longer to read and consumes more of a context window. Agents should reply
    with terse output that provides all necessary details and nothing more.
- Account for possible agent failures
  - Transient API errors may take down an agent instance. The workflow must not
    automatically continue if any agent returned `null` due to failing.
    Explicitly check for `null` agent responses and handle them (typically by
    stopping the workflow, checking why a `null` response was encountered, and
    then resuming the workflow).
- Cap maximum parallelism
  - Having too many agents active at a time can exhaust the 5 hour usage limit.
    Limit agent concurrency to 4 if the agents are expected to run for extended
    periods of time. If your workflow is designed around bursts of short lived
    parallel agents, a concurrency of 8 can be used as long as the workflow
    isn't expected to remain at the concurrency cap for a lengthy duration.
  - Limiting concurrency has to be hand-rolled, e.g.:
    ```js
    async function pool(items, fn, limit) {
      const results = new Array(items.length);
      let next = 0;
      await Promise.all(Array.from({length: limit}, async () => {
        for (let i = next++; i < items.length; i = next++) {
          results[i] = await fn(items[i], i);
        }
      }));
      return results;
    }
    ```
- Require all agents to use `flock` on a path you specify (i.e. shared across
  all workflows) whenever they run a command expected to consume the entire CPU
  to avoid massively oversubscribing the CPU due to concurrent agents' command
  execution.

If any of the above conflicts with the workflow authoring skill's content, stop
before starting any workflows and notify the user.

### Use Worktrees

Use worktrees for parallelism whenever reasonable. The goal is to complete the
issues in as little time as possible, but not at the cost of quality.

Increasing parallelism at the cost of merge conflicts is an acceptable tradeoff
when applied within reason. If resolving a merge conflict would be on the scale
of completing an issue, then the work must not be parallelized. Do not
parallelize issues that legitimately depend on each other.

Worktrees use their own cargo target folder to avoid conflicting during parallel
execution. Instruct agents to set `CARGO_TARGET_DIR` when running cargo commands.

## Cleanup

Whatever branch the repo is on when the request to drain the issue queue is made
is the branch that all work must end up on. This session is not complete until
all of the following is true:

- All changes have been committed (code or issues)
- All worktrees and branches created during the work have been merged and
  deleted
- No merge conflicts remain
