-- | The `harness` object: ending your session.
-- |
-- | Under responses as code every reply is a program, so there is no prose turn that could mean "I am
-- | done" — a model that answers "task complete" has written a reply that failed to be a program,
-- | not an ending. This is the call that means it, and it is bound only for an agent whose role is to
-- | do work: a reviewer's programs get `review` instead.
module Gg.Harness
  ( harness
  , finish
  ) where

import Prelude

import Effect (Effect)
import Gg.Internal.Wire as Wire
import Gg.Meta (listOn)
import Gg.Types (FunctionSummary)

-- | end your session
harness
  :: { finish :: String -> Effect Unit
     , list :: Effect (Array FunctionSummary)
     }
harness =
  { finish
  , list: listOn "harness"
  }

-- | End your session, reporting what you did in a sentence or two. This is the only thing that ends
-- | it.
-- |
-- | It does not stop your program — whatever follows it still runs — so call it last, once the tools
-- | have confirmed the work is really done. If your program then fails, the ending is cancelled and
-- | you get another turn.
-- |
-- | # Arguments
-- |
-- | - `summary` — What you did, in a sentence or two.
finish :: String -> Effect Unit
finish summary = Wire.call_ "finish" "harness" "finish" [ Wire.wire summary ]
