import {
  applyRememberedThemeColor,
  LAST_ORDER_ID_KEY,
  rememberCartPath,
  rememberThemeColor,
} from "./config.js"
import { appendDayOrderId } from "./order-day-history.js"
import { resolveTableContext, withTableQuery } from "./nav.js"
import { createOrder, fetchMenu } from "./api.js"
import {
  loadCart,
  ensureCart,
  saveCart,
  setLineQuantity,
  setSpecialInstructions,
  setCustomerName,
  setCustomerMobile,
  setDeliveryAddress,
  setMenuItemLineQuantity,
  cartTotals,
  toOrderPayload,
  clearCart,
  getDisplayNameForMenuItem,
  getQuantityForMenuItem,
  getUnitPriceForMenuItem,
  itemHasHalfFullOptions,
  normalizeSelectedPortion,
} from "./cart-store.js"
import { formatMoney } from "./format.js"
import { isNonVegFoodType, itemDietPillHtml } from "./diet.js"

const SPECIAL_INSTRUCTION_SUGGESTIONS = [
  "Mild spice level",
  "No onion and garlic",
  "Sauce on the side",
  "Please avoid peanuts (allergy)",
]

function $(sel, root = document) {
  return root.querySelector(sel)
}

function clearFieldError(fieldInput, errorEl) {
  if (!(fieldInput instanceof HTMLElement)) return
  fieldInput.classList.remove("cart-customer-name__input--invalid")
  fieldInput.removeAttribute("aria-invalid")
  const box = fieldInput.closest(".cart-customer-name__box")
  if (box) box.classList.remove("cart-customer-name__box--invalid")
  if (errorEl) {
    errorEl.hidden = true
    errorEl.textContent = ""
  }
}

function showFieldError(fieldInput, errorEl, message, shouldFocus = true) {
  if (!(fieldInput instanceof HTMLElement)) return
  fieldInput.classList.add("cart-customer-name__input--invalid")
  fieldInput.setAttribute("aria-invalid", "true")
  const box = fieldInput.closest(".cart-customer-name__box")
  if (box) box.classList.add("cart-customer-name__box--invalid")
  if (errorEl) {
    errorEl.hidden = false
    errorEl.textContent = message
  }
  if (shouldFocus) fieldInput.focus()
}

function isValidMobileNumber(mobile) {
  const digitsOnly = String(mobile || "").replace(/\D+/g, "")
  return digitsOnly.length === 10
}

function roundMoney(v) {
  return Math.round((Number(v) || 0) * 100) / 100
}

function syncCartBottomOffset() {
  const bar = document.querySelector(".cart-bottom-bar")
  const shell = document.querySelector(".app-shell--cart")
  if (!bar || !shell) return
  const h = Math.ceil(bar.getBoundingClientRect().height)
  shell.style.setProperty("--cart-bottom-h", `${h}px`)
}

let availabilityById = new Map()
/** Latest menu payload from `fetchMenu` — used for cart upsells / combos / pairings. */
let lastMenuData = null
let cartOrderAllowed = true
let cartOrderBlockedReason = ""

function flattenMenuItems(menuData) {
  const out = []
  for (const cat of menuData?.categories || []) {
    const categoryId = cat.id
    const categoryName = cat.name || ""
    for (const it of cat.items || []) {
      out.push({
        ...it,
        categoryId,
        categoryName,
      })
    }
  }
  return out
}

function isComboLikeItem(it) {
  const t = `${it.name || ""} ${it.description || ""}`.toLowerCase()
  return /\b(combo|thali|platter|bundle|meal deal|set menu|family pack|value meal)\b/i.test(t)
}

function isGreatCombinationItem(it) {
  const t = `${it.name || ""} ${it.description || ""}`.toLowerCase()
  return /\b(bought together|best with|pair with|great combination|recommended|must try|signature|chef special)\b/i.test(
    t
  )
}

function isBestSellerItem(it) {
  const t = `${it.name || ""} ${it.description || ""}`.toLowerCase()
  const isRestaurantSpecial = Boolean(it.isRestaurantSpecial || it.is_restaurant_special)
  const pop =
    Number(it.popularityScore) || Number(it.popularity_score) || Number(it.orderCount) || Number(it.order_count) || 0
  return isRestaurantSpecial || /\b(best seller|bestseller|popular|top seller|house special)\b/i.test(t) || pop >= 50
}

function isPairingCategoryHint(it) {
  return /beverage|drink|juice|wine|coffee|tea|dessert|sweet|bread|soup|starter|appetizer|side|salad|rice|naan/i.test(
    `${it.categoryName || ""} ${it.name || ""}`
  )
}

function itemSearchText(it) {
  return `${it.name || ""} ${it.description || ""} ${it.categoryName || ""}`.toLowerCase()
}

function normalizedBucketOf(it) {
  return String(it.normalizedBucket || it.normalized_bucket || "").toUpperCase().trim()
}

function upsellCategoryOf(it) {
  return String(it.upsellCategory || it.upsell_category || "").toUpperCase().trim()
}

/**
 * Universal upsell taxonomy:
 * keep one shared keyword bank so recommendations stay consistent
 * even when restaurants use different category naming.
 */
