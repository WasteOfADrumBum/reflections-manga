// Flat config. typescript-eslint supports TypeScript <6.1, which is why the
// project uses TypeScript 6.0.x (see docs/studio/DEPENDENCIES.md).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["node_modules/**", "test-results/**", "playwright-report/**", ".vercel/**"] },
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    extends: [...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["admin/**/*.js"],
    languageOptions: { globals: { ...globals.browser }, sourceType: "module" },
    rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_" }] },
  },
  {
    files: ["js/**/*.js"],
    languageOptions: { globals: { ...globals.browser }, sourceType: "script" },
    rules: { "no-unused-vars": "off" },
  },
  {
    files: ["scripts/**/*.{ts,mjs}", "*.config.{js,ts}"],
    languageOptions: { globals: { ...globals.node } },
    rules: { "no-console": "off" },
  },
);
