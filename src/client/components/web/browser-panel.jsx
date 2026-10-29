import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Collapse, Select, Input, Button, Space, Table, Modal, Typography } from 'antd'
import { notification } from '../common/notification'
import { handleErr } from '../../common/fetch'
import {
  UA_PRESETS,
  parseProfile,
  parseCookies,
  parseVault,
  mergeVault
} from './browser-profile'

const { Title, Text } = Typography
const VAULT_KEY = 'anubisBrowserVault'

function readVault () {
  try {
    const raw = window.localStorage.getItem(VAULT_KEY)
    const data = raw ? JSON.parse(raw) : []
    return Array.isArray(data) ? data : []
  } catch (e) {
    return []
  }
}

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

// "Browser tools" side panel for the RBI web session. Pure presentation plus a
// self-contained local vault; all cookie/profile round-trips go through the
// callbacks supplied by WebSession (which owns the RBI socket).
export default function BrowserPanel ({
  activeUa,
  onApplyUa,
  onExportCookies,
  onImportCookies,
  onSaveProfile,
  onLoadProfile
}) {
  const [presetKey, setPresetKey] = useState('default')
  const [uaCustom, setUaCustom] = useState('')
  const [saveOpen, setSaveOpen] = useState(false)
  const [profileName, setProfileName] = useState('')
  const [vault, setVault] = useState(readVault)
  const cookieFileRef = useRef(null)
  const profileFileRef = useRef(null)
  const vaultFileRef = useRef(null)

  useEffect(() => {
    try {
      window.localStorage.setItem(VAULT_KEY, JSON.stringify(vault))
    } catch (e) {
      // ignore quota / storage errors; vault is a convenience store
    }
  }, [vault])

  const isCustom = presetKey === 'custom'

  const applyUa = useCallback(() => {
    const preset = UA_PRESETS.find(p => p.key === presetKey)
    const ua = isCustom ? uaCustom.trim() : (preset ? preset.value : '')
    onApplyUa(ua)
    notification.success({
      message: 'User agent applied',
      description: ua || 'Using the built-in realistic default.'
    })
  }, [presetKey, isCustom, uaCustom, onApplyUa])

  const pickCookieFile = useCallback((event) => {
    const file = event.target.files && event.target.files[0]
    event.target.value = ''
    if (!file) return
    const reader = new window.FileReader()
    reader.onload = () => {
      try {
        onImportCookies(parseCookies(reader.result))
      } catch (error) {
        handleErr({ message: 'Cookie import failed: ' + error.message })
      }
    }
    reader.readAsText(file)
  }, [onImportCookies])

  const pickProfileFile = useCallback((event) => {
    const file = event.target.files && event.target.files[0]
    event.target.value = ''
    if (!file) return
    const reader = new window.FileReader()
    reader.onload = () => {
      try {
        const bundle = parseProfile(reader.result)
        const preset = UA_PRESETS.find(p => p.value === bundle.userAgent)
        setPresetKey(preset ? preset.key : 'custom')
        setUaCustom(bundle.userAgent)
        onLoadProfile(bundle)
      } catch (error) {
        handleErr({ message: 'Profile load failed: ' + error.message })
      }
    }
    reader.readAsText(file)
  }, [onLoadProfile])

  const confirmSave = useCallback(() => {
    if (!profileName.trim()) {
      handleErr({ message: 'Profile name is required' })
      return
    }
    onSaveProfile(profileName.trim())
    setSaveOpen(false)
    setProfileName('')
  }, [profileName, onSaveProfile])

  const setRow = (index, field, value) => {
    setVault(rows => rows.map((r, i) => i === index ? { ...r, [field]: value } : r))
  }
  const addRow = () => setVault(rows => [...rows, { domain: '', username: '', password: '' }])
  const deleteRow = (index) => setVault(rows => rows.filter((r, i) => i !== index))

  const exportVault = useCallback(() => {
    downloadJson(vault, 'anubis-vault.json')
    notification.success({ message: `Exported ${vault.length} vault entries` })
  }, [vault])

  const pickVaultFile = useCallback((event) => {
    const file = event.target.files && event.target.files[0]
    event.target.value = ''
    if (!file) return
    const reader = new window.FileReader()
    reader.onload = () => {
      try {
        const incoming = parseVault(reader.result)
        setVault(rows => mergeVault(rows, incoming))
        notification.success({ message: `Imported ${incoming.length} vault entries` })
      } catch (error) {
        handleErr({ message: 'Vault import failed: ' + error.message })
      }
    }
    reader.readAsText(file)
  }, [])

  const vaultColumns = [
    {
      title: 'Domain',
      dataIndex: 'domain',
      render: (text, record, index) => (
        <Input
          value={text}
          placeholder='example.com'
          onChange={e => setRow(index, 'domain', e.target.value)}
        />
      )
    },
    {
      title: 'Username',
      dataIndex: 'username',
      render: (text, record, index) => (
        <Input
          value={text}
          placeholder='user'
          onChange={e => setRow(index, 'username', e.target.value)}
        />
      )
    },
    {
      title: 'Password',
      dataIndex: 'password',
      render: (text, record, index) => (
        <Input.Password
          value={text}
          placeholder='password'
          onChange={e => setRow(index, 'password', e.target.value)}
        />
      )
    },
    {
      title: '',
      dataIndex: 'op',
      width: 80,
      render: (text, record, index) => (
        <Button size='small' danger onClick={() => deleteRow(index)}>Delete</Button>
      )
    }
  ]

  const sections = (
    <Space direction='vertical' size='middle' style={{ width: '100%' }}>
      <div>
        <Title level={5}>Browser engine</Title>
        <Select
          style={{ width: 240 }}
          value='rbi'
          options={[
            { value: 'rbi', label: 'Internal (RBI)' },
            { value: 'chrome', label: 'Google Chrome', disabled: true },
            { value: 'edge', label: 'Microsoft Edge', disabled: true }
          ]}
        />
        <div><Text type='secondary'>Chrome/Edge control coming in the next phase.</Text></div>
      </div>

      <div>
        <Title level={5}>User agent</Title>
        <Space wrap>
          <Select
            style={{ width: 240 }}
            value={presetKey}
            onChange={setPresetKey}
            options={UA_PRESETS.map(p => ({ value: p.key, label: p.label }))}
          />
          {isCustom && (
            <Input
              style={{ width: 360 }}
              value={uaCustom}
              placeholder='Custom user agent string'
              onChange={e => setUaCustom(e.target.value)}
            />
          )}
          <Button type='primary' onClick={applyUa}>Apply</Button>
        </Space>
        <div><Text type='secondary'>Active: {activeUa || 'built-in realistic default'}</Text></div>
      </div>

      <div>
        <Title level={5}>Cookies</Title>
        <Space wrap>
          <Button onClick={onExportCookies}>Export cookies</Button>
          <Button onClick={() => cookieFileRef.current && cookieFileRef.current.click()}>Import cookies</Button>
        </Space>
      </div>

      <div>
        <Title level={5}>Profiles</Title>
        <Space wrap>
          <Button onClick={() => setSaveOpen(true)}>Save profile</Button>
          <Button onClick={() => profileFileRef.current && profileFileRef.current.click()}>Load profile</Button>
        </Space>
        <div><Text type='secondary'>A profile bundles the current user agent and exported cookies into one JSON file.</Text></div>
      </div>

      <div>
        <Title level={5}>App vault</Title>
        <div><Text type='secondary'>App-managed, not browser-stored passwords. Stored locally in app config and not OS-encrypted.</Text></div>
        <Table
          rowKey={(record, index) => index}
          columns={vaultColumns}
          dataSource={vault}
          pagination={false}
          size='small'
          className='mg1t mg1b'
        />
        <Space wrap>
          <Button onClick={addRow}>Add row</Button>
          <Button onClick={exportVault}>Export vault</Button>
          <Button onClick={() => vaultFileRef.current && vaultFileRef.current.click()}>Import vault</Button>
        </Space>
      </div>
    </Space>
  )

  return (
    <div className='browser-tools-panel'>
      <Collapse
        size='small'
        items={[{ key: 'tools', label: 'Browser tools', children: sections }]}
      />
      <Modal
        title='Save profile'
        open={saveOpen}
        onOk={confirmSave}
        onCancel={() => setSaveOpen(false)}
        okText='Save'
      >
        <Input
          value={profileName}
          placeholder='Profile name'
          onChange={e => setProfileName(e.target.value)}
          onPressEnter={confirmSave}
        />
      </Modal>
      <input
        ref={cookieFileRef}
        type='file'
        accept='application/json,.json'
        style={{ display: 'none' }}
        onChange={pickCookieFile}
      />
      <input
        ref={profileFileRef}
        type='file'
        accept='application/json,.json'
        style={{ display: 'none' }}
        onChange={pickProfileFile}
      />
      <input
        ref={vaultFileRef}
        type='file'
        accept='application/json,.json'
        style={{ display: 'none' }}
        onChange={pickVaultFile}
      />
    </div>
  )
}
