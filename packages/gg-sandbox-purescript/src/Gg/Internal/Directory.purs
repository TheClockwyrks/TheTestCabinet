-- | **The directory every capability module carries**, and the one call underneath all eleven of
-- | them.
-- |
-- | Nothing here is model-facing. What a model reads is the `list` each module declares for itself,
-- | with that module's own guest namespaces closed over, so `Gg.Files.list` takes no argument at all.
-- |
-- | PureScript has no macro, so the eleven declarations are eleven real ones. What keeps them from
-- | being eleven copies of one paragraph that drift is `tools/signatures.mjs`, which reflects all of
-- | them and refuses a catalogue whose directories do not agree word for word — the same guarantee a
-- | macro gives, held by the reflector instead of by the language.
-- |
-- | A module takes a *list* of namespaces rather than one, because [`Gg.Session`](Gg.Session) spans
-- | two the guest binds one of: an agent that does work has `harness` and a reviewer has `review`.
-- | Asking an unbound namespace for its directory would raise `Unavailable` where the honest answer
-- | is the other namespace's directory, so the unbound ones are skipped rather than called.
module Gg.Internal.Directory
  ( directory
  ) where

import Prelude

import Data.Array (concat, filterA)
import Data.Traversable (traverse)
import Effect (Effect)
import Gg.Core (FunctionSummary)
import Gg.Internal.Wire as Wire

-- | The directories of every namespace `namespaces` names that this run bound, in order.
-- |
-- | `written` is the module's own `list`, fully qualified, which is what a refusal names.
directory :: String -> Array String -> Effect (Array FunctionSummary)
directory written namespaces = do
  bound <- filterA Wire.bound namespaces
  concat <$> traverse (\namespace -> Wire.call "list" namespace written []) bound
