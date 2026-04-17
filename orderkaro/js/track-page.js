import { getTableContext, LAST_ORDER_ID_KEY, rememberTrackPath } from "./config.js"
import { appendDayOrderId, loadDayOrders } from "./order-day-history.js"
import { withTableQuery } from "./nav.js"
import { fetchOrder, requestBill } from "./api.js"
import { formatMoney, formatOrderId, formatTrackDateTime } from "./format.js"

function getOrderId() {
  try {
    const u = new URL(window.location.href)
    return u.searchParams.get("orderId") || ""
  } catch {
    return ""
  }
}

const LABELS = {
  NEW: "Order placed",
  ORDER_PLACED: "Order placed",
  ACCEPTED: "Accepted",
  PREPARING: "Preparing",
  READY: "Ready",
  SERVED: "Served",
  PAID: "Paid",
  COMPLETED: "Paid",
  CANCELLED: "Cancelled",
}

function statusPillText(status) {
  return LABELS[status] || status
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function orderTotal(data) {
  if (!data.items?.length) return 0
  return data.items.reduce((sum, l) => sum + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0)
}

function statusUi(status) {
  if (status === "CANCELLED") {
    return { pillClass: "track-card__status--danger", label: statusPillText(status) }
  }
  if (status === "SERVED" || status === "PAID" || status === "COMPLETED") {
    return { pillClass: "track-card__status--muted", label: statusPillText(status) }
  }
  const pulse =
    status === "NEW" ||
    status === "ORDER_PLACED" ||
    status === "ACCEPTED" ||
    status === "PREPARING" ||
    status === "READY"
  return {
    pillClass: `track-card__status--live${pulse ? " track-card__status--pulse" : ""}`,
    label: statusPillText(status),
  }
}

function setHeaderContext() {
  const { slug, tableNumber } = getTableContext()
  const restaurantName = slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
  const nameEl = document.getElementById("track-restaurant-name")
  if (nameEl) nameEl.textContent = restaurantName
  const tableEl = document.getElementById("track-table-label")
  if (tableEl) tableEl.textContent = `Table ${tableNumber}`
  const descEl = document.getElementById("track-editorial-desc")
  if (descEl) {
    descEl.textContent = `Managing your culinary journey at ${restaurantName}. All active orders for Table ${tableNumber} are listed below.`
  }
}

function trackHrefForOrder(orderId) {
  const u = new URL(withTableQuery("track.html"), window.location.href)
  u.searchParams.set("orderId", orderId)
  return `${u.pathname}${u.search}${u.hash}`
}

function lineItemTemplate(line) {
  const photo = line?.itemPhotoUrl ? String(line.itemPhotoUrl) : ""
  const qty = Math.max(1, Number(line?.quantity || 1))
  return `
    <div class="track-card__line-item">
      <div class="track-card__line-thumb ${photo ? "" : "track-card__line-thumb--placeholder"}">
        ${photo ? `<img src="${escapeHtml(photo)}" alt="" />` : '<span class="material-symbols-outlined" aria-hidden="true">restaurant</span>'}
      </div>
      <div class="track-card__line-content">
        <div class="track-card__line-head">
          <p class="track-card__line-name">${escapeHtml(line?.itemName || "Item")}</p>
          <p class="track-card__line-qty">x${qty}</p>
        </div>
        ${line?.note ? `<p class="track-card__line-note">${escapeHtml(line.note)}</p>` : ""}
      </div>
    </div>
  `
}

function createOrderCardElement(orderId, data, currentOrderId) {
  const meta = statusUi(data.status)
  const total = orderTotal(data)
  const isCurrent = orderId === currentOrderId
  const items = Array.isArray(data.items) ? data.items : []

  const card = document.createElement("article")
  card.className = `track-card${isCurrent ? " track-card--active" : ""}`
  card.dataset.trackOrderId = orderId
  card.innerHTML = `
    <div class="track-card__inner">
      <div class="track-card__head">
        <div>
          <p class="track-card__id-label">Order ID</p>
          <h3 class="track-card__id-value">${escapeHtml(formatOrderId(data.shortId || orderId))}</h3>
        </div>
        <div class="track-card__status ${meta.pillClass}">${escapeHtml(meta.label)}</div>
      </div>
      ${isCurrent ? `<div class="track-card__time-row"><span class="material-symbols-outlined" aria-hidden="true">schedule</span><span>${escapeHtml(formatTrackDateTime(data.createdAt || ""))}</span></div>` : ""}
      <div class="track-card__lines-list">${items.map((line) => lineItemTemplate(line)).join("")}</div>
      <div class="track-card__footer">
        <span class="track-card__footer-label">Order Total</span>
        <span class="track-card__footer-total">${escapeHtml(formatMoney(total))}</span>
      </div>
      ${!isCurrent ? `<a class="track-card__jump-link" href="${trackHrefForOrder(orderId)}">View this order</a>` : ""}
    </div>
  `
  return card
}

function updateTrackCard(orderId, data) {
  const card = document.querySelector(`[data-track-order-id="${CSS.escape(orderId)}"]`)
  if (!card) return
  const replacement = createOrderCardElement(orderId, data, orderId)
  card.replaceWith(replacement)
}

async function renderOrderCards(slug, tableNumber, currentOrderId) {
  const listEl = document.getElementById("track-orders-list")
  const emptyEl = document.getElementById("track-orders-empty")
  if (!listEl || !emptyEl) return

  let ids = [...loadDayOrders(slug, tableNumber).orderIds]
  if (currentOrderId && !ids.includes(currentOrderId)) ids.push(currentOrderId)

  if (ids.length === 0) {
    emptyEl.hidden = false
    listEl.replaceChildren()
    return
  }

  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        const data = await fetchOrder(id)
        return { id, data }
      } catch {
        return { id, data: null }
      }
    })
  )
  const valid = results.filter((r) => r.data).sort(
    (a, b) => new Date(b.data.createdAt).getTime() - new Date(a.data.createdAt).getTime()
  )

  listEl.replaceChildren()
  if (valid.length === 0) {
    emptyEl.hidden = false
    return
  }
  emptyEl.hidden = true
  valid.forEach(({ id, data }) => listEl.appendChild(createOrderCardElement(id, data, currentOrderId)))
}

