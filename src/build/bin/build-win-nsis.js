require('./build-common').writeSrc('win-x64-installer.exe')
require('./nsis/build-release').main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
