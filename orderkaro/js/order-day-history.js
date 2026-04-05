/**
 * Persist order IDs placed from this browser for the current calendar day (local time),
 * scoped by restaurant slug + table. Survives refresh/new tabs (localStorage).
 * Resets automatically when the date changes.
 */

const PREFIX = "orderkaro_day_orders_v1"

function calendarDayKey() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function key(slug, tableNumber) {
  return `${PREFIX}:${slug}:${tableNumber}`
}

const KEY_PREFIX_PATTERN = `${PREFIX}:`

/** Remove all `orderkaro_day_orders_v1:*` entries that are not for today (or are invalid). */
function clearStaleOrderDayEntries() {
  const today = calendarDayKey()
  const toRemove = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(KEY_PREFIX_PATTERN)) continue
      const raw = localStorage.getItem(k)
      if (!raw) {
        toRemove.push(k)
        continue
      }
      try {
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed.day !== "string" || parsed.day !== today) {
          toRemove.push(k)
        }
      } catch {
        toRemove.push(k)
      }
    }
    toRemove.forEach((k) => {
      try {
        localStorage.removeItem(k)
      } catch {
        /* ignore */
      }
    })
  } catch {
    /* ignore */
  }
}

/**
 * @returns {{ day: string, orderIds: string[] }}
 */
export function loadDayOrders(slug, tableNumber) {
  const today = calendarDayKey()
  try {
    const raw = localStorage.getItem(key(slug, tableNumber))
    if (!raw) return { day: today, orderIds: [] }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.day !== "string" || parsed.day !== today) {
      try {
        localStorage.removeItem(key(slug, tableNumber))
      } catch {
        /* ignore */
      }
      return { day: today, orderIds: [] }
    }
    const orderIds = Array.isArray(parsed.orderIds)
      ? parsed.orderIds.filter((id) => typeof id === "string" && id.length > 0)
      : []
    return { day: today, orderIds }
  } catch {
    return { day: today, orderIds: [] }
  }
}

/** Record a placed order for today (dedupes by id). */
export function appendDayOrderId(slug, tableNumber, orderId) {
  if (!orderId || typeof orderId !== "string") return
  clearStaleOrderDayEntries()
  const today = calendarDayKey()
  const { orderIds } = loadDayOrders(slug, tableNumber)
  const next = orderIds.includes(orderId) ? orderIds : [...orderIds, orderId]
  try {
    localStorage.setItem(key(slug, tableNumber), JSON.stringify({ day: today, orderIds: next }))
  } catch {
    /* quota / private mode */
  }
}
