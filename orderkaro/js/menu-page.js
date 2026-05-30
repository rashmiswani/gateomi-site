import { applyRememberedThemeColor, rememberMenuPath, rememberThemeColor } from "./config.js"
import { resolveTableContext, withTableQuery } from "./nav.js"
import { fetchMenu, requestWaiterCall } from "./api.js"
import {
  ensureCart,
  cartTotals,
  loadCart,
  getQuantityForMenuItem,
  getDisplayNameForMenuItem,
  getUnitPriceForMenuItem,
  itemHasHalfFullOptions,
  normalizeSelectedPortion,
  setMenuItemLineQuantity,
} from "./cart-store.js"
import { formatMoney } from "./format.js"

function $(sel, root = document) {
  return root.querySelector(sel)
}

let menuData = null
let menuHeaderResizeObserver = null
let menuSearchText = ""
let menuVegOnly = false
let menuVegOnlyLocked = false
let waiterCallState = null
/** @type {Set<string>} */
const collapsedCategoryIds = new Set()
let waiterStatusPollTimer = null
const selectedPortionsByItemId = new Map()
const OPENING_SPLASH_DURATION_MS = 2500
const OPENING_SPLASH_FADE_MS = 420

let menuPromotionSliderTimer = null
let menuPromotionSliderIndex = 0

function isRestaurantMenuOpen(restaurant) {
  return restaurant?.isOpenNow !== false
}

function teardownMenuPromotionPopup() {
  if (menuPromotionSliderTimer) {
    clearInterval(menuPromotionSliderTimer)
    menuPromotionSliderTimer = null
  }
  const track = $("#menu-promotion-popup-track")
  const dots = $("#menu-promotion-popup-dots")
  const root = $("#menu-promotion-popup")
  if (track) track.innerHTML = ""
  if (dots) dots.innerHTML = ""
  if (root) {
    root.hidden = true
    root.setAttribute("aria-hidden", "true")
  }
}

function closeMenuPromotionPopup() {
  teardownMenuPromotionPopup()
  unlockMenuPageScroll()
}

function mountMenuPromotionPopup(slides) {
  teardownMenuPromotionPopup()
  const root = $("#menu-promotion-popup")
  const track = $("#menu-promotion-popup-track")
  const dotsRoot = $("#menu-promotion-popup-dots")
  if (!root || !track || !dotsRoot || !Array.isArray(slides) || slides.length === 0) return false
  const urls = slides.map((s) => String(s || "").trim()).filter(Boolean)
  if (!urls.length) return false

  const intervalMs = 4500
  menuPromotionSliderIndex = 0
  track.innerHTML = ""
  dotsRoot.innerHTML = ""

  urls.forEach((src, i) => {
    const slide = document.createElement("div")
    slide.className = `menu-promotion-popup__slide${i === 0 ? " is-active" : ""}`
    slide.setAttribute("aria-hidden", i === 0 ? "false" : "true")
    const img = document.createElement("img")
    img.src = src
    img.alt = `Promotion ${i + 1} of ${urls.length}`
    img.decoding = "async"
    img.loading = i === 0 ? "eager" : "lazy"
    slide.appendChild(img)
    track.appendChild(slide)

    if (urls.length > 1) {
      const dot = document.createElement("button")
      dot.type = "button"
      dot.className = `menu-promotion-popup__dot${i === 0 ? " is-active" : ""}`
      dot.setAttribute("aria-label", `Show promotion ${i + 1}`)
      dot.addEventListener("click", () => {
        menuPromotionSliderIndex = i
        applySlide()
      })
      dotsRoot.appendChild(dot)
    }
  })

  const slidesEls = () => [...track.querySelectorAll(".menu-promotion-popup__slide")]
  const dotEls = () => [...dotsRoot.querySelectorAll(".menu-promotion-popup__dot")]

  function applySlide() {
    slidesEls().forEach((el, i) => {
      const active = i === menuPromotionSliderIndex
      el.classList.toggle("is-active", active)
      el.setAttribute("aria-hidden", active ? "false" : "true")
    })
    dotEls().forEach((el, i) => {
      el.classList.toggle("is-active", i === menuPromotionSliderIndex)
    })
  }

  function nextSlide() {
    menuPromotionSliderIndex = (menuPromotionSliderIndex + 1) % urls.length
    applySlide()
  }

  if (urls.length > 1) {
    menuPromotionSliderTimer = window.setInterval(nextSlide, intervalMs)
  }

  root.hidden = false
  root.setAttribute("aria-hidden", "false")
  lockMenuPageScroll()
  return true
}

function getMenuPromotionSlides(restaurant) {
  const promo = restaurant?.menuPromotion
  return Array.isArray(promo?.slides)
    ? promo.slides.map((s) => String(s || "").trim()).filter(Boolean)
    : []
}

function maybeShowMenuPromotionPopup(restaurant) {
  if (!isRestaurantMenuOpen(restaurant)) {
    teardownMenuPromotionPopup()
    return
  }
  const slides = getMenuPromotionSlides(restaurant)
  if (!slides.length) {
    teardownMenuPromotionPopup()
    return
  }
  mountMenuPromotionPopup(slides)
}

