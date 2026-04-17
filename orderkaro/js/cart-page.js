import { rememberCartPath, LAST_ORDER_ID_KEY } from "./config.js"
import { appendDayOrderId } from "./order-day-history.js"
import { resolveTableContext, withTableQuery } from "./nav.js"
import { createOrder, fetchMenu } from "./api.js"
import {
  loadCart,
  ensureCart,
  saveCart,
  setLineQuantity,
  setSpecialInstructions,
  setMenuItemLineQuantity,
  cartTotals,
  toOrderPayload,
  clearCart,
} from "./cart-store.js"
import { formatMoney } from "./format.js"

function $(sel, root = document) {
  return root.querySelector(sel)
}

let availabilityById = new Map()
/** Latest menu payload from `fetchMenu` — used for cart upsells / combos / pairings. */
let lastMenuData = null

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
  return /\b(combo|thali|platter|bundle|brought together|meal deal|set menu|fixed|together|pair\s+with)\b/i.test(
    t
  )
}

function isPairingCategoryHint(it) {
  return /beverage|drink|juice|wine|coffee|tea|dessert|sweet|bread|soup|starter|appetizer|side|salad|rice|naan/i.test(
    `${it.categoryName || ""} ${it.name || ""}`
  )
}

/**
 * Suggest items not already in cart: combo-like names, cross-category “pairs”, then general upsell.
 * All suggestions respect `isAvailable` only (same as menu).
 */
function buildCartSuggestionGroups(cart, menuData) {
  const flat = flattenMenuItems(menuData)
  const inCart = new Set(cart.lines.map((l) => String(l.menuItemId)))
  const cartCategoryIds = new Set()
  for (const line of cart.lines) {
    const found = flat.find((x) => String(x.id) === String(line.menuItemId))
    if (found) cartCategoryIds.add(found.categoryId)
  }
  const pool = flat.filter((it) => it.isAvailable && !inCart.has(String(it.id)))
  const used = new Set()

  const combos = []
  for (const it of pool) {
    if (combos.length >= 8) break
    if (!isComboLikeItem(it)) continue
    combos.push(it)
    used.add(String(it.id))
  }

  const pairs = []
  for (const it of pool) {
    if (pairs.length >= 8) break
    if (used.has(String(it.id))) continue
    const cross =
      cartCategoryIds.size > 0 ? !cartCategoryIds.has(it.categoryId) : false
    const hint = isPairingCategoryHint(it)
    if (cross || hint) {
      pairs.push(it)
      used.add(String(it.id))
    }
  }

  const upsells = []
  const rest = pool.filter((it) => !used.has(String(it.id)))
  rest.sort((a, b) => Number(a.price) - Number(b.price))
  for (const it of rest) {
    if (upsells.length >= 8) break
    upsells.push(it)
    used.add(String(it.id))
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
      <h4 class="cart-suggest-card__name">${escapeHtml(it.name || "Item")}</h4>
      <div class="cart-suggest-card__row">
        <span class="cart-suggest-card__price">${formatMoney(Number(it.price))}</span>
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
      setMenuItemLineQuantity(
        c,
        {
          menuItemId: it.id,
          name: it.name,
          unitPrice: Number(it.price),
          photoUrl: it.photoUrl || null,
        },
        getQtyForItem(c, id) + 1
      )
      void hydrateCartLineImages(loadCart() || c).then((updated) => {
        render(updated || loadCart() || c)
      })
    })
  })
}

