const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../../..')
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const git = (directory, args) => execFileSync('git', ['--no-optional-locks', '-C', directory, ...args], { encoding: 'utf8' }).trim()
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex')

function pins () {
  const manifest = read(path.join(root, '.github/release-sources.json'))
  assert.equal(manifest.schemaVersion, 1)
  for (const name of ['resource', 'web', 'sdk']) {
    const pin = manifest[name]
    assert.match(pin.repository, /^Anubis-Security-Tool\/anubis-[a-z-]+$/)
    assert.match(pin.commit, /^[a-f0-9]{40}$/)
  }
  return manifest
}

function verify () {
  const manifest = pins()
  for (const name of ['resource', 'web', 'sdk']) {
    const directory = path.join(root, '.release-inputs', name)
    assert.equal(git(directory, ['rev-parse', 'HEAD']), manifest[name].commit)
    assert.equal(git(directory, ['status', '--porcelain', '--untracked-files=no']), '')
  }
  return manifest
}

function copyTracked (from, destination, accept = () => true) {
  const files = git(from, ['ls-files', '-z']).split('\0').filter(Boolean)
  for (const file of files) {
    if (!accept(file)) continue
    const source = path.join(from, file)
    assert(fs.lstatSync(source).isFile() && !fs.lstatSync(source).isSymbolicLink(), file)
    const output = path.join(destination, file)
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.copyFileSync(source, output, fs.constants.COPYFILE_EXCL)
  }
}

function run (cwd, script, args = []) {
  execFileSync(process.execPath, [script, ...args], { cwd, env: process.env, stdio: 'inherit' })
}

function nativeViteConfig (projectRoot) {
  const destination = path.join(projectRoot, '.release-build/native-vite.config.mjs')
  assert(fs.statSync(path.join(projectRoot, '.release-build/browser/build/vite/browser-dependencies.js')).isFile())
  fs.writeFileSync(destination, [
    "import config from '../src/build/vite/conf.js'",
    "import { browserDependencies } from './browser/build/vite/browser-dependencies.js'",
    'export default { ...config, plugins: [...config.plugins, browserDependencies()] }',
    ''
  ].join('\n'), { flag: 'wx' })
  return destination
}

