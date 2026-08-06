-- | **Reaching the code a skill or a memory carried.**
-- |
-- | A [skill](https://docs.testcabinet.ai/gg/skills/) or a
-- | [memory](https://docs.testcabinet.ai/gg/memories/) may carry a PureScript module as well as
-- | prose. Reading it binds that module's exports at `lib.<key>` for the rest of your session, and
-- | the reply that answered the read names the key and what it exports.
-- |
-- | `lib` is how a program reaches one. It is deliberately the one place in this SDK where **you**
-- | say what type you expect, because nothing else can: a code module is compiled separately from
-- | your program, so there is no `import` for the compiler to check it against. Say what the export
-- | is and use it:
-- |
-- | ```
-- | case lib "helpers" "slugify" of
-- |   Just slugify -> view.openText "slug" (slugify "Some Title" :: String)
-- |   Nothing -> view.openText "slug" "the helpers module has no slugify"
-- | ```
-- |
-- | The exports really are ordinary PureScript values — curried functions, records, constants —
-- | because the module really was compiled by `purs`. What `lib` cannot do is check that the type you
-- | asked for is the type the author wrote, so ask for what the read told you is there.
module Gg.Lib
  ( lib
  ) where

import Data.Maybe (Maybe)
import Data.Nullable (Nullable, toMaybe)

-- | One export of one code module, or `Nothing` when this session has no such module or that module
-- | has no such export.
foreign import libImpl :: forall a. String -> String -> Nullable a

-- | One export of a code module bound at `lib.<key>`, as the type you say it is.
lib :: forall a. String -> String -> Maybe a
lib key name = toMaybe (libImpl key name)
