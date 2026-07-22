import { createContext, useContext } from 'react'

export const LocaleContext = createContext('zh-CN')

export function useLocale() {
  return useContext(LocaleContext)
}
