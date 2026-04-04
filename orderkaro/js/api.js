import { getApiBase } from "./config.js"

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

/** GET /api/public/... — returns `data` or throws with message. */
export async function fetchMenu(slug, tableNumber) {
  const base = getApiBase()
  const url = `${base}/api/public/restaurants/${encodeURIComponent(slug)}/menu?tableNumber=${encodeURIComponent(String(tableNumber))}`
  const res = await fetch(url, { headers: { Accept: "application/json" } })
  const { body, ok } = await parseJson(res)
  if (!ok) {
    const msg = body && body.error ? body.error : `Request failed (${res.status})`
    throw new Error(msg)
  }
  return body.data
}

export async function createOrder(payload) {
  const base = getApiBase()
  const res = await fetch(`${base}/api/public/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  })
  const { body, ok } = await parseJson(res)
  if (!ok) {
    const msg = body && body.error ? body.error : `Could not place order (${res.status})`
    throw new Error(msg)
  }
  return body.data
}

export async function fetchOrder(orderId) {
  const base = getApiBase()
  const res = await fetch(`${base}/api/public/orders/${encodeURIComponent(orderId)}`, {
    headers: { Accept: "application/json" },
  })
  const { body, ok } = await parseJson(res)
  if (!ok) {
    const msg = body && body.error ? body.error : `Order not found (${res.status})`
    throw new Error(msg)
  }
  return body.data
}
