/**
 * API base for gateomi_orderkaro. Override before loading other scripts:
 *   <script>window.__ORDERKARO_API__ = "https://api.example.com";</script>
 * Or query: ?api=http://localhost:3000
 */
export function getApiBase() {
  try {
    const u = new URL(window.location.href)
    const q = u.searchParams.get("api")
    if (q) return q.replace(/\/$/, "")
  } catch {
    /* ignore */
  }
  if (typeof window.__ORDERKARO_API__ === "string" && window.__ORDERKARO_API__.length > 0) {
    return window.__ORDERKARO_API__.replace(/\/$/, "")
  }
  return "http://localhost:3000"
}

export const DEFAULT_SLUG = "demo-bistro"
export const DEFAULT_TABLE = 1

export const MENU_PATH_KEY = "orderkaro_menu_path_v1"
export const CART_PATH_KEY = "orderkaro_cart_path_v1"
export const SUCCESS_PATH_KEY = "orderkaro_success_path_v1"
export const TRACK_PATH_KEY = "orderkaro_track_path_v1"
/** Set when an order is placed; used if the success URL drops ?orderId= (pretty URLs / redirects). */
export const LAST_ORDER_ID_KEY = "orderkaro_last_order_id_v1"

export function rememberMenuPath() {
  try {
    sessionStorage.setItem(MENU_PATH_KEY, window.location.pathname)
  } catch {
    /* ignore */
  }
}

export function rememberCartPath() {
  try {
    sessionStorage.setItem(CART_PATH_KEY, window.location.pathname)
  } catch {
    /* ignore */
  }
}

export function rememberSuccessPath() {
  try {
    sessionStorage.setItem(SUCCESS_PATH_KEY, window.location.pathname)
  } catch {
    /* ignore */
  }
}

export function rememberTrackPath() {
  try {
    sessionStorage.setItem(TRACK_PATH_KEY, window.location.pathname)
  } catch {
    /* ignore */
  }
}

/** Read ?slug= & ?table= from URL with defaults. */
export function getTableContext() {
  try {
    const u = new URL(window.location.href)
    const slug = u.searchParams.get("slug") || DEFAULT_SLUG
    const t = u.searchParams.get("table")
    const tableNumber = t ? Number.parseInt(t, 10) : DEFAULT_TABLE
    return {
      slug,
      tableNumber: Number.isFinite(tableNumber) && tableNumber > 0 ? tableNumber : DEFAULT_TABLE,
    }
  } catch {
    return { slug: DEFAULT_SLUG, tableNumber: DEFAULT_TABLE }
  }
}