const UNIVERSAL_UPSELL_KEYWORDS = {
  beverage: [
    "beverage",
    "drink",
    "juice",
    "shake",
    "lassi",
    "tea",
    "coffee",
    "soda",
    "cola",
    "coke",
    "pepsi",
    "fanta",
    "sprite",
    "thumbs up",
    "thums up",
    "mocktail",
    "smoothie",
    "water",
    "buttermilk",
    "cold drink",
    "mojito",
    "lemonade",
  ],
  dessert: [
    "dessert",
    "sweet",
    "ice cream",
    "gulab",
    "halwa",
    "brownie",
    "cake",
    "kheer",
    "pastry",
    "mousse",
    "rabdi",
  ],
  main: [
    "curry",
    "biryani",
    "rice",
    "noodle",
    "pizza",
    "burger",
    "pasta",
    "thali",
    "main course",
    "meal",
    "combo",
    "plate",
    "gravy",
    "paneer",
    "dal",
    "korma",
    "masala",
    "chicken curry",
    "mutton",
    "fish curry",
  ],
  snack: [
    "starter",
    "appetizer",
    "snack",
    "chaat",
    "fries",
    "roll",
    "sandwich",
    "momos",
    "pakoda",
    "tikka",
    "finger food",
    "samosa",
    "kachori",
    "spring roll",
    "manchurian",
    "chilli paneer",
    "chilli chicken",
  ],
  side: [
    "side",
    "bread",
    "naan",
    "roti",
    "salad",
    "raita",
    "dip",
    "chutney",
    "pickle",
    "papad",
    "extra chutney",
    "extra sauce",
    "extra mayo",
  ],
}

function hasUniversalKeyword(text, bucket) {
  const words = UNIVERSAL_UPSELL_KEYWORDS[bucket] || []
  return words.some((w) => text.includes(w))
}

function isBeverageItem(it) {
  if (normalizedBucketOf(it) === "BEVERAGE") return true
  return hasUniversalKeyword(itemSearchText(it), "beverage")
}

function isDessertItem(it) {
  if (normalizedBucketOf(it) === "DESSERT") return true
  return hasUniversalKeyword(itemSearchText(it), "dessert")
}

function isMainCourseLike(it) {
  const b = normalizedBucketOf(it)
  if (b === "MAIN" || b === "COMBO") return true
  return hasUniversalKeyword(itemSearchText(it), "main")
}

function isSnackLike(it) {
  if (normalizedBucketOf(it) === "SNACK_STARTER") return true
  return hasUniversalKeyword(itemSearchText(it), "snack")
}

function isSideLike(it) {
  const b = normalizedBucketOf(it)
  if (b === "SIDE_ACCOMPANIMENT" || b === "BREAD" || b === "RICE" || b === "ADD_ON") return true
  return hasUniversalKeyword(itemSearchText(it), "side")
}

function buildCartProfile(cartItems) {
  return {
    hasMain: cartItems.some(isMainCourseLike),
    hasSnack: cartItems.some(isSnackLike),
    hasSide: cartItems.some(isSideLike),
    hasBeverage: cartItems.some(isBeverageItem),
    hasDessert: cartItems.some(isDessertItem),
  }
}

function detectCuisineFromText(text) {
  const t = String(text || "").toLowerCase()
  if (/(paneer|naan|roti|dal|biryani|tandoori|lassi|chaat|rajma|korma|masala)/.test(t)) return "indian"
  if (/(hakka|manchurian|chowmein|noodle|schezwan|dimsum|momo)/.test(t)) return "indo_chinese"
  if (/(pizza|pasta|lasagna|risotto|garlic bread|alfredo)/.test(t)) return "italian"
  if (/(burger|fries|wrap|hot dog|sandwich|steak)/.test(t)) return "continental"
  return "unknown"
}

function scoreParts(it, cartProfile, cartCategoryIds, cuisineSignal) {
  const text = itemSearchText(it)
  const price = Number(it.price) || 0
  const upsellTag = upsellCategoryOf(it)

  // 1) Rule match: strongest weight
  let ruleMatch = 0
  if (!cartProfile.hasBeverage && upsellTag === "DRINK_PAIRING") ruleMatch += 1.2
  if (!cartProfile.hasDessert && upsellTag === "DESSERT_FOLLOWUP") ruleMatch += 1
  if (cartProfile.hasMain && !cartProfile.hasSide && upsellTag === "SIDE_PAIRING") ruleMatch += 1
  if (cartProfile.hasMain && upsellTag === "COMBO_UPGRADE") ruleMatch += 0.6
  if (isBeverageItem(it) && (cartProfile.hasMain || cartProfile.hasSnack) && !cartProfile.hasBeverage) ruleMatch += 1
  if (isDessertItem(it) && cartProfile.hasMain && !cartProfile.hasDessert) ruleMatch += 0.8
  if (isSideLike(it) && cartProfile.hasMain) ruleMatch += 0.5
  if (cartCategoryIds.size > 0 && !cartCategoryIds.has(it.categoryId)) ruleMatch += 0.3

  // Missing category detection: MAIN present + no BEVERAGE => strongly boost drink pairing
  if (cartProfile.hasMain && !cartProfile.hasBeverage && isBeverageItem(it)) ruleMatch += 0.7

  // 2) Keyword confidence
  let keywordMatch = 0
  if (upsellTag === "DRINK_PAIRING" || upsellTag === "DESSERT_FOLLOWUP" || upsellTag === "SIDE_PAIRING") {
    keywordMatch += 0.6
  }
  if (isPairingCategoryHint(it)) keywordMatch += 0.6
  if (isBeverageItem(it)) keywordMatch += 0.4
  if (isDessertItem(it)) keywordMatch += 0.3
  if (isSideLike(it)) keywordMatch += 0.2
  if (/combo|meal|thali|platter|set/.test(text)) keywordMatch += 0.4

  // 3) Cuisine match (Indian menus name-heavy)
  const itemCuisine = detectCuisineFromText(text)
  let cuisineMatch = 0
  if (cuisineSignal !== "unknown" && itemCuisine === cuisineSignal) cuisineMatch = 1
  else if (itemCuisine === "unknown") cuisineMatch = 0.2

  // 4) Popularity score (if backend supplies; fallback neutral)
  const popularityRaw =
    Number(it.popularityScore) || Number(it.popularity_score) || Number(it.orderCount) || Number(it.order_count) || 0
  const popularityScore = Math.max(0, Math.min(1, popularityRaw > 0 ? popularityRaw / 100 : 0))

  // 5) Margin boost (if provided; else 0)
  const marginRaw = Number(it.marginBoost) || Number(it.margin_boost) || 0
  const marginBoost = Math.max(0, Math.min(1, marginRaw))

  // 6) Upsell priority (manual override from backend; else 0)
  const upsellPriorityRaw = Number(it.upsellPriority) || Number(it.upsell_priority) || 0
  const upsellPriority = Math.max(0, Math.min(1, upsellPriorityRaw / 10))

  // Price sanity small bonus for impulse adds
  const impulse = price > 0 && price <= 250 ? 0.15 : 0

  const score =
    ruleMatch * 50 +
    keywordMatch * 40 +
    cuisineMatch * 20 +
    popularityScore * 10 +
    marginBoost * 10 +
    upsellPriority * 5 +
    impulse * 10

  return { score, ruleMatch, keywordMatch, cuisineMatch }
}

