const KEY = "orderkaro_cart_v1"

function emptyCart(slug, tableNumber, restaurantName) {
  return {
    restaurantSlug: slug,
    tableNumber,
    restaurantName: restaurantName || "",
    lines: [],
  }
}

export function loadCart() {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || !data.restaurantSlug || !Array.isArray(data.lines)) return null
    return data
  } catch {
    return null
  }
}

export function saveCart(cart) {
  sessionStorage.setItem(KEY, JSON.stringify(cart))
}

export function clearCart() {
  sessionStorage.removeItem(KEY)
}

/** Ensure cart matches slug/table; reset if restaurant context changed. */
export function ensureCart(slug, tableNumber, restaurantName) {
  const slugNorm = String(slug || "").trim()
  const tableNorm = Number(tableNumber)
  let c = loadCart()
  if (
    !c ||
    String(c.restaurantSlug || "").trim() !== slugNorm ||
    Number(c.tableNumber) !== tableNorm
  ) {
    c = emptyCart(slugNorm, tableNorm, restaurantName)
    saveCart(c)
    return c
  }
  if (restaurantName && c.restaurantName !== restaurantName) {
    c.restaurantName = restaurantName
    saveCart(c)
  }
  return c
}

export function getQuantityForMenuItem(cart, menuItemId) {
  const line = cart.lines.find(
    (l) => l.menuItemId === menuItemId && (l.note || "") === ""
  )
  return line ? line.quantity : 0
}

/** Set quantity for a line without a note (same key as addLine). qty 0 removes the line. */
export function setMenuItemLineQuantity(cart, { menuItemId, name, unitPrice }, quantity) {
  const q = Math.max(0, Math.floor(Number(quantity)))
  const idx = cart.lines.findIndex(
    (l) => l.menuItemId === menuItemId && (l.note || "") === ""
  )
  if (q === 0) {
    if (idx >= 0) cart.lines.splice(idx, 1)
  } else if (idx >= 0) {
    cart.lines[idx].quantity = q
  } else {
    cart.lines.push({
      menuItemId,
      name,
      unitPrice: Number(unitPrice),
      quantity: q,
      note: "",
    })
  }
  saveCart(cart)
  return cart
}

export function addLine(cart, { menuItemId, name, unitPrice }) {
  const line = cart.lines.find(
    (l) => l.menuItemId === menuItemId && (l.note || "") === ""
  )
  if (line) {
    line.quantity += 1
  } else {
    cart.lines.push({
      menuItemId,
      name,
      unitPrice: Number(unitPrice),
      quantity: 1,
      note: "",
    })
  }
  saveCart(cart)
  return cart
}

export function setLineQuantity(cart, index, quantity) {
  const q = Math.max(0, Math.floor(Number(quantity)))
  if (!cart.lines[index]) return cart
  if (q === 0) {
    cart.lines.splice(index, 1)
  } else {
    cart.lines[index].quantity = q
  }
  saveCart(cart)
  return cart
}

export function setLineNote(cart, index, note) {
  if (!cart.lines[index]) return cart
  cart.lines[index].note = note == null ? "" : String(note).slice(0, 2000)
  saveCart(cart)
  return cart
}

export function cartTotals(cart) {
  let count = 0
  let total = 0
  for (const l of cart.lines) {
    count += l.quantity
    total += l.quantity * Number(l.unitPrice)
  }
  return { count, total }
}

export function toOrderPayload(cart) {
  return {
    restaurantSlug: cart.restaurantSlug,
    tableNumber: cart.tableNumber,
    items: cart.lines.map((l) => ({
      menuItemId: l.menuItemId,
      quantity: l.quantity,
      note: l.note && l.note.trim() ? l.note.trim() : null,
    })),
  }
}
