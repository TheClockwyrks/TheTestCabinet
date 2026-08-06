-- | The `skills` object: the authored skill library.
-- |
-- | A skill name is a plain `String` rather than an arm of a `data` type, because the catalogue is
-- | per run while this SDK is compiled once. The names available are listed in the system prompt, and
-- | an unknown one comes back as `NotFound` carrying the full list.
module Gg.Skills
  ( skills
  , readSkill
  ) where

import Effect (Effect)
import Gg.Internal.Wire as Wire
import Gg.Meta (listOn)
import Gg.Types (FunctionSummary)

-- | read authored skills
skills
  :: { readSkill :: String -> Effect String
     , list :: Effect (Array FunctionSummary)
     }
skills =
  { readSkill
  , list: listOn "skills"
  }

-- | Read a skill by name and hand back its body with the front matter stripped; reading it also pins
-- | that body permanently into your context, so a skill you have read stays read.
-- |
-- | A skill may be **code** rather than prose, or as well as it. If it carries code, reading it binds
-- | that code at `lib.<key>` for the rest of your session and the reply names the key and what it
-- | exports — reach it with `Gg.Lib.lib`. If it carries an on-use script, gg runs it once your
-- | program has ended, and whatever it shows you arrives on your next turn.
-- |
-- | # Arguments
-- |
-- | - `name` — The skill's name, as the system prompt lists it.
-- |
-- | # Raises
-- |
-- | `NotFound` — listing the skills that do exist — when the name is unknown.
readSkill :: String -> Effect String
readSkill name = Wire.call "read_skill" "skills" "readSkill" [ Wire.wire name ]
