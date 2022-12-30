import chalk, { type Chalk } from "chalk"

export const COLOURS = [
  "red",
  "cyan",
  "magenta",
  "blue",
  "yellow",
  "green",
] as const
export type Colour = typeof COLOURS[number]

export type Logger = (message: string) => void

let rot = 0
export function makeLogger(prefix: string, colour?: Colour | number): Logger {
  const b = chalk.bold

  let c: Chalk = b
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
