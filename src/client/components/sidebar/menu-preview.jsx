import { useState } from 'react'
import { auto } from 'manate/react'
import { Popover, Tooltip } from 'antd'
import {
  SquareTerminal, Swords, Cog, ChevronDown, ChevronRight,
  Cpu, BookOpen, Zap, CloudCog, LayoutGrid, Settings,
  Package, Workflow, FileSearch, ShieldAlert, Bot, Globe,
  Info, CircleHelp, PanelLeftClose, Crown
} from 'lucide-react'
import MenuBtn from '../sys-menu/menu-btn'
import QuickConnect from '../tabs/quick-connect'
import UpgradeModal from './upgrade-modal'
import { brand, modals, settingMap, infoTabs, terminalWebType } from '../../common/constants'
import { isAIDisabled } from '../../common/ai-feature'
import { groupedSidebarIconIds } from '../../common/left-sidebar-icon-defs'
import './menu-preview.styl'

// Three approved sections. Items with an `id` are user-configurable (ordered /
// filtered by groupedSidebarIconIds); id-less items are always shown. `pro`
// items are locked and open the upgrade modal instead of running an action.
// Arsenal items are two-line: brand product name + the feature it maps to.
const groups = [
  {
    label: 'Console',
    icon: SquareTerminal,
    items: [
      { key: 'systemInfo', name: 'System Info', icon: Cpu },
      { id: 'bookmarks', key: 'bookmarks', name: 'Bookmarks', icon: BookOpen },
      { id: 'quickConnect', key: 'quickConnect', name: 'Quick connect', icon: Zap },
      { id: 'settingSync', key: 'settingSync', name: 'Setting sync', icon: CloudCog },
      { id: 'widgets', key: 'widgets', name: 'Widgets', icon: LayoutGrid },
      { id: 'setting', key: 'setting', name: 'Setting', icon: Settings }
    ]
  },
  {
    label: 'Arsenal',
    icon: Swords,
    items: [
      { key: 'pluginStore', name: 'Plugin Store', icon: Package, pro: true },
      { key: 'aiAgents', name: 'Anubis Oracle', sub: 'AI Agents', icon: Bot },
      { key: 'automation', name: 'Anubis Osiris', sub: 'Automation', icon: Workflow, pro: true },
      { key: 'dllScanner', name: 'Anubis Scarab', sub: 'DLL Scanner', icon: FileSearch, pro: true },
      { key: 'cveScanner', name: 'Anubis Aegis', sub: 'CVE Scanner', icon: ShieldAlert, pro: true },
      { key: 'browser', name: 'Browser', icon: Globe }
    ]
  },
  {
    label: 'System',
    icon: Cog,
    items: [
      { key: 'about', name: 'About', icon: Info },
      { key: 'faq', name: 'FAQ', icon: CircleHelp },
      { key: 'hide', name: 'Hide', icon: PanelLeftClose }
    ]
  }
]

export default auto(function GroupedSidebarMenu ({ handleClickBookmark, children }) {
  const [upsell, setUpsell] = useState(null)
  const { store } = window
  const iconIds = groupedSidebarIconIds(store.config.leftSideBarIcons)
  const configuredGroups = groups.map(group => {
    const ordered = group.items
      .filter(item => item.id && iconIds.includes(item.id))
      .sort((a, b) => iconIds.indexOf(a.id) - iconIds.indexOf(b.id))
    return {
      ...group,
      items: group.items.flatMap(item => item.id ? (ordered.shift() || []) : item)
    }
  })
  const settingVisible = store.showModal === modals.setting
  const activeItems = {
    bookmarks: store.openedSideBar === 'bookmarks',
    settingSync: settingVisible && store.settingTab === settingMap.setting && store.settingItem.id === 'setting-sync',
    aiAgents: store.rightPanelVisible && store.rightPanelTab === 'ai',
    widgets: settingVisible && store.settingTab === settingMap.widgets,
    setting: settingVisible && store.settingTab === settingMap.setting && store.settingItem.id === 'setting-common',
    about: store.showInfoModal
  }
  const actions = {
    systemInfo: () => store.openAbout(infoTabs.os),
    bookmarks: handleClickBookmark,
    settingSync: () => store.openSettingSync(),
    aiAgents: () => store.toggleAIPanel(),
    widgets: () => store.openWidgetsModal(),
    setting: () => store.openSetting(),
    about: () => store.openAbout(),
    faq: () => window.pre.openExternal(brand.domains.docs),
    hide: () => store.toggleLeftSideBar(),
    browser: () => store.addTab({
      type: terminalWebType,
      url: 'https://www.google.com',
      title: 'Browser'
    })
  }

  function selectItem (item) {
    if (item.pro) {
      setUpsell(item.name)
    } else {
      actions[item.key]()
    }
  }

  return (
    <>
      <div className='preview-brand'>
        <MenuBtn store={store} config={store.config} />
      </div>
      <nav className='preview-navigation' aria-label='Application sections'>
        {configuredGroups.map(({ label, icon: GroupIcon, items }) => (
          <details className='preview-group' key={label} open>
            <summary title={label}>
              <GroupIcon size={17} strokeWidth={1.75} aria-hidden='true' />
              <span className='preview-label preview-group-title'>{label}</span>
              <ChevronDown className='preview-chevron' size={13} aria-hidden='true' />
            </summary>
            {items.map(({ key, name, sub, icon: Icon, pro = false }) => {
              const active = activeItems[key]
              const button = (
                <button
                  className={`preview-menu-item${active ? ' active' : ''}${pro ? ' pro' : ''}${sub ? ' has-sub' : ''}${key === 'bookmarks' ? ' bookmark-sidebar-toggle' : ''}`}
                  type='button'
                  aria-label={sub ? `${name} — ${sub}` : name}
                  aria-current={active ? 'page' : undefined}
                  disabled={key === 'aiAgents' && isAIDisabled()}
                  onClick={key === 'quickConnect' ? undefined : () => selectItem({ key, name, pro })}
                >
                  <Icon size={18} strokeWidth={1.75} aria-hidden='true' />
                  <span className='preview-label preview-item-text'>
                    <span className='preview-item-name'>{name}</span>
                    {sub && <span className='preview-item-sub'>{sub}</span>}
                  </span>
                  {pro && <span className='preview-pro-tag'>PRO</span>}
                </button>
              )
              return key === 'quickConnect'
                ? (
                  <Popover key={key} content={<QuickConnect inputOnly />} trigger='click' placement='right'>
                    {button}
                  </Popover>
                  )
                : (
                  <Tooltip key={key} title={pro ? 'Available only in the PRO version' : (sub ? `${name} — ${sub}` : name)} placement='right'>
                    {button}
                  </Tooltip>
                  )
            })}
          </details>
        ))}
      </nav>
      <div className='preview-footer' role='group' aria-label='Application controls'>
        {children}
      </div>
      <button
        type='button'
        className='preview-account'
        title='Free version'
        aria-label='Free version — upgrade available'
        onClick={() => setUpsell('')}
      >
        <span className='preview-account-icon'>
          <Crown size={16} strokeWidth={1.75} aria-hidden='true' />
        </span>
        <span className='preview-account-text'>
          <span className='preview-account-name'>Free version</span>
          <span className='preview-account-sub'>Upgrade available</span>
        </span>
        <ChevronRight className='preview-account-chevron' size={15} aria-hidden='true' />
      </button>
      <UpgradeModal
        open={upsell !== null}
        feature={upsell || ''}
        onClose={() => setUpsell(null)}
      />
    </>
  )
})
