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

import chalk, { type ChalkInstance } from "chalk"

export const COLOURS = ["red", "cyan", "magenta", "blue", "yellow", "green"] as const
export type Colour = (typeof COLOURS)[number]

export type Logger = (message: string) => void

let rot = 0
export function makeLogger(prefix: string, colour?: Colour | number): Logger {
	const b = chalk.bold

	let c: ChalkInstance = b
	if (typeof colour === "number") {
		c = c.ansi256(colour)
	} else {
		// either use the provided colour name or rotate through the list
		c = c[colour ?? COLOURS[rot++ % COLOURS.length]!]
	}

	return (message) => {
		if (message.trim().length > 0) {
			// this is unreadable but basically we have the coloured prefix surrounded by square brackets
			// then that is made bold and followed by the message
			console.log(`${b("[")}${c(prefix)}${b("]")} ${message}`)
		}
	}
}