function bindMenuPromotionPopup() {
  const root = $("#menu-promotion-popup")
  if (!root) return
  root.querySelectorAll("[data-promotion-popup-close]").forEach((el) => {
    el.addEventListener("click", closeMenuPromotionPopup)
  })
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && root && !root.hidden) closeMenuPromotionPopup()
  })
}

function isWaiterCallActive(state) {
  return Boolean(state?.waiterCallActive || (state?.waiterCallRequestedAt && !state?.waiterCallResolvedAt))
}

function getMenuWaiterButton() {
  return document.getElementById("menu-footer-waiter-btn")
}

function forceHideMenuWaiterButton() {
  const btn = getMenuWaiterButton()
  if (!(btn instanceof HTMLButtonElement)) return
  btn.hidden = true
  btn.style.display = "none"
  btn.removeAttribute("data-support-tel")
}

function normalizePhoneForTel(raw) {
  const val = String(raw || "").trim()
  if (!val) return ""
  const cleaned = val.replace(/[^\d+\-() ]/g, "").trim()
  if (!cleaned) return ""
  const hasDigit = /\d/.test(cleaned)
  if (!hasDigit) return ""
  return `tel:${cleaned}`
}

function applyMenuWaiterButtonState() {
  const btn = getMenuWaiterButton()
  if (!(btn instanceof HTMLButtonElement)) return
  const ctx = resolveTableContext()
  const ctxServiceType = String(ctx.serviceType || "").toUpperCase()
  const dataServiceType = String(menuData?.serviceType || "").toUpperCase()
  const isDelivery = ctxServiceType === "DELIVERY" || dataServiceType === "DELIVERY"
  const isDineIn = !isDelivery
  if (!isDineIn) {
    const telHref = normalizePhoneForTel(menuData?.restaurant?.supportPhone)
    if (!telHref) {
      forceHideMenuWaiterButton()
      return
    }
    btn.style.display = ""
    btn.hidden = false
    btn.disabled = false
    btn.setAttribute("data-support-tel", telHref)
    btn.title = "Call restaurant support"
    btn.setAttribute("aria-label", "Call restaurant support")
    btn.innerHTML =
      '<span class="material-symbols-outlined">call</span><span>Call Restaurant</span>'
    return
  }
  btn.removeAttribute("data-support-tel")
  btn.style.display = ""
  btn.hidden = false
  const active = isWaiterCallActive(waiterCallState)
  btn.disabled = active
  btn.title = active ? "Waiter already requested for this table" : "Call waiter to your table"
  btn.setAttribute("aria-label", active ? "Waiter already requested for this table" : "Call waiter to your table")
  btn.innerHTML = active
    ? '<span class="material-symbols-outlined">check_circle</span><span>Waiter On The Way</span>'
    : '<span class="material-symbols-outlined">room_service</span><span>Call Waiter</span>'
}

function wireMenuWaiterButton() {
  const btn = getMenuWaiterButton()
  if (!(btn instanceof HTMLButtonElement) || btn.dataset.bound === "1") return
  btn.dataset.bound = "1"
  btn.addEventListener("click", async () => {
    if (!menuData) return
    const supportTel = String(btn.getAttribute("data-support-tel") || "")
    if (supportTel) {
      window.location.href = supportTel
      return
    }
    const ctx = resolveTableContext()
    const ctxServiceType = String(ctx.serviceType || "").toUpperCase()
    const dataServiceType = String(menuData?.serviceType || "").toUpperCase()
    if (ctxServiceType === "DELIVERY" || dataServiceType === "DELIVERY") return
    btn.disabled = true
    try {
      const data = await requestWaiterCall(ctx.slug, ctx.tableNumber)
      waiterCallState = data
      applyMenuWaiterButtonState()
      startMenuWaiterStatusPolling()
      const err = document.querySelector("#orderkaro-error")
      if (err) {
        err.hidden = false
        err.textContent = "Waiter has been notified."
      }
    } catch (e) {
      applyMenuWaiterButtonState()
      const err = document.querySelector("#orderkaro-error")
      if (err) {
        err.hidden = false
        err.textContent = e instanceof Error ? e.message : "Could not call waiter"
      }
    }
  })
}

function stopMenuWaiterStatusPolling() {
  if (!waiterStatusPollTimer) return
  window.clearInterval(waiterStatusPollTimer)
  waiterStatusPollTimer = null
}

function startMenuWaiterStatusPolling() {
  const ctx = resolveTableContext()
  const serviceType = String(ctx.serviceType || "").toUpperCase()
  if (serviceType === "DELIVERY") {
    stopMenuWaiterStatusPolling()
    return
  }
  if (!isWaiterCallActive(waiterCallState)) {
    stopMenuWaiterStatusPolling()
    return
  }
  if (waiterStatusPollTimer) return
  waiterStatusPollTimer = window.setInterval(async () => {
    try {
      const latest = await fetchMenu(ctx.slug, ctx.tableNumber, ctx.serviceType || "DINE_IN")
      waiterCallState = latest?.tableService || null
      applyMenuWaiterButtonState()
      if (!isWaiterCallActive(waiterCallState)) {
        stopMenuWaiterStatusPolling()
      }
    } catch {
      // Keep existing UI state; next interval retries.
    }
  }, 5000)
}