async function build () {
  const manifest = verify()
  const version = read(path.join(root, 'package.json')).version
  const producer = path.join(root, '.release-build', 'browser')
  assert(!fs.existsSync(producer), 'A release producer must be fresh; do not silently reuse outputs')
  fs.mkdirSync(producer, { recursive: true })
  const web = path.join(root, '.release-inputs', 'web')
  copyTracked(web, producer, file => /^(?:LICENSE|NOTICE|THIRD-PARTY-LICENSES(?:\.md)?|README\.md)$/.test(file) ||
    /^(build\/|src\/app\/(common|views)\/)/.test(file) ||
    (file.startsWith('src/client/') && !/^src\/client\/(electerm-react|app)\//.test(file)))
  const appCopy = path.join(root, '.release-build', 'current-app')
  copyTracked(root, appCopy, file => file.startsWith('src/client/') || file.startsWith('src/app/common/'))
  fs.cpSync(path.join(appCopy, 'src/client'), path.join(producer, 'src/client/electerm-react'), { recursive: true })
  fs.cpSync(path.join(appCopy, 'src/app/common'), path.join(producer, 'src/client/app/common'), { recursive: true })
  const webPack = read(path.join(web, 'package.json'))
  webPack.private = true
  delete webPack.scripts
  delete webPack.publishConfig
  webPack.devDependencies['@ai-security-tool/electerm-react'] = version
  fs.writeFileSync(path.join(producer, 'package.json'), JSON.stringify(webPack, null, 2), { flag: 'wx' })
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(producer, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  process.env.BRAND_RES_DIR = path.join(root, '.release-inputs', 'resource')
  process.env.NODE_ENV = 'production'
  const vite = path.join(root, 'node_modules/vite/bin/vite.js')
  run(path.join(root, 'src/build/vite'), vite, ['build', '--config', nativeViteConfig(root), '--configLoader', 'runner'])
  for (const script of ['copy', 'pug']) run(root, path.join(__dirname, script + '.js'))
  run(producer, vite, ['build', '--config', path.join(producer, 'build/vite/conf.js'), '--configLoader', 'runner'])
  run(producer, path.join(producer, 'build/bin/copy.js'))
  const assets = path.join(producer, 'dist/assets')
  const { collectThirdPartyNotices } = await import(pathToFileURL(path.join(producer, 'build/bin/third-party-notices.js')).href)
  const nativeBundleManifest = path.join(root, 'work/app/assets/browser-dependencies.json')
  await collectThirdPartyNotices({
    root,
    assets,
    requireCompliance: true,
    additionalBundleManifests: [nativeBundleManifest]
  })
  for (const relative of [`js/basic-${version}.js`, `js/electerm-${version}.js`, `js/worker-${version}.js`, `css/style-${version}.css`]) {
    for (const base of [assets, path.join(root, 'work/app/assets')]) assert(fs.statSync(path.join(base, relative)).size > 0)
  }
  const html = require('pug').renderFile(path.join(producer, 'dist/views/index.pug'), {
    version, _global: { version, siteName: 'Anubis-Security-Tool', isDev: false, cdn: '', tokenElecterm: '', defaultAIPreset: {} }
  })
  assert(html.includes(`basic-${version}.js`) && html.includes(`style-${version}.css`))
  const receipt = {
    appCommit: git(root, ['rev-parse', 'HEAD']),
    version,
    sources: manifest,
    currentAppClientCompiledIntoDesktopAndBrowser: true,
    nativeBundleDependenciesSha256: sha256(fs.readFileSync(nativeBundleManifest)),
    browserBundleDependenciesSha256: sha256(fs.readFileSync(path.join(assets, 'browser-dependencies.json'))),
    browserPugSha256: sha256(html)
  }
  fs.writeFileSync(path.join(root, '.release-build/source-provenance.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' })
  if (process.env.GITHUB_ENV) {
    fs.appendFileSync(process.env.GITHUB_ENV, `ANUBIS_BROWSER_ASSETS_DIR=${assets}\nANUBIS_SDK_SOURCE_DIR=${path.join(root, '.release-inputs/sdk')}\n`)
  }
  verify()
}

function stageSdk (destination, source) {
  const metadata = read(path.join(source, 'package.json'))
  const runtime = read(path.join(path.dirname(path.dirname(destination)), '../package.json'))
  assert.equal(metadata.name, '@ai-security-tool/managed-access')
  assert.equal(metadata.version, runtime.dependencies[metadata.name])
  assert.equal(metadata.dependencies.ws, runtime.dependencies.ws)
  for (const file of [...metadata.files, 'package.json', 'LICENSE']) {
    assert(!path.isAbsolute(file) && !file.split(/[\\/]/).includes('..'))
    assert(fs.lstatSync(path.join(source, file)).isFile())
  }
  fs.rmSync(destination, { recursive: true, force: true })
  fs.mkdirSync(destination, { recursive: true })
  for (const file of [...metadata.files, 'package.json', 'LICENSE']) fs.copyFileSync(path.join(source, file), path.join(destination, file))
}

if (require.main === module) {
  const command = process.argv[2]
  if (command === 'pins') {
    for (const [name, pin] of Object.entries(pins())) {
      if (name !== 'schemaVersion') fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}_repository=${pin.repository}\n${name}_commit=${pin.commit}\n`)
    }
  } else if (command === 'verify') {
    verify()
    if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, `BRAND_RES_DIR=${path.join(root, '.release-inputs/resource')}\n`)
  } else if (command === 'build') {
    build().catch(error => {
      console.error(error)
      process.exitCode = 1
    })
  } else throw new Error('Expected pins, verify or build')
}

module.exports = { pins, verify, copyTracked, stageSdk, nativeViteConfig }