function applyAskBillState(data) {
  const askBillBtn = document.getElementById("ask-bill-btn")
  if (!askBillBtn) return
  const alreadyRequested = Boolean(data.billRequestedAt)
  askBillBtn.disabled =
    alreadyRequested ||
    data.status === "CANCELLED" ||
    data.status === "PAID" ||
    data.status === "COMPLETED"
  askBillBtn.innerHTML = alreadyRequested
    ? '<span class="material-symbols-outlined" aria-hidden="true">check_circle</span><span>Bill Requested</span>'
    : '<span class="material-symbols-outlined" aria-hidden="true">payments</span><span>Request Bill</span>'
}

let timer = null
let latestOrder = null
let currentOrderId = ""

async function poll(orderId) {
  try {
    const data = await fetchOrder(orderId)
    latestOrder = data
    applyAskBillState(data)
    updateTrackCard(orderId, data)
  } catch (e) {
    const err = document.querySelector("#orderkaro-error")
    if (err) {
      err.hidden = false
      err.textContent = e instanceof Error ? e.message : "Could not load order"
    }
  }
}

function wireAskBill() {
  const btn = document.getElementById("ask-bill-btn")
  if (!btn) return
  btn.addEventListener("click", async () => {
    if (!currentOrderId) return
    btn.disabled = true
    btn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">hourglass_top</span><span>Requesting...</span>'
    try {
      const data = await requestBill(currentOrderId)
      const base = latestOrder && typeof latestOrder === "object" ? latestOrder : { status: "ORDER_PLACED" }
      applyAskBillState({ ...base, billRequestedAt: data?.billRequestedAt || new Date().toISOString() })
    } catch (e) {
      btn.disabled = false
      btn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">payments</span><span>Request Bill</span>'
      const err = document.querySelector("#orderkaro-error")
      if (err) {
        err.hidden = false
        err.textContent = e instanceof Error ? e.message : "Could not request bill"
      }
    }
  })
}

async function main() {
  rememberTrackPath()
  setHeaderContext()
  wireAskBill()

  const { slug, tableNumber } = getTableContext()
  const errBanner = document.querySelector("#orderkaro-error")
  if (errBanner) errBanner.hidden = true

  const menuLink = document.getElementById("track-menu-link")
  if (menuLink) menuLink.href = withTableQuery("menu.html")
  const selfLink = document.getElementById("track-self-link")
  if (selfLink) selfLink.href = withTableQuery("track.html")
  const emptyMenu = document.getElementById("track-empty-menu-link")
  if (emptyMenu) emptyMenu.href = withTableQuery("menu.html")

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
    currentOrderId = orderId
    appendDayOrderId(slug, tableNumber, orderId)
    try {
      const last = sessionStorage.getItem(LAST_ORDER_ID_KEY)
      if (last) appendDayOrderId(slug, tableNumber, last)
    } catch {
      /* ignore */
    }
  }

  await renderOrderCards(slug, tableNumber, orderId)

  if (orderId && !hadUrl) {
    try {
      const u = new URL(window.location.href)
      u.searchParams.set("orderId", orderId)
      window.history.replaceState(null, "", u.pathname + u.search + u.hash)
    } catch {
      /* ignore */
    }
  }

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

void main()

window.addEventListener("beforeunload", () => {
  if (timer) window.clearInterval(timer)
})