function updateTableBadge(tableNumber, isDelivery) {
  const badge = document.querySelector(".menu-topbar__right .table-badge:not(.table-badge--action)")
  if (!badge) return
  badge.textContent = isDelivery ? "Delivery" : `Table ${tableNumber}`
}

function openImageLightbox(src, details = {}) {
  const root = $("#menu-image-lightbox")
  const img = $("#menu-image-lightbox-img")
  const caption = $("#menu-image-lightbox-caption")
  const titleEl = $("#menu-image-lightbox-title")
  const descEl = $("#menu-image-lightbox-desc")
  if (!root || !img || !src) return
  const name = String(details?.name || "").trim()
  const description = String(details?.description || "").trim()
  img.src = src
  img.alt = name || "Menu item image"
  const panel = root.querySelector(".menu-image-lightbox__panel")
  if (caption && titleEl && descEl) {
    const hasCaption = Boolean(name || description)
    caption.hidden = !hasCaption
    titleEl.textContent = name
    titleEl.hidden = !name
    descEl.textContent = description
    descEl.hidden = !description
  }
  if (panel instanceof HTMLElement) {
    if (name) {
      panel.setAttribute("aria-labelledby", "menu-image-lightbox-title")
      panel.removeAttribute("aria-label")
    } else {
      panel.setAttribute("aria-label", "Image preview")
      panel.removeAttribute("aria-labelledby")
    }
  }
  root.hidden = false
  root.setAttribute("aria-hidden", "false")
  lockMenuPageScroll()
}

function closeImageLightbox() {
  const root = $("#menu-image-lightbox")
  const img = $("#menu-image-lightbox-img")
  const caption = $("#menu-image-lightbox-caption")
  const titleEl = $("#menu-image-lightbox-title")
  const descEl = $("#menu-image-lightbox-desc")
  if (!root || !img) return
  root.hidden = true
  root.setAttribute("aria-hidden", "true")
  img.removeAttribute("src")
  img.alt = ""
  if (caption) caption.hidden = true
  if (titleEl) {
    titleEl.textContent = ""
    titleEl.hidden = true
  }
  if (descEl) {
    descEl.textContent = ""
    descEl.hidden = true
  }
  unlockMenuPageScroll()
}

function bindImageLightbox() {
  const root = $("#menu-image-lightbox")
  const closeBtn = $("#menu-image-lightbox-close")
  const backdrop = root?.querySelector(".menu-image-lightbox__backdrop")
  if (!root || !closeBtn || !backdrop) return
  closeBtn.addEventListener("click", closeImageLightbox)
  backdrop.addEventListener("click", closeImageLightbox)
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && root && !root.hidden) closeImageLightbox()
  })
}

function filterMenuCategories(categories) {
  const q = menuSearchText.trim().toLowerCase()
  return (Array.isArray(categories) ? categories : [])
    .map((cat) => {
      const items = (cat.items || []).filter((it) => {
        if (menuVegOnly && isNonVegFoodType(it.foodType)) return false
        if (!q) return true
        return String(it.name || "").toLowerCase().includes(q)
      })
      return { ...cat, items }
    })
    .filter((cat) => cat.items.length > 0)
}

function scrollToMenuCategory(categoryId) {
  const id = String(categoryId || "")
  if (!id) return
  collapsedCategoryIds.delete(id)
  const section = document.getElementById(`menu-cat-${id}`)
  const feed = $("#menu-sections")
  if (!section || !feed) return
  section.classList.remove("is-collapsed")
  const head = section.querySelector(".menu-cat-block__head")
  if (head) head.setAttribute("aria-expanded", "true")
  const headerEl = document.querySelector(".sticky-menu-header")
  const headerOffset = headerEl ? Math.ceil(headerEl.getBoundingClientRect().height) + 8 : 72
  const top = section.getBoundingClientRect().top - feed.getBoundingClientRect().top + feed.scrollTop - headerOffset
  feed.scrollTo({ top: Math.max(0, top), behavior: "smooth" })
}

function openCategoryGallery() {
  const root = $("#menu-category-gallery")
  if (!root || !menuData) return
  const list = $("#menu-category-gallery-list")
  if (!list) return
  const categories = filterMenuCategories(menuData.categories)
  list.innerHTML = categories
    .map(
      (cat) => `<li>
        <button type="button" class="menu-category-sheet__row" data-category-jump="${escapeHtml(String(cat.id))}">
          <span class="menu-category-sheet__name">${escapeHtml(String(cat.name || "Category"))}</span>
          <span class="menu-category-sheet__count">${(cat.items || []).length}</span>
        </button>
      </li>`,
    )
    .join("")
  list.querySelectorAll("[data-category-jump]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextId = String(btn.getAttribute("data-category-jump") || "")
      if (!nextId) return
      closeCategoryGallery()
      scrollToMenuCategory(nextId)
    })
  })
  root.hidden = false
  root.setAttribute("aria-hidden", "false")
  lockMenuPageScroll()
}

function closeCategoryGallery() {
  const root = $("#menu-category-gallery")
  if (!root) return
  root.hidden = true
  root.setAttribute("aria-hidden", "true")
  unlockMenuPageScroll()
}

