import { Children, cloneElement, isValidElement } from 'react'
import { translateText } from './lib/i18n.js'
import { LocaleContext, useLocale } from './locale-context.js'

const TEXT_PROPS = new Set(['label', 'hint', 'title', 'placeholder', 'aria-label', 'alt'])

function translateOptions(locale, options) {
  if (!Array.isArray(options)) return options
  return options.map((option) => (
    option && typeof option === 'object' && typeof option.label === 'string'
      ? { ...option, label: translateText(locale, option.label) }
      : option
  ))
}

function localizeNode(locale, node) {
  if (typeof node === 'string') return translateText(locale, node)
  if (Array.isArray(node)) {
    return node.map((child, index) => {
      const localized = localizeNode(locale, child)
      return isValidElement(localized) && localized.key == null
        ? cloneElement(localized, { key: `localized-${index}` })
        : localized
    })
  }
  if (!isValidElement(node)) return node

  const patch = {}
  for (const [name, value] of Object.entries(node.props)) {
    if (TEXT_PROPS.has(name) && typeof value === 'string') patch[name] = translateText(locale, value)
    if (name === 'options') patch.options = translateOptions(locale, value)
  }
  if ('children' in node.props) {
    patch.children = Children.map(node.props.children, (child, index) => {
      const localized = localizeNode(locale, child)
      return isValidElement(localized) && localized.key == null
        ? cloneElement(localized, { key: `localized-${index}` })
        : localized
    })
  }
  return cloneElement(node, patch)
}

export function I18nProvider({ locale, children }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
}

export function Localized({ children }) {
  const locale = useLocale()
  return localizeNode(locale, children)
}
