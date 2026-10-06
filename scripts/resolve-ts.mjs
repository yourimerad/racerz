// Resolution hook for running src/game's TypeScript directly with Node (native type
// stripping, no build step). The game code uses extension-less relative imports
// (`./track`), which Node's ESM resolver doesn't support on its own: this hook appends
// `.ts` when a bare relative specifier doesn't resolve as-is.
//
// Load with `node --import ./scripts/resolve-ts.mjs <entry>.ts`.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[a-zA-Z0-9]+$/.test(specifier)) {
      const asFile = fileURLToPath(new URL(specifier, context.parentURL));
      if (existsSync(asFile + ".ts")) return nextResolve(specifier + ".ts", context);
    }
    return nextResolve(specifier, context);
  },
});
