import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    settings: {
      // eslint-config-next sets this to "detect", but eslint-plugin-react's
      // detection calls context.getFilename(), which ESLint 10 removed — every
      // run crashes. Pin it instead; keep in step with "react" in package.json.
      react: { version: "19.2" },
    },
  },
  {
    rules: {
      // New in eslint-plugin-react-hooks 7 (React Compiler rules). It flags the
      // existing "reset/fetch state in useEffect" pattern across many
      // components; fixing it means restructuring each effect, so keep it as a
      // visible warning rather than blocking lint on it.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // node_modules/ is always ignored by ESLint; eslint-config-next already
  // ignores these too, restated so they don't silently change with it.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
