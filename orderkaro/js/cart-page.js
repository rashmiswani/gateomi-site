import { rememberCartPath, LAST_ORDER_ID_KEY } from "./config.js"
import { appendDayOrderId } from "./order-day-history.js"
import { resolveTableContext, withTableQuery } from "./nav.js"
import { createOrder } from "./api.js"
import {
  loadCart,
  ensureCart,
  saveCart,
  setLineQuantity,
  setLineNote,
  cartTotals,
  toOrderPayload,
  clearCart,
} from "./cart-store.js"
import { formatMoney } from "./format.js"

function $(sel, root = document) {
  return root.querySelector(sel)
}

function render(cart) {
  const mount = $("#cart-mount")
  const meta = $(".page-header__meta")
  const totalAmount = $(".total-row__amount")
  const nameEl = $(".restaurant-name")

  if (nameEl) nameEl.textContent = "Your order"
  if (meta) meta.textContent = `${cart.restaurantName || "Restaurant"} · Table ${cart.tableNumber}`

  const addLink = $('a[href*="menu"]')
  if (addLink) addLink.href = withTableQuery("menu.html")

  if (!mount) return
  mount.innerHTML = ""

  if (cart.lines.length === 0) {
    mount.innerHTML = `<p class="cart-empty">Your cart is empty. <a class="text-link" href="${withTableQuery("menu.html")}">Browse menu</a></p>`
    if (totalAmount) totalAmount.textContent = formatMoney(0)
    const btn = $("#place-order-btn")
    if (btn) {
      btn.disabled = true
      btn.textContent = "Place order"
    }
    return
  }

  cart.lines.forEach((line, index) => {
    const row = document.createElement("div")
    row.className = "cart-row"
    row.innerHTML = `
      <div class="cart-row__top">
        <div>
          <h2 class="cart-row__name"></h2>
          <p class="cart-row__line"></p>
        </div>
      </div>
      <div class="qty-row">
        <div class="qty-control" role="group" aria-label="Quantity">
          <button type="button" class="qty-btn" data-act="dec" aria-label="Decrease">−</button>
          <span class="qty-val"></span>
          <button type="button" class="qty-btn" data-act="inc" aria-label="Increase">+</button>
        </div>
        <span class="menu-card__price line-total"></span>
      </div>
      <label class="visually-hidden" for="note-${index}">Note</label>
      <textarea id="note-${index}" class="note-field" rows="2" placeholder="Note for kitchen (optional)"></textarea>
    `
    row.querySelector(".cart-row__name").textContent = line.name
    row.querySelector(".cart-row__line").textContent = `${formatMoney(line.unitPrice)} each`
    row.querySelector(".qty-val").textContent = String(line.quantity)
    row.querySelector(".line-total").textContent = formatMoney(line.quantity * line.unitPrice)
    const ta = row.querySelector("textarea")
    ta.value = line.note || ""

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
    ta.addEventListener("change", () => {
      const c = loadCart()
      if (c) setLineNote(c, index, ta.value)
    })

    mount.appendChild(row)
  })

  const { total } = cartTotals(cart)
  if (totalAmount) totalAmount.textContent = formatMoney(total)
  const btn = $("#place-order-btn")
  if (btn) {
    btn.disabled = false
    btn.textContent = "Place order"
  }
}

async function placeOrder(cart) {
  const btn = $("#place-order-btn")
  if (!btn || cart.lines.length === 0) return
  btn.disabled = true
  btn.textContent = "Placing…"
  try {
    const payload = toOrderPayload(cart)
    const res = await createOrder(payload)
    clearCart()
    const id = res && res.orderId ? res.orderId : ""
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
    const qs = id ? `${sep}orderId=${encodeURIComponent(id)}` : ""
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
