const path = require('path');
const fs = require('fs');

/**
 * Plugin para añadir un shebang al comienzo del bundle generado.
 */
class AddShebangPlugin {
  /**
   * Registro de hooks en el compilador.
   * @param {Object} compiler - El objeto del compilador de Webpack.
   */
  apply(compiler) {
    const shebang = '#!/usr/bin/env node\n';
    compiler.hooks.emit.tapAsync('AddShebangPlugin', (compilation, callback) => {
      const assetName = compiler.options.output.filename;
      // Chequea si el asset con el filename existe
      if (compilation.assets[assetName]) {
        const asset = compilation.assets[assetName];
        const originalSource = asset.source();
        // Añade el shebang si no está presente
        const updatedSource = originalSource.startsWith(shebang)
          ? originalSource
          : shebang + originalSource;
        // Actualiza el asset con el nuevo contenido
        compilation.assets[assetName] = {
          source: () => updatedSource,
          size: () => updatedSource.length,
        };
        console.log(`Shebang has been added to ${assetName}`);
      }
      callback();
    });
  }
}

module.exports = {
  // El archivo de entrada de la aplicación
  entry: './dist/cjs/index.js',
  // El entorno de destino
  target: 'async-node',
  // Modo del compilador (desarrollo o producción)
  mode: 'production',
  // Herramienta para mapear hacia el código original
  devtool: 'source-map',
  module: {
    rules: [
      // Reglas para manejar archivos .node con node-loader
      {
        test: /\.node$/,
        use: 'node-loader',
      },
    ],
  },
  output: {
    filename: '[name].bundle.js',
    path: path.resolve(__dirname, 'bin'),
  },
  optimization: {
    splitChunks: {
      chunks: 'all', // Indica que debe considerar todos los tipos de chunks (async y non-async)
      cacheGroups: {
        vendors: {
          test: /[\\/]node_modules[\\/]/, // Busca los módulos de node_modules
          name: 'vendors', // Nombre del archivo de salida para las dependencias
          chunks: 'all',
        },
      },
    },
  },
  resolve: {
    extensions: ['.ts', '.js', '.json', 'mjs'],
  },
  externals: {
    mysql: 'commonjs mysql',
    mysql2: 'commonjs mysql2',
    oracledb: 'commonjs oracledb',
    'pg-query-stream': 'commonjs pg-query-stream',
    pg: 'commonjs pg',
  },
  plugins: [
    // Instancia del plugin para añadir shebang
    new AddShebangPlugin()
  ],
};
