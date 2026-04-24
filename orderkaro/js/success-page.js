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

const BREAD_ITEM_HINTS = [
  "roti",
  "naan",
  "bread",
  "kulcha",
  "paratha",
  "chapati",
  "phulka",
  "roomali",
]

function orderHasBreadItems(order) {
  const items = Array.isArray(order?.items) ? order.items : []
  return items.some((line) => {
    const name = String(line?.itemName || "").toLowerCase()
    return BREAD_ITEM_HINTS.some((k) => name.includes(k))
  })
}

function isActiveOrderStatus(status) {
  const s = String(status || "").toUpperCase()
  return s === "NEW" || s === "ORDER_PLACED" || s === "ACCEPTED" || s === "PREPARING" || s === "READY"
}

async function maybeShowBreadReorderBrowserNotice(order) {
  if (!orderHasBreadItems(order) || !isActiveOrderStatus(order?.status)) return
  if (typeof window === "undefined" || typeof Notification === "undefined") return
  const orderKey = String(order?.id || order?.shortId || "")
  if (!orderKey) return
  const storageKey = `orderkaro_bread_notice_${orderKey}`
  try {
    if (sessionStorage.getItem(storageKey) === "1") return
  } catch {
    /* ignore */
  }
  const show = () => {
    try {
      new Notification("Need extra bread/roti/naan?", {
        body: "Order now if needed, it can take 5-10 more minutes.",
        tag: storageKey,
      })
      sessionStorage.setItem(storageKey, "1")
    } catch {
      /* ignore */
    }
  }
  if (Notification.permission === "granted") {
    show()
    return
  }
  if (Notification.permission === "default") {
    try {
      const next = await Notification.requestPermission()
      if (next === "granted") show()
    } catch {
      /* ignore */
    }
  }
}

function mountEstimateCountdown(container, estimatedReadyAt, status) {
  if (!container || !estimatedReadyAt) return
  const end = new Date(estimatedReadyAt).getTime()
  if (!Number.isFinite(end)) return
  const card = document.createElement("section")
  card.className = "success-estimate-hero"
  card.innerHTML = `
    <span class="success-estimate-hero__label">Estimated Ready In</span>
    <div class="success-estimate-hero__row">
      <span class="material-symbols-outlined" aria-hidden="true">schedule</span>
      <p id="success-estimate-countdown">—</p>
    </div>
  `
  container.insertAdjacentElement("afterend", card)
  const el = card.querySelector("#success-estimate-countdown")
  const currentStatus = String(status || "").toUpperCase()
  if (currentStatus === "SERVED") {
    el.textContent = "Served"
    return
  }
  if (currentStatus === "PAID" || currentStatus === "COMPLETED" || currentStatus === "CANCELLED") {
    el.textContent = "Closed"
    return
  }
  const tick = () => {
    const leftMs = end - Date.now()
    if (leftMs <= 0) {
      el.textContent = "Any moment now"
      return
    }
    const sec = Math.floor(leftMs / 1000)
    const mm = Math.floor(sec / 60)
    const ss = sec % 60
    el.textContent = `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
  }
  tick()
  const timer = window.setInterval(tick, 1000)
  window.addEventListener("beforeunload", () => window.clearInterval(timer), { once: true })
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
    const u = new URL(withTableQuery("track"), window.location.href)
    if (id) u.searchParams.set("orderId", id)
    track.href = u.pathname + u.search
  }

  const orderAgain = document.querySelector("#success-order-again-link")
  const closeLink = document.querySelector("#success-close-link")
  const menuHref = withTableQuery("menu")
  if (orderAgain) orderAgain.href = menuHref
  if (closeLink) closeLink.href = menuHref

  const totalEl = document.querySelector("#success-total")
  const orderedAtEl = document.querySelector("#success-ordered-at")
  const list = document.querySelector("#success-items-list")
  if (!id || !list) return
  try {
    const order = await fetchOrder(id)
    await maybeShowBreadReorderBrowserNotice(order)
    mountEstimateCountdown(document.querySelector(".success-status-ref"), order?.estimatedReadyAt, order?.status)
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
