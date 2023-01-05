const path = require("node:path")
const fs = require("node:fs")

const globals = require("globals")
const prettier = require("eslint-config-prettier")
const typescriptParser = require("@typescript-eslint/parser")
const typescriptPlugin = require("@typescript-eslint/eslint-plugin")
const tsdocPlugin = require("eslint-plugin-tsdoc")
const importsPlugin = require("eslint-plugin-simple-import-sort")
const headerPlugin = require("eslint-plugin-header")

const license = fs.readFileSync(path.join(__dirname, "LICENSE"), "utf8")

const mapRules = (rules, oldKey = "", newKey = "") =>
  Object.fromEntries(
    Object.entries(rules).map(([k, v]) => [k.replace(oldKey, newKey), v]),
  )

module.exports = [
  { ignores: ["dist/**"] },
  "eslint:recommended",
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 11,
      globals: { ...globals.es2020, ...globals.commonjs, ...globals.node },
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: { project: ["./tsconfig.json"] },
    },
    plugins: {
      ts: typescriptPlugin,
      tsdoc: tsdocPlugin,
      imports: importsPlugin,
    },
    rules: {
      ...typescriptPlugin.configs["eslint-recommended"].overrides[0].rules,
      ...mapRules(
        typescriptPlugin.configs["recommended"].rules,
        "@typescript-eslint",
        "ts",
      ),
      ...mapRules(
        typescriptPlugin.configs["recommended-requiring-type-checking"].rules,
        "@typescript-eslint",
        "ts",
      ),
      ...mapRules(
        typescriptPlugin.configs["strict"].rules,
        "@typescript-eslint",
        "ts",
      ),
      "ts/no-non-null-assertion": "off",
      "ts/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "tsdoc/syntax": "warn",
      "imports/imports": "warn",
    },
  },
  {
    files: ["src/**"],
    plugins: { header: headerPlugin },
    rules: {
      "header/header": ["error", "block", `\n${license.trim()}\n`],
    },
  },
  { rules: prettier.rules },
]
