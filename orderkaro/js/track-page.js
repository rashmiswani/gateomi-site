import { getTableContext, LAST_ORDER_ID_KEY, rememberTrackPath } from "./config.js"
import { withTableQuery } from "./nav.js"
import { fetchOrder } from "./api.js"
import { formatOrderId, formatTrackDateTime } from "./format.js"

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
  if (num) num.textContent = formatOrderId(data.id)

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

async function poll(orderId) {
  try {
    const data = await fetchOrder(orderId)
    renderOrder(data)
  } catch (e) {
    const err = document.querySelector("#orderkaro-error")
    if (err) {
      err.hidden = false
      err.textContent = e instanceof Error ? e.message : "Could not load order"
    }
  }
}

function main() {
  rememberTrackPath()

  const fromUrl = getOrderId()
  let orderId = fromUrl
  if (!orderId) {
    try {
      orderId = sessionStorage.getItem(LAST_ORDER_ID_KEY) || ""
    } catch {
      /* ignore */
    }
  } else {
    try {
      sessionStorage.setItem(LAST_ORDER_ID_KEY, orderId)
    } catch {
      /* ignore */
    }
  }

  if (orderId && !fromUrl) {
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
