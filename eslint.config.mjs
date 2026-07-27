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
    // electron-builder's output. It contains a whole copy of the app plus
    // node_modules, so linting it means linting every dependency twice.
    "release/**",
  ]),
  {
    /*
     * The backend entrypoint and the modules it pulls in are loaded by plain
     * `node`, outside the Next build, so they have to be CommonJS. The Electron
     * main process is the same: it runs before any bundler is involved.
     * Everything else in the app uses ESM imports and still gets the rule.
     */
    files: [
      "server.js",
      "src/lib/db.js",
      "src/lib/sessionManager.js",
      "src/lib/originGuard.js",
      "electron/main.js",
      // The tests require those same CommonJS modules, and node:test runs
      // them outside any bundler.
      "test/**/*.js",
    ],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
