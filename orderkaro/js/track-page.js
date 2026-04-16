import { getTableContext, LAST_ORDER_ID_KEY, rememberTrackPath } from "./config.js"
import { appendDayOrderId, loadDayOrders } from "./order-day-history.js"
import { withTableQuery } from "./nav.js"
import { fetchOrder } from "./api.js"
import { formatOrderId, formatTrackDateTime } from "./format.js"
import { ensureCart, saveCart } from "./cart-store.js"

function getOrderId() {
  try {
    const u = new URL(window.location.href)
    return u.searchParams.get("orderId") || ""
  } catch {
    return ""
  }
}

const LABELS = {
  NEW: "New",
  ACCEPTED: "Accepted",
  PREPARING: "Preparing",
  SERVED: "Served",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
}

function statusPillText(status) {
  return LABELS[status] || status
}

const HOPE_MESSAGES = {
  NEW: "Your order is in. The kitchen will pick it up soon — your food is on the way.",
  ACCEPTED: "The restaurant has your order. Cooking will start shortly — hang tight!",
  PREPARING: "Your meal is being prepared fresh. It won't be long now.",
  SERVED: "Your order is heading to your table. Enjoy every bite!",
  COMPLETED: "Thanks for dining with us. We hope you loved it!",
  CANCELLED: "This order was cancelled.",
}

function hopeMessage(status) {
  return HOPE_MESSAGES[status] || HOPE_MESSAGES.NEW
}

/** Map API fields to the three customer-facing steps (times may be null for older orders). */
function stepTimes(data) {
  const placed = data.createdAt || null
  const step0 = placed
  const step1 = data.preparingAt || data.acceptedAt || null
  const step2 = data.servedAt || null
  return [step0, step1, step2]
}

/** Three steps: New → Preparing → Served */
function applyTimeline(status) {
  const steps = document.querySelectorAll(".timeline__step")
  if (steps.length < 3) return

  const set = (i, state) => {
    const el = steps[i]
    el.classList.remove("timeline__step--done", "timeline__step--current", "timeline__step--pending")
    el.classList.add(`timeline__step--${state}`)
  }

  if (status === "CANCELLED") {
    set(0, "pending")
    set(1, "pending")
    set(2, "pending")
    return
  }

  if (status === "NEW") {
    set(0, "current")
    set(1, "pending")
    set(2, "pending")
  } else if (status === "ACCEPTED" || status === "PREPARING") {
    set(0, "done")
    set(1, "current")
    set(2, "pending")
  } else if (status === "SERVED") {
    set(0, "done")
    set(1, "done")
    set(2, "current")
  } else if (status === "COMPLETED") {
    set(0, "done")
    set(1, "done")
    set(2, "done")
  }
}

function renderOrder(data) {
  const { slug } = getTableContext()
  const nameEl = document.querySelector(".brand-name--sub")
  if (nameEl) {
    nameEl.textContent = slug
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  }

  const num = document.querySelector(".track-order-num")
  if (num) num.textContent = formatOrderId(data.shortId || data.id)

  const hope = document.getElementById("track-hope")
  if (hope) hope.textContent = hopeMessage(data.status)

  const placedEl = document.getElementById("track-placed-time")
  if (placedEl) {
    const placedIso = data.createdAt || ""
    placedEl.textContent = formatTrackDateTime(placedIso)
    if (placedIso) placedEl.setAttribute("datetime", placedIso)
    else placedEl.removeAttribute("datetime")
  }

  const times = stepTimes(data)
  document.querySelectorAll(".timeline__time").forEach((el) => {
    const i = Number(el.getAttribute("data-step-time"))
    const iso = times[i]
    el.textContent = formatTrackDateTime(iso || "")
  })

  const pill = document.querySelector(".status-pill")
  if (pill) {
    pill.classList.remove("status-pill--danger")
    if (data.status === "CANCELLED") {
      pill.textContent = "Cancelled"
      pill.classList.add("status-pill--danger")
    } else {
      pill.textContent = statusPillText(data.status)
    }
  }

  if (data.status === "CANCELLED") {
    applyTimeline("CANCELLED")
  } else {
    applyTimeline(data.status)
  }
}

let timer = null
let latestOrder = null

