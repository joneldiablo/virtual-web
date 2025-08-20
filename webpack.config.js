const path = require("path");
const fs = require("fs");

/**
 * AddShebangAndChmodPlugin
 * - Strip any existing shebang and prepend "#!/usr/bin/env node\n"
 * - Only touch assets that match /main.bundle\.js$/
 * - After emit, chmod +x (0755) on those files on disk
 */
class AddShebangAndChmodPlugin {
  constructor(options = {}) {
    this.shebang = "#!/usr/bin/env node\n";
    this.filter = options.filter || /^main\.bundle\.js$/; // <- as requested
    this.touched = new Set(); // remember files we modified to chmod later
  }

  apply(compiler) {
    const pluginName = "AddShebangAndChmodPlugin";

    // 1) Modify JS sources before writing to disk
    compiler.hooks.emit.tapAsync(pluginName, (compilation, callback) => {
      try {
        const files = Object.keys(compilation.assets || {});
        for (const file of files) {
          console.log(file, this.filter.test(file));
          if (!this.filter.test(file)) continue;

          const asset = compilation.assets[file];
          const original =
            typeof asset.source === "function"
              ? String(asset.source())
              : String(asset);

          // Strip any existing shebang at the very top
          const stripped = original.replace(/^#![^\r\n]*(\r?\n)/, "");
          // Prepend our Node shebang
          const updated = this.shebang + stripped;

          compilation.assets[file] = {
            source: () => updated,
            size: () => Buffer.byteLength(updated, "utf8"),
          };

          this.touched.add(file);
          console.log(`[${pluginName}] Shebang forced on ${file}`);
        }
        callback();
      } catch (err) {
        callback(err);
      }
    });

    // 2) After assets are written to disk, chmod +x
    compiler.hooks.afterEmit.tapAsync(pluginName, (compilation, callback) => {
      const outDir = compiler.options.output && compiler.options.output.path;
      if (!outDir) return callback();

      const tasks = [];
      for (const file of this.touched) {
        const abs = path.join(outDir, file);
        tasks.push(
          new Promise((resolve) => {
            fs.chmod(abs, 0o755, (err) => {
              if (err) {
                console.warn(
                  `[${pluginName}] chmod failed for ${abs}:`,
                  err.message
                );
              } else {
                console.log(`[${pluginName}] chmod +x applied to ${abs}`);
              }
              resolve();
            });
          })
        );
      }

      Promise.all(tasks)
        .then(() => callback())
        .catch(() => callback());
    });
  }
}

module.exports = {
  entry: "./dist/cjs/cli.js",
  target: "async-node",
  mode: "production",
  devtool: "source-map",
  module: {
    rules: [{ test: /\.node$/, use: "node-loader" }],
  },
  output: {
    filename: "[name].bundle.js",
    path: path.resolve(__dirname, "bin"),
  },
  optimization: {
    splitChunks: {
      chunks: "all",
      cacheGroups: {
        vendors: {
          test: /[\\/]node_modules[\\/]/,
          name: "vendors",
          chunks: "all",
        },
      },
    },
  },
  resolve: { extensions: [".ts", ".js", ".json", "mjs"] },
  externalsPresets: { node: true },
  plugins: [new AddShebangAndChmodPlugin()],
};