function isMenuOverlayOpen() {
  return [
    "#menu-category-gallery",
    "#menu-image-lightbox",
    "#menu-portion-picker",
    "#menu-promotion-popup",
  ].some(
    (sel) => {
      const el = $(sel)
      return el && !el.hidden
    },
  )
}

function unlockMenuPageScroll() {
  if (isMenuOverlayOpen()) return
  document.body.style.overflow = ""
  document.body.classList.remove("menu-page-scroll-locked")
}

function lockMenuPageScroll() {
  document.body.style.overflow = "hidden"
  document.body.classList.add("menu-page-scroll-locked")
}

function bindCategoryGallery() {
  const root = $("#menu-category-gallery")
  const fab = $("#menu-category-fab")
  if (!root) return
  root.querySelectorAll("[data-category-gallery-close]").forEach((el) => {
    el.addEventListener("click", closeCategoryGallery)
  })
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !root.hidden) closeCategoryGallery()
  })
  fab?.addEventListener("click", () => openCategoryGallery())
  document.querySelectorAll(".orderkaro-logo-link, .restaurant-name-link").forEach((link) => {
    link.addEventListener("click", (ev) => {
      ev.preventDefault()
      openCategoryGallery()
    })
  })
}

function syncMenuCategoryFab(visible) {
  const fab = $("#menu-category-fab")
  if (!fab) return
  fab.hidden = !visible
}

/** Match .app-shell--menu padding to actual fixed header height (avoids a gap when the estimate is too large). */
function syncMenuHeaderHeight() {
  const el = document.querySelector(".sticky-menu-header")
  if (!el) return
  const h = Math.round(el.getBoundingClientRect().height)
  document.body.style.setProperty("--menu-sticky-header-h", `${h}px`)
}

function setupMenuHeaderHeightSync() {
  const el = document.querySelector(".sticky-menu-header")
  if (!el) return
  syncMenuHeaderHeight()
  if (menuHeaderResizeObserver) menuHeaderResizeObserver.disconnect()
  menuHeaderResizeObserver = new ResizeObserver(() => syncMenuHeaderHeight())
  menuHeaderResizeObserver.observe(el)
  window.addEventListener("resize", syncMenuHeaderHeight)
}

function setLogo(logoUrl) {
  const slots = document.querySelectorAll("[data-restaurant-logo-slot]")
  slots.forEach((el) => {
    el.innerHTML = ""
    if (!logoUrl) return
    const img = document.createElement("img")
    img.src = logoUrl
    img.alt = ""
    img.loading = "lazy"
    el.appendChild(img)
  })
}

function showError(msg) {
  const b = $("#orderkaro-error")
  if (!b) return
  b.hidden = false
  b.textContent = msg
}

