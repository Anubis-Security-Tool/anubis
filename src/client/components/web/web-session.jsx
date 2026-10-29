import AddressBar from './address-bar'
import WebAuthModal from './web-auth-modal'
import RbiView from './rbi-view'
import BrowserPanel from './browser-panel'
import { notification } from '../common/notification'
import { handleErr } from '../../common/fetch'
import { buildProfile, sanitizeFileBase } from './browser-profile'
import React, { useState, useRef, useEffect, useCallback } from 'react'

function downloadJson (obj, fileName) {
  const blob = new window.Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const href = window.URL.createObjectURL(blob)
  const a = window.document.createElement('a')
  a.href = href
  a.download = fileName
  window.document.body.appendChild(a)
  a.click()
  window.document.body.removeChild(a)
  window.URL.revokeObjectURL(href)
}

export default function WebSession ({ tab, reloadTab }) {
  const { url = '' } = tab
  const native = window.anubisWebsite?.version === 1 && window.anubisWebsite.embedded === true
  const [partition, setPartition] = useState(null)
  const [zoom, setZoom] = useState(1.0)
  const [currentUrl, setCurrentUrl] = useState(url)
  const [loadError, setLoadError] = useState('')
  const [authRequest, setAuthRequest] = useState(null)
  const webviewRef = useRef(null)
  const rbiRef = useRef(null)
  const pendingRef = useRef(null)
  const [activeUa, setActiveUa] = useState('')
  let valid = false
  try {
    valid = ['http:', 'https:'].includes(new URL(url).protocol)
  } catch {
    valid = false
  }
  const embedded = native || !window.et.isWebApp
  const addrProps = {
    url: currentUrl,
    title: tab.title,
    description: tab.description,
    zoom,
    onZoom: handleZoom,
    onOpen: handleOpen,
    onReload: () => {
      if (embedded && webviewRef.current?.reload) {
        setLoadError('')
        webviewRef.current.reload()
      } else reloadTab(tab)
    }
  }

  function handleOpen () {
    window.openLink(currentUrl)
  }

  function handleZoom (value) {
    setZoom(value)
    const el = webviewRef.current
    if (el?.setZoomFactor) el.setZoomFactor(value)
    else if (el) el.style.zoom = value
  }

  useEffect(() => { setCurrentUrl(url); setLoadError('') }, [url])

  useEffect(() => {
    if (!native || !valid) return
    let active = true
    let allocated
    const release = value => window.anubisWebsite.release(value).catch(error => {
      console.error('Embedded website cleanup failed:', error.message)
    })
    window.anubisWebsite.allocate().then(value => {
      allocated = value
      if (active) setPartition(value)
      else release(value)
    }).catch(error => {
      if (active) setLoadError(error.message)
    })
    return () => {
      active = false
      if (allocated) release(allocated)
    }
  }, [native, valid])

  useEffect(() => {
    if (native) {
      const removeAuth = window.anubisWebsite.onAuth(data => {
        if (data.partition !== partition) return
        if (data.cancelled) setAuthRequest(current => current?.id === data.id ? null : current)
        else setAuthRequest(data)
      })
      const removeError = window.anubisWebsite.onError(data => {
        if (data.partition === partition) setLoadError(data.code)
      })
      return () => { removeAuth(); removeError() }
    }
    return window.api?.onWebviewAuthRequest?.(setAuthRequest)
  }, [native, partition])

  useEffect(() => {
    const el = webviewRef.current
    if (!el || !embedded) return
    const ready = () => el.setZoomFactor(zoom)
    const starting = event => {
      if (event.isMainFrame !== false) setLoadError('')
    }
    const failed = event => {
      if (event.isMainFrame !== false && event.errorCode !== -3) {
        setLoadError(event.errorDescription || 'Website could not be loaded')
      }
    }
    const navigated = event => {
      if (/^https?:\/\//i.test(event.url)) setCurrentUrl(event.url)
    }
    const stopped = () => setLoadError('Website renderer stopped. Reload to try again.')
    el.addEventListener('dom-ready', ready)
    el.addEventListener('did-start-navigation', starting)
    el.addEventListener('did-fail-load', failed)
    el.addEventListener('did-navigate', navigated)
    el.addEventListener('did-navigate-in-page', navigated)
    el.addEventListener('render-process-gone', stopped)
    return () => {
      el.removeEventListener('dom-ready', ready)
      el.removeEventListener('did-start-navigation', starting)
      el.removeEventListener('did-fail-load', failed)
      el.removeEventListener('did-navigate', navigated)
      el.removeEventListener('did-navigate-in-page', navigated)
      el.removeEventListener('render-process-gone', stopped)
    }
  }, [embedded, partition, zoom, url])

  const respond = useCallback((username, password) => {
    if (!authRequest) return
    const value = { id: authRequest.id, username, password }
    if (native) {
      window.anubisWebsite.authenticate(value).catch(error => setLoadError(error.message))
    } else {
      window.api.sendWebviewAuthResponse(value)
    }
    setAuthRequest(null)
  }, [native, authRequest])
  const cancelAuth = useCallback(() => respond('', ''), [respond])

  // Cookies exported from the RBI session arrive here. A pending-action flag set
  // just before the export request decides whether we write a plain cookies file
  // or bundle them (with the active user agent) into a profile.
  const handleCookies = useCallback((cookies) => {
    const pending = pendingRef.current
    pendingRef.current = null
    const list = Array.isArray(cookies) ? cookies : []
    try {
      if (pending && pending.type === 'profile') {
        const bundle = buildProfile({ name: pending.name, userAgent: activeUa, cookies: list })
        downloadJson(bundle, `${sanitizeFileBase(bundle.name)}.anubisprofile.json`)
        notification.success({ message: 'Profile saved', description: `${bundle.name} (${list.length} cookies)` })
      } else {
        downloadJson(list, `cookies-${tab.id}.json`)
        notification.success({ message: `Exported ${list.length} cookies` })
      }
    } catch (error) {
      handleErr({ message: 'Cookie export failed: ' + error.message })
    }
  }, [tab.id, activeUa])

  const onApplyUa = useCallback((ua) => {
    setActiveUa(typeof ua === 'string' ? ua.trim() : '')
  }, [])

  const onExportCookies = useCallback(() => {
    pendingRef.current = { type: 'export' }
    rbiRef.current?.send({ t: 'cookies-export' })
  }, [])

  const onImportCookies = useCallback((cookies) => {
    const list = Array.isArray(cookies) ? cookies : []
    rbiRef.current?.send({ t: 'cookies-import', cookies: list })
    notification.success({ message: `Imported ${list.length} cookies` })
  }, [])

  const onSaveProfile = useCallback((name) => {
    pendingRef.current = { type: 'profile', name }
    rbiRef.current?.send({ t: 'cookies-export' })
  }, [])

  const onLoadProfile = useCallback((bundle) => {
    setActiveUa(typeof bundle.userAgent === 'string' ? bundle.userAgent.trim() : '')
    const list = Array.isArray(bundle.cookies) ? bundle.cookies : []
    rbiRef.current?.send({ t: 'cookies-import', cookies: list })
    notification.success({ message: 'Profile loaded', description: `${bundle.name} (${list.length} cookies)` })
  }, [])

  function renderView () {
    if (!valid) return <div>URL: <b>{url}</b> not valid (HTTP or HTTPS required)</div>
    if (!embedded) {
      return (
        <RbiView
          key={tab.id}
          ref={rbiRef}
          tab={tab}
          url={url}
          userAgent={activeUa}
          onNavigate={setCurrentUrl}
          onError={setLoadError}
          onCookies={handleCookies}
        />
      )
    }
    if (native && !partition) return loadError ? null : <div className='pd1'>Opening isolated website...</div>
    return (
      <webview
        key={partition || 'legacy'}
        ref={webviewRef}
        src={url}
        partition={native ? partition : undefined}
        style={{ width: '100%', height: '100%', background: '#fff', display: loadError ? 'none' : undefined }}
        allowpopups='true'
        useragent={tab.useragent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'}
      />
    )
  }

  return (
    <div className='web-session-wrap'>
      {!tab.hideAddressBar && <AddressBar {...addrProps} />}
      {/*
        Defense in depth: BrowserPanel is a PRO surface. The authoritative
        entitlement gate lives in the sidebar (menu-preview.jsx), which reads
        the per-device managed status before opening this tab. We intentionally
        do NOT re-check entitlement here: this panel only renders in the web
        build (!embedded), where globals route over WS to the pinned anubis-web
        gateway whose run-sync allowlist has no getManagedConnectivity, so
        entitlement is physically unreadable from the web client. Keeping the
        sidebar gate authoritative is the agreed approach.
        TODO: gate the panel directly once the pinned gateway exposes managed
        connectivity to the web client.
      */}
      {!embedded && valid && (
        <BrowserPanel
          activeUa={activeUa}
          onApplyUa={onApplyUa}
          onExportCookies={onExportCookies}
          onImportCookies={onImportCookies}
          onSaveProfile={onSaveProfile}
          onLoadProfile={onLoadProfile}
        />
      )}
      {loadError && <div role='alert' className='pd1'>Website could not be loaded: {loadError}</div>}
      <div className='web-session-content'>{renderView()}</div>
      <WebAuthModal authRequest={authRequest} onAuthSubmit={respond} onAuthCancel={cancelAuth} />
    </div>
  )
}
