import {
  applyRememberedThemeColor,
  getTableContext,
  LAST_ORDER_ID_KEY,
  rememberThemeColor,
  rememberTrackPath,
} from "./config.js"
import { appendDayOrderId, loadDayOrders } from "./order-day-history.js"
import { withTableQuery } from "./nav.js"
import { fetchOrder, requestBill, requestOrderCancel, submitOrderFeedback } from "./api.js"
import { formatMoney, formatOrderId, formatTrackDateTime } from "./format.js"
import { itemDietPillHtml } from "./diet.js"

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

const FEEDBACK_RATING_LABELS = {
  1: "Bad",
  2: "Poor",
  3: "Okay",
  4: "Good",
  5: "Excellent",
}

let confirmResolve = null

function statusPillText(status) {
  return LABELS[status] || status
}

function feedbackLabelForRating(rating) {
  const n = Number(rating || 0)
  if (!Number.isInteger(n) || n < 1 || n > 5) return ""
  return FEEDBACK_RATING_LABELS[n] || ""
}

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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

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
  const messageEl = document.getElementById("track-confirm-message")
  const yesBtn = document.getElementById("track-confirm-yes")
  const cancelBtn = document.getElementById("track-confirm-cancel")
  if (!modal || !titleEl || !messageEl || !yesBtn || !cancelBtn) {
    return Promise.resolve(window.confirm(message || title || "Are you sure?"))
  }
  titleEl.textContent = String(title || "Confirm action")
  messageEl.textContent = String(message || "")
  yesBtn.textContent = String(confirmText || "Confirm")
  cancelBtn.textContent = String(cancelText || "Cancel")
  modal.hidden = false
  modal.setAttribute("aria-hidden", "false")
  return new Promise((resolve) => {
    confirmResolve = resolve
  })
}

function wireCustomConfirm() {
  const modal = document.getElementById("track-confirm-modal")
  const yesBtn = document.getElementById("track-confirm-yes")
  const cancelBtn = document.getElementById("track-confirm-cancel")
  if (!modal || !yesBtn || !cancelBtn) return
  modal.querySelectorAll("[data-confirm-close]").forEach((el) => {
    el.addEventListener("click", () => closeCustomConfirm(false))
  })
  yesBtn.addEventListener("click", () => closeCustomConfirm(true))
  cancelBtn.addEventListener("click", () => closeCustomConfirm(false))
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !modal.hidden) closeCustomConfirm(false)
  })
}

