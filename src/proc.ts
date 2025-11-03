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

import { type SpawnOptions, spawn } from "node:child_process"
import type { Readable } from "node:stream"

import type { Logger } from "./log.ts"

// executes a process with an optional stream to pipe to stdin and logging its output
// returns a promise that will resolve or reject once the process exits
export function exec(
	cmd: string,
	args: string[],
	options: Omit<SpawnOptions, "stdio"> & {
		log: Logger
		stdin?: Readable
	},
): Promise<number> {
	return new Promise((res, rej) => {
		options.log(`executing '${cmd} ${args.join(" ")}'`)
		const proc = spawn(cmd, args, {
			...options,
			stdio: "pipe",
		})

		proc.once("exit", (code) => {
			if (code === 0) {
				res(code)
			} else {
				rej(code)
			}
		})

		if (options.stdin) {
			options.stdin.pipe(proc.stdin)
		}

		// log stdout and stderr with the provided logger, buffering at newlines
		for (const stream of ["stdout", "stderr"] as const) {
			let buffer = Buffer.alloc(0)
			proc[stream].on("data", (data) => {
				buffer = Buffer.concat([buffer, data])
				const lines = buffer.toString("utf8").split("\n")
				buffer = Buffer.from(lines.pop()!, "utf8")
				for (const line of lines) {
					options.log(line)
				}
			})
			proc[stream].once("end", () => options.log(buffer.toString("utf8")))
		}
	})
}