/**
 * Suggest items not already in cart: combo-like names, cross-category “pairs”, then general upsell.
 * All suggestions respect `isAvailable` only (same as menu).
 */
function buildCartSuggestionGroups(cart, menuData) {
  const flat = flattenMenuItems(menuData)
  const inCart = new Set(cart.lines.map((l) => String(l.menuItemId)))
  const byId = new Map(flat.map((it) => [String(it.id), it]))
  const cartCategoryIds = new Set()
  const cartItems = []
  for (const line of cart.lines) {
    const found = byId.get(String(line.menuItemId))
    if (!found) continue
    cartCategoryIds.add(found.categoryId)
    cartItems.push(found)
  }
  const cartProfile = buildCartProfile(cartItems)
  const hasNonVegInCart = cartItems.some((it) => isNonVegFoodType(it.foodType))
  const hasVegInCart = cartItems.some((it) => !isNonVegFoodType(it.foodType))
  const preferVegOnlySuggestions = hasVegInCart && !hasNonVegInCart
  const cuisineSignal = detectCuisineFromText(
    cartItems.map((it) => itemSearchText(it)).join(" ") ||
      `${menuData?.restaurant?.name || ""} ${menuData?.restaurant?.slug || ""}`
  )
  const pool = flat.filter((it) => {
    if (!it.isAvailable || inCart.has(String(it.id))) return false
    // If cart is currently veg-only, keep recommendations veg-only as well.
    if (preferVegOnlySuggestions && isNonVegFoodType(it.foodType)) return false
    return true
  })
  const used = new Set()

  const combos = []
  const comboCandidates = pool
    .filter((it) => isComboLikeItem(it))
    .map((it) => ({ it, ...scoreParts(it, cartProfile, cartCategoryIds, cuisineSignal) }))
    .sort((a, b) => b.score - a.score || Number(a.it.price) - Number(b.it.price))
  for (const cand of comboCandidates) {
    if (combos.length >= 4) break
    combos.push(cand.it)
    used.add(String(cand.it.id))
  }

  const pairs = []
  const preferBeverageFirst = !cartProfile.hasBeverage
  const pairCandidates = pool
    .filter((it) => !used.has(String(it.id)))
    .filter((it) => {
      const tag = upsellCategoryOf(it)
      return (
        tag === "DRINK_PAIRING" ||
        tag === "DESSERT_FOLLOWUP" ||
        tag === "SIDE_PAIRING" ||
        isBeverageItem(it) ||
        isSideLike(it) ||
        isDessertItem(it)
      )
    })
    .map((it) => ({ it, ...scoreParts(it, cartProfile, cartCategoryIds, cuisineSignal) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (preferBeverageFirst) {
        const aIsBeverage = isBeverageItem(a.it)
        const bIsBeverage = isBeverageItem(b.it)
        if (aIsBeverage !== bIsBeverage) return aIsBeverage ? -1 : 1
      }
      return b.score - a.score || Number(a.it.price) - Number(b.it.price)
    })

  const priorityBuckets = []
  if (!cartProfile.hasBeverage)
    priorityBuckets.push((it) => upsellCategoryOf(it) === "DRINK_PAIRING" || isBeverageItem(it))
  if (!cartProfile.hasDessert)
    priorityBuckets.push((it) => upsellCategoryOf(it) === "DESSERT_FOLLOWUP" || isDessertItem(it))
  if (cartProfile.hasMain && !cartProfile.hasSide)
    priorityBuckets.push((it) => upsellCategoryOf(it) === "SIDE_PAIRING" || isSideLike(it))

  for (const pickFromBucket of priorityBuckets) {
    if (pairs.length >= 5) break
    const top = pairCandidates.find((x) => !used.has(String(x.it.id)) && pickFromBucket(x.it))
    if (!top) continue
    pairs.push(top.it)
    used.add(String(top.it.id))
  }

  const pairCandidatesOrdered = pairCandidates.filter((x) => !used.has(String(x.it.id)))
  for (const cand of pairCandidatesOrdered) {
    if (pairs.length >= 5) break
    pairs.push(cand.it)
    used.add(String(cand.it.id))
  }

  const upsells = []
  const rest = pool.filter((it) => !used.has(String(it.id)))
  const restRanked = rest
    .map((it) => ({ it, ...scoreParts(it, cartProfile, cartCategoryIds, cuisineSignal) }))
    .sort((a, b) => {
      const aCombo = isComboLikeItem(a.it) || isGreatCombinationItem(a.it)
      const bCombo = isComboLikeItem(b.it) || isGreatCombinationItem(b.it)
      if (aCombo !== bCombo) return aCombo ? -1 : 1
      const aBest = isBestSellerItem(a.it)
      const bBest = isBestSellerItem(b.it)
      if (aBest !== bBest) return aBest ? -1 : 1
      return b.score - a.score || Number(a.it.price) - Number(b.it.price)
    })
  for (const cand of restRanked) {
    if (upsells.length >= 4) break
    upsells.push(cand.it)
    used.add(String(cand.it.id))
  }

  return { combos, pairs, upsells }
}

function renderSuggestionCard(it) {
  const photo = it.photoUrl
    ? `<img src="${escapeHtml(it.photoUrl)}" alt="" class="cart-suggest-card__photo" loading="lazy" />`
    : `<span class="material-symbols-outlined cart-suggest-card__photo-fallback">restaurant</span>`
  return `<div class="cart-suggest-card">
    <div class="cart-suggest-card__media">${photo}</div>
    <div class="cart-suggest-card__body">
      <div class="cart-suggest-card__title-row">
        ${itemDietPillHtml(it.foodType)}
        <h4 class="cart-suggest-card__name">${escapeHtml(it.name || "Item")}</h4>
      </div>
      <div class="cart-suggest-card__row">
        <span class="cart-suggest-card__price">${itemHasHalfFullOptions(it) ? `From ${formatMoney(Number(it.halfPrice || it.price || 0))}` : formatMoney(Number(it.price))}</span>
        <button type="button" class="cart-suggest-card__add" data-suggest-add data-id="${escapeHtml(
          String(it.id)
        )}" aria-label="Add ${escapeHtml(it.name || "item")}">
          <span class="material-symbols-outlined">add</span>
        </button>
      </div>
    </div>
  </div>`
}

function bindSuggestionAdds(root) {
  root.querySelectorAll("[data-suggest-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id")
      if (!id || !lastMenuData) return
      const flat = flattenMenuItems(lastMenuData)
      const it = flat.find((x) => String(x.id) === id)
      if (!it || !it.isAvailable) return
      const c = loadCart()
      if (!c) return
      const selectedPortion = itemHasHalfFullOptions(it) ? "FULL" : null
      setMenuItemLineQuantity(
        c,
        {
          menuItemId: it.id,
          name: it.name,
          unitPrice: getUnitPriceForMenuItem(it, selectedPortion),
          photoUrl: it.photoUrl || null,
          foodType: it.foodType,
          selectedPortion,
        },
        getQtyForItem(c, id, selectedPortion) + 1
      )
      void hydrateCartLineImages(loadCart() || c).then((updated) => {
        render(updated || loadCart() || c)
      })
    })
  })
}