function getQtyForItem(cart, menuItemId) {
  const line = cart.lines.find((l) => String(l.menuItemId) === String(menuItemId))
  return line ? line.quantity : 0
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
  if (combos.length) {
    blocks.push(`<section class="cart-suggest-block" aria-label="Combos and bundles">
      <h3 class="cart-suggest-block__label">Combos &amp; bundles</h3>
      <p class="cart-suggest-block__hint">Meals and sets that go together</p>
      <div class="cart-suggest-strip">${combos.map(renderSuggestionCard).join("")}</div>
    </section>`)
  }
  if (pairs.length) {
    blocks.push(`<section class="cart-suggest-block" aria-label="You might like">
      <h3 class="cart-suggest-block__label">You might like</h3>
      <p class="cart-suggest-block__hint">Drinks, sides &amp; more picked for your order</p>
      <div class="cart-suggest-strip">${pairs.map(renderSuggestionCard).join("")}</div>
    </section>`)
  }
  if (upsells.length) {
    blocks.push(`<section class="cart-suggest-block" aria-label="Add to your order">
      <h3 class="cart-suggest-block__label">Add to your order</h3>
      <p class="cart-suggest-block__hint">Popular add-ons &amp; small plates</p>
      <div class="cart-suggest-strip">${upsells.map(renderSuggestionCard).join("")}</div>
    </section>`)
  }
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
  const gstRow = $("#summary-gst-row")
  const gstEl = $("#summary-gst")
  const totalEl = $("#summary-total")
  const summary = $("#cart-summary")
  const globalNote = $("#special-instructions")
  const unavailableBanner = $("#cart-unavailable-banner")

  if (topName) topName.textContent = cart.restaurantName || "Restaurant"
  if (topTable) topTable.textContent = `Table ${cart.tableNumber}`

  const addLinks = [$("#top-add-link"), $("#bottom-menu-link")].filter(Boolean)
  addLinks.forEach((a) => {
    a.href = withTableQuery("menu.html")
  })
  const orderLink = $("#bottom-order-link")
  if (orderLink) orderLink.href = withTableQuery("track.html")

  if (!mount) return
  mount.innerHTML = ""
  if (globalNote) {
    globalNote.value = cart.specialInstructions || ""
  }

  if (cart.lines.length === 0) {
    mount.innerHTML = `<p class="cart-empty">Your cart is empty. <a class="text-link" href="${withTableQuery("menu.html")}">Browse menu</a></p>`
    if (summary) summary.hidden = true
    if (subtotalEl) subtotalEl.textContent = formatMoney(0)
    if (gstEl) gstEl.textContent = formatMoney(0)
    if (gstRow) gstRow.hidden = true
    if (totalEl) totalEl.textContent = formatMoney(0)
    if (unavailableBanner) unavailableBanner.hidden = true
    const btn = $("#place-order-btn")
    if (btn) {
      btn.disabled = true
      btn.textContent = "Place order"
    }
    renderSuggestionSections(cart)
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
              <h2 class="cart-row__name"></h2>
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
  const gst = total * gstRate
  const grandTotal = total + gst
  if (summary) summary.hidden = false
  if (unavailableBanner) unavailableBanner.hidden = unavailableCount === 0
  if (subtotalEl) subtotalEl.textContent = formatMoney(total)
  if (gstEl) gstEl.textContent = formatMoney(gst)
  if (gstRow) gstRow.hidden = !cart.isGstEnabled
  if (totalEl) totalEl.textContent = formatMoney(grandTotal)
  const btn = $("#place-order-btn")
  if (btn) {
    btn.disabled = unavailableCount > 0
    btn.textContent = "Place order"
  }

  renderSuggestionSections(cart)
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
    return cart
  }
  const menuData = await fetchMenu(cart.restaurantSlug, cart.tableNumber)
  lastMenuData = menuData
  const items = (menuData?.categories || []).flatMap((cat) => cat.items || [])
  const photoById = new Map(items.map((it) => [String(it.id), String(it.photoUrl || "")]))
  const nextAvailability = new Map()
  items.forEach((it) => {
    if (typeof it?.isAvailable !== "boolean") return
    nextAvailability.set(String(it.id), it.isAvailable)
  })
  availabilityById = nextAvailability
  let changed = false
  const gstEnabled = Boolean(menuData?.restaurant?.isGstEnabled)
  if (cart.isGstEnabled !== gstEnabled) {
    cart.isGstEnabled = gstEnabled
    changed = true
  }
  cart.lines.forEach((line) => {
    if (line.photoUrl) return
    const photoUrl = photoById.get(String(line.menuItemId)) || ""
    if (!photoUrl) return
    line.photoUrl = photoUrl
    changed = true
  })
  if (changed) saveCart(cart)
  return cart
}

async function placeOrder(cart) {
  const btn = $("#place-order-btn")
  if (!btn || cart.lines.length === 0) return
  btn.disabled = true
  btn.textContent = "Placing…"
  try {
    const latestMenu = await fetchMenu(cart.restaurantSlug, cart.tableNumber)
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
    const base = withTableQuery("success.html")
    const sep = base.includes("?") ? "&" : "?"
    let qs = id ? `${sep}orderId=${encodeURIComponent(id)}` : ""
    if (shortId) {
      const sep2 = qs ? "&" : sep
      qs += `${sep2}shortId=${encodeURIComponent(shortId)}`
    }
    window.location.href = `${base}${qs}`
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not place order"
    alert(msg)
    btn.disabled = false
    btn.textContent = "Place order"
  }
}

async function main() {
  rememberCartPath()
  const { slug, tableNumber } = resolveTableContext()
  let cart = loadCart()
  if (!cart) {
    cart = ensureCart(slug, tableNumber, "")
  } else {
    cart = ensureCart(slug, tableNumber, cart.restaurantName)
  }

  try {
    const updated = await hydrateCartLineImages(cart)
    render(updated || cart)
  } catch {
    /* if menu fetch fails, clear availability map to avoid stale warnings */
    availabilityById = new Map()
    render(cart)
  }

  const globalNote = $("#special-instructions")
  if (globalNote) {
    globalNote.addEventListener("change", () => {
      const c = loadCart()
      if (!c) return
      setSpecialInstructions(c, globalNote.value)
    })
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
    } catch {
      availabilityById = new Map()
      render(c)
    }
  })
}

main()
