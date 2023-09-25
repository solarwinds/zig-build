import { expect, it } from "@solarwinds-apm/test"
import * as shimmer from "shimmer"
import * as sinon from "sinon"

import { build } from "../src/"

it("calls spawn with the right arguments and produces a valid database", async () => {
  /* eslint-disable */
  const cproc =
    require("node:child_process") as typeof import("node:child_process")
  const fs = require("node:fs/promises") as typeof import("node:fs/promises")
  /* eslint-enable */

  const spawn = sinon.fake<[string, string[]]>(() => cproc.exec("cd ."))
  const writeFile = sinon.fake<[string, string]>(() => Promise.resolve())

  shimmer.wrap(cproc, "spawn", () => spawn as unknown as typeof cproc.spawn)
  shimmer.wrap(
    fs,
    "writeFile",
    () => writeFile as unknown as typeof fs.writeFile,
  )

  await build(
    {
      x64: {
        target: "x86_64-linux-gnu",
        sources: ["foo.cc", "bar.cc"],
        mode: "small",
        std: "c++20",
        output: "test.x64.so",
        defines: {
          TEST_VALUE: "baz",
        },
        include: ["dir"],
        rpath: "runtime",
      },
      arm64: {
        target: "aarch64-linux-musl",
        sources: ["foo.cc", "bar.cc"],
        type: "static",
        output: "test.arm64.a",
        exceptions: false,
        defines: {
          NDEBUG: true,
        },
        libraries: ["lib"],
        librariesSearch: ["dir"],
      },
    },
    __dirname,
    true,
  )

  const spawnCalls = spawn.getCalls()
  expect(spawnCalls).to.have.length(2)

  for (const call of spawnCalls) {
    expect(call.args[0]).to.include("zig")
    expect(call.args[1]).to.include("foo.cc")
    expect(call.args[1]).to.include("bar.cc")
  }

  expect(spawnCalls[0]!.args[1].slice(0, 10)).to.deep.equal([
    "c++",
    "-target",
    "x86_64-linux-gnu",
    "-mcpu=baseline",
    "-o",
    "test.x64.so",
    "-shared",
    "-fPIC",
    "-Oz",
    "-std=c++20",
  ])
  expect(spawnCalls[0]!.args[1]).to.include("-DTEST_VALUE=baz")
  expect(spawnCalls[0]!.args[1]).to.include("-Idir")
  expect(spawnCalls[0]!.args[1]).to.include("-Wl,-rpath,runtime")

  expect(spawnCalls[1]!.args[1].slice(0, 9)).to.deep.equal([
    "c++",
    "-target",
    "aarch64-linux-musl",
    "-mcpu=baseline",
    "-o",
    "test.arm64.a",
    "-static",
    "-O3",
    "-fno-exceptions",
  ])
  expect(spawnCalls[1]!.args[1]).to.include("-DNDEBUG")
  expect(spawnCalls[1]!.args[1]).to.include("-llib")
  expect(spawnCalls[1]!.args[1]).to.include("-Ldir")

  const writeFileCalls = writeFile.getCalls()
  expect(writeFileCalls).to.have.length(1)

  const writeFileCall = writeFileCalls[0]!
  expect(writeFileCall.args[0]).to.include("compile_commands.json")

  const compileCommands = JSON.parse(writeFileCall.args[1]) as {
    directory: string
    arguments: string[]
    file: string
  }[]
  expect(compileCommands).to.have.length(4)

  for (const c of compileCommands) {
    expect(c.directory).to.equal(__dirname)
    expect(c.file).to.be.oneOf(["foo.cc", "bar.cc"])
    expect(c.arguments).not.to.include.any.members([
      "-target",
      "-mcpu=baseline",
      "-o",
      "-shared",
      "-fPIC",
      "-static",
      "-Oz",
      "-O3",
      "-llib",
      "-Ldir",
      "-Wl,-rpath,runtime",
    ])
  }

  for (const c of compileCommands.slice(0, 2)) {
    expect(c.arguments).to.include.all.members([
      "-std=c++20",
      "-DTEST_VALUE=baz",
      "-Idir",
    ])
  }
  for (const c of compileCommands.slice(2)) {
    expect(c.arguments).to.include.all.members(["-fno-exceptions", "-DNDEBUG"])
  }
})
