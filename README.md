# zig-build

Node.js native addon build and cross-compile library using Zig

- [Usage](#usage)
  - [Preprocessor defines](#preprocessor-defines)
  - [Linking libraries](#linking-libraries)
  - [Custom flags](#custom-flags)
  - [Custom glibc version](#custom-glibc-version)
- [Caveats](#caveats)
- [Contributing](#contributing)
- [License](./LICENSE)

`zig-build` provides an interface for building native C/C++ Node-API addons or any native code. Unlike `node-gyp` and `cmake-js`, it is not a wrapper around a build system and directly calls the compiler. It doesn't depend on the system compiler and instead downloads a copy of Zig and uses its [Clang wrapper](https://andrewkelley.me/post/zig-cc-powerful-drop-in-replacement-gcc-clang.html), and benefits from its many features.

- First class cross-compilation support
- Automatic build caching
- Statically linked libc++ to use any C++ standard on any target
- Custom glibc version targeting

`zig-build` aims to be a modern alternative to `node-gyp`, and as such only offers first-class support for Node-API (previously NAPI) addons and not legacy NAN ones. Node headers for the current version are downloaded and added to the include path as Node-API is version agnostic, and automatically downloading version-specific headers is a non-goal. `zig-build` will also detect and automatically include `node-addon-api` if it is present.

Also following this focus on modern approaches, `zig-build` doesn't provide any way to download native addons at install time. We instead recommend using [`optionalDependencies`](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#optionaldependencies) with [`os`](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#os) and [`cpu`](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#cpu) specific npm packages containing their respective native addons, which are supported by all modern package managers, provide a much better user experience and reduce the amount of runtime dependencies.

## Usage

Unlike `node-gyp`, `zig-build` is provided as a library and not a CLI. You will need to create a script file and import the `build` function, with the upside that the build configuration can profit from the expressivity of JavaScript. Another difference is that `zig-build` focuses on cross-compilation, and the compilation target will not be implied to be the current machine and must be specified explicitly.

Many options are available, for a full reference see [`index.ts`](./src/index.ts).

```sh
# using npm
npm install --save-dev zig-build
# optional
npm install --save-dev node-addon-api

# using yarn
yarn add --dev zig-build
# optional
yarn add --dev node-addon-api
```

```js
import { build } from "zig-build"

const config = {
  sources: ["addon.cc", "util.cc"],
  std: "c++17",
}

await build({
  windows: {
    target: "x86_64-windows",
    output: "windows/addon.node",
    ...config,
  },
  "linux-x64": {
    target: "x86_64-linux-gnu",
    output: "linux-x64/addon.node",
    ...config,
  },
  "linux-arm64": {
    target: "aarch64-linux-gnu",
    output: "linux-arm64/addon.node",
    ...config,
  },
})
```

### Preprocessor defines

```js
await build({
  addon: {
    target: "x86_64-linux-gnu",
    sources: ["addon.cc"],
    output: "addon.node",
    defines: {
      TARGET_NODE: true, // -DTARGET_NODE
      ADDON_VERSION: "1.2.3", // -DADDON_VERSION=1.2.3
      ADDON_REV: 4, // -DADDON_REV=4
    },
  },
})
```

### Linking libraries

```js
await build({
  addon: {
    target: "x86_64-linux-gnu",
    sources: ["addon.cc"],
    output: "addon.node",
    libraries: ["z", "private"], // -lz -lprivate
    librariesSearch: ["libprivate-vendored"], // -Llibprivate-vendored
    rpath: "$ORIGIN", // -Wl,-rpath,$ORIGIN
  },
})
```

### Custom flags

```js
await build({
  addon: {
    target: "x86_64-linux-gnu",
    sources: ["addon.cc"],
    output: "addon.node",
    cflags: ["-Wl,-soname,napiaddon"],
  },
})
```

### Custom glibc version

Thanks to Zig, Linux `gnu` targets support specifying a custom glibc version, which makes it possible to run the addon on older Linux distribution, which bundle older glibc versions, even if it was built against a much more recent version of glibc.

```js
await build({
  addon: {
    target: "x86_64-linux-gnu",
    glibc: "2.17",
    sources: ["addon.cc"],
    output: "addon.node",
  },
})
```

## Caveats

While it inherits Zig's upsides, `zig-build` also inherits its caveats.

- [Incompatibility with `g++` and `clang++`](https://github.com/ziglang/zig/issues/9832). This generally applies to any C++ code; all objects should be built with the same compiler.
- Incompatibility with MSVC. Since this is a cross-compiler which needs to run on any target, Windows targets use `mingw`.
- Statically linking `libc++`. This is often useful but not always desirable and there are reasons to prefer dynamically linking against the system `libstdc++`.
- Not using the system compiler. There a many reasons to need or prefer using the system compiler, in which cases `zig-build` is simply not appropriate.

## Contributing

Contributions are welcome ! For major changes, please first open an issue to discuss before opening a PR.
