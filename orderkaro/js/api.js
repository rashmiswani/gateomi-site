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
export async function fetchMenu(slug, tableNumber, serviceType = "DINE_IN") {
  const base = getApiBase()
  const sp = new URLSearchParams()
  if (serviceType === "DELIVERY") sp.set("serviceType", "DELIVERY")
  else sp.set("tableNumber", String(tableNumber))
  const url = `${base}/api/public/restaurants/${encodeURIComponent(slug)}/menu?${sp.toString()}`
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

export async function requestBill(orderId) {
  const base = getApiBase()
  const res = await fetch(`${base}/api/public/orders/${encodeURIComponent(orderId)}`, {
    method: "POST",
    headers: { Accept: "application/json" },
  })
  const { body, ok } = await parseJson(res)
  if (!ok) {
    const msg = body && body.error ? body.error : `Could not request bill (${res.status})`
    throw new Error(msg)
  }
  return body.data
}

export async function submitOrderFeedback(orderId, payload) {
  const base = getApiBase()
  const res = await fetch(`${base}/api/public/orders/${encodeURIComponent(orderId)}/feedback`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  })
  const { body, ok } = await parseJson(res)
  if (!ok) {
    const msg = body && body.error ? body.error : `Could not submit feedback (${res.status})`
    throw new Error(msg)
  }
  return body.data
}

export async function requestOrderCancel(orderId) {
  const base = getApiBase()
  const res = await fetch(`${base}/api/public/orders/${encodeURIComponent(orderId)}/cancel-request`, {
    method: "POST",
    headers: { Accept: "application/json" },
  })
  const { body, ok } = await parseJson(res)
  if (!ok) {
    const msg = body && body.error ? body.error : `Could not request cancellation (${res.status})`
    throw new Error(msg)
  }
  return body.data
}


export async function requestWaiterCall(slug, tableNumber) {
  const base = getApiBase()
  const res = await fetch(
    `${base}/api/public/restaurants/${encodeURIComponent(slug)}/tables/${encodeURIComponent(String(tableNumber))}/waiter-call`,
    {
      method: "POST",
      headers: { Accept: "application/json" },
    }
  )
  const { body, ok } = await parseJson(res)
  if (!ok) {
    const msg = body && body.error ? body.error : `Could not call waiter (${res.status})`
    throw new Error(msg)
  }
  return body.data
}