function hideError() {
  const b = $("#orderkaro-error")
  if (b) b.hidden = true
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function restaurantNameFromSlug(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function setOpeningSplashTitle(name) {
  const titleEl = $(".menu-opening-splash__title", $("#menu-opening-splash") || document)
  if (!titleEl) return
  titleEl.textContent = String(name || "").trim() || "Restaurant"
}

function formatRestaurantTimeLabel(value) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  const m = raw.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return ""
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return ""
  const period = hh >= 12 ? "PM" : "AM"
  const h12 = hh % 12 || 12
  return `${h12}:${String(mm).padStart(2, "0")} ${period}`
}

function setOpeningSplashHours(restaurant) {
  const hoursEl = $("#menu-opening-splash-hours")
  if (!hoursEl) return
  const openText = formatRestaurantTimeLabel(restaurant?.openingTime)
  const closeText = formatRestaurantTimeLabel(restaurant?.closingTime)
  if (!openText || !closeText) {
    hoursEl.hidden = true
    hoursEl.textContent = ""
    return
  }
  hoursEl.hidden = false
  hoursEl.textContent = `Open ${openText} - Close ${closeText}`
}

async function showOpeningSplash(readyPromise = Promise.resolve()) {
  const overlay = $("#menu-opening-splash")
  if (!overlay) return

  overlay.hidden = false
  overlay.setAttribute("aria-hidden", "false")
  document.body.classList.add("menu-opening-splash-visible")

  await Promise.all([wait(OPENING_SPLASH_DURATION_MS), readyPromise])

  overlay.classList.add("is-hiding")
  await wait(OPENING_SPLASH_FADE_MS)
  overlay.hidden = true
  overlay.setAttribute("aria-hidden", "true")
  overlay.classList.remove("is-hiding")
  document.body.classList.remove("menu-opening-splash-visible")
}

function showSingleScreenMessage(msg) {
  teardownMenuPromotionPopup()
  const stickyCart = document.querySelector(".sticky-cart")
  const loading = $("#orderkaro-loading")
  const loadingTabs = $("#orderkaro-loading-tabs")
  const disclaimer = $("#menu-image-disclaimer")
  const errorBanner = $("#orderkaro-error")
  const sections = $("#menu-sections")
  const shell = $(".app-shell")

  if (stickyCart) stickyCart.hidden = true
  if (loading) loading.hidden = true
  if (loadingTabs) loadingTabs.hidden = true
  if (disclaimer) disclaimer.hidden = true
  syncMenuCategoryFab(false)
  if (errorBanner) {
    errorBanner.hidden = false
    errorBanner.textContent = msg
  }
  if (sections) {
    sections.innerHTML = `<p class="cart-empty" style="padding:36px 20px; text-align:center;">${escapeHtml(msg)}</p>`
  }
  if (shell) shell.setAttribute("aria-busy", "false")
  requestAnimationFrame(() => syncMenuHeaderHeight())
}

function updateSticky(cart) {
  const { count, total } = cartTotals(cart)
  const countEl = $(".sticky-cart__count")
  const totalEl = $(".sticky-cart__total")
  const link = $("#view-cart-link")
  const topCartLink = $("#top-cart-link")
  const topTrackLink = $("#top-track-link")
  if (countEl) countEl.textContent = String(count)
  if (totalEl) totalEl.textContent = formatMoney(total)
  if (link) {
    link.href = withTableQuery("cart")
    link.setAttribute("aria-disabled", count === 0 ? "true" : "false")
  }
  if (topCartLink) {
    topCartLink.href = withTableQuery("cart")
  }
  if (topTrackLink) {
    topTrackLink.href = withTableQuery("track")
  }
}

function refreshFromCart() {
  if (!menuData) return
  const ctx = resolveTableContext()
  const c = ensureCart(
    ctx.slug,
    ctx.tableNumber,
    menuData.restaurant.name,
    ctx.serviceType || menuData?.serviceType || "DINE_IN"
  )
  c.isGstEnabled = Boolean(menuData?.restaurant?.isGstEnabled)
  c.isGstInclusive = Boolean(menuData?.restaurant?.estimatedTimeSettings?.pricing?.gstInclusive)
  c.isRoundOffTotalEnabled = Boolean(menuData?.restaurant?.estimatedTimeSettings?.pricing?.roundOffTotalEnabled)
  renderMenu(menuData, c)
  updateSticky(c)
}

function isNonVegFoodType(foodType) {
  const value = String(foodType || "").toLowerCase()
  return value.includes("non") || value.includes("egg")
}

function getSelectedPortionForMenuItem(item) {
  if (!itemHasHalfFullOptions(item)) return null
  return normalizeSelectedPortion(selectedPortionsByItemId.get(String(item?.id || ""))) || "FULL"
}

function setSelectedPortionForMenuItem(itemId, portion) {
  const normalized = normalizeSelectedPortion(portion)
  if (!normalized) return
  selectedPortionsByItemId.set(String(itemId || ""), normalized)
}

function getTotalQuantityForMenuItem(cart, menuItemId) {
  if (!cart || !menuItemId) return 0
  if (!menuData) {
    return getQuantityForMenuItem(cart, menuItemId, null)
  }
  const item = findMenuItemById(menuItemId)
  if (!item || !itemHasHalfFullOptions(item)) {
    return getQuantityForMenuItem(cart, menuItemId, null)
  }
  return (
    getQuantityForMenuItem(cart, menuItemId, "HALF") +
    getQuantityForMenuItem(cart, menuItemId, "FULL")
  )
}

function findMenuItemById(menuItemId) {
  if (!menuData?.categories) return null
  const id = String(menuItemId || "")
  for (const cat of menuData.categories) {
    const hit = (cat.items || []).find((it) => String(it.id) === id)
    if (hit) return hit
  }
  return null
}

function formatMenuItemPriceLabel(item) {
  if (!itemHasHalfFullOptions(item)) {
    return formatMoney(Number(item.price || 0))
  }
  const half = Number(item.halfPrice || 0)
  const full = Number(item.fullPrice || item.price || 0)
  if (half > 0 && full > half) {
    return `${formatMoney(half)} – ${formatMoney(full)}`
  }
  return formatMoney(full)
}

let portionPickerOnSelect = null

function closePortionPicker() {
  const root = $("#menu-portion-picker")
  if (!root) return
  root.hidden = true
  root.setAttribute("aria-hidden", "true")
  portionPickerOnSelect = null
  unlockMenuPageScroll()
}

function openPortionPicker(item, onSelect, pickerOptions = {}) {
  const root = $("#menu-portion-picker")
  const titleEl = $("#menu-portion-picker-title")
  const nameEl = $("#menu-portion-picker-item")
  const optionsEl = $("#menu-portion-picker-options")
  if (!root || !optionsEl || !item) return
  const mode = pickerOptions.mode === "remove" ? "remove" : "add"
  const cart = loadCart()
  const halfQty = getQuantityForMenuItem(cart, item.id, "HALF")
  const fullQty = getQuantityForMenuItem(cart, item.id, "FULL")
  portionPickerOnSelect = typeof onSelect === "function" ? onSelect : null
  if (titleEl) {
    titleEl.textContent = mode === "remove" ? "Remove which portion?" : "Add which portion?"
  }
  if (nameEl) {
    nameEl.textContent = String(item.name || "Item")
  }
  const renderOption = (portion, price, inCartQty) => {
    const disabled = mode === "remove" && inCartQty <= 0
    const qtyHint =
      inCartQty > 0
        ? `<span class="menu-portion-picker__option-qty">In cart: ${inCartQty}</span>`
        : ""
    return `<button type="button" class="menu-portion-picker__option${
      disabled ? " is-disabled" : ""
    }" data-pick-portion="${portion}" ${disabled ? "disabled" : ""}>
      <span class="menu-portion-picker__option-label">${portion === "HALF" ? "Half" : "Full"}</span>
      <span class="menu-portion-picker__option-price">${formatMoney(price)}</span>
      ${qtyHint}
    </button>`
  }
  optionsEl.innerHTML =
    renderOption("HALF", Number(item.halfPrice || 0), halfQty) +
    renderOption("FULL", Number(item.fullPrice || item.price || 0), fullQty)
  optionsEl.querySelectorAll("[data-pick-portion]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return
      const portion = normalizeSelectedPortion(btn.getAttribute("data-pick-portion"))
      if (!portion) return
      setSelectedPortionForMenuItem(item.id, portion)
      const cb = portionPickerOnSelect
      closePortionPicker()
      if (cb) cb(portion)
    })
  })
  root.hidden = false
  root.setAttribute("aria-hidden", "false")
  lockMenuPageScroll()
}

