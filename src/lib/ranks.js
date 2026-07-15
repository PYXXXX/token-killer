const ROMAN_DIVISIONS = ['', 'I', 'II', 'III', 'IV', 'V']
export const BLACK_HOLE_STAR_STEP = 32_000_000

export const RANK_TIERS = [
  { id: 'spark', name: '火种', min: 0, max: 100_000, divisions: 3 },
  { id: 'core', name: '燃芯', min: 100_000, max: 500_000, divisions: 3 },
  { id: 'furnace', name: '熔炉', min: 500_000, max: 2_000_000, divisions: 4 },
  { id: 'flare', name: '耀斑', min: 2_000_000, max: 10_000_000, divisions: 4 },
  { id: 'star', name: '恒星', min: 10_000_000, max: 50_000_000, divisions: 5 },
  { id: 'nova', name: '超新星', min: 50_000_000, max: 200_000_000, divisions: 5 },
  { id: 'singularity', name: '奇点', min: 200_000_000, max: 1_000_000_000, divisions: 5 },
  { id: 'black-hole', name: '黑洞', min: 1_000_000_000, max: null, divisions: 1, starStep: BLACK_HOLE_STAR_STEP },
]

export function rankForTokens(value = 0) {
  const tokens = Math.max(0, Number(value) || 0)
  const tierIndex = RANK_TIERS.findIndex((tier) => tier.max === null || tokens < tier.max)
  const tier = RANK_TIERS[Math.max(0, tierIndex)]
  const nextTier = RANK_TIERS[tierIndex + 1] || null

  if (tier.max === null) {
    const starStep = tier.starStep || BLACK_HOLE_STAR_STEP
    const stars = Math.floor((tokens - tier.min) / starStep) + 1
    const starFloor = tier.min + ((stars - 1) * starStep)
    const nextStarFloor = starFloor + starStep
    const starProgress = Math.min(1, Math.max(0, (tokens - starFloor) / starStep))

    return {
      id: tier.id,
      name: tier.name,
      division: `${stars} 星`,
      fullName: `${tier.name} ${stars} 星`,
      stars,
      maxStars: null,
      infiniteStars: true,
      progress: Math.min(99.9, Math.round(starProgress * 1000) / 10),
      nextName: `${tier.name} ${stars + 1} 星`,
      tokensToNext: Math.max(0, Math.ceil(nextStarFloor - tokens)),
      threshold: starFloor,
      starStep,
      min: tier.min,
      max: null,
    }
  }

  const span = tier.max - tier.min
  const tierProgress = Math.min(0.999999, Math.max(0, (tokens - tier.min) / span))
  const divisionOffset = Math.min(tier.divisions - 1, Math.floor(tierProgress * tier.divisions))
  const divisionNumber = tier.divisions - divisionOffset
  const divisionProgress = (tierProgress * tier.divisions) - divisionOffset
  const stars = Math.min(5, Math.floor(divisionProgress * 5))
  const division = ROMAN_DIVISIONS[divisionNumber]
  const nextDivisionNumber = Math.max(1, divisionNumber - 1)
  const nextName = divisionNumber === 1
    ? nextTier?.max === null
      ? `${nextTier.name} 1 星`
      : nextTier?.name || null
    : `${tier.name} ${ROMAN_DIVISIONS[nextDivisionNumber]}`
  const divisionCeiling = tier.min + span * ((divisionOffset + 1) / tier.divisions)

  return {
    id: tier.id,
    name: tier.name,
    division,
    fullName: `${tier.name} ${division}`,
    stars,
    maxStars: 5,
    infiniteStars: false,
    progress: Math.round(divisionProgress * 1000) / 10,
    nextName,
    tokensToNext: Math.max(0, Math.ceil(divisionCeiling - tokens)),
    threshold: tier.min,
    min: tier.min,
    max: tier.max,
  }
}
