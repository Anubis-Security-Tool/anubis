const { execFileSync } = require('node:child_process')
const { existsSync, readFileSync, unlinkSync, readdirSync, lstatSync, rmSync, mkdirSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')

function copyGoNotices (appOutDir, go, options, execute) {
  const capture = { ...options, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
  const toolchain = JSON.parse(execute(go, ['env', '-json', 'GOROOT', 'GOVERSION'], capture))
  assert(toolchain.GOROOT && toolchain.GOVERSION, 'Missing compiling Go toolchain identity')
  const modules = [...new Set(execute(go, [
    'list', '-deps', '-f', '{{with .Module}}{{if not .Main}}{{.Path}}|{{.Version}}|{{.Dir}}{{end}}{{end}}', '.'
  ], capture).trim().split(/\r?\n/).filter(Boolean))].map(line => {
    const [source, version, directory] = line.split('|')
    assert(source && version && directory, 'Missing resolved Go module license directory')
    return { source, version, directory }
  })
  assert(modules.length > 0, 'Missing native host Go dependency graph')
  const records = []
  const originals = new Map()
  for (const component of [
    { source: 'go-toolchain', version: toolchain.GOVERSION, directory: toolchain.GOROOT },
    ...modules
  ]) {
    const names = readdirSync(component.directory).sort().filter(name => /^(?:licen[cs]e|copying|notice|copyright|patents)(?:[._ -].*)?$/i.test(name))
    assert(names.some(name => /^(?:licen[cs]e|copying)(?:[._ -].*)?$/i.test(name)), `Missing original Go license: ${component.source}`)
    for (const name of names) {
      const file = join(component.directory, name)
      const stat = lstatSync(file)
      assert(stat.isFile() && !stat.isSymbolicLink(), `Invalid Go notice: ${file}`)
      const bytes = readFileSync(file)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const relative = `${sha256}.txt`
      originals.set(relative, bytes)
      records.push({ source: component.source, version: component.version, original: name, relative, bytes: bytes.length, sha256 })
    }
  }
  const destination = join(appOutDir, 'third-party-go-notices')
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination)
  for (const [file, bytes] of originals) {
    writeFileSync(join(destination, file), bytes)
    assert(readFileSync(join(destination, file)).equals(bytes), 'Go notice staging changed original bytes')
  }
  writeFileSync(join(destination, 'manifest.json'), JSON.stringify({ schemaVersion: 1, files: records }, null, 2) + '\n')
}

function copyWindowsMachineHost (context, arch, execute = execFileSync) {
  const marker = join(context.appOutDir, 'anubis-machine-install.json')
  if (existsSync(marker)) unlinkSync(marker)
  const destination = join(context.appOutDir, 'anubis-host.exe')
  if (arch !== 'x64') {
    if (existsSync(destination)) unlinkSync(destination)
    rmSync(join(context.appOutDir, 'third-party-go-notices'), { recursive: true, force: true })
    return
  }
  const root = resolve(__dirname, '../../..')
  const go = process.env.ANUBIS_GO || 'go'
  const options = {
    cwd: join(root, 'native', 'windows-host'),
    env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' },
    stdio: 'inherit'
  }
  execute(go, [
    'build', '-trimpath', '-buildvcs=false', '-o', destination, '.'
  ], options)
  const image = readFileSync(destination)
  const pe = image.readUInt32LE(0x3c)
  if (image.toString('ascii', 0, 2) !== 'MZ' ||
      image.toString('ascii', pe, pe + 4) !== 'PE\0\0' ||
      image.readUInt16LE(pe + 4) !== 0x8664) {
    throw new Error('Windows machine host must be a freshly built amd64 PE executable')
  }
  copyGoNotices(context.appOutDir, go, options, execute)
}

module.exports = { copyWindowsMachineHost }
