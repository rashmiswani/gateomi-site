import { getApiBase, isStaffOrderMode } from "./config.js"

function staffAuthUrl(path) {
  const base = getApiBase().replace(/\/$/, "")
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}

async function parseJson(res) {
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  return { body, ok: res.ok, status: res.status }
}

async function staffAuthFetch(path, options = {}) {
  const res = await fetch(staffAuthUrl(path), {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {}),
    },
    ...options,
  })
  const { body, ok, status } = await parseJson(res)
  if (!ok) {
    const msg = body && body.error ? body.error : `Request failed (${status})`
    throw new Error(msg)
  }
  return body?.data ?? body
}

/** Current staff session, or null when not signed in. */
export async function getStaffSession() {
  try {
    return await staffAuthFetch("/api/manager/auth/me")
  } catch {
    return null
  }
}

export async function postStaffLogin(login, password) {
  return staffAuthFetch("/api/manager/auth/login", {
    method: "POST",
    body: JSON.stringify({ login, password }),
  })
}

export async function postStaffLogout() {
  try {
    await staffAuthFetch("/api/manager/auth/logout", { method: "POST", body: "{}" })
  } catch {
    /* ignore */
  }
}

export function staffDisplayName(session) {
  const user = session?.user
  if (!user) return ""
  const username = String(user.username || "").trim()
  if (username) return username
  return String(user.email || "").trim()
}

/** Returns session when authenticated for the given restaurant slug. */
export async function requireStaffOrderAuth(slug) {
  if (!isStaffOrderMode()) return null
  const session = await getStaffSession()
  if (!session) return null
  const expectedSlug = String(slug || "").trim()
  const actualSlug = String(session?.restaurant?.slug || "").trim()
  if (expectedSlug && actualSlug && expectedSlug !== actualSlug) {
    const err = new Error("This account belongs to a different restaurant.")
    err.code = "RESTAURANT_MISMATCH"
    throw err
  }
  return session
}

export function buildStaffStartUrl(slug) {
  const u = new URL("start", window.location.href)
  u.searchParams.set("slug", String(slug || ""))
  u.searchParams.set("staff", "1")
  try {
    const api = new URL(window.location.href).searchParams.get("api")
    if (api) u.searchParams.set("api", api)
  } catch {
    /* ignore */
  }
  return u.pathname + u.search
}

export function redirectToStaffStart(slug) {
  window.location.replace(buildStaffStartUrl(slug))
}

/** Today's orders placed by the signed-in staff member (all tables). */
export async function fetchStaffPlacedByMeOrders() {
  return staffAuthFetch("/api/manager/orders/placed-by-me")
}