function bindPortionPicker() {
  const root = $("#menu-portion-picker")
  if (!root) return
  root.querySelectorAll("[data-portion-picker-close]").forEach((el) => {
    el.addEventListener("click", closePortionPicker)
  })
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && root && !root.hidden) closePortionPicker()
  })
}

function isEnabledFlag(value) {
  return value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true"
}

function syncVegToggleUi() {
  const vegToggle = $("#menu-veg-only-toggle")
  if (!vegToggle) return
  vegToggle.checked = Boolean(menuVegOnly)
  vegToggle.disabled = Boolean(menuVegOnlyLocked)
  vegToggle.title = menuVegOnlyLocked
    ? "This restaurant serves pure veg only."
    : ""
}

function appendCategoryItemsToList(list, cat, cart) {
  for (const it of cat.items || []) {
    const card = document.createElement("article")
    card.className = "menu-card menu-card--editorial"
    if (!it.isAvailable) card.classList.add("menu-card--unavailable")

    const imgWrap = document.createElement("div")
    imgWrap.className = "menu-card__img"
    if (it.photoUrl) {
      const img = document.createElement("img")
      img.src = it.photoUrl
      img.alt = ""
      img.className = "menu-card__img-el menu-card__img-el--tap"
      img.loading = "lazy"
      img.addEventListener("click", () =>
        openImageLightbox(it.photoUrl, {
          name: it.name,
          description: it.description,
        }),
      )
      imgWrap.appendChild(img)
    }
    const isNonVeg = isNonVegFoodType(it.foodType)
    const dietLabel = isNonVeg ? "Non-Veg" : "Veg"
    const dietDotClass = isNonVeg ? "is-nonveg" : "is-veg"
    const hasPortions = itemHasHalfFullOptions(it)
    const qty = getTotalQuantityForMenuItem(cart, it.id)
    const priceLabel = formatMenuItemPriceLabel(it)
    const overlay = document.createElement("div")
    overlay.className = "menu-card__image-overlay"
    overlay.innerHTML =
      it.isAvailable && qty > 0
        ? `<div class="menu-card__qty-overlay">
              <button type="button" class="menu-card__qty-btn menu-card__qty-btn--dec" aria-label="Decrease quantity">
                <span class="material-symbols-outlined">remove</span>
              </button>
              <span class="menu-card__qty-val">${qty}</span>
              <button type="button" class="menu-card__qty-btn menu-card__qty-btn--inc" aria-label="Increase quantity">
                <span class="material-symbols-outlined">add</span>
              </button>
            </div>`
        : it.isAvailable
          ? `<button type="button" class="menu-card__add-btn menu-card__qty-btn--inc" aria-label="Add to cart">
              <span class="material-symbols-outlined">add</span>
            </button>`
          : `<div class="menu-card__sold-overlay">
              <div class="menu-card__sold-pill">Sold Out</div>
            </div>`
    imgWrap.appendChild(overlay)

    const body = document.createElement("div")
    body.className = "menu-card__body"
    body.innerHTML = `
      <div class="menu-card__head">
        <div class="menu-card__title-row">
          <span class="menu-card__diet-mark ${isNonVeg ? "is-nonveg" : "is-veg"}" title="${dietLabel}" aria-label="${dietLabel}">
            <span class="menu-card__diet-dot ${dietDotClass}"></span>
          </span>
          <h2 class="menu-card__title">${escapeHtml(it.name)}</h2>
        </div>
        <span class="menu-card__price">${escapeHtml(priceLabel)}</span>
      </div>
      ${!it.isAvailable ? `<p class="menu-card__status">Currently Unavailable</p>` : ""}
    `
    const decBtn = overlay.querySelector(".menu-card__qty-btn--dec")
    const incBtn = overlay.querySelector(".menu-card__qty-btn--inc")
    const addWithPortion = (portion) => {
      const normalized = normalizeSelectedPortion(portion)
      const unitPrice = getUnitPriceForMenuItem(it, normalized)
      const ctx = resolveTableContext()
      if (!menuData) return
      let c = loadCart()
      c = ensureCart(
        ctx.slug,
        ctx.tableNumber,
        menuData.restaurant.name,
        ctx.serviceType || menuData?.serviceType || "DINE_IN",
      )
      const current = getQuantityForMenuItem(c, it.id, normalized)
      setMenuItemLineQuantity(
        c,
        {
          menuItemId: it.id,
          name: it.name,
          unitPrice,
          photoUrl: it.photoUrl || null,
          foodType: it.foodType,
          selectedPortion: normalized,
        },
        current + 1,
      )
      refreshFromCart()
    }
    const setQtyForPortion = (portion, next) => {
      const normalized = normalizeSelectedPortion(portion)
      const unitPrice = getUnitPriceForMenuItem(it, normalized)
      const ctx = resolveTableContext()
      if (!menuData) return
      let c = loadCart()
      c = ensureCart(
        ctx.slug,
        ctx.tableNumber,
        menuData.restaurant.name,
        ctx.serviceType || menuData?.serviceType || "DINE_IN",
      )
      setMenuItemLineQuantity(
        c,
        {
          menuItemId: it.id,
          name: it.name,
          unitPrice,
          photoUrl: it.photoUrl || null,
          foodType: it.foodType,
          selectedPortion: normalized,
        },
        next,
      )
      refreshFromCart()
    }
    if (decBtn) {
      decBtn.disabled = !it.isAvailable || qty <= 0
      decBtn.addEventListener("click", (ev) => {
        ev.stopPropagation()
        if (!it.isAvailable || qty <= 0) return
        if (hasPortions) {
          openPortionPicker(
            it,
            (portion) => {
              const c = loadCart()
              const current = getQuantityForMenuItem(c, it.id, portion)
              if (current <= 0) return
              setQtyForPortion(portion, current - 1)
            },
            { mode: "remove" },
          )
          return
        }
        const c = loadCart()
        const current = getQuantityForMenuItem(c, it.id, null)
        if (current <= 0) return
        setQtyForPortion(null, current - 1)
      })
    }
    if (incBtn) {
      incBtn.disabled = !it.isAvailable
      incBtn.addEventListener("click", (ev) => {
        ev.stopPropagation()
        if (!it.isAvailable) return
        if (hasPortions) {
          openPortionPicker(it, (portion) => addWithPortion(portion), { mode: "add" })
          return
        }
        addWithPortion(null)
      })
    }
    if (!it.isAvailable) body.classList.add("menu-card__body--unavailable")

    card.appendChild(imgWrap)
    card.appendChild(body)
    list.appendChild(card)
  }
}

