import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // ── Security-critical rules (ENABLED) ────────────────────────────
    // These catch real bugs that can become security issues.
    "no-debugger":      "error",   // debug statements must not reach production
    "no-unreachable":   "warn",    // dead code can mask logic errors
    "prefer-const":     "error",   // prevents accidental mutation of config/keys
    "no-undef":         "error",   // catches use of undeclared globals
    "no-redeclare":     "error",   // prevents variable shadowing bugs

    // Console: allow error/warn (used for server-side error logging in api-utils)
    // but warn on console.log so debug statements don't leak in production.
    "no-console": ["warn", { allow: ["error", "warn"] }],

    // ── TypeScript rules (relaxed for developer ergonomics) ──────────
    // Keeping these off avoids false positives during iterative development.
    "@typescript-eslint/no-explicit-any":        "off",
    "@typescript-eslint/no-unused-vars":         "off",
    "@typescript-eslint/no-non-null-assertion":  "off",
    "@typescript-eslint/ban-ts-comment":         "off",
    "@typescript-eslint/prefer-as-const":        "off",
    "@typescript-eslint/no-unused-disable-directive": "off",

    // ── React rules ───────────────────────────────────────────────────
    "react-hooks/exhaustive-deps":  "off",
    "react-hooks/purity":           "off",
    "react/no-unescaped-entities":  "off",
    "react/display-name":           "off",
    "react/prop-types":             "off",
    "react-compiler/react-compiler":"off",

    // ── Next.js rules ─────────────────────────────────────────────────
    "@next/next/no-img-element":          "off",
    "@next/next/no-html-link-for-pages":  "off",

    // ── General (non-security noise) ─────────────────────────────────
    "no-unused-vars":           "off", // covered by TS compiler
    "no-empty":                 "off",
    "no-irregular-whitespace":  "off",
    "no-case-declarations":     "off",
    "no-fallthrough":           "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-useless-escape":        "off",
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"],
}];

export default eslintConfig;
