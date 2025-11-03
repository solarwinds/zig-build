/*
© SolarWinds Worldwide, LLC. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"

import headers from "node-api-headers"

import { fetchDeps } from "./deps.ts"
import { type Logger, makeLogger } from "./log.ts"
import { exec } from "./proc.ts"

type GnuTargetTriple = "x86_64-linux-gnu" | "aarch64-linux-gnu" | (string & {})
type MacosTargetTriple = "x86_64-macos" | "aarch64-macos" | (string & {})
type NixTargetTriple =
	| GnuTargetTriple
	| MacosTargetTriple
	| "x86_64-linux-musl"
	| "aarch64-linux-musl"
	| (string & {})
export type TargetTriple =
	| NixTargetTriple
	| "x86_64-windows"
	| "aarch64-windows"
	| (string & {})

type OutputType = "bin" | "shared" | "static"
type OutputMode = "debug" | "fast" | "small"

type NodeVersion = `${number}.${number}.${number}`

type CStd =
	| "c89"
	| "gnu89"
	| "c99"
	| "gnu99"
	| "c11"
	| "gnu11"
	| "c17"
	| "gnu17"
	| "c23"
	| "gnu23"
	| (string & {})
type CppStd =
	| "c++98"
	| "gnu++98"
	| "c++03"
	| "gnu++03"
	| "c++11"
	| "gnu++11"
	| "c++14"
	| "gnu++14"
	| "c++17"
	| "gnu++17"
	| "c++20"
	| "gnu++20"
	| "c++23"
	| "gnu++23"
	| "c++2c"
	| "gnu++2c"
	| (string & {})
export type Std = CStd | CppStd

type Glibc = `2.${number}` | `2.${number}.${number}` | (string & {})

interface BaseTarget {
	/** Target triple */
	target?: TargetTriple
	/** Target CPU */
	cpu?: string
	/** Output file */
	output: string
	/** Output file type (binary executable, shared library (default) or static library) */
	type?: OutputType
	/** Optimisation mode (debug, fast (default) or small) */
	mode?: OutputMode
	/** Source files to compile into the output */
	sources: string[]
	/**
	 * Include paths (-I flag)
	 *
	 * The Node headers are automatically included.
	 * The `node-addon-api` headers are automatically included if the dependency is present.
	 **/
	include?: string[]
	/** Linked libraries (-l flag) */
	libraries?: string[]
	/** Library search paths (-L flag) */
	librariesSearch?: string[]
	/**
	 * Node headers version
	 *
	 * This is used to determine which Node headers to include.
	 * If not specified, the current Node version is used.
	 **/
	nodeVersion?: NodeVersion
	/** Node-API version */
	napiVersion?: number
	/** Preprocessor defines (-D flag) */
	defines?: Record<string, boolean | string | number>
	/** C/C++ standard */
	std?: Std
	/** Optionally disable C++ exceptions */
	exceptions?: boolean
	/** Compiler flags */
	cflags?: string[]
	/** Print verbose information */
	verbose?: boolean
}
interface NixTarget extends BaseTarget {
	target: NixTargetTriple
	/** Runtime library search paths */
	rpath?: string | string[]
}
interface GnuTarget extends NixTarget {
	target: GnuTargetTriple
	/** Version of glibc to link against */
	glibc?: Glibc
}
interface MacosTarget extends NixTarget {
	target: MacosTargetTriple
	/** Linked frameworks (-f flag) */
	frameworks?: string[]
	/** Frameworks search paths (-F flag) */
	frameworksSearch?: string[]
}
export type Target = BaseTarget | NixTarget | GnuTarget | MacosTarget

type CompilationDatabase = {
	directory: string
	file: string
	output?: string
} & ({ arguments: string[] } | { command: string })

// turn an optional array or element into an array
function a<T>(v: T | T[] | undefined): T[] {
	if (v === undefined) return []
	else if (Array.isArray(v)) return v
	else return [v]
}

function eq(l: unknown, r: unknown): boolean {
	try {
		assert.deepEqual(l, r)
		return true
	} catch {
		return false
	}
}

