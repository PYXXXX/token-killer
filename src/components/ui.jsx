export function NavButton({ active, icon: Icon, label, onClick }) {
  const NavIcon = Icon
  return (
    <button className={`nav-button ${active ? 'active' : ''}`} type="button" onClick={onClick}>
      <NavIcon size={20} weight={active ? 'fill' : 'regular'} />
      <span>{label}</span>
    </button>
  )
}

export function Metric({ label, value, detail, icon: Icon }) {
  return (
    <div className="metric">
      <div className="metric-label">
        <span>{label}</span>
        {Icon ? <Icon size={18} /> : null}
      </div>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  )
}

export function RankIcon({ tier, eager = false, decorative = false }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}ranks-c/${tier.id}.png`}
      alt={decorative ? '' : `${tier.name}段位徽章`}
      aria-hidden={decorative || undefined}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
    />
  )
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  )
}

export function Segmented({ value, options, onChange, label }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={value === option.value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
