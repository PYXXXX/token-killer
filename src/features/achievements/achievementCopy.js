export function achievementTitle(achievement, locale) {
  return locale === 'en' ? achievement.titleEn : achievement.title
}

export function achievementDescription(achievement, locale) {
  return locale === 'en' ? achievement.descriptionEn : achievement.description
}
