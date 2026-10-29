import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react'

// Remote browser isolation client. Renders a real offscreen Chromium page that
// is streamed from the Electron main process as JPEG screencast frames over a
// binary WebSocket (`/browser/:id`), and forwards semantic mouse/key/scroll/
// resize events back. Replaces the <iframe> used in the web build, which fails
// on sites that set X-Frame-Options / CSP frame-ancestors.
//
// The parent drives extra realism controls (custom user agent, cookie
// import/export) through an imperative `send(obj)` handle exposed via ref, plus
// an `onCookies` callback for exported cookie payloads pushed back from main.
export default forwardRef(function RbiView ({ tab, url, userAgent, onNavigate, onError, onCookies }, ref) {
  const canvasRef = useRef(null)
  const wsRef = useRef(null)

  useImperativeHandle(ref, () => ({
    send (obj) {
      const ws = wsRef.current
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj))
    }
  }), [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const container = canvas.parentElement
    const ctx = canvas.getContext('2d')
    let closed = false
    const size = { width: 0, height: 0 }

    const token = window.store?.config?.tokenElecterm ||
      (window.localStorage && window.localStorage.getItem('tokenElecterm')) || ''
    const host = window.store?.config?.host || ''

    const measure = () => {
      const rect = container.getBoundingClientRect()
      return {
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height))
      }
    }
    const applySize = (s) => {
      size.width = s.width
      size.height = s.height
      canvas.width = s.width
      canvas.height = s.height
    }
    applySize(measure())

    const extra = `&width=${size.width}&height=${size.height}`
    const wsUrl = window.et.buildWsUrl
      ? window.et.buildWsUrl(host, '', token, tab.id, 'browser', extra)
      : `ws://${host}/browser/${tab.id}?token=${token}${extra}`
    const ws = new window.WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    const send = (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)) }
    const mods = e => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0)
    const pos = e => {
      const rect = canvas.getBoundingClientRect()
      const sx = rect.width ? canvas.width / rect.width : 1
      const sy = rect.height ? canvas.height / rect.height : 1
      return { x: Math.round((e.clientX - rect.left) * sx), y: Math.round((e.clientY - rect.top) * sy) }
    }

    const ua = typeof userAgent === 'string' && userAgent.trim() ? userAgent.trim() : undefined
    ws.onopen = () => send({ t: 'open', url, width: size.width, height: size.height, dpr: 1, userAgent: ua })
    ws.onmessage = async (ev) => {
      if (typeof ev.data === 'string') {
        let msg
        try { msg = JSON.parse(ev.data) } catch { return }
        if (msg.t === 'nav' && onNavigate) onNavigate(msg.url)
        else if (msg.t === 'error' && onError) onError(msg.code || 'Website could not be loaded')
        else if (msg.t === 'cookies' && onCookies) onCookies(msg.cookies || [])
        return
      }
      try {
        const bitmap = await window.createImageBitmap(new window.Blob([ev.data], { type: 'image/jpeg' }))
        if (closed) { bitmap.close && bitmap.close(); return }
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        bitmap.close && bitmap.close()
      } catch {}
    }
    ws.onerror = () => { if (onError) onError('Website stream error') }

    const onMove = e => { send({ t: 'mouse', kind: 'move', ...pos(e), buttons: e.buttons, modifiers: mods(e) }) }
    const onDown = e => {
      e.preventDefault()
      canvas.focus()
      send({ t: 'mouse', kind: 'down', ...pos(e), button: e.button, buttons: e.buttons, clickCount: e.detail || 1, modifiers: mods(e) })
    }
    const onUp = e => {
      send({ t: 'mouse', kind: 'up', ...pos(e), button: e.button, buttons: e.buttons, clickCount: e.detail || 1, modifiers: mods(e) })
    }
    const onWheel = e => {
      e.preventDefault()
      send({ t: 'mouse', kind: 'wheel', ...pos(e), dx: -e.deltaX, dy: -e.deltaY, modifiers: mods(e) })
    }
    const onContext = e => e.preventDefault()
    const onKeyDown = e => {
      e.preventDefault()
      send({ t: 'key', kind: 'down', key: e.key, code: e.code, keyCode: e.keyCode, modifiers: mods(e) })
      if (e.key && e.key.length === 1) send({ t: 'key', kind: 'char', key: e.key, text: e.key, modifiers: mods(e) })
    }
    const onKeyUp = e => {
      e.preventDefault()
      send({ t: 'key', kind: 'up', key: e.key, code: e.code, keyCode: e.keyCode, modifiers: mods(e) })
    }

    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onContext)
    canvas.addEventListener('keydown', onKeyDown)
    canvas.addEventListener('keyup', onKeyUp)

    const observer = new window.ResizeObserver(() => {
      const s = measure()
      if (s.width === size.width && s.height === size.height) return
      applySize(s)
      send({ t: 'resize', width: s.width, height: s.height, dpr: 1 })
    })
    observer.observe(container)

    return () => {
      closed = true
      observer.disconnect()
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', onContext)
      canvas.removeEventListener('keydown', onKeyDown)
      canvas.removeEventListener('keyup', onKeyUp)
      try { ws.close() } catch {}
      wsRef.current = null
    }
  }, [tab.id, url, userAgent])

  return (
    <div style={{ width: '100%', height: '100%', background: '#fff', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        style={{ width: '100%', height: '100%', display: 'block', outline: 'none' }}
      />
    </div>
  )
})
