-- | The `review` object: returning your verdict on the work you are reviewing.
-- |
-- | An ending is a **result**, and a reviewer's result has a shape of its own: not what was done, but
-- | whether it may stand. So it is its own pair of calls rather than a `finish` carrying a verdict in
-- | prose, and they are bound only for a program whose agent is reviewing — an agent doing work has
-- | `harness.finish` and no `review` object at all.
module Gg.Review
  ( review
  , approve
  , requestChanges
  ) where

import Prelude

import Effect (Effect)
import Gg.Internal.Wire as Wire
import Gg.Meta (listOn)
import Gg.Types (FunctionSummary)

-- | return your verdict on the work you are reviewing
review
  :: { approve :: Effect Unit
     , requestChanges :: Array String -> Effect Unit
     , list :: Effect (Array FunctionSummary)
     }
review =
  { approve
  , requestChanges
  , list: listOn "review"
  }

-- | Accept the work you are reviewing: it meets every completion criterion and stays in scope. This
-- | ends your session.
-- |
-- | It does not stop your program — whatever follows it still runs — so call it last, once you have
-- | actually read the change.
-- |
-- | # Arguments
-- |
-- | (none — approval carries nothing but itself)
approve :: Effect Unit
approve = Wire.call_ "approve" "review" "approve" []

-- | Reject the work you are reviewing, listing every change that must be made before it can be
-- | accepted. This ends your session, and does not stop your program.
-- |
-- | Each item says what is wrong and what to change; the list may not be empty.
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
  Wire.call_ "request_changes" "review" "requestChanges" [ Wire.wire items ]