function getQtyForItem(cart, menuItemId, selectedPortion = null) {
  return getQuantityForMenuItem(cart, menuItemId, selectedPortion)
}

function renderSuggestionSections(cart) {
  const mount = $("#cart-suggestions")
  if (!mount) return
  if (!cart.lines.length || !lastMenuData) {
    mount.innerHTML = ""
    mount.hidden = true
    return
  }
  const { combos, pairs, upsells } = buildCartSuggestionGroups(cart, lastMenuData)
  const blocks = []
  if (pairs.length) {
    blocks.push(`<section class="cart-suggest-block" aria-label="You might like">
      <h3 class="cart-suggest-block__label">You might like</h3>
      <p class="cart-suggest-block__hint">Drinks, sides &amp; more picked for your order</p>
      <div class="cart-suggest-strip">${pairs.map(renderSuggestionCard).join("")}</div>
    </section>`)
  }
  if (combos.length) {
    blocks.push(`<section class="cart-suggest-block" aria-label="Combos and bundles">
      <h3 class="cart-suggest-block__label">Combos &amp; bundles</h3>
      <p class="cart-suggest-block__hint">Meals and sets that go together</p>
      <div class="cart-suggest-strip">${combos.map(renderSuggestionCard).join("")}</div>
    </section>`)
  }
  if (upsells.length) {
    blocks.push(`<section class="cart-suggest-block" aria-label="Add to your order">
      <h3 class="cart-suggest-block__label">Add to your order</h3>
      <p class="cart-suggest-block__hint">Popular add-ons &amp; small plates</p>
      <div class="cart-suggest-strip">${upsells.map(renderSuggestionCard).join("")}</div>
    </section>`)
  }
  // Keep experience focused: only 2-3 sections, prioritize pairing relevance.
  if (blocks.length > 3) blocks.length = 3
  if (!blocks.length) {
    mount.innerHTML = ""
    mount.hidden = true
    return
  }
  mount.innerHTML = blocks.join("")
  mount.hidden = false
  bindSuggestionAdds(mount)
}

