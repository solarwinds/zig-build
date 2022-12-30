import * as fs from "node:fs/promises"
import { type IncomingMessage } from "node:http"
import * as http from "node:https"
import * as os from "node:os"
import * as path from "node:path"

import { type Logger, makeLogger } from "./log"
import { exec } from "./proc"

const ZIG_VERSION = "0.10.0"
const ZIGS: Partial<Record<NodeJS.Platform, Partial<Record<string, string>>>> =
  {
    linux: {
      x64: `https://ziglang.org/download/${ZIG_VERSION}/zig-linux-x86_64-${ZIG_VERSION}.tar.xz`,
      ia32: `https://ziglang.org/download/${ZIG_VERSION}/zig-linux-i386-${ZIG_VERSION}.tar.xz`,
      arm64: `https://ziglang.org/download/${ZIG_VERSION}/zig-linux-aarch64-${ZIG_VERSION}.tar.xz`,
      arm: `https://ziglang.org/download/${ZIG_VERSION}/zig-linux-armv7a-${ZIG_VERSION}.tar.xz`,
    },
    darwin: {
      x64: `https://ziglang.org/download/${ZIG_VERSION}/zig-macos-x86_64-${ZIG_VERSION}.tar.xz`,
      arm64: `https://ziglang.org/download/${ZIG_VERSION}/zig-macos-aarch64-${ZIG_VERSION}.tar.xz`,
    },
    win32: {
      x64: `https://ziglang.org/download/${ZIG_VERSION}/zig-windows-x86_64-${ZIG_VERSION}.zip`,
      arm64: `https://ziglang.org/download/${ZIG_VERSION}/zig-windows-aarch64-${ZIG_VERSION}.zip`,
    },
    freebsd: {
      x64: `https://ziglang.org/download/${ZIG_VERSION}/zig-freebsd-x86_64-${ZIG_VERSION}.tar.xz`,
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
