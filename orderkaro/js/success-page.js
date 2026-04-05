import { withTableQuery, resolveTableContext } from "./nav.js"
import { formatOrderId } from "./format.js"
import { LAST_ORDER_ID_KEY, rememberSuccessPath } from "./config.js"
import { appendDayOrderId } from "./order-day-history.js"

function getOrderIdFromUrl() {
  try {
    const u = new URL(window.location.href)
    return u.searchParams.get("orderId") || ""
  } catch {
    return ""
  }
}

function main() {
  rememberSuccessPath()

  const fromUrl = getOrderIdFromUrl()
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
  if (numEl) numEl.textContent = formatOrderId(id)

  const track = document.querySelector('a[href*="track"]')
  if (track) {
    const u = new URL(withTableQuery("track.html"), window.location.href)
    if (id) u.searchParams.set("orderId", id)
    track.href = u.pathname + u.search
  }

  const menu = document.querySelector('a[href*="menu"]')
  if (menu) menu.href = withTableQuery("menu.html")
}

main()
