-- | The authored skill library.
-- |
-- | A skill name is a plain `String` rather than the arm of a sum type, because the catalogue is per
-- | run while this SDK is compiled once. The names available are listed in the system prompt, and an
-- | unknown one comes back as `NotFound` carrying the full list.
module Gg.Skills
  ( readSkill
  ) where

import Effect (Effect)
import Gg.Internal.Wire as Wire

-- | Read a skill by name, handing back its body with the front matter stripped.
-- |
-- | Reading it also pins that body permanently into the context window, so a skill once read stays
-- | read. A skill may be **code** rather than prose, or as well as it: code is bound at `lib.<key>`
-- | for the rest of the session and the reply names the key and what it exports, reachable through
-- | `Gg.Core.lib`. An on-use script runs once the program has ended, and whatever it shows arrives on
-- | the next turn.
-- |
-- | # Operation
-- |
-- | skills.read_skill
-- |
-- | # Arguments
-- |
-- | - `name` — The skill's name, as the system prompt lists it.
-- |
-- | # Returns
-- |
-- | The skill's body with its front matter stripped, and — where the skill is code — the
-- | `lib.<key>` its exports are now bound at.
-- |
-- | # Throws
-- |
-- | `NotFound`, listing the skills that do exist, when the name is unknown.
readSkill :: String -> Effect String
readSkill name = Wire.call "read_skill" "skills" "Gg.Skills.readSkill" [ Wire.wire name ]
