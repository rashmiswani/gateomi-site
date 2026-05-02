import { withTableQuery, resolveTableContext } from "./nav.js"
import { formatCustomerOrderRef, formatMoney, formatTrackDateTime } from "./format.js"
import {
  applyRememberedThemeColor,
  LAST_ORDER_ID_KEY,
  rememberSuccessPath,
  rememberThemeColor,
} from "./config.js"
import { appendDayOrderId } from "./order-day-history.js"
import { fetchOrder, requestBill, requestOrderCancel, requestWaiterCall } from "./api.js"
import { itemDietPillHtml } from "./diet.js"

function getOrderIdFromUrl() {
  try {
    const u = new URL(window.location.href)
    return u.searchParams.get("orderId") || ""
  } catch {
    applySuccessBillState(null)
    applySuccessCancelState(null)
    applySuccessWaiterState(null)
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

function getOrderNoFromUrl() {
  try {
    const u = new URL(window.location.href)
    const raw = u.searchParams.get("orderNo") || ""
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? String(Math.trunc(n)) : ""
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


function showActionFeedback(message, tone = "info") {
  const el = document.querySelector("#success-action-feedback")
  if (!el) return
  el.hidden = false
  el.textContent = String(message || "")
  el.setAttribute("data-tone", tone)
}

function clearActionFeedback() {
  const el = document.querySelector("#success-action-feedback")
  if (!el) return
  el.hidden = true
  el.textContent = ""
  el.removeAttribute("data-tone")
}

function isWaiterCallActive(state) {
  return Boolean(state?.waiterCallActive || (state?.waiterCallRequestedAt && !state?.waiterCallResolvedAt))
}

function forceHideSuccessWaiterButton() {
  const btn = document.getElementById("success-call-waiter-btn")
  if (!(btn instanceof HTMLButtonElement)) return
  btn.hidden = true
  btn.style.display = "none"
  btn.disabled = true
}

function applySuccessWaiterState(order) {
  const btn = document.getElementById("success-call-waiter-btn")
  if (!(btn instanceof HTMLButtonElement)) return
  const ctx = resolveTableContext()
  const ctxServiceType = String(ctx.serviceType || "").toUpperCase()
  const orderType = String(order?.orderType || "").toUpperCase()
  const isDelivery = ctxServiceType === "DELIVERY" || orderType === "DELIVERY"
  if (isDelivery) {
    forceHideSuccessWaiterButton()
    return
  }
  btn.style.display = ""
  btn.hidden = false
  if (!order) {
    btn.disabled = true
    return
  }
  const active = isWaiterCallActive(order?.tableService)
  btn.disabled = active
  btn.innerHTML = active
    ? '<span class="material-symbols-outlined" aria-hidden="true">check_circle</span><span>Waiter Called</span>'
    : '<span class="material-symbols-outlined" aria-hidden="true">notifications_active</span><span>Call Waiter</span>'
}

function canCustomerRequestCancel(status) {
  const s = String(status || "").toUpperCase()
  return s === "NEW" || s === "ORDER_PLACED" || s === "ACCEPTED"
}

function applySuccessBillState(order) {
  const btn = document.getElementById("success-ask-bill-btn")
  if (!(btn instanceof HTMLButtonElement)) return
  if (!order) {
    btn.disabled = true
    btn.removeAttribute("data-pay-url")
    return
  }
  const alreadyRequested = Boolean(order.billRequestedAt)
  const payUrl = String(order?.payment?.url || "")
  const canPayNow = alreadyRequested && payUrl && order.status !== "PAID" && order.status !== "COMPLETED"
  if (canPayNow) btn.setAttribute("data-pay-url", payUrl)
  else btn.removeAttribute("data-pay-url")
  btn.disabled =
    (!canPayNow && alreadyRequested) ||
    order.status === "CANCELLED" ||
    order.status === "PAID" ||
    order.status === "COMPLETED"
  btn.innerHTML = canPayNow
    ? '<span class="material-symbols-outlined" aria-hidden="true">currency_rupee</span><span>Pay Now</span>'
    : alreadyRequested
      ? '<span class="material-symbols-outlined" aria-hidden="true">check_circle</span><span>Bill Requested</span>'
      : '<span class="material-symbols-outlined" aria-hidden="true">payments</span><span>Request Bill</span>'
}

function applySuccessCancelState(order) {
  const btn = document.getElementById("success-cancel-order-btn")
  if (!(btn instanceof HTMLButtonElement)) return
  if (!order) {
    btn.disabled = true
    return
  }
  const alreadyRequested = Boolean(order?.cancellationRequestedAt)
  const canCancel = canCustomerRequestCancel(order.status)
  btn.disabled = alreadyRequested || !canCancel
  btn.innerHTML = alreadyRequested
    ? '<span class="material-symbols-outlined" aria-hidden="true">check_circle</span><span>Cancel Requested</span>'
    : canCancel
      ? '<span class="material-symbols-outlined" aria-hidden="true">cancel</span><span>Request Cancel</span>'
      : '<span class="material-symbols-outlined" aria-hidden="true">cancel</span><span>Cancel Unavailable</span>'
}

function sanitizeUpiPayUrl(url) {
  const raw = String(url || "").trim()
  if (!raw) return ""
  return /^upi:\/\//i.test(raw) || /^https?:\/\//i.test(raw) ? raw : ""
}

function wireSuccessActions(getOrderId, getLatestOrder, setLatestOrder) {
  const billBtn = document.getElementById("success-ask-bill-btn")
  const waiterBtn = document.getElementById("success-call-waiter-btn")
  const cancelBtn = document.getElementById("success-cancel-order-btn")
  if (billBtn instanceof HTMLButtonElement) {
    billBtn.addEventListener("click", async () => {
      const currentOrderId = getOrderId()
      const latestOrder = getLatestOrder()
      if (!currentOrderId || !latestOrder) return
      clearActionFeedback()
      const payUrl = sanitizeUpiPayUrl(String(billBtn.getAttribute("data-pay-url") || ""))
      if (payUrl) {
        window.location.href = payUrl
        return
      }
      billBtn.disabled = true
      try {
        const data = await requestBill(currentOrderId)
        const nextOrder = {
          ...latestOrder,
          billRequestedAt: data?.billRequestedAt || new Date().toISOString(),
          payment: data?.payment || latestOrder?.payment || null,
        }
        setLatestOrder(nextOrder)
        applySuccessBillState(nextOrder)
        applySuccessCancelState(nextOrder)
        applySuccessWaiterState(nextOrder)
        showActionFeedback("Bill requested successfully.", "success")
      } catch (e) {
        applySuccessBillState(latestOrder)
        applySuccessWaiterState(latestOrder)
        showActionFeedback(e instanceof Error ? e.message : "Could not request bill", "error")
      }
    })
  }
  if (waiterBtn instanceof HTMLButtonElement) {
    waiterBtn.addEventListener("click", async () => {
      const ctx = resolveTableContext()
      const latestOrder = getLatestOrder()
      if (!latestOrder) return
      if (String(ctx.serviceType || "").toUpperCase() === "DELIVERY") return
      if (String(latestOrder?.orderType || "").toUpperCase() === "DELIVERY") return
      clearActionFeedback()
      waiterBtn.disabled = true
      try {
        const data = await requestWaiterCall(ctx.slug, ctx.tableNumber)
        const nextOrder = { ...latestOrder, tableService: data }
        setLatestOrder(nextOrder)
        applySuccessWaiterState(nextOrder)
        showActionFeedback("Waiter has been notified.", "success")
      } catch (e) {
        applySuccessWaiterState(latestOrder)
        showActionFeedback(e instanceof Error ? e.message : "Could not call waiter", "error")
      }
    })
  }
  if (cancelBtn instanceof HTMLButtonElement) {
    cancelBtn.addEventListener("click", async () => {
      const currentOrderId = getOrderId()
      const latestOrder = getLatestOrder()
      if (!currentOrderId || !latestOrder) return
      if (!canCustomerRequestCancel(latestOrder.status) || latestOrder.cancellationRequestedAt) return
      clearActionFeedback()
      const ok = await askCustomConfirm({
        title: "Request Cancellation",
        message: "Send cancellation request for this order now?",
        confirmText: "Request Cancel",
        cancelText: "Keep Order",
      })
      if (!ok) return
      cancelBtn.disabled = true
      try {
        const data = await requestOrderCancel(currentOrderId)
        const nextOrder = {
          ...latestOrder,
          cancellationRequestedAt: data?.cancellationRequestedAt || new Date().toISOString(),
        }
        setLatestOrder(nextOrder)
        applySuccessCancelState(nextOrder)
        applySuccessBillState(nextOrder)
        applySuccessWaiterState(nextOrder)
        showActionFeedback("Cancellation requested successfully.", "success")
      } catch (e) {
        applySuccessCancelState(latestOrder)
        applySuccessWaiterState(latestOrder)
        showActionFeedback(e instanceof Error ? e.message : "Could not request cancellation", "error")
      }
    })
  }
}

let confirmResolve = null

function closeCustomConfirm(result) {
  const modal = document.getElementById("track-confirm-modal")
  if (modal) {
    modal.hidden = true
    modal.setAttribute("aria-hidden", "true")
  }
  const resolver = confirmResolve
  confirmResolve = null
  if (typeof resolver === "function") resolver(Boolean(result))
}

function askCustomConfirm({
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
}) {
  const modal = document.getElementById("track-confirm-modal")
  const titleEl = document.getElementById("track-confirm-title")
  const msgEl = document.getElementById("track-confirm-message")
  const yesBtn = document.getElementById("track-confirm-yes")
  const cancelBtn = document.getElementById("track-confirm-cancel")
  if (!modal || !titleEl || !msgEl || !yesBtn || !cancelBtn) {
    return Promise.resolve(window.confirm(message || title || "Confirm action?"))
  }
  titleEl.textContent = title || "Confirm action"
  msgEl.textContent = message || ""
  yesBtn.textContent = confirmText
  cancelBtn.textContent = cancelText
  modal.hidden = false
  modal.setAttribute("aria-hidden", "false")
  return new Promise((resolve) => {
    confirmResolve = resolve
  })
}

function bindCustomConfirmModal() {
  const modal = document.getElementById("track-confirm-modal")
  if (!modal) return
  modal.querySelectorAll("[data-confirm-close]").forEach((el) => {
    el.addEventListener("click", () => closeCustomConfirm(false))
  })
  document.getElementById("track-confirm-cancel")?.addEventListener("click", () => closeCustomConfirm(false))
  document.getElementById("track-confirm-yes")?.addEventListener("click", () => closeCustomConfirm(true))
}

function paymentInfoHtml(payment) {
  const upiId = String(payment?.upiId || "").trim()
  if (!upiId) return ""
  const payeeName = String(payment?.payeeName || "Restaurant").trim() || "Restaurant"
  const amount = Number(payment?.amount || 0)
  return `
    <section class="success-payment-card" aria-label="Payment details">
      <div class="success-payment-card__head">
        <span class="material-symbols-outlined" aria-hidden="true">payments</span>
        <div>
          <p>Restaurant UPI ID</p>
          <strong>${escapeHtml(upiId)}</strong>
        </div>
        <button type="button" class="upi-copy-btn" data-copy-upi="${escapeHtml(upiId)}" aria-label="Copy UPI ID">
          <span class="material-symbols-outlined" aria-hidden="true">content_copy</span>
        </button>
      </div>
      <div class="success-payment-card__meta">
        <span>Payee: ${escapeHtml(payeeName)}</span>
        ${amount > 0 ? `<span>Amount: ${escapeHtml(formatMoney(amount))}</span>` : ""}
      </div>
    </section>
  `
}

function renderPaymentInfo(order) {
  document.querySelector('.success-payment-card')?.remove()
  const totalSection = document.querySelector('.success-status-total')
  if (!totalSection) return
  const html = paymentInfoHtml(order?.payment)
  if (!html) return
  totalSection.insertAdjacentHTML('afterend', html)
}

function setCopyButtonState(button, copied) {
  const icon = button?.querySelector('.material-symbols-outlined')
  if (!button || !icon) return
  if (copied) {
    button.dataset.copied = '1'
    icon.textContent = 'check'
    window.setTimeout(() => {
      button.dataset.copied = '0'
      icon.textContent = 'content_copy'
    }, 1600)
    return
  }
  button.dataset.copied = '0'
  icon.textContent = 'content_copy'
}

function wireUpiCopyButtons() {
  document.addEventListener('click', async (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-copy-upi]') : null
    if (!(button instanceof HTMLButtonElement)) return
    const upiId = String(button.getAttribute('data-copy-upi') || '').trim()
    if (!upiId) return
    try {
      await navigator.clipboard.writeText(upiId)
      setCopyButtonState(button, true)
    } catch {
      setCopyButtonState(button, false)
    }
  })
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

let latestOrder = null
let currentOrderId = ""

async function main() {
  applyRememberedThemeColor()
  bindCustomConfirmModal()
  rememberSuccessPath()
  if (String(resolveTableContext().serviceType || "").toUpperCase() === "DELIVERY") {
    forceHideSuccessWaiterButton()
  }

  const fromUrl = getOrderIdFromUrl()
  const shortId = getShortIdFromUrl()
  const preOrderNo = getOrderNoFromUrl()
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
  if (numEl) {
    numEl.textContent = preOrderNo ? `#${preOrderNo}` : formatCustomerOrderRef({ shortId, id })
  }

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
  currentOrderId = id
  wireSuccessActions(() => currentOrderId, () => latestOrder, (next) => { latestOrder = next })
  if (!id || !list) return
  try {
    const order = await fetchOrder(id)
    latestOrder = order
    if (numEl) numEl.textContent = formatCustomerOrderRef(order)
    applySuccessBillState(order)
    applySuccessCancelState(order)
    applySuccessWaiterState(order)
    rememberThemeColor(order?.restaurantThemeColor)
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
    renderPaymentInfo(order)
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

wireUpiCopyButtons()

main()
