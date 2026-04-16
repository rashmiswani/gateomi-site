import { LAST_ORDER_ID_KEY, rememberMenuPath } from "./config.js"
import { resolveTableContext, withTableQuery } from "./nav.js"
import { fetchMenu } from "./api.js"
import { loadDayOrders } from "./order-day-history.js"
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

function updateSticky(cart) {
  const { count, total } = cartTotals(cart)
  const countEl = $(".sticky-cart__count")
  const totalEl = $(".sticky-cart__total")
  const link = $("#view-cart-link") || $(".sticky-cart a.btn--primary")
  if (countEl) countEl.textContent = count === 1 ? "1 item" : `${count} items`
  if (totalEl) totalEl.textContent = formatMoney(total)
  if (link) {
    link.href = withTableQuery("cart.html")
    link.setAttribute("aria-disabled", count === 0 ? "true" : "false")
  }
  const trackLink = $("#track-order-link")
  if (trackLink) {
    const ctx = resolveTableContext()
    const recent = loadDayOrders(ctx.slug, ctx.tableNumber).orderIds
    let orderId = recent.length ? recent[recent.length - 1] : ""
    if (!orderId) {
      try {
        orderId = sessionStorage.getItem(LAST_ORDER_ID_KEY) || ""
      } catch {
        orderId = ""
      }
    }
    const u = new URL(withTableQuery("track.html"), window.location.href)
    if (orderId) u.searchParams.set("orderId", orderId)
    trackLink.href = `${u.pathname}${u.search}`
  }
}

function scrollToCategory(id) {
  const el = document.getElementById(`cat-${id}`)
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
}

function refreshFromCart() {
  if (!menuData) return
  const ctx = resolveTableContext()
  const c = ensureCart(ctx.slug, ctx.tableNumber, menuData.restaurant.name)
  renderMenu(menuData, c)
  updateSticky(c)
}

/** Always show − / qty / + for available items (qty 0: − disabled, use + to add). */
function buildMenuItemActions(it, cart) {
  const wrap = document.createElement("div")
  wrap.className = "menu-card__actions"

  if (!it.isAvailable) {
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "btn btn--primary btn--sm"
    btn.textContent = "Unavailable"
    btn.disabled = true
    wrap.appendChild(btn)
    return wrap
  }

  const qty = getQuantityForMenuItem(cart, it.id)

  const group = document.createElement("div")
  group.className = "qty-control qty-control--menu"
  group.setAttribute("role", "group")
  group.setAttribute("aria-label", `Quantity for ${it.name}`)

  const dec = document.createElement("button")
  dec.type = "button"
  dec.className = "qty-btn qty-btn--sm"
  dec.setAttribute("aria-label", "Decrease quantity")
  dec.textContent = "−"
  dec.disabled = qty <= 0

  const val = document.createElement("span")
  val.className = "qty-val"
  val.textContent = String(qty)

  const inc = document.createElement("button")
  inc.type = "button"
  inc.className = "qty-btn qty-btn--sm"
  inc.setAttribute("aria-label", "Increase quantity")
  inc.textContent = "+"

  const applyQty = (next) => {
    const ctx = resolveTableContext()
    if (!menuData) return
    let c = loadCart()
    c = ensureCart(ctx.slug, ctx.tableNumber, menuData.restaurant.name)
    setMenuItemLineQuantity(
      c,
      { menuItemId: it.id, name: it.name, unitPrice: it.price },
      next
    )
    refreshFromCart()
  }

  dec.addEventListener("click", () => {
    const ctx = resolveTableContext()
    if (!menuData) return
    let c = loadCart()
    c = ensureCart(ctx.slug, ctx.tableNumber, menuData.restaurant.name)
    const current = getQuantityForMenuItem(c, it.id)
    if (current <= 0) return
    applyQty(current - 1)
  })

  inc.addEventListener("click", () => {
    const ctx = resolveTableContext()
    if (!menuData) return
    let c = loadCart()
    c = ensureCart(ctx.slug, ctx.tableNumber, menuData.restaurant.name)
    const current = getQuantityForMenuItem(c, it.id)
    applyQty(current + 1)
  })

  group.appendChild(dec)
  group.appendChild(val)
  group.appendChild(inc)
  wrap.appendChild(group)
  return wrap
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

  filteredCategories.forEach((cat, i) => {
    const tab = document.createElement("button")
    tab.type = "button"
    tab.className = `category-tab${i === 0 ? " category-tab--active" : ""}`
    tab.textContent = cat.name
    tab.addEventListener("click", () => {
      tabs.querySelectorAll(".category-tab").forEach((t) => t.classList.remove("category-tab--active"))
      tab.classList.add("category-tab--active")
      scrollToCategory(cat.id)
    })
    tabs.appendChild(tab)

    const label = document.createElement("p")
    label.className = "section-label"
    label.id = `cat-${cat.id}`
    label.textContent = cat.name
    sections.appendChild(label)

    const list = document.createElement("div")
    list.className = "menu-list"

    for (const it of cat.items || []) {
      const card = document.createElement("article")
      card.className = "menu-card"
      if (!it.isAvailable) card.classList.add("menu-card--unavailable")

      const imgWrap = document.createElement("div")
      imgWrap.className = "menu-card__img"
      if (it.photoUrl) {
        const img = document.createElement("img")
        img.src = it.photoUrl
        img.alt = ""
        img.className = "menu-card__img-el"
        img.loading = "lazy"
        imgWrap.appendChild(img)
      }

      const body = document.createElement("div")
      body.className = "menu-card__body"
      body.innerHTML = `
        <h2 class="menu-card__title">${escapeHtml(it.name)}</h2>
        <p class="menu-card__desc">${it.description ? escapeHtml(it.description) : ""}</p>
        <div class="menu-card__row">
          <span class="menu-card__price">${formatMoney(it.price)}</span>
        </div>
      `
      const row = body.querySelector(".menu-card__row")
      const actions = buildMenuItemActions(it, cart)
      if (row) row.appendChild(actions)

      card.appendChild(imgWrap)
      card.appendChild(body)
      list.appendChild(card)
    }
    sections.appendChild(list)
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

  const loading = $("#orderkaro-loading")
  const loadingTabs = $("#orderkaro-loading-tabs")
  const shell = $(".app-shell")
  const { slug, tableNumber } = resolveTableContext()

  hideError()
  if (loading) loading.hidden = false
  if (loadingTabs) loadingTabs.hidden = false
  if (shell) shell.setAttribute("aria-busy", "true")

  let data
  try {
    data = await fetchMenu(slug, tableNumber)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not load menu"
    showError(msg)
    if (loading) loading.hidden = true
    if (loadingTabs) loadingTabs.hidden = true
    if (shell) shell.setAttribute("aria-busy", "false")
    requestAnimationFrame(() => syncMenuHeaderHeight())
    return
  }

  menuData = data
  const cart = ensureCart(slug, tableNumber, data.restaurant.name)
  renderMenu(data, cart)
  updateSticky(cart)
  const searchInput = $("#menu-search-input")
  if (searchInput) {
    searchInput.value = menuSearchText
    searchInput.addEventListener("input", () => {
      menuSearchText = String(searchInput.value || "")
      const latestCart = ensureCart(slug, tableNumber, data.restaurant.name)
      renderMenu(data, latestCart)
      updateSticky(latestCart)
    })
  }

  if (loading) loading.hidden = true
  if (loadingTabs) loadingTabs.hidden = true
  if (shell) shell.setAttribute("aria-busy", "false")
  requestAnimationFrame(() => syncMenuHeaderHeight())
}

main()
