const path = require("node:path")
const fs = require("node:fs")

const eslint = require("@eslint/js")
const globals = require("globals")
const prettier = require("eslint-config-prettier")
const typescriptParser = require("@typescript-eslint/parser")
const typescriptPlugin = require("@typescript-eslint/eslint-plugin")
const tsdocPlugin = require("eslint-plugin-tsdoc")
const importsPlugin = require("eslint-plugin-simple-import-sort")
const headerPlugin = require("eslint-plugin-header")

const license = fs.readFileSync(path.join(__dirname, "LICENSE"), "utf8")

module.exports = [
  { ignores: ["dist/**"] },
  eslint.configs.recommended,
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
      parserOptions: { project: true },
    },
    plugins: {
      "@typescript-eslint": typescriptPlugin,
      tsdoc: tsdocPlugin,
      imports: importsPlugin,
    },
    rules: {
      ...typescriptPlugin.configs["eslint-recommended"].overrides[0].rules,
      ...typescriptPlugin.configs["strict-type-checked"].rules,
      ...typescriptPlugin.configs["stylistic-type-checked"].rules,
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/consistent-type-imports": [
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
  prettier,
]
