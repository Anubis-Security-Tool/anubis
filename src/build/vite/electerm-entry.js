import { loadAttachAddon } from '../../client/components/terminal/xterm-loader.js'

await loadAttachAddon()
await import('../../client/entry/electerm.jsx')
