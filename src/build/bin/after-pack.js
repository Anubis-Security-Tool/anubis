const { join } = require('path')
const { copyWindowsTerminalRuntime } = require('./windows-terminal-runtime')
const { copyWindowsMachineHost } = require('./windows-machine-host')
const { verifyPackagedNotices } = require('./third-party-notices')
const { verifyPackagedCompliance } = require('./third-party-compliance')
const { verifyPackagedBrowserAssets } = require('./browser-assets')

module.exports = async function afterPack (context) {
  const resources = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  verifyPackagedNotices(join(resources, 'app.asar'), context.packager.info.appDir)
  verifyPackagedCompliance(join(resources, 'app.asar'), context.packager.info.appDir)
  verifyPackagedBrowserAssets(join(resources, 'app.asar'), context.packager.info.appDir)
  if (context.electronPlatformName !== 'win32') {
    return
  }
  const { Arch } = require('builder-util')
  const arch = Arch[context.arch]
  const ptyDir = join(context.packager.info.appDir, 'node_modules', 'node-pty')
  const releaseDir = join(
    context.appOutDir, 'resources', 'app.asar.unpacked',
    'node_modules', 'node-pty', 'build', 'Release'
  )
  copyWindowsTerminalRuntime(ptyDir, releaseDir, arch)
  copyWindowsMachineHost(context, arch)
}
