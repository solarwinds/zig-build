import fs from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import test from "node:test"

import { build } from "../src/index.ts"

const require = createRequire(import.meta.url)

await test("zig-build", async (t) => {
	await t.test("commonjs", (t) => {
		const required = require("../src/index.cjs")
		t.assert.equal(typeof required, "function")
		t.assert.equal(typeof required.build, "function")
	})

	await build(
		{
			test: {
				output: "addon.node",
				sources: ["addon.cc"],
			},
		},
		{
			cwd: import.meta.dirname,
			compilationDatabase: true,
		},
	)

	const addon = require("./addon.node")
	t.assert.equal(addon.hello(), "world")

	if (process.platform === "linux") {
		const cc: { file: string; arguments: string[] }[] = JSON.parse(
			await fs.readFile(path.join(import.meta.dirname, "compile_commands.json"), {
				encoding: "utf-8",
			}),
		)

		t.assert.equal(cc.length, 1)
		t.assert.equal(cc[0].file, "addon.cc")
		t.assert.deepEqual(cc[0].arguments.slice(0, -2), [
			"clang++",
			"-o",
			"addon.node",
			"-fPIC",
			"-Wl,--as-needed",
			"-shared",
			"-O2",
		])
		t.assert.equal(cc[0].arguments.at(-2)?.endsWith("node-api-headers/include"), true)
		t.assert.equal(cc[0].arguments.at(-1)?.endsWith("node-addon-api"), true)
	}
})
