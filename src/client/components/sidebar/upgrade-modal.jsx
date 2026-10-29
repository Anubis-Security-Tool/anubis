import { useState } from 'react'
import { auto } from 'manate/react'
import { Modal } from 'antd'
import { Check, Crown } from 'lucide-react'
import ExternalLink from '../common/external-link'
import { brand } from '../../common/constants'
import './upgrade-modal.styl'

// Pricing tiers shown in the upsell modal. Copy/prices are placeholders styled
// after the pricing reference; the "learn more" link always points at the
// official site so the exact plans can live there.
const tiers = [
  {
    id: 'free',
    name: 'Free',
    priceMonthly: 0,
    priceYearly: 0,
    tagline: 'Core terminal workflow',
    features: ['SSH / SFTP / Serial', 'Bookmarks', 'Quick connect', 'Setting sync']
  },
  {
    id: 'tiny',
    name: 'Tiny',
    priceMonthly: 3,
    priceYearly: 30,
    tagline: 'For power users',
    features: ['Everything in Free', 'Widgets dashboard', 'Extra themes', 'Setting sync cloud']
  },
  {
    id: 'solo',
    name: 'Solo',
    priceMonthly: 7,
    priceYearly: 70,
    tagline: 'Most loved plan',
    popular: true,
    features: ['Everything in Tiny', 'Plugin Store', 'Automation', 'AI Agents']
  },
  {
    id: 'pro',
    name: 'Pro',
    priceMonthly: 15,
    priceYearly: 150,
    tagline: 'Full arsenal',
    features: ['Everything in Solo', 'DLL Scanner', 'CVE Scanner', 'Browser Control']
  }
]

export default auto(function UpgradeModal ({ open, feature, onClose }) {
  const [yearly, setYearly] = useState(false)
  return (
    <Modal
      className='upgrade-pricing-modal'
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      width={900}
      title={null}
      destroyOnClose
    >
      <div className='upgrade-head'>
        <h2 className='upgrade-title'>Upgrade for More</h2>
        <p className='upgrade-subtitle'>
          {feature
            ? `${feature} is available on paid plans.`
            : 'Unlock professional security and automation tools.'}
        </p>
        <div className='upgrade-cycle' role='group' aria-label='Billing cycle'>
          <button
            type='button'
            className={`upgrade-cycle-btn${yearly ? '' : ' active'}`}
            onClick={() => setYearly(false)}
          >
            Monthly
          </button>
          <button
            type='button'
            className={`upgrade-cycle-btn${yearly ? ' active' : ''}`}
            onClick={() => setYearly(true)}
          >
            Yearly
          </button>
        </div>
      </div>
      <div className='upgrade-grid'>
        {tiers.map(tier => (
          <div
            key={tier.id}
            className={`upgrade-card${tier.popular ? ' popular' : ''}`}
          >
            {tier.popular && (
              <span className='upgrade-badge'>
                <Crown size={12} strokeWidth={2} aria-hidden='true' />
                Most Popular
              </span>
            )}
            <div className='upgrade-card-name'>{tier.name}</div>
            <div className='upgrade-card-tagline'>{tier.tagline}</div>
            <div className='upgrade-card-price'>
              <span className='upgrade-card-amount'>
                ${yearly ? tier.priceYearly : tier.priceMonthly}
              </span>
              <span className='upgrade-card-period'>
                /{yearly ? 'year' : 'mo'}
              </span>
            </div>
            <ul className='upgrade-card-features'>
              {tier.features.map(f => (
                <li key={f}>
                  <Check size={15} strokeWidth={2.25} aria-hidden='true' />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className='upgrade-foot'>
        <ExternalLink to={brand.domains.site} className='upgrade-cta'>
          Learn more on the website
        </ExternalLink>
      </div>
    </Modal>
  )
})
