function staleEntryFixture (entry, entryPath, archivePaths) {
  const files = new Set(archivePaths.map(file => file.replace(/\\/g, '/').replace(/^\/+/, '')))
  const base = new URL(entryPath, 'http://fixture.invalid')
  const imports = /\bimport\s*\(\s*(["'`])([^"'`\r\n]+\.js)\1\s*\)/g
  const candidates = [...entry.matchAll(imports)]
  for (const moduleName of ['info-modal', 'tab-quick-commands', 'electerm']) {
    for (const match of candidates) {
      const specifier = match[2]
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue
      const target = new URL(specifier, base)
      if (!target.pathname.split('/').pop().startsWith(moduleName + '-')) continue
      if (target.origin !== base.origin || !files.has(`assets${target.pathname}`)) continue
      const staleSpecifier = specifier.replace(/\.js$/, '-OLD_BUILD.js')
      const removedTarget = `assets${new URL(staleSpecifier, base).pathname}`
      if (files.has(removedTarget)) throw new Error('Stale entry fixture target already exists in the archive')
      return {
        stale: entry.replaceAll(specifier, staleSpecifier),
        originalTarget: `assets${target.pathname}`,
        removedTarget
      }
    }
  }
  throw new Error('Packaged entry has no literal import of an exercised generated JavaScript module')
}

module.exports = { staleEntryFixture }
