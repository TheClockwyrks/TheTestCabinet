# Drive gg's session-side SDK modules from Ruby programs

Every operation in gg's context, delegation, programs, docs, views and session
modules, plus the `feedback` interface behind them, gets a Ruby program that
calls it and an assertion on the state that call left. Each distinct runtime
failure mode of a well-typed call gets its own program and its own assertion.

## Current state

The arm's end-to-end harness lives in
`crates/gg/src/sandbox/language/ruby.substrate.test.rs`. `prepare` (:71) runs the
production compiler, `component` (:64) pays the guest compile once per process,
and `evaluate_through` (:181) builds the store, instantiates the real membrane
and hands back the outcome and the call log. Three wrappers sit on it: `run`
(:240) for a program with no gg tool offered, `run_with` (:230) for one with a
granted operation set, `run_as` (:96) for one with an ending role and a library
flag, and `run_with_program` (:157) for an agent whose library already holds a
recorded program. `logs` (:256) and `program_error` (:271) read the two things a
case asserts most.

The tool side is `FakeOperationApi` (`crates/gg/src/sandbox/fake.test.rs:250`),
which records each call into a `CallLog` (:94) and answers through a responder;
`canned_outcome` (:780) is the default responder and a case that needs a failure
passes its own closure, as the read-file case at :487-495 does.
`all_operations` (:1151) grants everything, `all_operations_without` (:1185)
withholds one capability, and `FakeOperationApi::with_program` (:295) seeds the
program library.

Several of these operations already cross the membrane from their Ruby spelling.
The crossing table at :880 asserts the JSON each context and delegation call
arrives as, and the module walk at :1142 drives `GG::Views.open_text` in both
forms, `GG::Views.close` for an open and an unopened selector,
`GG::Views.open_docs_view` in its Symbol, String and Method spellings,
`GG::Views.open_file`, `GG::Session.finish`, `GG::Session.request_changes`,
`GG::Programs.history`, `GG::Programs.get` for a held and an unheld id,
`GG::Programs.rerun`, `GG::Docs.search`, and `GG::Docs.close`/`GG::Docs.close_all`
both with the capability (:1302, asserted `"0 0"` at :1320) and without it
(:1337-1345). The `feedback.log` channel is driven through `puts`, `warn`, `p`
and a `print` that never ends its line at :315-326, and `feedback.report_error`
through the line-location case at :591 and the G8 gate at :2102.

## Design

Every case below lands in `crates/gg/src/sandbox/language/ruby.substrate.test.rs`
as its own `#[test]`, driving one short Ruby program with one assertion. The
file's consolidation note at :19-25 is revised as part of this work: `component`
(:58-68) is a per-process `OnceLock` over the guest, so the compile is paid once
per process and a whole program costs a fraction of it. The guidance the note
keeps is that each program stays short.

One helper is added. `FakeOperationApi` builds its library with
`ProgramLibrary::enabled(None, 4)` (`crates/gg/src/sandbox/fake.test.rs:264`), so
it retains every program it is given; give it a builder that sets the retention
so a test can seed two programs into a library that keeps one, which is what the
dropped-program case needs.

### context

| case | what the program asserts |
| --- | --- |
| a path is evicted | the `ReclaimReport`'s items, reclaimed tokens, paths and detail are read back |
| every file view is evicted | the omitted path sends no path and the report counts what went |
| an empty path is refused | `:invalid_argument`, because a path that names nothing is not a path that names everything |
| an inclusive and an exclusive range archive the same span | the report is read back for both |
| an empty span list is refused | `:invalid_argument` |
| more than thirty-two spans are refused | `:invalid_argument` |
| a span that ends before it starts is refused | `:invalid_argument` |
| a span that is not a range of turn numbers is refused | `:invalid_argument` naming the argument |
| an archive search with a hit | `archive_empty?` is false and the hit's seq, role and text are read |
| an archive search with no match | `archive_empty?` is false and the hit list is empty |
| a search of an empty archive | `archive_empty?` is true |
| an empty query is refused | `:invalid_argument` |
| a compaction is registered | the call returns `nil` and the lines after it still run |
| a blank summary is refused | `:invalid_argument` |

### delegation

| case | what the program asserts |
| --- | --- |
| a subagent is spawned from a prompt | the `SubagentHandle`'s id, slot and model id are read back |
| a subagent is spawned from an issue | the issue brief crosses as the issue arm of the variant |
| a brief that is neither is refused | `:invalid_argument` naming both `prompt` and `issue_id` |
| a brief that is both is refused | `:invalid_argument` naming both |
| the depth cap refuses a spawn | `:limit_exceeded` |
| an agent this run does not declare is refused | `:invalid_argument` |
| named children are waited for | each `SubagentResult`'s id, status and summary are read |
| every child is waited for | the no-argument form sends no ids and collects what returned |
| a child that ended with no verdict | its status and summary are read as absent |
| each `AgentEnding` value | every status lowers onto the Symbol a program compares against |
| an unknown id is waited for | `:not_found` |
| a message is delivered | the call returns `nil` and the arguments cross |
| a handle delivers its own message | `SubagentHandle#send_message` crosses as `send_message` with the handle's id |
| a message to an unknown id | `:not_found` |
| a message to a child that has returned | `:conflict` |
| a state transition is declared | the call returns and the lines after it still run |
| a state this session may not move to | `:invalid_argument` |
| a transition then an exec in one program | the transition stands and the exec is `:refused` |
| an agent standing in no machine state | `:unavailable`, the one `Binding::Machine` row (`crates/gg/src/sandbox/operations.rs:214`) |
| an exec is declared | the call returns, the program runs to its end, and the succession is on the outcome |
| an agent this session may not become | `:invalid_argument` |
| an exec then a transition in one program | the exec stands and the transition is `:refused` |
| a fork is registered | the copy's id comes back before the program ends |
| the forked id is waited for in the same program | `:not_found`, because the copy is dispatched when the turn closes |
| the depth cap refuses a fork | `:limit_exceeded` |

