import {
  getTableContext,
  MENU_PATH_KEY,
  CART_PATH_KEY,
  SUCCESS_PATH_KEY,
  TRACK_PATH_KEY,
} from "./config.js"
import { loadCart } from "./cart-store.js"

/**
 * Slug/table for API + cart: use URL when present; otherwise fall back to the
 * cart in sessionStorage so `/cart` without query still shows the same order.
 */
export function resolveTableContext() {
  let u
  try {
    u = new URL(window.location.href)
  } catch {
    return getTableContext()
  }
  const hasSlug = u.searchParams.has("slug")
  const hasTable = u.searchParams.has("table") || u.searchParams.has("tableNumber")
  const hasService = u.searchParams.has("service") || u.searchParams.has("serviceType")
  const base = getTableContext()
  const cart = loadCart()
  if (!cart) return base

  const slug = hasSlug
    ? base.slug
    : String(cart.restaurantSlug || base.slug).trim() || base.slug

  const serviceType = hasService
    ? base.serviceType
    : hasTable
      ? "DINE_IN"
      : String(cart.serviceType || base.serviceType || "DINE_IN").toUpperCase() === "DELIVERY"
        ? "DELIVERY"
        : "DINE_IN"
  let tableNumber = base.tableNumber
  if (serviceType === "DELIVERY") {
    tableNumber = null
  } else if (hasTable) {
    tableNumber = base.tableNumber
  } else {
    const tn = Number(cart.tableNumber)
    if (Number.isFinite(tn) && tn > 0) tableNumber = tn
  }

  return { slug, tableNumber, serviceType }
}

/** Append slug & table to a path; reuse pretty paths like `/orderkaro/menu` when seen before. */
export function withTableQuery(href) {
  const { slug, tableNumber, serviceType } = resolveTableContext()
  let target = href
  if (href === "menu.html" || href === "menu") {
    const stored = sessionStorage.getItem(MENU_PATH_KEY)
    if (stored) target = stored
  }
  if (href === "cart.html" || href === "cart") {
    const stored = sessionStorage.getItem(CART_PATH_KEY)
    if (stored) target = stored
  }
  if (href === "success.html" || href === "success") {
    const stored = sessionStorage.getItem(SUCCESS_PATH_KEY)
    if (stored) target = stored
  }
  if (href === "track.html" || href === "track") {
    const stored = sessionStorage.getItem(TRACK_PATH_KEY)
    if (stored) target = stored
  }
  const u = new URL(target, window.location.href)
  u.searchParams.set("slug", slug)
  if (serviceType === "DELIVERY") {
    u.searchParams.delete("table")
    u.searchParams.delete("tableNumber")
    u.searchParams.delete("serviceType")
    u.searchParams.set("service", "delivery")
  } else {
    const nextTable =
      Number.isFinite(Number(tableNumber)) && Number(tableNumber) > 0 ? Number(tableNumber) : 1
    u.searchParams.set("table", String(nextTable))
    u.searchParams.delete("tableNumber")
    u.searchParams.delete("serviceType")
    u.searchParams.set("service", "dine-in")
  }
  const api = new URL(window.location.href).searchParams.get("api")
  if (api) u.searchParams.set("api", api)
  return u.pathname + u.search + u.hash
}
