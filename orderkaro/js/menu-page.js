import { rememberMenuPath } from "./config.js"
import { resolveTableContext, withTableQuery } from "./nav.js"
import { fetchMenu } from "./api.js"
import {
  ensureCart,
  cartTotals,
  loadCart,
  getQuantityForMenuItem,
  setMenuItemLineQuantity,
} from "./cart-store.js"
import { formatMoney } from "./format.js"

function $(sel, root = document) {
  return root.querySelector(sel)
}

let menuData = null
let menuHeaderResizeObserver = null
let menuSearchText = ""
let activeCategoryId = ""
const OPENING_SPLASH_DURATION_MS = 1000
const OPENING_SPLASH_FADE_MS = 420

function openImageLightbox(src) {
  const root = $("#menu-image-lightbox")
  const img = $("#menu-image-lightbox-img")
  if (!root || !img || !src) return
  img.src = src
  root.hidden = false
  root.setAttribute("aria-hidden", "false")
  document.body.style.overflow = "hidden"
}

function closeImageLightbox() {
  const root = $("#menu-image-lightbox")
  const img = $("#menu-image-lightbox-img")
  if (!root || !img) return
  root.hidden = true
  root.setAttribute("aria-hidden", "true")
  img.removeAttribute("src")
  document.body.style.overflow = ""
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
  const stickyCart = document.querySelector(".sticky-cart")
  const loading = $("#orderkaro-loading")
  const loadingTabs = $("#orderkaro-loading-tabs")
  const disclaimer = $("#menu-image-disclaimer")
  const errorBanner = $("#orderkaro-error")
  const tabs = $("#category-tabs")
  const sections = $("#menu-sections")
  const shell = $(".app-shell")

  if (stickyCart) stickyCart.hidden = true
  if (loading) loading.hidden = true
  if (loadingTabs) loadingTabs.hidden = true
  if (disclaimer) disclaimer.hidden = true
  if (errorBanner) {
    errorBanner.hidden = false
    errorBanner.textContent = msg
  }
  if (tabs) {
    tabs.hidden = true
    tabs.innerHTML = ""
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

/** Category rail thumbnail: use category image when set, otherwise any item image in that category. */
function categoryRailThumbUrl(cat) {
  const direct = String(cat.photoUrl || "").trim()
  if (direct) return direct
  const withPhoto = (cat.items || []).find((it) => String(it.photoUrl || "").trim())
  return withPhoto ? String(withPhoto.photoUrl).trim() : ""
}

function refreshFromCart() {
  if (!menuData) return
  const ctx = resolveTableContext()
  const c = ensureCart(ctx.slug, ctx.tableNumber, menuData.restaurant.name)
  c.isGstEnabled = Boolean(menuData?.restaurant?.isGstEnabled)
  c.isGstInclusive = Boolean(menuData?.restaurant?.estimatedTimeSettings?.pricing?.gstInclusive)
  renderMenu(menuData, c)
  updateSticky(c)
}

function renderMenu(data, cart) {
  const { restaurant, tableNumber, categories } = data
  const nameEl = $(".restaurant-name")
  if (nameEl) nameEl.textContent = restaurant.name
  const badge = $(".table-badge")
  if (badge) badge.textContent = `Table ${tableNumber}`
  setLogo(restaurant.logoUrl || null)

  const tabs = $("#category-tabs")
  const sections = $("#menu-sections")
  if (!tabs || !sections) return

  sections.classList.remove("menu-feed--enter")

  tabs.innerHTML = ""
  sections.innerHTML = ""
  const q = menuSearchText.trim().toLowerCase()
  const filteredCategories = categories
    .map((cat) => {
      const items = (cat.items || []).filter((it) => {
        if (!q) return true
        const hay = `${it.name || ""} ${it.description || ""}`.toLowerCase()
        return hay.includes(q)
      })
      return { ...cat, items }
    })
    .filter((cat) => cat.items.length > 0)
  tabs.hidden = filteredCategories.length === 0

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
    p.textContent = "No matching dishes found."
    sections.appendChild(p)
    requestAnimationFrame(() => syncMenuHeaderHeight())
    return
  }

  if (!activeCategoryId || !filteredCategories.some((cat) => String(cat.id) === String(activeCategoryId))) {
    activeCategoryId = String(filteredCategories[0].id)
  }
  const activeCategory =
    filteredCategories.find((cat) => String(cat.id) === String(activeCategoryId)) || filteredCategories[0]

  filteredCategories.forEach((cat) => {
    const tab = document.createElement("button")
    tab.type = "button"
    tab.className = `category-tab category-rail__item${
      String(activeCategory.id) === String(cat.id) ? " category-tab--active" : ""
    }`
    const thumb = categoryRailThumbUrl(cat)
    tab.innerHTML = `<span class="category-rail__thumb">${
      thumb ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy" />` : ""
    }</span><span class="category-rail__name">${escapeHtml(cat.name)}</span>`
    tab.addEventListener("click", () => {
      activeCategoryId = String(cat.id)
      renderMenu(data, cart)
    })
    tabs.appendChild(tab)
  })

  const heading = document.createElement("div")
  heading.className = "menu-feed-head"
  const categoryDesc = String(activeCategory.description || "").trim()
  heading.innerHTML = `<h2>${escapeHtml(activeCategory.name)}</h2><p>${
    categoryDesc
      ? escapeHtml(categoryDesc)
      : ""
  }</p>`
  sections.appendChild(heading)

  const list = document.createElement("div")
  list.className = "menu-list menu-list--editorial"

  for (const it of activeCategory.items || []) {
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
      img.addEventListener("click", () => openImageLightbox(it.photoUrl))
      imgWrap.appendChild(img)
    }
    const foodType = String(it.foodType || "").toLowerCase()
    const isNonVeg = foodType.includes("non") || foodType.includes("egg")
    const dietLabel = isNonVeg ? "Non-Veg" : "Veg"
    const dietDotClass = isNonVeg ? "is-nonveg" : "is-veg"
    const qty = getQuantityForMenuItem(cart, it.id)
    const overlay = document.createElement("div")
    overlay.className = "menu-card__image-overlay"
    overlay.innerHTML = `
      <div class="menu-card__diet-pill">
        <span class="menu-card__diet-dot ${dietDotClass}"></span>
        <span>${dietLabel}</span>
      </div>
      ${
        it.isAvailable
          ? `<div class="menu-card__qty-overlay">
              <button type="button" class="menu-card__qty-btn menu-card__qty-btn--dec" aria-label="Decrease quantity">
                <span class="material-symbols-outlined">remove</span>
              </button>
              <span class="menu-card__qty-val">${qty}</span>
              <button type="button" class="menu-card__qty-btn menu-card__qty-btn--inc" aria-label="Increase quantity">
                <span class="material-symbols-outlined">add</span>
              </button>
            </div>`
          : `<div class="menu-card__sold-overlay">
              <div class="menu-card__sold-pill">Sold Out</div>
            </div>`
      }
    `
    imgWrap.appendChild(overlay)

    const body = document.createElement("div")
    body.className = "menu-card__body"
    const desc = String(it.description || "")
    const effectiveDesc = it.isAvailable ? desc : "Currently Unavailable"
    const showMore = it.isAvailable && effectiveDesc.length > 52
    body.innerHTML = `
      <div class="menu-card__head">
        <h2 class="menu-card__title">${escapeHtml(it.name)}</h2>
        <span class="menu-card__price">${formatMoney(it.price)}</span>
      </div>
      <p class="menu-card__desc${showMore ? " is-collapsed" : ""}">${effectiveDesc ? escapeHtml(effectiveDesc) : ""}</p>
      ${
        showMore
          ? `<button type="button" class="menu-card__more" data-more="0" data-full="${escapeHtml(
              effectiveDesc
            )}">View more</button>`
          : ""
      }
    `
    const decBtn = overlay.querySelector(".menu-card__qty-btn--dec")
    const incBtn = overlay.querySelector(".menu-card__qty-btn--inc")
    const setQty = (next) => {
      const ctx = resolveTableContext()
      if (!menuData) return
      let c = loadCart()
      c = ensureCart(ctx.slug, ctx.tableNumber, menuData.restaurant.name)
      setMenuItemLineQuantity(
        c,
        {
          menuItemId: it.id,
          name: it.name,
          unitPrice: it.price,
          photoUrl: it.photoUrl || null,
          foodType: it.foodType,
        },
        next
      )
      refreshFromCart()
    }
    if (decBtn) {
      decBtn.disabled = !it.isAvailable || qty <= 0
      decBtn.addEventListener("click", () => {
        const current = getQuantityForMenuItem(loadCart(), it.id)
        if (current <= 0) return
        setQty(current - 1)
      })
    }
    if (incBtn) {
      incBtn.disabled = !it.isAvailable
      incBtn.addEventListener("click", () => {
        const current = getQuantityForMenuItem(loadCart(), it.id)
        setQty(current + 1)
      })
    }
    if (!it.isAvailable) body.classList.add("menu-card__body--unavailable")
    body.querySelectorAll(".menu-card__more").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = body.querySelector(".menu-card__desc")
        if (!p) return
        const expanded = btn.getAttribute("data-more") === "1"
        if (expanded) {
          p.classList.add("is-collapsed")
          btn.setAttribute("data-more", "0")
          btn.textContent = "View more"
        } else {
          p.classList.remove("is-collapsed")
          btn.setAttribute("data-more", "1")
          btn.textContent = "View less"
        }
      })
    })

    card.appendChild(imgWrap)
    card.appendChild(body)
    list.appendChild(card)
  }
  sections.appendChild(list)
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
  rememberMenuPath()
  setupMenuHeaderHeightSync()
  bindImageLightbox()

  const loading = $("#orderkaro-loading")
  const loadingTabs = $("#orderkaro-loading-tabs")
  const shell = $(".app-shell")
  const { slug, tableNumber } = resolveTableContext()

  hideError()
  if (loading) loading.hidden = true
  if (loadingTabs) loadingTabs.hidden = true
  if (shell) shell.setAttribute("aria-busy", "true")

  const menuFetchPromise = fetchMenu(slug, tableNumber)
  await showOpeningSplash(menuFetchPromise.then(() => undefined, () => undefined))

  let data
  try {
    data = await menuFetchPromise
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not load menu"
    showSingleScreenMessage(msg)
    return
  }

  menuData = data
  if (data?.restaurant?.isOpenNow === false) {
    showSingleScreenMessage("Restaurant is unavailable to take orders at the moment. Please try again later.")
    return
  }
  const cart = ensureCart(slug, tableNumber, data.restaurant.name)
  cart.isGstEnabled = Boolean(data?.restaurant?.isGstEnabled)
  cart.isGstInclusive = Boolean(data?.restaurant?.estimatedTimeSettings?.pricing?.gstInclusive)
  renderMenu(data, cart)
  updateSticky(cart)
  const searchInput = $("#menu-search-input")
  if (searchInput) {
    searchInput.value = menuSearchText
    searchInput.addEventListener("input", () => {
      menuSearchText = String(searchInput.value || "")
      const latestCart = ensureCart(slug, tableNumber, data.restaurant.name)
      latestCart.isGstEnabled = Boolean(data?.restaurant?.isGstEnabled)
      latestCart.isGstInclusive = Boolean(data?.restaurant?.estimatedTimeSettings?.pricing?.gstInclusive)
      renderMenu(data, latestCart)
      updateSticky(latestCart)
    })
  }

  if (shell) shell.setAttribute("aria-busy", "false")
  requestAnimationFrame(() => syncMenuHeaderHeight())
}

main()
