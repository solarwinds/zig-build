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

import * as fs from "node:fs/promises"
import { type IncomingMessage } from "node:http"
import * as http from "node:https"
import * as os from "node:os"
import * as path from "node:path"

import { type Logger, makeLogger } from "./log"
import { exec } from "./proc"

const ZIG_VERSION = "0.10.1"
const ZIGS: Partial<Record<NodeJS.Platform, Partial<Record<string, string>>>> =
  {
    linux: {
      x64: `https://ziglang.org/download/${ZIG_VERSION}/zig-linux-x86_64-${ZIG_VERSION}.tar.xz`,
      arm64: `https://ziglang.org/download/${ZIG_VERSION}/zig-linux-aarch64-${ZIG_VERSION}.tar.xz`,
    },
    darwin: {
      x64: `https://ziglang.org/download/${ZIG_VERSION}/zig-macos-x86_64-${ZIG_VERSION}.tar.xz`,
      arm64: `https://ziglang.org/download/${ZIG_VERSION}/zig-macos-aarch64-${ZIG_VERSION}.tar.xz`,
    },
    win32: {
      x64: `https://ziglang.org/download/${ZIG_VERSION}/zig-windows-x86_64-${ZIG_VERSION}.zip`,
      arm64: `https://ziglang.org/download/${ZIG_VERSION}/zig-windows-aarch64-${ZIG_VERSION}.zip`,
    },
  }

const DOWNLOAD_DIR = path.join(os.homedir(), ".zig-build")
const NODE_DIR = path.join(DOWNLOAD_DIR, "node")
const ZIG_DIR = path.join(DOWNLOAD_DIR, "zig", ZIG_VERSION)

interface NodeReport {
  header: {
    nodejsVersion: string
    release: {
      headersUrl: string
    }
  }
}

const get = (url: string, options: http.RequestOptions & { log: Logger }) =>
  new Promise<IncomingMessage>((res, rej) => {
    options.log(`fetching '${url}'`)
    http.get(url, options, (resp) => {
      if (!resp.statusCode || resp.statusCode < 200 || resp.statusCode >= 300) {
        rej(resp)
      } else {
        res(resp)
      }
    })
  })

const exists = (path: string) =>
  fs
    .stat(path)
    .then(() => true)
    .catch(() => false)

async function fetchNodeHeaders() {
  // 40 is a green ansii256 colour code
  const log = makeLogger("node", 40)

  const report = process.report?.getReport() as unknown as NodeReport
  const version = report.header.nodejsVersion

  const headersDir = path.join(NODE_DIR, version)
  const includePath = path.join(headersDir, "include", "node")
  log(`checking for node headers at '${includePath}'`)
  if (await exists(includePath)) {
    return includePath
  }

  const headersUrl = report.header.release.headersUrl
  const headersArchive = await get(headersUrl, { log })
  await fs.mkdir(headersDir, { recursive: true })
  // windows 10 provides bsdtar which should ignore the z flag if a zip is passed
  await exec("tar", ["-xzf", "-", "--strip-components=1", "-C", headersDir], {
    stdin: headersArchive,
    log,
  })

  return includePath
}

async function fetchZig() {
  // 214 is an orange ansii256 colour code
  const log = makeLogger("zig", 214)

  const platform = os.platform()
  const arch = os.arch()

  const binary = platform === "win32" ? "zig.exe" : "zig"
  const binaryPath = path.join(ZIG_DIR, binary)
  log(`checking for zig at '${binaryPath}'`)
  if (await exists(binaryPath)) {
    return binaryPath
  }

  const url = ZIGS[platform]?.[arch]
  if (!url) {
    throw new Error(`unsupported platform ${platform} ${arch}`)
  }

  const zigArchive = await get(url, { log })
  await fs.mkdir(ZIG_DIR, { recursive: true })
  // windows 10 provides bsdtar which should ignore the J flag if a zip is passed
  await exec("tar", ["-xJf", "-", "--strip-components=1", "-C", ZIG_DIR], {
    stdin: zigArchive,
    log,
  })

  return binaryPath
}

export async function fetchDeps(): Promise<
  [node: string, zig: string, napi: string | null]
> {
  const [node, zig] = await Promise.all([fetchNodeHeaders(), fetchZig()])
  // if node-addon-api is in the dependency tree grab its include path
  // and strip the surrounding quotes
  const napi = await import("node-addon-api")
    .then((napi) => napi.include.slice(1, -1))
    .catch(() => null)
  return [node, zig, napi]
}
