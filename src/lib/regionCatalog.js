import chinaCities from '@province-city-china/city'
import {
  configure,
  getAllCitiesOfCountry,
  getCitiesOfState,
  getStatesOfCountry,
} from '@countrystatecity/countries-browser'
import { chinaRegionOptions } from './regions.js'

const CHINA_PROVINCE_CODES = {
  AH: '34', BJ: '11', CQ: '50', FJ: '35', GD: '44', GS: '62', GX: '45',
  GZ: '52', HA: '41', HB: '42', HE: '13', HI: '46', HL: '23', HN: '43',
  JL: '22', JS: '32', JX: '36', LN: '21', NM: '15', NX: '64', QH: '63',
  SC: '51', SD: '37', SH: '31', SN: '61', SX: '14', TJ: '12', XJ: '65',
  XZ: '54', YN: '53', ZJ: '33',
}

const CHINA_MUNICIPALITIES = {
  BJ: '北京市',
  CQ: '重庆市',
  SH: '上海市',
  TJ: '天津市',
}

const TAIWAN_CITIES = [
  '基隆市',
  '台北市',
  '新北市',
  '桃园市',
  '新竹市',
  '台中市',
  '嘉义市',
  '台南市',
  '高雄市',
]

const catalogBaseUrl = typeof document === 'undefined'
  ? 'http://localhost/region-data'
  : new URL('region-data', document.baseURI).toString().replace(/\/$/, '')

configure({
  baseURL: catalogBaseUrl,
  cacheSize: 24,
  timeout: 10_000,
})

const uniqueOptions = (values, locale = 'en') => {
  const seen = new Set()
  return values
    .map((value) => String(value || '').trim())
    .filter((value) => value && !seen.has(value) && seen.add(value))
    .sort((left, right) => left.localeCompare(right, locale))
    .map((value) => ({ value, label: value }))
}

const catalogLabel = (entry) => String(entry?.native || entry?.name || '').trim()

export async function loadRegionOptions(countryCode, locale = 'zh-CN') {
  const country = String(countryCode || '').toUpperCase()
  if (!country) return []
  if (country === 'CN') return chinaRegionOptions(locale)

  const states = await getStatesOfCountry(country)
  return states
    .map((state) => ({
      value: String(state.iso2 || '').toUpperCase(),
      label: catalogLabel(state),
    }))
    .filter((option) => option.value && option.label)
    .sort((left, right) => left.label.localeCompare(right.label, locale))
}

export async function loadCityOptions(countryCode, regionCode) {
  const country = String(countryCode || '').toUpperCase()
  const region = String(regionCode || '').toUpperCase()
  if (!country) return []

  if (country === 'CN') {
    if (['HK', 'MO'].includes(region)) return []
    if (region === 'TW') return TAIWAN_CITIES.map((value) => ({ value, label: value }))
    if (CHINA_MUNICIPALITIES[region]) {
      const value = CHINA_MUNICIPALITIES[region]
      return [{ value, label: value }]
    }

    const provinceCode = CHINA_PROVINCE_CODES[region]
    if (!provinceCode) return []
    return uniqueOptions(
      chinaCities
        .filter((city) => city.province === provinceCode)
        .map((city) => city.name),
      'zh-CN',
    )
  }

  const cities = region
    ? await getCitiesOfState(country, region)
    : await getAllCitiesOfCountry(country)

  return uniqueOptions(cities.map(catalogLabel))
}