function buildOne(
	target: Target,
	cwd: string,
	node: string,
	zig: string,
	napi: string | null,
	log: Logger,
): [task: Promise<number>, db: CompilationDatabase[]] {
	let task = Promise.resolve(0)

	let triple = target.target
	if (triple && "glibc" in target && target.glibc) {
		// zig reads the glibc version from the end of gnu triple after a dot
		triple += `.${target.glibc}`
	}

	const [lang, clang] =
		(target.std?.includes("++") ?? true) ? ["c++", "clang++"] : ["cc", "clang"]

	// base flags for c/++ compilation, always the same
	const flags = [lang, "-o", target.output, "-fPIC", "-Wl,--as-needed"]

	if (triple) {
		flags.push("-target", triple)
	}
	if (target.cpu) {
		flags.push("-mcpu", target.cpu)
	}

	switch (target.type ?? "shared") {
		case "bin":
		case "static": {
			flags.push("-static")
			break
		}

		case "shared": {
			flags.push("-shared")

			if (triple?.includes("windows") || (!triple && process.platform === "win32")) {
				const def = headers.def_paths.node_api_def
				const lib = path.join(node, "node.lib")
				const flags = ["dlltool", "-d", def, "-l", lib]

				if (triple) {
					let machine: string
					const parts = triple.split("-")

					switch (parts[0]!) {
						case "x86_64": {
							machine = "i386:x86-64"
							break
						}

						case "aarch64": {
							machine = "arm64"
							break
						}

						case "x86":
						case "i386":
						case "i486":
						case "i586":
						case "i686": {
							machine = "i386"
							break
						}

						default: {
							throw new Error("Unsupported Windows target")
						}
					}

					flags.push("-m", machine!)
				}

				task = task.then(() => exec(zig, flags, { log }))
				target.sources.push(lib)
			} else if (triple?.includes("macos") || (!triple && process.platform === "darwin")) {
				flags.push("-Wl,-undefined,dynamic_lookup")
			}

			break
		}
	}

	switch (target.mode ?? "fast") {
		// use -O2 for fast (-O3) is known to trigger some bugs in C code
		// (and most C codes has bugs)
		case "fast": {
			flags.push("-O2")
			break
		}
		// use -Os for small
		case "small": {
			flags.push("-Os")
			break
		}
		case "debug":
	}

	if (target.std) {
		flags.push(`-std=${target.std}`)
	}
	if (target.exceptions === false) {
		flags.push("-fno-exceptions")
	}

	flags.push(`-I${node}`)
	if (napi) {
		// add node-addon-api include directory if it's in the dependency tree
		flags.push(`-I${napi}`)
	}
	for (const i of a(target.include)) {
		flags.push(`-I${i}`)
	}

	for (const l of a(target.libraries)) {
		flags.push(`-l${l}`)
	}
	for (const l of a(target.librariesSearch)) {
		flags.push(`-L${l}`)
	}

	target.defines ??= {}
	if (target.napiVersion) {
		// add NAPI_VERSION define but let the user override it
		target.defines = { NAPI_VERSION: target.napiVersion, ...target.defines }
	}
	if (target.exceptions === false) {
		// add node-addon-api defines to disable exceptions and enable safe error handling
		// but let the user override them
		target.defines = {
			NAPI_DISABLE_CPP_EXCEPTIONS: true,
			NODE_ADDON_API_ENABLE_MAYBE: true,
			...target.defines,
		}
	}
	for (const [n, v] of Object.entries(target.defines)) {
		if (v === true) {
			flags.push(`-D${n}`)
		} else if (typeof v === "string" || typeof v === "number") {
			flags.push(`-D${n}=${v}`)
		}
	}

	if ("frameworks" in target || "frameworksSearch" in target) {
		for (const f of a(target.frameworks)) {
			flags.push(`-${f}`)
		}
		for (const f of a(target.frameworksSearch)) {
			flags.push(`-F${f}`)
		}
	}

	if ("rpath" in target && target.rpath) {
		// specify rpaths as a linker flags
		for (const r of a(target.rpath)) {
			flags.push(`-Wl,-rpath,${r}`)
		}
	}

	if (target.verbose) {
		flags.push("-v")
	}

	flags.push(...a(target.cflags))
	flags.push(...target.sources)

	task = task.then(() => exec(zig, flags, { cwd, log }))
	// create a compilation database entry for each source file
	const db = target.sources.map((source) => ({
		directory: cwd,
		arguments: [clang, ...flags.slice(1, -target.sources.length)],
		file: source,
	}))

	return [task, db]
}

export interface Options {
	/** Working directory to use for compiler invocations */
	cwd?: string
	/** Location of an optionally generated [Clang JSON compilation database](https://clang.llvm.org/docs/JSONCompilationDatabase.html) */
	compilationDatabase?: string | boolean
}

export async function build(
	targets: Record<string, Target>,
	{ cwd = process.cwd(), compilationDatabase = false }: Options,
): Promise<void> {
	const nodeVersions = new Set(Object.values(targets).map((t) => t.nodeVersion))
	const [node, zig, napi] = await fetchDeps(nodeVersions)

	// for each target merge the task into an array of tasks and
	// the partial compilation database into the complete one
	const [tasks, db] = Object.entries(targets).reduce<
		[Promise<number>[], CompilationDatabase[]]
	>(
		([tasks, db], [name, target]) => {
			const [task, partialDb] = buildOne(
				target,
				cwd,
				node.get(target.nodeVersion)!,
				zig,
				napi,
				makeLogger(name),
			)

			return [
				[...tasks, task],
				[...db, ...partialDb],
			]
		},
		[[], []],
	)

	await Promise.all(tasks)

	if (compilationDatabase) {
		if (typeof compilationDatabase !== "string") {
			compilationDatabase = "compile_commands.json"
		}

		// don't keep duplicate entries in the compilation database
		const unique = db.filter((l, idx) => db.findIndex((r) => eq(l, r)) === idx)
		await fs.writeFile(path.join(cwd, compilationDatabase), JSON.stringify(unique))
	}
}
export default build
