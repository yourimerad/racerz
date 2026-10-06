// Resolution hook so Node's native type-stripping can run src/game's extensionless
// relative imports (e.g. `from "./car"`) without a bundler. Node 22.15+/25: sync hooks,
// no worker thread. Load with `node --import ./scripts/ts-loader.mjs scripts/sim-bots.ts`.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const CANDIDATES = [".ts", "/index.ts", ".tsx", ".js"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") || specifier.startsWith("/")) {
      try {
        return nextResolve(specifier, context);
      } catch (err) {
        const base = context.parentURL ? new URL(specifier, context.parentURL) : pathToFileURL(specifier);
        for (const ext of CANDIDATES) {
          const candidate = base.href + ext;
          if (existsSync(fileURLToPath(candidate))) return nextResolve(specifier + ext, context);
        }
        throw err;
      }
    }
    return nextResolve(specifier, context);
  },
});
