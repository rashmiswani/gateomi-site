/** Veg / non-veg helpers — matches menu logic (foodType VEG | NON_VEG). */

export function isNonVegFoodType(foodType) {
  const t = String(foodType || "VEG").toLowerCase()
  return t.includes("non") || t.includes("egg")
}

/**
 * Inline badge HTML for cart / track / success (labels are fixed; safe to inject).
 * Reuses `.menu-card__diet-dot` for colors.
 */
export function itemDietPillHtml(foodType) {
  const non = isNonVegFoodType(foodType)
  const dotClass = non ? "is-nonveg" : "is-veg"
  const label = non ? "Non-Veg" : "Veg"
  return `<span class="item-diet-pill" title="${label}"><span class="menu-card__diet-dot ${dotClass}" aria-hidden="true"></span><span>${label}</span></span>`
}
