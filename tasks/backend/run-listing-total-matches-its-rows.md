# A Run Listing's Total Matches Its Rows

The total a run listing reports equals the number of rows the listing can serve.

## Current behaviour

`Db::assemble` (`crates/backend/src/db.rs`) skips a run whose stored
`record_json` no longer deserializes against the current `RunRecord`, so the
listing serves fewer rows than the count query counted. The local cluster reports
a total of 11 over a listing that serves 6, and the pages past the served rows are
empty.

`packages/ui/src/app/pages/runs/RunsPage.tsx` derives `pageCount` from the total,
so the console offers pages that hold nothing.

A skipped run also answers 404 on `GET /runs/{id}`, which leaves it unreachable
from the console while `Db::delete_run` would still delete it, since that path
reads the row rather than the record.

## Design

Count what the listing can serve. Apply the same predicate to the count and to
the selection.

Offer a way to reach a run whose record no longer deserializes, so a stored run
can be deleted through the console rather than through the database.

## Done when

- [ ] A listing's total equals the number of rows it serves.
- [ ] The console's pager offers only pages that hold rows.
- [ ] A run whose record no longer deserializes can be deleted through the console.
- [ ] Gates green.