function sanitizeUpiPayUrl(rawUrl) {
  const input = String(rawUrl || "").trim()
  if (!/^upi:\/\//i.test(input)) return input
  try {
    const url = new URL(input)
    const rawTr = String(url.searchParams.get("tr") || "")
    const safeTr = rawTr
      .replace(/[^a-zA-Z0-9.-]/g, "")
      .slice(0, 35)
    if (safeTr) url.searchParams.set("tr", safeTr)
    else url.searchParams.delete("tr")
    return url.toString()
  } catch {
    return input
  }
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
  const u = new URL(withTableQuery("track"), window.location.href)
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
          <p class="track-card__line-name">${itemDietPillHtml(line?.foodType)}<span class="track-card__line-title">${escapeHtml(line?.itemName || "Item")}</span></p>
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
  const feedbackAllowed =
    data.status === "SERVED" || data.status === "PAID" || data.status === "COMPLETED"
  const feedbackSubmitted = Boolean(data.feedbackSubmittedAt || Number(data.feedbackRating || 0) > 0)

  const card = document.createElement("article")
  card.className = `track-card${isCurrent ? " track-card--active" : ""}`
  card.dataset.trackOrderId = orderId
  let countdownHtml = ""
  if (isCurrent && data?.estimatedReadyAt) {
    countdownHtml = `<div class="track-estimate-hero">
      <span class="track-estimate-hero__label">Estimated Ready In</span>
      <div class="track-estimate-hero__row">
        <span class="material-symbols-outlined" aria-hidden="true">schedule</span>
        <span data-estimate-countdown="${escapeHtml(String(data.estimatedReadyAt))}" data-estimate-status="${escapeHtml(
          String(data.status || "")
        )}">—</span>
      </div>
    </div>`
  }
  card.innerHTML = `
    <div class="track-card__inner">
      <div class="track-card__head">
        <div>
          <p class="track-card__id-label">Order ID</p>
          <h3 class="track-card__id-value">${escapeHtml(formatOrderId(data.shortId || orderId))}</h3>
          ${
            data.customerName
              ? `<p class="track-card__guest-name">For ${escapeHtml(String(data.customerName))}</p>`
              : ""
          }
        </div>
        <div class="track-card__status ${meta.pillClass}">${escapeHtml(meta.label)}</div>
      </div>
      ${isCurrent ? `<div class="track-card__time-row"><span class="material-symbols-outlined" aria-hidden="true">schedule</span><span>${escapeHtml(formatTrackDateTime(data.createdAt || ""))}</span></div>` : ""}
      ${countdownHtml}
      <div class="track-card__lines-list">${items.map((line) => lineItemTemplate(line)).join("")}</div>
      <div class="track-card__footer">
        <span class="track-card__footer-label">Order Total</span>
        <span class="track-card__footer-total">${escapeHtml(formatMoney(total))}</span>
      </div>
      ${
        feedbackAllowed
          ? `<div class="track-feedback" data-feedback-order-id="${escapeHtml(orderId)}">
              <h4 class="track-feedback__title">Share your feedback</h4>
              ${
                feedbackSubmitted
                  ? `<p class="track-feedback__submitted">Thanks! You rated this order ${escapeHtml(String(data.feedbackRating || 0))}/5 (${escapeHtml(feedbackLabelForRating(data.feedbackRating) || "Rated")})${
                      data.feedbackComment ? ` — "${escapeHtml(String(data.feedbackComment))}"` : ""
                    }.</p>`
                  : `<form class="track-feedback__form" data-feedback-form data-feedback-order-id="${escapeHtml(orderId)}">
                      <label class="track-feedback__label">Rating</label>
                      <div class="track-feedback-stars" role="radiogroup" aria-label="Rate this order">
                        <input type="hidden" name="rating" value="" required />
                        <button type="button" class="track-feedback-star" data-star="1" aria-label="1 star">★</button>
                        <button type="button" class="track-feedback-star" data-star="2" aria-label="2 stars">★</button>
                        <button type="button" class="track-feedback-star" data-star="3" aria-label="3 stars">★</button>
                        <button type="button" class="track-feedback-star" data-star="4" aria-label="4 stars">★</button>
                        <button type="button" class="track-feedback-star" data-star="5" aria-label="5 stars">★</button>
                      </div>
                      <p class="track-feedback__hint" data-feedback-hint>Tap a star to rate</p>
                      <label class="track-feedback__label" for="feedback-comment-${escapeHtml(orderId)}">Comment (optional)</label>
                      <textarea id="feedback-comment-${escapeHtml(orderId)}" name="comment" rows="2" maxlength="1000" placeholder="Tell us what we can improve"></textarea>
                      <button type="submit" class="track-feedback__submit">Submit Feedback</button>
                    </form>`
              }
            </div>`
          : ""
      }
      ${!isCurrent ? `<a class="track-card__jump-link" href="${trackHrefForOrder(orderId)}">View this order</a>` : ""}
    </div>
  `
  return card
}

function updateEstimateCountdowns() {
  document.querySelectorAll("[data-estimate-countdown]").forEach((el) => {
    const status = String(el.getAttribute("data-estimate-status") || "").toUpperCase()
    if (status === "SERVED") {
      el.textContent = "Served"
      return
    }
    if (status === "PAID" || status === "COMPLETED" || status === "CANCELLED") {
      el.textContent = "Closed"
      return
    }
    const raw = el.getAttribute("data-estimate-countdown") || ""
    const end = new Date(raw).getTime()
    if (!Number.isFinite(end)) {
      el.textContent = "—"
      return
    }
    const leftMs = end - Date.now()
    if (leftMs <= 0) {
      el.textContent = "Any moment now"
      return
    }
    const sec = Math.floor(leftMs / 1000)
    const mm = Math.floor(sec / 60)
    const ss = sec % 60
    el.textContent = `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
  })
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
  if (!listEl || !emptyEl) return { valid: [] }

  let ids = [...loadDayOrders(slug, tableNumber).orderIds]
  if (currentOrderId && !ids.includes(currentOrderId)) ids.push(currentOrderId)

  if (ids.length === 0) {
    emptyEl.hidden = false
    listEl.replaceChildren()
    return { valid: [] }
  }

  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        const data = await fetchOrder(id)
        rememberThemeColor(data?.restaurantThemeColor)
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
    return { valid: [] }
  }
  emptyEl.hidden = true
  valid.forEach(({ id, data }) => listEl.appendChild(createOrderCardElement(id, data, currentOrderId)))
  return { valid }
}

function applyAskBillState(data) {
  const askBillBtn = document.getElementById("ask-bill-btn")
  if (!askBillBtn) return
  if (data == null) {
    askBillBtn.disabled = true
    askBillBtn.removeAttribute("data-pay-url")
    askBillBtn.innerHTML =
      '<span class="material-symbols-outlined" aria-hidden="true">payments</span><span>Request Bill</span>'
    askBillBtn.title = "No open order to request a bill for."
    return
  }
  askBillBtn.removeAttribute("title")
  const alreadyRequested = Boolean(data.billRequestedAt)
  const payUrl = String(data?.payment?.url || "")
  const canPayNow = alreadyRequested && payUrl && data.status !== "PAID" && data.status !== "COMPLETED"
  if (canPayNow) askBillBtn.setAttribute("data-pay-url", payUrl)
  else askBillBtn.removeAttribute("data-pay-url")
  askBillBtn.disabled =
    (!canPayNow && alreadyRequested) ||
    data.status === "CANCELLED" ||
    data.status === "PAID" ||
    data.status === "COMPLETED"
  askBillBtn.innerHTML = canPayNow
    ? '<span class="material-symbols-outlined" aria-hidden="true">currency_rupee</span><span>Pay Now</span>'
    : alreadyRequested
      ? '<span class="material-symbols-outlined" aria-hidden="true">check_circle</span><span>Bill Requested</span>'
    : '<span class="material-symbols-outlined" aria-hidden="true">payments</span><span>Request Bill</span>'
}

function canCustomerRequestCancel(status) {
  const s = String(status || "").toUpperCase()
  return s === "NEW" || s === "ORDER_PLACED" || s === "ACCEPTED"
}

function applyCancelOrderState(data) {
  const cancelBtn = document.getElementById("cancel-order-btn")
  if (!cancelBtn) return
  if (data == null) {
    cancelBtn.disabled = true
    cancelBtn.title = "No order selected."
    cancelBtn.innerHTML =
      '<span class="material-symbols-outlined" aria-hidden="true">cancel</span><span>Request Cancel</span>'
    return
  }
  const alreadyRequested = Boolean(data?.cancellationRequestedAt)
  const canCancel = canCustomerRequestCancel(data.status)
  cancelBtn.disabled = alreadyRequested || !canCancel
  cancelBtn.title = alreadyRequested
    ? "Cancellation already requested."
    : canCancel
    ? ""
    : "Cancellation request is allowed only right after placing the order."
  cancelBtn.innerHTML = alreadyRequested
    ? '<span class="material-symbols-outlined" aria-hidden="true">check_circle</span><span>Cancel Requested</span>'
    : canCancel
    ? '<span class="material-symbols-outlined" aria-hidden="true">cancel</span><span>Request Cancel</span>'
    : '<span class="material-symbols-outlined" aria-hidden="true">cancel</span><span>Cancel Unavailable</span>'
}

let timer = null
let latestOrder = null
let currentOrderId = ""
let feedbackSubmittingFor = ""

async function poll(orderId) {
  try {
    const data = await fetchOrder(orderId)
    rememberThemeColor(data?.restaurantThemeColor)
    await maybeShowBreadReorderBrowserNotice(data)
    latestOrder = data
    applyAskBillState(data)
    applyCancelOrderState(data)
    updateTrackCard(orderId, data)
    updateEstimateCountdowns()
  } catch (e) {
    const err = document.querySelector("#orderkaro-error")
    if (err) {
      err.hidden = false
      err.textContent = e instanceof Error ? e.message : "Could not load order"
    }
  }
}

function wireCancelOrder() {
  const btn = document.getElementById("cancel-order-btn")
  if (!btn) return
  btn.addEventListener("click", async () => {
    if (!currentOrderId || !latestOrder) return
    if (!canCustomerRequestCancel(latestOrder.status) || latestOrder.cancellationRequestedAt) return
    const ok = await askCustomConfirm({
      title: "Request Cancellation",
      message: "Send cancellation request for this order now?",
      confirmText: "Request Cancel",
      cancelText: "Keep Order",
    })
    if (!ok) return
    btn.disabled = true
    btn.innerHTML =
      '<span class="material-symbols-outlined" aria-hidden="true">hourglass_top</span><span>Requesting...</span>'
    try {
      const data = await requestOrderCancel(currentOrderId)
      latestOrder = {
        ...(latestOrder || {}),
        cancellationRequestedAt: data?.cancellationRequestedAt || new Date().toISOString(),
      }
      applyCancelOrderState(latestOrder)
      applyAskBillState(latestOrder)
      updateTrackCard(currentOrderId, latestOrder)
      const err = document.querySelector("#orderkaro-error")
      if (err) {
        err.hidden = false
        err.textContent = "Cancellation requested successfully."
      }
    } catch (e) {
      applyCancelOrderState(latestOrder)
      const err = document.querySelector("#orderkaro-error")
      if (err) {
        err.hidden = false
        err.textContent = e instanceof Error ? e.message : "Could not request cancellation"
      }
    }
  })
}

function wireAskBill() {
  const btn = document.getElementById("ask-bill-btn")
  if (!btn) return
  btn.addEventListener("click", async () => {
    if (!currentOrderId) return
    const payUrl = sanitizeUpiPayUrl(String(btn.getAttribute("data-pay-url") || ""))
    if (payUrl) {
      const isUpiIntent = /^upi:\/\//i.test(payUrl)
      if (isUpiIntent) {
        const shouldOpen = await askCustomConfirm({
          title: "Open Payment App",
          message: "Open payment app now? Tap cancel to copy payment link and pay using app of your choice.",
          confirmText: "Open App",
          cancelText: "Copy Link",
        })
        if (!shouldOpen) {
          try {
            await navigator.clipboard.writeText(payUrl)
            const err = document.querySelector("#orderkaro-error")
            if (err) {
              err.hidden = false
              err.textContent = "Payment link copied. Open your preferred UPI app and paste the link."
            }
          } catch {
            const err = document.querySelector("#orderkaro-error")
            if (err) {
              err.hidden = false
              err.textContent = "Could not copy payment link. Please try again."
            }
          }
          return
        }
      }
      window.location.href = payUrl
      return
    }
    btn.disabled = true
    btn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">hourglass_top</span><span>Requesting...</span>'
    try {
      const data = await requestBill(currentOrderId)
      const base = latestOrder && typeof latestOrder === "object" ? latestOrder : { status: "ORDER_PLACED" }
      applyAskBillState({
        ...base,
        billRequestedAt: data?.billRequestedAt || new Date().toISOString(),
        payment: data?.payment || base?.payment || null,
      })
    } catch (e) {
      applyAskBillState(latestOrder)
      const err = document.querySelector("#orderkaro-error")
      if (err) {
        err.hidden = false
        err.textContent = e instanceof Error ? e.message : "Could not request bill"
      }
    }
  })
}

function wireFeedbackSubmit() {
  const list = document.getElementById("track-orders-list")
  if (!list) return
  list.addEventListener("mouseover", (ev) => {
    const target = ev.target
    if (!(target instanceof Element)) return
    const starBtn = target.closest(".track-feedback-star")
    if (!(starBtn instanceof HTMLButtonElement)) return
    const form = starBtn.closest("form[data-feedback-form]")
    if (!(form instanceof HTMLFormElement)) return
    const rating = Number(starBtn.getAttribute("data-star") || 0)
    const hint = form.querySelector("[data-feedback-hint]")
    if (hint instanceof HTMLElement && rating >= 1 && rating <= 5) {
      hint.textContent = `${rating} star${rating > 1 ? "s" : ""} - ${feedbackLabelForRating(rating)}`
    }
  })
  list.addEventListener("mouseout", (ev) => {
    const target = ev.target
    if (!(target instanceof Element)) return
    const starBtn = target.closest(".track-feedback-star")
    if (!(starBtn instanceof HTMLButtonElement)) return
    const form = starBtn.closest("form[data-feedback-form]")
    if (!(form instanceof HTMLFormElement)) return
    const ratingInput = form.querySelector('input[name="rating"]')
    const selected = Number(
      ratingInput instanceof HTMLInputElement ? ratingInput.value : "0"
    )
    const hint = form.querySelector("[data-feedback-hint]")
    if (!(hint instanceof HTMLElement)) return
    if (selected >= 1 && selected <= 5) {
      hint.textContent = `${selected} star${selected > 1 ? "s" : ""} - ${feedbackLabelForRating(selected)}`
    } else {
      hint.textContent = "Tap a star to rate"
    }
  })
  list.addEventListener("click", (ev) => {
    const target = ev.target
    if (!(target instanceof Element)) return
    const starBtn = target.closest(".track-feedback-star")
    if (!(starBtn instanceof HTMLButtonElement)) return
    const form = starBtn.closest("form[data-feedback-form]")
    if (!(form instanceof HTMLFormElement)) return
    const selected = Number(starBtn.getAttribute("data-star") || 0)
    if (!Number.isInteger(selected) || selected < 1 || selected > 5) return
    const ratingInput = form.querySelector('input[name="rating"]')
    if (ratingInput instanceof HTMLInputElement) ratingInput.value = String(selected)
    const hint = form.querySelector("[data-feedback-hint]")
    if (hint instanceof HTMLElement) {
      hint.textContent = `${selected} star${selected > 1 ? "s" : ""} - ${feedbackLabelForRating(selected)}`
    }
    form.querySelectorAll(".track-feedback-star").forEach((btn) => {
      if (!(btn instanceof HTMLElement)) return
      const value = Number(btn.getAttribute("data-star") || 0)
      if (value <= selected) btn.classList.add("is-active")
      else btn.classList.remove("is-active")
    })
  })
  list.addEventListener("submit", async (ev) => {
    const target = ev.target
    if (!(target instanceof HTMLFormElement) || !target.matches("[data-feedback-form]")) return
    ev.preventDefault()
    const orderId = String(target.getAttribute("data-feedback-order-id") || "")
    if (!orderId || feedbackSubmittingFor === orderId) return
    const fd = new FormData(target)
    const rating = Number(fd.get("rating") || 0)
    const comment = String(fd.get("comment") || "").trim()
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      const err = document.querySelector("#orderkaro-error")
      if (err) {
        err.hidden = false
        err.textContent = "Please select a rating between 1 and 5."
      }
      return
    }
    const submitBtn = target.querySelector("button[type='submit']")
    if (submitBtn) submitBtn.disabled = true
    feedbackSubmittingFor = orderId
    try {
      await submitOrderFeedback(orderId, { rating, comment: comment || null })
      const fresh = await fetchOrder(orderId)
      if (orderId === currentOrderId) latestOrder = fresh
      updateTrackCard(orderId, fresh)
    } catch (e) {
      const err = document.querySelector("#orderkaro-error")
      if (err) {
        err.hidden = false
        err.textContent = e instanceof Error ? e.message : "Could not submit feedback"
      }
      if (submitBtn) submitBtn.disabled = false
    } finally {
      feedbackSubmittingFor = ""
    }
  })
}

async function main() {
  applyRememberedThemeColor()
  rememberTrackPath()
  setHeaderContext()
  wireAskBill()
  wireCancelOrder()
  wireFeedbackSubmit()
  wireCustomConfirm()

  const { slug, tableNumber } = getTableContext()
  const errBanner = document.querySelector("#orderkaro-error")
  if (errBanner) errBanner.hidden = true

  const menuLink = document.getElementById("track-menu-link")
  if (menuLink) menuLink.href = withTableQuery("menu")
  const selfLink = document.getElementById("track-self-link")
  if (selfLink) selfLink.href = withTableQuery("track")
  const emptyMenu = document.getElementById("track-empty-menu-link")
  if (emptyMenu) emptyMenu.href = withTableQuery("menu")

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

  const { valid } = await renderOrderCards(slug, tableNumber, orderId)

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
    applyAskBillState(null)
    applyCancelOrderState(null)
    return
  }

  const tracked = valid.find((r) => r.id === orderId)
  if (tracked) {
    applyAskBillState(tracked.data)
    applyCancelOrderState(tracked.data)
  }

  void poll(orderId)
  timer = window.setInterval(() => void poll(orderId), 5000)
  window.setInterval(updateEstimateCountdowns, 1000)
}

void main()

window.addEventListener("beforeunload", () => {
  if (timer) window.clearInterval(timer)
})
