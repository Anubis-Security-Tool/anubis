import { useState } from 'react'
import { Modal, Input, Button, Space, Typography } from 'antd'
import { notification } from '../common/notification'
import { handleErr } from '../../common/fetch'

const { Text, Paragraph } = Typography

// Readable messages for the activation failure codes returned by the managed
// controller (and the local "offline" code when the managed runtime is not
// available).
const reasons = {
  invalid: 'Invalid key',
  scope: 'Key not valid for this device',
  expired: 'Key expired',
  offline: 'Managed service offline'
}

// Small activation dialog for Browser PRO. On success it reports back through
// onActivated so the caller can open the Browser tab (entitlement is now true;
// the managed-connectivity re-emit updates globalState for later gate checks).
export default function ActivationModal ({ open, onClose, onActivated }) {
  const [key, setKey] = useState('')
  const [loading, setLoading] = useState(false)

  async function activate () {
    const trimmed = key.trim()
    if (!trimmed) {
      handleErr({ message: 'Activation key is required' })
      return
    }
    setLoading(true)
    try {
      const r = await window.pre.runGlobalAsync('activateBrowser', trimmed)
      if (r && r.ok === true) {
        notification.success({ message: 'Browser PRO activated' })
        setKey('')
        onClose()
        onActivated()
      } else {
        handleErr({ message: reasons[r && r.error] || 'Activation failed' })
      }
    } catch (error) {
      handleErr({ message: 'Activation failed: ' + error.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title='Activate Browser PRO'
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
      width={420}
    >
      <Space direction='vertical' style={{ width: '100%' }} size='middle'>
        <Paragraph type='secondary' style={{ marginBottom: 0 }}>
          Browser is a PRO feature. Enter an activation key to unlock it on this
          device.
        </Paragraph>
        <Input.Password
          placeholder='Activation key'
          value={key}
          autoFocus
          onChange={e => setKey(e.target.value)}
          onPressEnter={activate}
          disabled={loading}
        />
        <div style={{ textAlign: 'right' }}>
          <Button type='primary' loading={loading} onClick={activate}>
            Activate
          </Button>
        </div>
        <Text type='secondary' style={{ fontSize: 12 }}>
          A key is required to enable Browser on newly enrolled devices.
        </Text>
      </Space>
    </Modal>
  )
}
