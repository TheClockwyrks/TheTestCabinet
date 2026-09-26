-- | Ending the session, one group of calls per role.
-- |
-- | Exactly one group is bound: a working role ends the session by reporting what was done, a
-- | reviewing one by a verdict on the work under review.
-- |
-- | None of them stops the program; whatever follows still runs. A program that then fails revokes
-- | the ending and earns another turn.
module Gg.Session
  ( finish
  , approve
  , requestChanges
  ) where

import Prelude

import Effect (Effect)
import Gg.Internal.Wire as Wire

-- | End the session, reporting what was done in a sentence or two.
-- |
-- | It does not stop the program; whatever follows still runs. A program that then fails cancels the
-- | ending and earns another turn.
-- |
-- | # Operation
-- |
-- | session.finish
-- |
-- | # Arguments
-- |
-- | - `summary` — What was done, in a sentence or two.
finish :: String -> Effect Unit
finish summary = Wire.call_ "finish" "session" "Gg.Session.finish" [ Wire.wire summary ]

-- | Accept the work under review: it meets every completion criterion and stays in scope.
-- |
-- | This ends the session and does not stop the program.
-- |
-- | # Operation
-- |
-- | session.approve
-- |
-- | # Arguments
-- |
-- | (none)
approve :: Effect Unit
approve = Wire.call_ "approve" "session" "Gg.Session.approve" []

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
-- | # Throws
-- |
-- | `InvalidArgument` when the list is empty.
requestChanges :: Array String -> Effect Unit
requestChanges items =
  Wire.call_ "request_changes" "session" "Gg.Session.requestChanges" [ Wire.wire items ]
