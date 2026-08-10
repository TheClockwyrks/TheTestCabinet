-- | The authored skill library.
-- |
-- | A skill name is a plain `String` rather than the arm of a sum type, because the catalogue is per
-- | run while this SDK is compiled once. The names available are listed in the system prompt, and an
-- | unknown one comes back as `NotFound` carrying the full list.
module Gg.Skills
  ( readSkill
  , list
  ) where

import Effect (Effect)
import Gg.Core (FunctionSummary)
import Gg.Internal.Directory (directory)
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
-- | # Raises
-- |
-- | `NotFound`, listing the skills that do exist, when the name is unknown.
readSkill :: String -> Effect String
readSkill name = Wire.call "read_skill" "skills" "Gg.Skills.readSkill" [ Wire.wire name ]

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
list = directory "Gg.Skills.list" [ "skills" ]
