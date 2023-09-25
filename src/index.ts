/*
© 2023 SolarWinds Worldwide, LLC. All rights reserved.

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

import * as assert from "node:assert"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as process from "node:process"

import { fetchDeps } from "./deps"
import { type Logger, makeLogger } from "./log"
import { exec } from "./proc"

type GnuTargetTriple =
  | "x86_64-linux-gnu"
  | "aarch64-linux-gnu"
  | "x86-linux-gnu"
  | "arm-linux-gnueabi"
  | "arm-linux-gnueabihf"
type MacosTargetTriple = "x86_64-macos" | "aarch64-macos"
type NixTargetTriple =
  | GnuTargetTriple
  | MacosTargetTriple
  | "x86_64-linux-musl"
  | "aarch64-linux-musl"
  | "x86-linux-musl"
  | "arm-linux-musleabi"
  | "arm-linux-musleabihf"
export type TargetTriple =
  | NixTargetTriple
  | "x86_64-windows"
  | "aarch64-windows"
  | "x86-windows"

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
  | "c++2b"
  | "gnu++2b"
export type Std = CStd | CppStd

type Glibc = `2.${number}` | `2.${number}.${number}`

interface BaseTarget {
  /** Target triple */
  target: TargetTriple
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
export type Target = BaseTarget | NixTarget | GnuTarget

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

// returns a function that pushes to all the provided arrays
function push<T>(...as: T[][]): (...v: T[]) => void {
  return (...v) => {
    for (const a of as) {
      a.push(...v)
    }
  }
}

function eq(l: unknown, r: unknown): boolean {
  try {
    assert.deepStrictEqual(l, r)
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
  let triple = target.target
  if ("glibc" in target && target.glibc) {
    // zig reads the glibc version from the end of gnu triple after a dot
    triple += `.${target.glibc}`
  }

  const [lang, clang] =
    target.std?.includes("++") ?? true ? ["c++", "clang++"] : ["cc", "clang"]

  // base flags for c/++ compilation, always the same
  // use baseline instruction set for the target by default
  const flags = [
    lang,
    "-target",
    triple,
    `-mcpu=${target.cpu ?? "baseline"}`,
    "-o",
    target.output,
  ]
  const dbFlags = [clang]

  switch (target.type ?? "shared") {
    case "bin":
    case "static": {
      push(flags)("-static")
      break
    }
    case "shared": {
      // generate position independent code for shared objects
      push(flags)("-shared", "-fPIC")
      break
    }
  }

  switch (target.mode ?? "fast") {
    // use -O3 for fast (-Ofast) is not standard compliant
    case "fast": {
      push(flags)("-O3")
      break
    }
    // use -Oz for small
    case "small": {
      push(flags)("-Oz")
      break
    }
    case "debug":
  }

  if (target.std) {
    push(flags, dbFlags)(`-std=${target.std}`)
  }
  if (target.exceptions === false) {
    push(flags, dbFlags)("-fno-exceptions")
  }

  push(flags, dbFlags)(`-I${node}`)
  if (napi) {
    // add node-addon-api include directory if it's in the dependency tree
    push(flags, dbFlags)(`-I${napi}`)
  }
  for (const i of a(target.include)) {
    push(flags, dbFlags)(`-I${i}`)
  }

  for (const l of a(target.libraries)) {
    push(flags)(`-l${l}`)
  }
  for (const l of a(target.librariesSearch)) {
    push(flags)(`-L${l}`)
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
      push(flags, dbFlags)(`-D${n}`)
    } else if (typeof v === "string" || typeof v === "number") {
      push(flags, dbFlags)(`-D${n}=${v}`)
    }
  }

  if ("rpath" in target && target.rpath) {
    // specify rpaths as a linker flags
    for (const r of a(target.rpath)) {
      push(flags)(`-Wl,-rpath,${r}`)
    }
  }

  if (target.verbose) {
    push(flags)("-v")
  }

  push(flags, dbFlags)(...a(target.cflags))

  push(flags)(...target.sources)

  const db = target.sources.map((source) => ({
    directory: cwd,
    arguments: dbFlags,
    file: source,
  }))

  return [exec(zig, flags, { cwd, log }), db]
}

/**
 * Builds a set of targets in parallel
 *
 * @param targets - Targets definitions
 * @param cwd - Working directory to use for compiler invocations
 * @param compilationDatabase - Location of an optionally generated Clang JSON compilation database (https://clang.llvm.org/docs/JSONCompilationDatabase.html)
 */
export async function build(
  targets: Record<string, Target>,
  cwd: string = process.cwd(),
  compilationDatabase: boolean | string = false,
): Promise<void> {
  const nodeVersions = new Set(Object.values(targets).map((t) => t.nodeVersion))
  const [node, zig, napi] = await fetchDeps(nodeVersions)
  const [tasks, db] = Object.entries(targets).reduce<
    [Promise<number>[], CompilationDatabase[]]
  >(
    ([tasks, db], [name, target]) => {
      const [t, d] = buildOne(
        target,
        cwd,
        node.get(target.nodeVersion)!,
        zig,
        napi,
        makeLogger(name),
      )
      return [
        [...tasks, t],
        [...db, ...d],
      ]
    },
    [[], []],
  )

  await Promise.all(tasks)

  if (compilationDatabase) {
    if (typeof compilationDatabase !== "string") {
      compilationDatabase = "compile_commands.json"
    }

    const unique = db.filter((l, idx) => db.findIndex((r) => eq(l, r)) === idx)
    await fs.writeFile(
      path.join(cwd, compilationDatabase),
      JSON.stringify(unique),
    )
  }
}
export default build
