-- | The one module this package's own source tree carries today, and the place gg's PureScript SDK
-- | lands when it is written.
-- |
-- | Spago will not resolve a package with no sources of its own, and this arm's sources — the
-- | hand-written, idiomatic `Gg.*` modules a model is actually given — belong to the SDK commit
-- | rather than to the substrate one. So this is what stands in for them: it is compiled by
-- | `spago install` and is deliberately NOT staged into the shipped library tree, because nothing a
-- | program can import should exist without a reason a model would import it.
module Gg.Anchor (anchor) where

-- | A value nobody calls. Its only job is to give this module a body.
anchor :: Int
anchor = 0
