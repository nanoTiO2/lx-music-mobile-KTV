const fs = require('fs')
const path = require('path')
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */
const localNodeModules = path.resolve(__dirname, 'node_modules')
const externalNodeModules = path.resolve('F:/CodexNode/lx-music-mobile-master/node_modules')
const existingNodeModulesPaths = [localNodeModules, externalNodeModules].filter(dir => fs.existsSync(dir))
const watchFolders = existingNodeModulesPaths.filter(dir => dir != localNodeModules)

const config = {
  watchFolders,
  resolver: {
    unstable_enableSymlinks: true,
    nodeModulesPaths: existingNodeModulesPaths,
    extraNodeModules: {
      // crypto: require.resolve('react-native-quick-crypto'),
      // stream: require.resolve('stream-browserify'),
      buffer: require.resolve('buffer'),
    },
  },
}

module.exports = mergeConfig(getDefaultConfig(__dirname), config)