async function poll(orderId) {
  try {
    const data = await fetchOrder(orderId)
    latestOrder = data
    renderOrder(data)
  } catch (e) {
    const err = document.querySelector("#orderkaro-error")
    if (err) {
      err.hidden = false
      err.textContent = e instanceof Error ? e.message : "Could not load order"
    }
  }
}

function wireOrderAgain() {
  const btn = document.getElementById("order-again-btn")
  if (!btn) return
  btn.addEventListener("click", () => {
    const { slug, tableNumber } = getTableContext()
    if (!latestOrder || !Array.isArray(latestOrder.items) || latestOrder.items.length === 0) {
      const err = document.querySelector("#orderkaro-error")
      if (err) {
        err.hidden = false
        err.textContent = "This order has no items to reorder."
      }
      return
    }

    const restaurantName =
      slug
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ") || "Restaurant"

    const cart = ensureCart(slug, tableNumber, restaurantName)
    cart.lines = latestOrder.items
      .filter((l) => l && l.menuItemId && Number(l.quantity) > 0)
      .map((l) => ({
        menuItemId: l.menuItemId,
        name: l.itemName || "Item",
        unitPrice: Number(l.unitPrice || 0),
        quantity: Math.max(1, Math.floor(Number(l.quantity || 1))),
        note: l.note ? String(l.note) : "",
      }))
    saveCart(cart)
    window.location.href = withTableQuery("cart.html")
  })
}

function renderMyOrdersList(slug, tableNumber, currentOrderId) {
  const wrap = document.getElementById("my-orders-today")
  const list = document.getElementById("my-orders-today-list")
  if (!wrap || !list) return
  const { orderIds } = loadDayOrders(slug, tableNumber)
  if (orderIds.length === 0) {
    wrap.hidden = true
    return
  }
  wrap.hidden = false
  list.innerHTML = orderIds
    .map((oid) => {
      const u = new URL(withTableQuery("track.html"), window.location.href)
      u.searchParams.set("orderId", oid)
      const active = oid === currentOrderId ? " my-orders-today__link--active" : ""
      return `<li class="my-orders-today__item"><a class="my-orders-today__link${active}" href="${u.pathname}${u.search}">${formatOrderId(oid)}</a></li>`
    })
    .join("")
}

function main() {
  rememberTrackPath()

  const { slug, tableNumber } = getTableContext()

  const fromUrl = getOrderId()
  const hadUrl = !!fromUrl
  let orderId = fromUrl
  if (!orderId) {
    try {
      orderId = sessionStorage.getItem(LAST_ORDER_ID_KEY) || ""
    } catch {
      /* ignore */
    }
  }
  if (!orderId) {
    const { orderIds } = loadDayOrders(slug, tableNumber)
    if (orderIds.length > 0) orderId = orderIds[orderIds.length - 1]
  }
  if (fromUrl) {
    try {
      sessionStorage.setItem(LAST_ORDER_ID_KEY, orderId)
    } catch {
      /* ignore */
    }
  } else if (orderId) {
    try {
      sessionStorage.setItem(LAST_ORDER_ID_KEY, orderId)
    } catch {
      /* ignore */
    }
  }

  if (orderId) {
    appendDayOrderId(slug, tableNumber, orderId)
    try {
      const last = sessionStorage.getItem(LAST_ORDER_ID_KEY)
      if (last) appendDayOrderId(slug, tableNumber, last)
    } catch {
      /* ignore */
    }
  }

  renderMyOrdersList(slug, tableNumber, orderId)

  if (orderId && !hadUrl) {
    try {
      const u = new URL(window.location.href)
      u.searchParams.set("orderId", orderId)
      window.history.replaceState(null, "", u.pathname + u.search + u.hash)
    } catch {
      /* ignore */
    }
  }

  const menu = document.querySelector('a[href*="menu"]')
  if (menu) menu.href = withTableQuery("menu.html")
  wireOrderAgain()

  if (!orderId) {
    const err = document.querySelector("#orderkaro-error")
    if (err) {
      err.hidden = false
      err.textContent =
        "Missing order link. Open track from your order confirmation, or place an order first."
    }
    return
  }

  void poll(orderId)
  timer = window.setInterval(() => void poll(orderId), 5000)
}

main()

window.addEventListener("beforeunload", () => {
  if (timer) window.clearInterval(timer)
})