function render(cart) {
  const mount = $("#cart-mount")
  const topName = $(".cart-topbar__name")
  const topTable = $(".cart-topbar__table")
  const subtotalEl = $("#summary-subtotal")
  const subtotalLabelEl = $("#summary-subtotal-label")
  const gstRow = $("#summary-gst-row")
  const gstLabelEl = $("#summary-gst-label")
  const gstEl = $("#summary-gst")
  const totalLabelEl = $("#summary-total-label")
  const totalEl = $("#summary-total")
  const summary = $("#cart-summary")
  const globalNote = $("#special-instructions")
  const suggestionWrap = $("#special-instructions-suggestions")
  const unavailableBanner = $("#cart-unavailable-banner")
  const deliveryAddressWrap = $("#cart-delivery-address-wrap")
  const deliveryAddressEl = $("#delivery-address")
  const isDelivery = String(cart.serviceType || "").toUpperCase() === "DELIVERY"

  if (topName) topName.textContent = cart.restaurantName || "Restaurant"
  if (topTable) topTable.textContent = isDelivery ? "Delivery" : `Table ${cart.tableNumber}`

  const addLinks = [$("#top-add-link"), $("#bottom-menu-link")].filter(Boolean)
  addLinks.forEach((a) => {
    a.href = withTableQuery("menu")
  })
  const orderLink = $("#bottom-order-link")
  if (orderLink) orderLink.href = withTableQuery("track")

  if (!mount) return
  mount.innerHTML = ""
  if (globalNote) {
    globalNote.value = cart.specialInstructions || ""
  }
  if (suggestionWrap) {
    const activeNote = String(cart.specialInstructions || "")
    suggestionWrap.innerHTML = SPECIAL_INSTRUCTION_SUGGESTIONS.map((text) => {
      const active = activeNote.toLowerCase().includes(text.toLowerCase())
      return `<button type="button" class="cart-special-suggestion${active ? " is-active" : ""}" data-special-suggestion="${escapeHtml(text)}">${escapeHtml(text)}</button>`
    }).join("")
    suggestionWrap.querySelectorAll("[data-special-suggestion]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!globalNote) return
        const picked = String(btn.getAttribute("data-special-suggestion") || "").trim()
        if (!picked) return
        const current = String(globalNote.value || "").trim()
        const next = current
          ? current.toLowerCase().includes(picked.toLowerCase())
            ? current
            : `${current}${current.endsWith(".") ? " " : ". "}${picked}`
          : picked
        globalNote.value = next
        const c = loadCart()
        if (!c) return
        setSpecialInstructions(c, next)
        render(loadCart() || c)
      })
    })
  }
  const customerNameEl = $("#customer-name")
  const customerMobileEl = $("#customer-mobile")
  const customerNameWrap = $("#cart-customer-name-wrap")
  if (customerNameEl) {
    customerNameEl.value = typeof cart.customerName === "string" ? cart.customerName : ""
    customerNameEl.required = isDelivery
  }
  if (customerMobileEl) {
    customerMobileEl.value = typeof cart.customerMobile === "string" ? cart.customerMobile : ""
    customerMobileEl.required = isDelivery
  }
  const customerNameLabel = document.querySelector('label[for="customer-name"]')
  const customerMobileLabel = document.querySelector('label[for="customer-mobile"]')
  if (customerNameLabel) customerNameLabel.textContent = isDelivery ? "Name (required)" : "Name (optional)"
  if (customerMobileLabel) {
    customerMobileLabel.textContent = isDelivery ? "Mobile number (required)" : "Mobile number (optional)"
  }
  if (customerNameWrap) {
    customerNameWrap.hidden = cart.lines.length === 0
  }
  if (deliveryAddressWrap) {
    deliveryAddressWrap.hidden = cart.lines.length === 0 || !isDelivery
  }
  if (deliveryAddressEl) {
    deliveryAddressEl.value = typeof cart.deliveryAddress === "string" ? cart.deliveryAddress : ""
  }

  if (cart.lines.length === 0) {
    mount.innerHTML = `<p class="cart-empty">Your cart is empty. <a class="text-link" href="${withTableQuery("menu")}">Browse menu</a></p>`
    if (summary) summary.hidden = true
    if (subtotalEl) subtotalEl.textContent = formatMoney(0)
    if (subtotalLabelEl) subtotalLabelEl.textContent = "Subtotal"
    if (gstEl) gstEl.textContent = formatMoney(0)
    if (gstLabelEl) gstLabelEl.textContent = "GST (5%)"
    if (gstRow) gstRow.hidden = true
    if (totalLabelEl) totalLabelEl.textContent = "Total"
    if (totalEl) totalEl.textContent = formatMoney(0)
    if (unavailableBanner) unavailableBanner.hidden = true
    const btn = $("#place-order-btn")
    if (btn) {
      btn.disabled = true
      btn.textContent = "Place order"
    }
    renderSuggestionSections(cart)
    requestAnimationFrame(syncCartBottomOffset)
    return
  }

  let unavailableCount = 0
  cart.lines.forEach((line, index) => {
    const lineKey = String(line.menuItemId)
    const hasAvailability = availabilityById.has(lineKey)
    const isUnavailable = hasAvailability && availabilityById.get(lineKey) === false
    if (isUnavailable) unavailableCount += 1
    const row = document.createElement("div")
    row.className = `cart-row${isUnavailable ? " cart-row--unavailable" : ""}`
    row.innerHTML = `
      <div class="cart-row__main">
        <div class="cart-row__media">
          ${isUnavailable ? '<span class="cart-row__sold-tag">Sold Out</span>' : ""}
          ${
            line.photoUrl
              ? `<img src="${escapeHtml(line.photoUrl)}" alt="" class="cart-row__photo${
                  isUnavailable ? " cart-row__photo--unavailable" : ""
                }" loading="lazy" />`
              : `<span class="material-symbols-outlined">restaurant</span>`
          }
        </div>
        <div class="cart-row__body${isUnavailable ? " cart-row__body--unavailable" : ""}">
          <div class="cart-row__top">
            <div>
              <div class="cart-row__name-row">
                <span class="cart-row__diet"></span>
                <h2 class="cart-row__name"></h2>
              </div>
              <p class="cart-row__line"></p>
            </div>
            <span class="menu-card__price line-total"></span>
          </div>
          <div class="qty-row">
            <div class="qty-control" role="group" aria-label="Quantity">
              <button type="button" class="qty-btn" data-act="dec" aria-label="Decrease" ${
                isUnavailable ? "disabled" : ""
              }>−</button>
              <span class="qty-val"></span>
              <button type="button" class="qty-btn" data-act="inc" aria-label="Increase" ${
                isUnavailable ? "disabled" : ""
              }>+</button>
            </div>
            <button type="button" class="cart-row__delete-btn${
              isUnavailable ? " cart-row__delete-btn--danger" : ""
            }" data-act="del" aria-label="Remove item">
              <span class="material-symbols-outlined">delete</span>
            </button>
          </div>
        </div>
      </div>
    `
    const dietWrap = row.querySelector(".cart-row__diet")
    if (dietWrap) dietWrap.innerHTML = itemDietPillHtml(line.foodType)
    row.querySelector(".cart-row__name").textContent = line.name
    row.querySelector(".cart-row__line").textContent = isUnavailable
      ? "Currently unavailable"
      : `${formatMoney(line.unitPrice)} each`
    row.querySelector(".qty-val").textContent = String(line.quantity)
    row.querySelector(".line-total").textContent = formatMoney(line.quantity * line.unitPrice)

    row.querySelector('[data-act="dec"]').addEventListener("click", () => {
      const c = loadCart()
      if (!c || !c.lines[index]) return
      setLineQuantity(c, index, c.lines[index].quantity - 1)
      render(loadCart() || c)
    })
    row.querySelector('[data-act="inc"]').addEventListener("click", () => {
      const c = loadCart()
      if (!c || !c.lines[index]) return
      setLineQuantity(c, index, c.lines[index].quantity + 1)
      render(loadCart() || c)
    })
    row.querySelector('[data-act="del"]').addEventListener("click", () => {
      const c = loadCart()
      if (!c || !c.lines[index]) return
      setLineQuantity(c, index, 0)
      render(loadCart() || c)
    })
    mount.appendChild(row)
  })

  const { total } = cartTotals(cart)
  const gstRate = cart.isGstEnabled ? 0.05 : 0
  const gstInclusive = cart.isGstEnabled && cart.isGstInclusive
  const taxableSubtotal = roundMoney(gstInclusive ? total / (1 + gstRate) : total)
  const grandTotal = gstInclusive ? roundMoney(total) : roundMoney(taxableSubtotal + taxableSubtotal * gstRate)
  const gst = roundMoney(gstInclusive ? grandTotal - taxableSubtotal : grandTotal - taxableSubtotal)
  if (summary) summary.hidden = false
  if (unavailableBanner) unavailableBanner.hidden = unavailableCount === 0
  if (subtotalLabelEl) subtotalLabelEl.textContent = gstInclusive ? "Subtotal (excl. GST)" : "Subtotal"
  if (subtotalEl) subtotalEl.textContent = formatMoney(taxableSubtotal)
  if (gstLabelEl) {
    gstLabelEl.textContent = cart.isGstEnabled
      ? gstInclusive
        ? "GST (5% included)"
        : "GST (5%)"
      : "GST (off)"
  }
  if (gstEl) gstEl.textContent = formatMoney(gst)
  if (gstRow) gstRow.hidden = false
  if (totalLabelEl) totalLabelEl.textContent = cart.isGstEnabled ? "Total (Subtotal + GST)" : "Total"
  if (totalEl) totalEl.textContent = formatMoney(grandTotal)
  const btn = $("#place-order-btn")
  if (btn) {
    btn.disabled = unavailableCount > 0 || !cartOrderAllowed
    btn.textContent = cartOrderAllowed ? "Place order" : "Ordering unavailable"
  }

  renderSuggestionSections(cart)
  requestAnimationFrame(syncCartBottomOffset)
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function getUnavailableLines(cart, menuData) {
  const items = (menuData?.categories || []).flatMap((cat) => cat.items || [])
  const byId = new Map()
  items.forEach((it) => {
    if (typeof it?.isAvailable !== "boolean") return
    byId.set(String(it.id), it.isAvailable)
  })
  return cart.lines.filter((line) => {
    const key = String(line.menuItemId)
    return byId.has(key) && byId.get(key) === false
  })
}

async function hydrateCartLineImages(cart) {
  if (!cart || !cart.lines.length) {
    lastMenuData = null
    cartOrderAllowed = true
    cartOrderBlockedReason = ""
    return cart
  }
  const menuData = await fetchMenu(cart.restaurantSlug, cart.tableNumber, cart.serviceType || "DINE_IN")
  rememberThemeColor(menuData?.restaurant?.themeColor)
  lastMenuData = menuData
  cartOrderAllowed = menuData?.restaurant?.isOpenNow !== false
  cartOrderBlockedReason = cartOrderAllowed
    ? ""
    : "Restaurant is not accepting orders right now. Please try again during working hours."
  const items = (menuData?.categories || []).flatMap((cat) => cat.items || [])
  const itemById = new Map(items.map((it) => [String(it.id), it]))
  const photoById = new Map(items.map((it) => [String(it.id), String(it.photoUrl || "")]))
  const foodTypeById = new Map(items.map((it) => [String(it.id), it.foodType]))
  const nextAvailability = new Map()
  items.forEach((it) => {
    if (typeof it?.isAvailable !== "boolean") return
    nextAvailability.set(String(it.id), it.isAvailable)
  })
  availabilityById = nextAvailability
  let changed = false
  const gstEnabled = Boolean(menuData?.restaurant?.isGstEnabled)
  const gstInclusive = Boolean(menuData?.restaurant?.estimatedTimeSettings?.pricing?.gstInclusive)
  if (cart.isGstEnabled !== gstEnabled) {
    cart.isGstEnabled = gstEnabled
    changed = true
  }
  if (cart.isGstInclusive !== gstInclusive) {
    cart.isGstInclusive = gstInclusive
    changed = true
  }
  cart.lines.forEach((line) => {
    const id = String(line.menuItemId)
    const item = itemById.get(id)
    if (!line.photoUrl) {
      const photoUrl = photoById.get(id) || ""
      if (photoUrl) {
        line.photoUrl = photoUrl
        changed = true
      }
    }
    if (line.foodType == null || line.foodType === "") {
      const ft = foodTypeById.get(id)
      if (ft != null && ft !== "") {
        line.foodType = ft
        changed = true
      }
    }
    if (item) {
      const selectedPortion = normalizeSelectedPortion(line.selectedPortion)
      const nextBaseName = String(item.name || line.baseName || line.name || "Item").trim() || "Item"
      const nextName = getDisplayNameForMenuItem(nextBaseName, selectedPortion)
      const nextUnitPrice = getUnitPriceForMenuItem(item, selectedPortion)
      if (line.baseName !== nextBaseName) {
        line.baseName = nextBaseName
        changed = true
      }
      if (line.name !== nextName) {
        line.name = nextName
        changed = true
      }
      if (Number(line.unitPrice || 0) !== Number(nextUnitPrice || 0)) {
        line.unitPrice = Number(nextUnitPrice || 0)
        changed = true
      }
    }
  })
  if (changed) saveCart(cart)
  return cart
}

async function placeOrder(cart) {
  const btn = $("#place-order-btn")
  const nameInput = $("#customer-name")
  const mobileInput = $("#customer-mobile")
  const deliveryAddressInput = $("#delivery-address")
  const nameError = $("#customer-name-error")
  const mobileError = $("#customer-mobile-error")
  const deliveryAddressError = $("#delivery-address-error")
  if (!btn || cart.lines.length === 0) return
  if (!cartOrderAllowed) {
    alert(cartOrderBlockedReason || "Restaurant is not accepting orders right now.")
    return
  }
  btn.disabled = true
  btn.textContent = "Placing…"
  try {
    const latestMenu = await fetchMenu(cart.restaurantSlug, cart.tableNumber, cart.serviceType || "DINE_IN")
    if (latestMenu?.restaurant?.isOpenNow === false) {
      alert("Restaurant is currently closed. Please place order during open hours.")
      btn.disabled = false
      btn.textContent = "Place order"
      return
    }
    const unavailableLines = getUnavailableLines(cart, latestMenu)
    if (unavailableLines.length) {
      const names = unavailableLines
        .map((l) => String(l.name || "Item"))
        .filter(Boolean)
      alert(
        `Please remove unavailable item(s) from cart before placing order: ${names.join(", ")}`
      )
      btn.disabled = false
      btn.textContent = "Place order"
      return
    }

    if (nameInput) {
      setCustomerName(cart, nameInput.value)
      cart = loadCart() || cart
    }
    if (mobileInput) {
      setCustomerMobile(cart, mobileInput.value)
      cart = loadCart() || cart
    }
    const isDelivery = String(cart.serviceType || "").toUpperCase() === "DELIVERY"
    const customerName = String(nameInput?.value || "").trim()
    const customerMobile = String(mobileInput?.value || "").trim()
    const deliveryAddress = String(deliveryAddressInput?.value || "").trim()
    clearFieldError(nameInput, nameError)
    clearFieldError(mobileInput, mobileError)
    clearFieldError(deliveryAddressInput, deliveryAddressError)

    let firstInvalidField = null
    let hasValidationErrors = false
    if (isDelivery && !customerName) {
      showFieldError(nameInput, nameError, "Name is required for delivery.", false)
      firstInvalidField = firstInvalidField || nameInput
      hasValidationErrors = true
    }
    if (isDelivery && !customerMobile) {
      showFieldError(mobileInput, mobileError, "Mobile number is required for delivery.", false)
      firstInvalidField = firstInvalidField || mobileInput
      hasValidationErrors = true
    }
    if (customerMobile && !isValidMobileNumber(customerMobile)) {
      showFieldError(mobileInput, mobileError, "Please enter a valid 10-digit mobile number.", false)
      firstInvalidField = firstInvalidField || mobileInput
      hasValidationErrors = true
    }
    if (isDelivery && !deliveryAddress) {
      showFieldError(deliveryAddressInput, deliveryAddressError, "Delivery address is required.", false)
      firstInvalidField = firstInvalidField || deliveryAddressInput
      hasValidationErrors = true
    }
    if (hasValidationErrors) {
      if (firstInvalidField instanceof HTMLElement) firstInvalidField.focus()
      btn.disabled = false
      btn.textContent = "Place order"
      return
    }

    if (deliveryAddressInput) {
      setDeliveryAddress(cart, deliveryAddressInput.value)
      cart = loadCart() || cart
    }

    const payload = toOrderPayload(cart)
    const res = await createOrder(payload)
    clearCart()
    const id = res && res.orderId ? res.orderId : ""
    const shortId = res && res.shortId ? String(res.shortId) : ""
    if (id) {
      try {
        sessionStorage.setItem(LAST_ORDER_ID_KEY, id)
      } catch {
        /* ignore */
      }
      const { slug, tableNumber } = resolveTableContext()
      appendDayOrderId(slug, tableNumber, id)
    }
    const base = withTableQuery("success")
    const sep = base.includes("?") ? "&" : "?"
    let qs = id ? `${sep}orderId=${encodeURIComponent(id)}` : ""
    if (shortId) {
      const sep2 = qs ? "&" : sep
      qs += `${sep2}shortId=${encodeURIComponent(shortId)}`
    }
    window.location.href = `${base}${qs}`
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not place order"
    const lowerMsg = String(msg || "").toLowerCase()
    if (lowerMsg.includes("mobile")) {
      showFieldError(mobileInput, mobileError, msg)
    } else if (lowerMsg.includes("name")) {
      showFieldError(nameInput, nameError, msg)
    } else if (lowerMsg.includes("address")) {
      showFieldError(deliveryAddressInput, deliveryAddressError, msg)
    } else {
      alert(msg)
    }
    btn.disabled = false
    btn.textContent = "Place order"
  }
}

async function main() {
  applyRememberedThemeColor()
  rememberCartPath()
  const { slug, tableNumber, serviceType } = resolveTableContext()
  let cart = loadCart()
  if (!cart) {
    cart = ensureCart(slug, tableNumber, "", serviceType)
  } else {
    cart = ensureCart(slug, tableNumber, cart.restaurantName, serviceType)
  }

  try {
    const updated = await hydrateCartLineImages(cart)
    render(updated || cart)
  } catch (e) {
    /* if menu fetch fails, clear availability map to avoid stale warnings */
    availabilityById = new Map()
    cartOrderAllowed = false
    cartOrderBlockedReason =
      e instanceof Error && e.message
        ? e.message
        : "Restaurant is not accepting orders right now."
    render(cart)
  }

  const globalNote = $("#special-instructions")
  if (globalNote) {
    const syncSpecialInstructions = () => {
      const c = loadCart()
      if (!c) return
      setSpecialInstructions(c, globalNote.value)
    }
    globalNote.addEventListener("change", syncSpecialInstructions)
    globalNote.addEventListener("input", syncSpecialInstructions)
  }

  const customerNameInput = $("#customer-name")
  const customerNameError = $("#customer-name-error")
  if (customerNameInput) {
    const syncName = () => {
      const c = loadCart()
      if (!c) return
      setCustomerName(c, customerNameInput.value)
      clearFieldError(customerNameInput, customerNameError)
    }
    customerNameInput.addEventListener("change", syncName)
    customerNameInput.addEventListener("input", syncName)
    customerNameInput.addEventListener("blur", syncName)
  }
  const customerMobileInput = $("#customer-mobile")
  const customerMobileError = $("#customer-mobile-error")
  if (customerMobileInput) {
    const syncMobile = () => {
      const c = loadCart()
      if (!c) return
      setCustomerMobile(c, customerMobileInput.value)
      const rawMobile = String(customerMobileInput.value || "").trim()
      if (!rawMobile || isValidMobileNumber(rawMobile)) {
        clearFieldError(customerMobileInput, customerMobileError)
      }
    }
    customerMobileInput.addEventListener("change", syncMobile)
    customerMobileInput.addEventListener("blur", syncMobile)
    customerMobileInput.addEventListener("input", syncMobile)
  }
  const deliveryAddressInput = $("#delivery-address")
  const deliveryAddressError = $("#delivery-address-error")
  if (deliveryAddressInput) {
    const syncAddress = () => {
      const c = loadCart()
      if (!c) return
      setDeliveryAddress(c, deliveryAddressInput.value)
      if (String(deliveryAddressInput.value || "").trim()) {
        clearFieldError(deliveryAddressInput, deliveryAddressError)
      }
    }
    deliveryAddressInput.addEventListener("change", syncAddress)
    deliveryAddressInput.addEventListener("blur", syncAddress)
    deliveryAddressInput.addEventListener("input", syncAddress)
  }

  const btn = $("#place-order-btn")
  if (btn) {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault()
      const c = loadCart()
      if (c) placeOrder(c)
    })
  }

  // iOS Safari can restore stale page state from BFCache; force a fresh availability render.
  window.addEventListener("pageshow", async () => {
    const c = loadCart()
    if (!c) return
    try {
      const updated = await hydrateCartLineImages(c)
      render(updated || c)
    } catch (e) {
      availabilityById = new Map()
      cartOrderAllowed = false
      cartOrderBlockedReason =
        e instanceof Error && e.message
          ? e.message
          : "Restaurant is not accepting orders right now."
      render(c)
    }
  })
  window.addEventListener("resize", syncCartBottomOffset)
  requestAnimationFrame(syncCartBottomOffset)
}

main()
