import { defineConfig } from "rollup";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import external from "rollup-plugin-peer-deps-external";
import json from "@rollup/plugin-json";

const createPlugins = () => [
  json(),
  external(),
  resolve({
    preferBuiltins: true,
  }),
  commonjs(),
];

export default defineConfig([
  {
    context: "globalThis",
    input: "./dist/esm/index.js",
    output: {
      file: "./dist/index.js",
      format: "cjs",
      exports: "named",
      interop: "auto",
      sourcemap: false,
    },
    plugins: createPlugins(),
  },
  {
    context: "globalThis",
    input: "./dist/esm/client/index.js",
    output: {
      file: "./dist/client/index.js",
      format: "cjs",
      exports: "named",
      interop: "auto",
      sourcemap: false,
    },
    plugins: createPlugins(),
  },
]);
