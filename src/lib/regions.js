const ISO_COUNTRY_CODES = `
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO
JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MP MQ MR
MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE
RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR
TT TV TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
`.trim().split(/\s+/)

const CHINA_REGIONS = [
  ['AH', '安徽省'], ['BJ', '北京市'], ['CQ', '重庆市'], ['FJ', '福建省'],
  ['GD', '广东省'], ['GS', '甘肃省'], ['GX', '广西壮族自治区'], ['GZ', '贵州省'],
  ['HA', '河南省'], ['HB', '湖北省'], ['HE', '河北省'], ['HI', '海南省'],
  ['HL', '黑龙江省'], ['HN', '湖南省'], ['JL', '吉林省'], ['JS', '江苏省'],
  ['JX', '江西省'], ['LN', '辽宁省'], ['NM', '内蒙古自治区'], ['NX', '宁夏回族自治区'],
  ['QH', '青海省'], ['SC', '四川省'], ['SD', '山东省'], ['SH', '上海市'],
  ['SN', '陕西省'], ['SX', '山西省'], ['TJ', '天津市'], ['XJ', '新疆维吾尔自治区'],
  ['XZ', '西藏自治区'], ['YN', '云南省'], ['ZJ', '浙江省'],
  ['HK', '香港特别行政区'], ['MO', '澳门特别行政区'], ['TW', '台湾省'],
]

const CHINA_REGION_NAMES_EN = {
  AH: 'Anhui', BJ: 'Beijing', CQ: 'Chongqing', FJ: 'Fujian', GD: 'Guangdong',
  GS: 'Gansu', GX: 'Guangxi', GZ: 'Guizhou', HA: 'Henan', HB: 'Hubei',
  HE: 'Hebei', HI: 'Hainan', HL: 'Heilongjiang', HN: 'Hunan', JL: 'Jilin',
  JS: 'Jiangsu', JX: 'Jiangxi', LN: 'Liaoning', NM: 'Inner Mongolia',
  NX: 'Ningxia', QH: 'Qinghai', SC: 'Sichuan', SD: 'Shandong', SH: 'Shanghai',
  SN: 'Shaanxi', SX: 'Shanxi', TJ: 'Tianjin', XJ: 'Xinjiang', XZ: 'Tibet',
  YN: 'Yunnan', ZJ: 'Zhejiang', HK: 'Hong Kong SAR', MO: 'Macao SAR',
  TW: 'Taiwan Province',
}

export const EMPTY_MANUAL_REGION = {
  countryCode: '',
  regionCode: '',
  regionName: '',
  cityName: '',
}

export function countryOptions(locale = 'zh-CN') {
  const language = locale === 'en' ? 'en' : 'zh-CN'
  const names = new Intl.DisplayNames([language], { type: 'region' })
  return ISO_COUNTRY_CODES
    .filter((code) => !['HK', 'MO', 'TW'].includes(code))
    .map((code) => ({ value: code, label: names.of(code) || code }))
    .sort((a, b) => a.label.localeCompare(b.label, language))
}

export function chinaRegionOptions(locale = 'zh-CN') {
  if (locale !== 'en') return CHINA_REGIONS.map(([value, label]) => ({ value, label }))
  return CHINA_REGIONS.map(([value, fallback]) => ({
    value,
    label: CHINA_REGION_NAMES_EN[value] || fallback,
  }))
}

export function sanitizeManualRegion(region) {
  if (!region || typeof region !== 'object') return { ...EMPTY_MANUAL_REGION }
  return {
    countryCode: String(region.countryCode || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2),
    regionCode: String(region.regionCode || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12),
    regionName: String(region.regionName || '').replace(/[\p{Cc}<>\\/{}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80),
    cityName: String(region.cityName || '').replace(/[\p{Cc}<>\\/{}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80),
  }
}
