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
  // return "http://localhost:3000"
  return "https://orderfood.gateomi.com"
}

export const DEFAULT_SLUG = "demo-bistro"
export const DEFAULT_TABLE = 1
export const DEFAULT_SERVICE_TYPE = "DINE_IN"

export const MENU_PATH_KEY = "orderkaro_menu_path_v1"
export const CART_PATH_KEY = "orderkaro_cart_path_v1"
export const SUCCESS_PATH_KEY = "orderkaro_success_path_v1"
export const TRACK_PATH_KEY = "orderkaro_track_path_v1"
/** Set when an order is placed; used if the success URL drops ?orderId= (pretty URLs / redirects). */
export const LAST_ORDER_ID_KEY = "orderkaro_last_order_id_v1"
export const THEME_COLOR_KEY = "orderkaro_theme_color_v1"
export const DEFAULT_THEME_COLOR = "#3D6B41"

function normalizeServiceType(input) {
  const raw = String(input || "").trim().toLowerCase()
  const compact = raw.replace(/[\s_-]+/g, "")
  if (compact === "delivery" || compact === "delivary") return "DELIVERY"
  if (compact === "dinein" || compact === "table" || compact === "tableorder") return "DINE_IN"
  return DEFAULT_SERVICE_TYPE
}

function normalizeThemeColor(input) {
  const v = String(input || "").trim()
  return /^#([0-9a-fA-F]{6})$/.test(v) ? v.toUpperCase() : ""
}

function hexToRgb(hex) {
  const safe = normalizeThemeColor(hex)
  if (!safe) return null
  const h = safe.slice(1)
  return {
    r: Number.parseInt(h.slice(0, 2), 16),
    g: Number.parseInt(h.slice(2, 4), 16),
    b: Number.parseInt(h.slice(4, 6), 16),
  }
}

function clampByte(n) {
  return Math.max(0, Math.min(255, Math.round(n)))
}

function darkenHex(hex, ratio) {
  const rgb = hexToRgb(hex)
  if (!rgb) return ""
  const k = 1 - Math.max(0, Math.min(1, Number(ratio || 0)))
  const toHex = (n) => clampByte(n).toString(16).padStart(2, "0").toUpperCase()
  return `#${toHex(rgb.r * k)}${toHex(rgb.g * k)}${toHex(rgb.b * k)}`
}

function alphaColor(hex, alpha) {
  const rgb = hexToRgb(hex)
  const a = Math.max(0, Math.min(1, Number(alpha || 0)))
  if (!rgb) return ""
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`
}

function clearThemeVars() {
  if (typeof document === "undefined") return
  const root = document.documentElement
  root.style.removeProperty("--primary")
  root.style.removeProperty("--primary-pressed")
  root.style.removeProperty("--primary-soft")
  root.style.removeProperty("--track-primary")
  root.style.removeProperty("--track-primary-mid")
  root.style.removeProperty("--track-primary-soft")
}

function setThemeVars(color) {
  if (typeof document === "undefined") return
  const root = document.documentElement
  root.style.setProperty("--primary", color)
  root.style.setProperty("--primary-pressed", darkenHex(color, 0.16) || color)
  root.style.setProperty("--primary-soft", alphaColor(color, 0.12) || "rgba(0,0,0,0.08)")
  root.style.setProperty("--track-primary", darkenHex(color, 0.42) || color)
  root.style.setProperty("--track-primary-mid", darkenHex(color, 0.26) || color)
  root.style.setProperty("--track-primary-soft", darkenHex(color, 0.26) || color)
}

export function rememberThemeColor(color) {
  const safe = normalizeThemeColor(color)
  if (!safe) {
    try {
      sessionStorage.removeItem(THEME_COLOR_KEY)
    } catch {
      /* ignore */
    }
    setThemeVars(DEFAULT_THEME_COLOR)
    return DEFAULT_THEME_COLOR
  }
  try {
    sessionStorage.setItem(THEME_COLOR_KEY, safe)
  } catch {
    /* ignore */
  }
  setThemeVars(safe)
  return safe
}

export function applyRememberedThemeColor() {
  try {
    const saved = sessionStorage.getItem(THEME_COLOR_KEY) || ""
    const safe = normalizeThemeColor(saved)
    if (!safe) {
      setThemeVars(DEFAULT_THEME_COLOR)
      return DEFAULT_THEME_COLOR
    }
    setThemeVars(safe)
    return safe
  } catch {
    setThemeVars(DEFAULT_THEME_COLOR)
    return DEFAULT_THEME_COLOR
  }
}

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
    const serviceType = normalizeServiceType(
      u.searchParams.get("service") || u.searchParams.get("serviceType") || ""
    )
    const t = u.searchParams.get("table") || u.searchParams.get("tableNumber")
    const tableNumber = t ? Number.parseInt(t, 10) : DEFAULT_TABLE
    const normalizedTable = Number.isFinite(tableNumber) && tableNumber > 0 ? tableNumber : DEFAULT_TABLE
    return {
      slug,
      serviceType,
      tableNumber: serviceType === "DELIVERY" ? null : normalizedTable,
    }
  } catch {
    return { slug: DEFAULT_SLUG, serviceType: DEFAULT_SERVICE_TYPE, tableNumber: DEFAULT_TABLE }
  }
}
