-- | Ending the session, one group of calls per role.
-- |
-- | Under responses as code every reply is a program, so there is no prose turn that could mean "the
-- | work is done" — a model that answers "task complete" has written a reply that failed to be a
-- | program, not an ending. These are the calls that mean it.
-- |
-- | Exactly one group is bound. An agent whose role is to do work gets `finish`; a reviewer gets
-- | `approve` and `requestChanges` instead, because a reviewer's result has a shape of its own: not
-- | what was done, but whether it may stand.
-- |
-- | None of them stops the program. Whatever follows still runs, so an ending belongs last, once the
-- | calls before it have confirmed the work. A program that then fails revokes the ending and earns
-- | another turn.
module Gg.Session
  ( finish
  , approve
  , requestChanges
  , list
  ) where

import Prelude

import Effect (Effect)
import Gg.Core (FunctionSummary)
import Gg.Internal.Directory (directory)
import Gg.Internal.Wire as Wire

-- | End the session, reporting what was done in a sentence or two.
-- |
-- | This is the only thing that ends it. It does not stop the program — whatever follows still runs —
-- | so it belongs last, once the calls before it have confirmed the work is really done. A program
-- | that then fails cancels the ending and earns another turn.
-- |
-- | # Operation
-- |
-- | session.finish
-- |
-- | # Arguments
-- |
-- | - `summary` — What was done, in a sentence or two.
finish :: String -> Effect Unit
finish summary = Wire.call_ "finish" "harness" "Gg.Session.finish" [ Wire.wire summary ]

-- | Accept the work under review: it meets every completion criterion and stays in scope.
-- |
-- | This ends the session, and does not stop the program, so it belongs last — once the change has
-- | actually been read.
-- |
-- | # Operation
-- |
-- | session.approve
-- |
-- | # Arguments
-- |
-- | (none — approval carries nothing but itself)
approve :: Effect Unit
approve = Wire.call_ "approve" "review" "Gg.Session.approve" []

-- | Reject the work under review, listing every change that must be made before it can be accepted.
-- |
-- | Each item says what is wrong and what to change. The list may not be empty. This ends the
-- | session, and does not stop the program.
-- |
-- | # Operation
-- |
-- | session.request_changes
-- |
-- | # Arguments
-- |
-- | - `items` — Every change that must be made before the work can be accepted, one per entry: what
-- |   is wrong, and what to change. It may not be empty.
-- |
-- | # Raises
-- |
-- | `InvalidArgument` when the list is empty.
requestChanges :: Array String -> Effect Unit
requestChanges items =
  Wire.call_ "request_changes" "review" "Gg.Session.requestChanges" [ Wire.wire items ]

-- | List the functions this module offers, each with a one-line summary.
-- |
-- | Only the functions this run actually bound are returned, so the directory never names a call the
-- | program cannot make. One function's full signature, argument descriptions and types are opened as
-- | a view with `Gg.Views.openDocsView`.
-- |
-- | # Arguments
-- |
-- | (none — the module is the one the directory is declared in)
list :: Effect (Array FunctionSummary)
list = directory "Gg.Session.list" [ "harness", "review" ]
