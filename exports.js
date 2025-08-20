#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");

/**
 * Recursively list all files in a directory (relative paths).
 * @param {string} dir
 * @param {string} baseDir
 * @returns {string[]}
 */
const getFilesRecursively = (dir, baseDir) => {
  let results = [];
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name);
    const rel = path.relative(baseDir, full);
    if (dirent.isDirectory())
      results = results.concat(getFilesRecursively(full, baseDir));
    else results.push(rel);
  }
  return results;
};

/**
 * Remove last extension from path ("foo/bar.ts" -> "foo/bar").
 * @param {string} filePath
 */
const removeExtension = (filePath) => filePath.replace(/\.[^/.]+$/, "");

/**
 * From a base path (no ext), pick .tsx if exists, else .ts.
 * @param {string} basePath
 */
const getSourceFilePath = (basePath) => {
  const ts = `${basePath}.ts`;
  const tsx = `${basePath}.tsx`;
  return fs.existsSync(tsx) ? tsx : ts;
};

/**
 * Quick & reasonably robust check whether a TS/TSX file has *real* exports.
 * - Counts: `export default`, `export const|function|class|type|interface|enum`,
 *           `export { a, b }` (non-empty), `export * from '...'`
 * - Ignores: a lone `export {}` used only to mark ESM.
 * @param {string} srcPath absolute or cwd-relative path
 * @returns {boolean}
 */
function sourceHasExports(srcPath) {
  if (!fs.existsSync(srcPath)) return false;
  let code = fs.readFileSync(srcPath, "utf8");

  // Strip comments to reduce false positives
  code = code
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/\/\/.*$/gm, ""); // line comments

  const hasDefault = /\bexport\s+default\b/.test(code);
  const hasDecl =
    /\bexport\s+(?:const|let|var|function|class|enum|interface|type)\b/.test(
      code
    );
  const hasStar = /\bexport\s*\*\s*from\s*['"][^'"]+['"]/.test(code);
  const hasNamed =
    /\bexport\s*\{[^}]*[A-Za-z0-9_$][^}]*\}\s*(?:from\s*['"][^'"]+['"])?/.test(
      code
    );

  // Detect lone empty export `{}` (not a real export)
  const onlyEmptyExport =
    /^\s*export\s*\{\s*\}\s*;?\s*$/m.test(code) &&
    code.replace(/^\s*export\s*\{\s*\}\s*;?\s*$/gm, "").trim().length === 0;

  return (hasDefault || hasDecl || hasStar || hasNamed) && !onlyEmptyExport;
}

/**
 * ESM file check (fallback) — look for real export tokens in transpiled JS.
 * @param {string} esmPath
 * @returns {boolean}
 */
function esmHasExports(esmPath) {
  if (!fs.existsSync(esmPath)) return false;
  const code = fs.readFileSync(esmPath, "utf8");
  // Same heuristics (no comment stripping needed for dist)
  if (/\bexport\s+default\b/.test(code)) return true;
  if (/\bexport\s+(?:const|function|class|var)\b/.test(code)) return true;
  if (/\bexport\s*\*\s*from\s*['"][^'"]+['"]/.test(code)) return true;
  if (/\bexport\s*\{[^}]*[A-Za-z0-9_$][^}]*\}/.test(code)) return true;
  // Ignore lone "export {}" emitted by TS
  return false;
}

/**
 * Generate exports map skipping files with no real exports.
 */
const generateExportsAndDirectories = () => {
  const packagePath = path.join(process.cwd(), "package.json");
  if (!fs.existsSync(packagePath)) {
    console.error("Error: package.json not found in the current directory.");
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf-8"));

  const srcRoot = path.join(process.cwd(), "src/js");
  const distRoot = path.join(process.cwd(), "dist");
  const esmDir = path.join(distRoot, "esm");
  const cjsDir = path.join(distRoot, "cjs");
  const typesDir = path.join(distRoot, "types");

  if (
    !fs.existsSync(esmDir) ||
    !fs.existsSync(cjsDir) ||
    !fs.existsSync(typesDir)
  ) {
    console.error(
      "Error: dist folders missing (dist/esm, dist/cjs, dist/types). Build first."
    );
    process.exit(1);
  }

  /** Base export (package root) always present */
  const exportsConfig = {
    ".": {
      import: "./dist/esm/index.js",
      require: "./dist/cjs/index.js",
      types: "./dist/types/index.d.ts",
      source: getSourceFilePath("./src/js/index"),
    },
  };

  // Enumerate ESM .js files; skip maps and d.ts
  const esmFiles = getFilesRecursively(esmDir, esmDir).filter((f) =>
    f.endsWith(".js")
  );

  for (const file of esmFiles) {
    const noExt = removeExtension(file).replace(/\\/g, "/"); // e.g. "utils/math"
    const key = `./${noExt}`; // subpath export key
    const esmPath = `./dist/esm/${file.replace(/\\/g, "/")}`;
    const cjsPath = `./dist/cjs/${file.replace(/\\/g, "/")}`;
    const dtsPath = `./dist/types/${noExt}.d.ts`;

    // Compute source path (TS or TSX)
    const srcBase = `./src/js/${noExt}`;
    const srcPath = getSourceFilePath(srcBase);

    // Decide if we should include this file:
    // prefer checking the source; if missing, fallback to ESM dist file
    let has = false;
    if (fs.existsSync(path.resolve(process.cwd(), srcPath))) {
      has = sourceHasExports(path.resolve(process.cwd(), srcPath));
    } else {
      has = esmHasExports(path.resolve(process.cwd(), "dist/esm", file));
    }
    if (!has) {
      // Skip: file with no actual exports
      continue;
    }

    exportsConfig[key] = {
      import: esmPath,
      require: cjsPath,
      types: dtsPath,
      source: srcPath,
    };
  }

  pkg.exports = exportsConfig;
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2));
  console.log("✅ package.json updated successfully (filtered empty exports)");
};

generateExportsAndDirectories();
