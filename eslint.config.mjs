import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    /*
     * The backend entrypoint and the modules it pulls in are loaded by plain
     * `node`, outside the Next build, so they have to be CommonJS. Everything
     * else in the app uses ESM imports and still gets the rule.
     */
    files: ["server.js", "src/lib/db.js", "src/lib/sessionManager.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
