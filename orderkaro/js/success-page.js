import { withTableQuery, resolveTableContext } from "./nav.js"
import { formatMoney, formatOrderId, formatTrackDateTime } from "./format.js"
import { LAST_ORDER_ID_KEY, rememberSuccessPath } from "./config.js"
import { appendDayOrderId } from "./order-day-history.js"
import { fetchOrder } from "./api.js"
import { itemDietPillHtml } from "./diet.js"

function getOrderIdFromUrl() {
  try {
    const u = new URL(window.location.href)
    return u.searchParams.get("orderId") || ""
  } catch {
    return ""
  }
}

function getShortIdFromUrl() {
  try {
    const u = new URL(window.location.href)
    return u.searchParams.get("shortId") || ""
  } catch {
    return ""
  }
}

async function main() {
  rememberSuccessPath()

  const fromUrl = getOrderIdFromUrl()
  const shortId = getShortIdFromUrl()
  let id = fromUrl
  if (!id) {
    try {
      id = sessionStorage.getItem(LAST_ORDER_ID_KEY) || ""
    } catch {
      /* ignore */
    }
  } else {
    try {
      sessionStorage.setItem(LAST_ORDER_ID_KEY, id)
    } catch {
      /* ignore */
    }
  }

  if (id) {
    const { slug, tableNumber } = resolveTableContext()
    appendDayOrderId(slug, tableNumber, id)
  }

  if (id && !fromUrl) {
    try {
      const u = new URL(window.location.href)
      u.searchParams.set("orderId", id)
      window.history.replaceState(null, "", u.pathname + u.search + u.hash)
    } catch {
      /* ignore */
    }
  }

  const numEl = document.querySelector(".order-number")
  if (numEl) numEl.textContent = formatOrderId(shortId || id)

  const track = document.querySelector("#success-track-link")
  if (track) {
    const u = new URL(withTableQuery("track.html"), window.location.href)
    if (id) u.searchParams.set("orderId", id)
    track.href = u.pathname + u.search
  }

  const orderAgain = document.querySelector("#success-order-again-link")
  const closeLink = document.querySelector("#success-close-link")
  const menuHref = withTableQuery("menu.html")
  if (orderAgain) orderAgain.href = menuHref
  if (closeLink) closeLink.href = menuHref

  const totalEl = document.querySelector("#success-total")
  const orderedAtEl = document.querySelector("#success-ordered-at")
  const list = document.querySelector("#success-items-list")
  if (!id || !list) return
  try {
    const order = await fetchOrder(id)
    const items = Array.isArray(order?.items) ? order.items : []
    const subtotal = items.reduce((sum, line) => {
      const qty = Number(line?.quantity || 0)
      const unit = Number(line?.unitPrice || 0)
      return sum + qty * unit
    }, 0)
    if (totalEl) totalEl.textContent = formatMoney(subtotal)
    if (orderedAtEl) orderedAtEl.textContent = formatTrackDateTime(order?.createdAt || "")
    list.innerHTML = ""
    items.forEach((line) => {
      const li = document.createElement("li")
      li.innerHTML = `
        <div class="success-line__main">
          <span class="success-line__qty">${Number(line?.quantity || 0)}×</span>
          <strong class="success-line__title">${itemDietPillHtml(line?.foodType)}${escapeHtml(String(line?.itemName || "Item"))}</strong>
        </div>
        <span>${formatMoney(Number(line?.unitPrice || 0) * Number(line?.quantity || 0))}</span>
      `
      list.appendChild(li)
    })
  } catch {
    if (totalEl) totalEl.textContent = "—"
    if (orderedAtEl) orderedAtEl.textContent = "—"
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

main()
