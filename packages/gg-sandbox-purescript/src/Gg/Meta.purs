-- | The one function that belongs to **no** API object, because it belongs to all of them.
-- |
-- | Every object this SDK offers carries a `list`, bound with that object's own name closed over, so
-- | a program can always discover what it has whatever a run enables. Reading what one of those
-- | functions *does* is `view.openDocsView` — a view, because everything a model reads is a view.
module Gg.Meta
  ( list
  , listOn
  ) where

import Effect (Effect)
import Effect.Exception (error, throwException)
import Gg.Internal.Wire as Wire
import Gg.Types (FunctionSummary)

-- | List the functions available on this API object, each with a one-line summary.
-- |
-- | Only the functions this run actually bound are returned, so the directory never names a call
-- | your program cannot make. Open a view of one function's full signature, argument descriptions
-- | and types with `view.openDocsView`.
-- |
-- | # Arguments
-- |
-- | (none — the object is the one you called it on)
list :: Effect (Array FunctionSummary)
-- DECLARED here and bound per object by `listOn`, which is the honest shape of it: the function a
-- program calls takes no arguments because the object it belongs to is closed over, and there is no
-- one object this declaration could name. Writing the signature and the documentation HERE, on a
-- real declaration, is what keeps them reflected out of the code like every other function's rather
-- than written into a table gg could never check.
list = throwException
  (error "`list` is bound per API object; call it as `fs.list`, `view.list`, and so on")

-- | The `list` an API object carries, with that object's name closed over.
listOn :: String -> Effect (Array FunctionSummary)
listOn object = Wire.call "list" object "list" []