### programs

The held-library cases at :1204-1220 already cover reading a summary back,
fetching its source by id, `ProgramSummary#source` as the second spelling of that
fetch, and `:not_found` for an id the library was never issued. The hand-over at
:1215 is asserted at :1237.

| case | what the program asserts |
| --- | --- |
| an empty history | `GG::Programs.history` is an empty list before the first program, asserted rather than only run (the program at :1180 logs the count today) |
| no library, history | the name is not bound and the refusal names the call |
| no library, get | the name is not bound |
| no library, rerun | the name is not bound |
| an id the retention has dropped | `:not_found`, distinct from an id never issued |
| a blank source is handed over | `:invalid_argument` rather than a compiler being handed nothing |
| a second hand-over in one program | the first source stands and the second is `:refused` |
| a hand-over then a raise | the hand-over is revoked: `rerun` is absent and `revoked_rerun` is set |
| a hand-over refused over its argument | the refusal is absent from the turn's refusal roster |

### docs

| case | what the program asserts |
| --- | --- |
| a search from an agent granted nothing | the page comes back, because searching is unconditional |
| a search with neither a query nor a filter | `:invalid_argument` |
| a search with an unrecognised kind | `:invalid_argument` naming the accepted set |
| a search with a limit of zero | `:invalid_argument` |
| a key that is open is closed | the count is one and the view is gone |
| a close without the capability | `:unavailable` naming `close` |

### views

| case | what the program asserts |
| --- | --- |
| a file that is not there | `:not_found`, and nothing is opened |
| a window over gg's byte cap | `:limit_exceeded` naming the size and the bound |
| `max_line_chars` of zero | `:invalid_argument` |
| `max_line_chars` over 65,536 | `:invalid_argument` |
| a run that withheld read-file | `:unavailable` |
| the same path opened twice | the second open supersedes the first rather than adding a view |
| an empty label | `:invalid_argument`, because a view with no selector could never be closed |
| neither a body nor a block | `:invalid_argument` raised by the SDK before the host is reached (`packages/gg-sandbox-ruby/src/gg/views.rb:92`) |
| a body over gg's cap | `:limit_exceeded` naming the cap |
| a label over gg's cap | `:limit_exceeded` naming the cap, a separate bound from the body's |
| a documentation target gg does not have | `:not_found` |
| a documentation target this agent does not bind | `:not_found`, a distinct cause from an unknown name |
| a target that is none of Symbol, String and Method | `:invalid_argument` from `docs_name` (`packages/gg-sandbox-ruby/src/gg/views.rb:23`) |
| an empty selector is closed | `:invalid_argument` |
| a close without agent-managed-context | `:unavailable` |

### session

The finish at :1160 and the rejection at :1182 run today; assert the verdict each
one leaves on the outcome as part of this work. The agent with no ending role is
covered at :1267-1272.

| case | what the program asserts |
| --- | --- |
| a blank summary | `:invalid_argument` |
| a second finish in one program | the later summary replaces the earlier one |
| a finish then a raise | the completion is revoked and lands on `revoked_completion` |
| a finish after the wall-clock budget is spent | the ending is still taken |
| a standard call under a review role | `:unavailable`, naming this arm's spelling of the endings it does have |
| a reviewer approves | the verdict is on the outcome; `GG::Session.approve` is absent from this arm's programs today |
| an approval under a standard role | `:unavailable`, and the refusal is on the turn's refusal roster |
| an empty change list | `:invalid_argument` |
| a change list whose every entry is blank | `:invalid_argument`, a distinct cause (`crates/gg/wit/gg-sandbox.wit:693`) |
| a rejection under a standard role | `:unavailable` |

### feedback

`crates/gg/wit/gg-sandbox.wit:1099` onwards defines the five. `log` is covered at
:315-326 and `report_error` at :591 and :2102.

| case | what the program asserts |
| --- | --- |
| more lines than the capture cap keeps | the kept lines are the cap's worth and `logs_suppressed` counts the rest |
| a program whose last expression is a value | `returned_value` stays false: Ruby discards a top-level script's final value itself, so there is nothing for gg to note |
| work deferred into a microtask through Opal's inline JavaScript | the deferred call is in the log and `deferred_note` stays absent, the drain the shared guest gives every arm |
| a code module that raises while loading | `module_errors` carries the binding key and the author's message, as the Python arm asserts at `crates/gg/src/sandbox/language/python.substrate.test.rs:1070`; the Ruby case at :800-825 asserts only what the program sees |

## Done when

- [ ] Each context, delegation, programs, docs, views and session operation has a Ruby program asserting the state a successful call leaves.
- [ ] Each distinct runtime failure mode listed above has its own Ruby program and its own assertion.
- [ ] `GG::Session.approve` is driven from a Ruby program.
- [ ] The `feedback` channel's four uncovered behaviours are asserted from Ruby programs.
- [ ] `FakeOperationApi` can seed a library whose retention drops a program it issued.
- [ ] The consolidation note at
      `crates/gg/src/sandbox/language/ruby.substrate.test.rs:19-25` reads as a
      rule about program length rather than about function count.
- [ ] No test reaches a real model or provider.
- [ ] Gates green.