function renderCategoryBlocks(sectionsRoot, filteredCategories, cart) {
  filteredCategories.forEach((cat) => {
    const section = document.createElement("section")
    const catId = String(cat.id)
    section.className = "menu-cat-block"
    section.id = `menu-cat-${catId}`
    if (collapsedCategoryIds.has(catId)) section.classList.add("is-collapsed")

    const head = document.createElement("button")
    head.type = "button"
    head.className = "menu-cat-block__head"
    head.setAttribute("aria-expanded", collapsedCategoryIds.has(catId) ? "false" : "true")
    const count = (cat.items || []).length
    head.innerHTML = `<span class="menu-cat-block__title">${escapeHtml(cat.name)} <span class="menu-cat-block__count">(${count})</span></span><span class="material-symbols-outlined menu-cat-block__chevron" aria-hidden="true">expand_less</span>`
    head.addEventListener("click", () => {
      if (collapsedCategoryIds.has(catId)) {
        collapsedCategoryIds.delete(catId)
        section.classList.remove("is-collapsed")
        head.setAttribute("aria-expanded", "true")
      } else {
        collapsedCategoryIds.add(catId)
        section.classList.add("is-collapsed")
        head.setAttribute("aria-expanded", "false")
      }
    })

    const body = document.createElement("div")
    body.className = "menu-cat-block__body"
    const list = document.createElement("div")
    list.className = "menu-list menu-list--editorial"
    appendCategoryItemsToList(list, cat, cart)
    body.appendChild(list)
    section.appendChild(head)
    section.appendChild(body)
    sectionsRoot.appendChild(section)
  })
}

