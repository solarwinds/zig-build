/**
 * @typedef{import("./index.ts", { with: { "resolution-mode": "import" } })} Module
 * @type{Module["default"] & { build: Module["build"] }}
 **/
module.exports = function build(targets, options) {
	return import("./index.ts").then((zig) => zig.build(targets, options))
}

/** @type{Module["build"]} */
module.exports.build = function build(targets, options) {
	return import("./index.ts").then((zig) => zig.build(targets, options))
}
