---
format: nyxsis-issue
version: 2
id: yzpumdhqm8pfwraa8tjjl5ub
zone: RUN
number: 3
title: Lease claimed runs and resolve lapsed leases in the dispatcher
type: generic
state: done
created: 2026-10-19T00:37:57.96751129Z
done: 2026-10-19T17:48:37.605740649Z
---

A claimed run has no lease. The dispatcher decides a driver is lost from an
in-memory clock (`LostTracker` and `LOST_GRACE` in
`crates/dispatcher/src/lost.rs`) that a restart resets, and a claim whose `Job`
creation failed (`create_job` in `crates/dispatcher/src/controller.rs`) waits
out the 120 second grace and is then failed and retried as though a driver had
run. The backend stores nothing it could judge either case by.

The documentation gives every claim a lease held in Postgres, renewed by the
dispatcher, and resolves a lapsed one by the job's state:

- `apps/docs/src/content/docs/components/dispatcher/overview.md`, "Claim
  leases", "Lost drivers" and "The control loop"
- `apps/docs/src/content/docs/components/backend/api.md`, "Leases and lost
  jobs"

## What is missing

- A lease expiry on the job row, set two minutes out by `POST /jobs/next`.
- `POST /jobs/leases` with the service token, extending the lease of each
  listed job to two minutes past the call, and `GET /jobs/active` returning
  each job's lease expiry.
- The dispatcher renewing, each tick, every driven job whose driver `Job`
  exists and has not finished, before it judges any lease.
- A lapsed lease on a `dispatched` job returning it to the queue at its
  original queue position with a fresh per-job token and no attempt counted,
  taken by the backend's next claim.
- A lapsed lease on a `starting`, `running` or `storing` job reported with
  `POST /jobs/{id}/lost`, in place of `LostTracker`.
- A driver whose token is refused on its first report deleting its sandbox and
  exiting.

## Verify

- A controller test whose `create_job` fails sees the job back in the queue at
  its position after the lease lapses, with no retry recorded.
- A controller test builds a dispatcher, lets a driven job's lease lapse with
  its `Job` live, and sees the first tick renew it and report nothing lost.
- A controller test with a lapsed lease and no `Job` reports the job lost on
  the first tick of a freshly built dispatcher, with no grace waited.
- A backend test claims a job, lets its lease lapse, and sees the old per-job
  token refused once the job is claimed again.