function renderMenu(data, cart) {
  if (menuVegOnlyLocked) menuVegOnly = true
  const { restaurant, tableNumber, categories } = data
  const isDelivery = String(data?.serviceType || "").toUpperCase() === "DELIVERY"
  const nameEl = $(".restaurant-name")
  if (nameEl) nameEl.textContent = restaurant.name
  setOpeningSplashTitle(restaurant.name)
  waiterCallState = data?.tableService || null
  updateTableBadge(tableNumber, isDelivery)
  setLogo(restaurant.logoUrl || null)
  applyMenuWaiterButtonState()
  wireMenuWaiterButton()

  const sections = $("#menu-sections")
  const disclaimer = $("#menu-image-disclaimer")
  if (!sections) return

  sections.classList.remove("menu-feed--enter")

  sections.innerHTML = ""
  const filteredCategories = filterMenuCategories(categories)
  syncMenuCategoryFab(filteredCategories.length > 1)
  if (disclaimer) {
    disclaimer.hidden = !filteredCategories.some((cat) =>
      Array.isArray(cat.items) && cat.items.some((it) => String(it?.photoUrl || "").trim())
    )
  }

  if (categories.length === 0) {
    const p = document.createElement("p")
    p.className = "cart-empty"
    p.style.padding = "24px 20px"
    p.textContent = "No menu published yet for this table."
    sections.appendChild(p)
    requestAnimationFrame(() => syncMenuHeaderHeight())
    return
  }

  if (filteredCategories.length === 0) {
    const p = document.createElement("p")
    p.className = "cart-empty"
    p.style.padding = "24px 20px"
    p.textContent = menuVegOnly ? "No matching veg dishes found." : "No matching dishes found."
    sections.appendChild(p)
    requestAnimationFrame(() => syncMenuHeaderHeight())
    return
  }

  renderCategoryBlocks(sections, filteredCategories, cart)
  requestAnimationFrame(() => {
    sections.classList.add("menu-feed--enter")
  })

  requestAnimationFrame(() => syncMenuHeaderHeight())
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

async function main() {
  applyRememberedThemeColor()
  unlockMenuPageScroll()
  closeCategoryGallery()
  closeImageLightbox()
  closePortionPicker()
  closeMenuPromotionPopup()
  rememberMenuPath()
  setupMenuHeaderHeightSync()
  bindImageLightbox()
  bindCategoryGallery()
  bindPortionPicker()
  bindMenuPromotionPopup()

  const loading = $("#orderkaro-loading")
  const loadingTabs = $("#orderkaro-loading-tabs")
  const shell = $(".app-shell")
  const { slug, tableNumber, serviceType } = resolveTableContext()
  if (String(serviceType || "").toUpperCase() === "DELIVERY") {
    forceHideMenuWaiterButton()
  }
  setOpeningSplashTitle(restaurantNameFromSlug(slug))
  setOpeningSplashHours(null)

  hideError()
  if (loading) loading.hidden = true
  if (loadingTabs) loadingTabs.hidden = true
  if (shell) shell.setAttribute("aria-busy", "true")

  const menuFetchPromise = fetchMenu(slug, tableNumber, serviceType)
  const splashReadyPromise = menuFetchPromise.then(
    (data) => {
      setOpeningSplashHours(data?.restaurant || null)
      return undefined
    },
    () => undefined,
  )
  await showOpeningSplash(splashReadyPromise)

  let data
  try {
    data = await menuFetchPromise
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not load menu"
    showSingleScreenMessage(msg)
    return
  }

  menuData = data
  setOpeningSplashHours(data?.restaurant || null)
  rememberThemeColor(data?.restaurant?.themeColor)
  menuVegOnlyLocked = isEnabledFlag(data?.restaurant?.pureVegOnly)
  menuVegOnly = menuVegOnlyLocked ? true : menuVegOnly
  syncVegToggleUi()
  if (data?.restaurant?.isOpenNow === false) {
    showSingleScreenMessage("Restaurant is unavailable to take orders at the moment. Please try again later.")
    return
  }
  const cart = ensureCart(slug, tableNumber, data.restaurant.name, serviceType)
  cart.isGstEnabled = Boolean(data?.restaurant?.isGstEnabled)
  cart.isGstInclusive = Boolean(data?.restaurant?.estimatedTimeSettings?.pricing?.gstInclusive)
  cart.isRoundOffTotalEnabled = Boolean(data?.restaurant?.estimatedTimeSettings?.pricing?.roundOffTotalEnabled)
  renderMenu(data, cart)
  updateSticky(cart)
  maybeShowMenuPromotionPopup(data.restaurant)
  waiterCallState = data?.tableService || null
  applyMenuWaiterButtonState()
  startMenuWaiterStatusPolling()
  const searchInput = $("#menu-search-input")
  if (searchInput) {
    searchInput.value = menuSearchText
    searchInput.addEventListener("input", () => {
      menuSearchText = String(searchInput.value || "")
      const latestCart = ensureCart(slug, tableNumber, data.restaurant.name, serviceType)
      latestCart.isGstEnabled = Boolean(data?.restaurant?.isGstEnabled)
      latestCart.isGstInclusive = Boolean(data?.restaurant?.estimatedTimeSettings?.pricing?.gstInclusive)
      latestCart.isRoundOffTotalEnabled = Boolean(
        data?.restaurant?.estimatedTimeSettings?.pricing?.roundOffTotalEnabled
      )
      renderMenu(data, latestCart)
      updateSticky(latestCart)
    })
  }
  const vegToggle = $("#menu-veg-only-toggle")
  if (vegToggle) {
    syncVegToggleUi()
    vegToggle.addEventListener("change", () => {
      if (menuVegOnlyLocked) {
        syncVegToggleUi()
        return
      }
      menuVegOnly = Boolean(vegToggle.checked)
      const latestCart = ensureCart(slug, tableNumber, data.restaurant.name, serviceType)
      latestCart.isGstEnabled = Boolean(data?.restaurant?.isGstEnabled)
      latestCart.isGstInclusive = Boolean(data?.restaurant?.estimatedTimeSettings?.pricing?.gstInclusive)
      latestCart.isRoundOffTotalEnabled = Boolean(
        data?.restaurant?.estimatedTimeSettings?.pricing?.roundOffTotalEnabled
      )
      renderMenu(data, latestCart)
      updateSticky(latestCart)
      syncVegToggleUi()
    })
  }

  if (shell) shell.setAttribute("aria-busy", "false")
  requestAnimationFrame(() => syncMenuHeaderHeight())
}

main()

window.addEventListener("beforeunload", () => {
  stopMenuWaiterStatusPolling()
})
