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
  cartTotals,
  toOrderPayload,
  clearCart,
} from "./cart-store.js"
import { formatMoney } from "./format.js"

function $(sel, root = document) {
  return root.querySelector(sel)
}

let availabilityById = new Map()

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
    return
  }

  let unavailableCount = 0
  cart.lines.forEach((line, index) => {
    const isUnavailable = availabilityById.get(String(line.menuItemId)) === false
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
  const byId = new Map(items.map((it) => [String(it.id), Boolean(it.isAvailable)]))
  return cart.lines.filter((line) => byId.get(String(line.menuItemId)) !== true)
}

async function hydrateCartLineImages(cart) {
  if (!cart || !cart.lines.length) return cart
  const menuData = await fetchMenu(cart.restaurantSlug, cart.tableNumber)
  const items = (menuData?.categories || []).flatMap((cat) => cat.items || [])
  const photoById = new Map(items.map((it) => [String(it.id), String(it.photoUrl || "")]))
  availabilityById = new Map(items.map((it) => [String(it.id), Boolean(it.isAvailable)]))
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

function main() {
  rememberCartPath()
  const { slug, tableNumber } = resolveTableContext()
  let cart = loadCart()
  if (!cart) {
    cart = ensureCart(slug, tableNumber, "")
  } else {
    cart = ensureCart(slug, tableNumber, cart.restaurantName)
  }

  render(cart)
  hydrateCartLineImages(cart)
    .then((updated) => {
      if (updated) render(updated)
    })
    .catch(() => {
      /* image hydration is best-effort */
    })

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
}

main()
