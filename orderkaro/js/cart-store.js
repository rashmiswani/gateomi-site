const KEY = "orderkaro_cart_v1"

function emptyCart(slug, tableNumber, restaurantName) {
  return {
    restaurantSlug: slug,
    tableNumber,
    restaurantName: restaurantName || "",
    isGstEnabled: false,
    specialInstructions: "",
    customerName: "",
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
  if (typeof c.specialInstructions !== "string") {
    c.specialInstructions = ""
    saveCart(c)
  }
  if (typeof c.isGstEnabled !== "boolean") {
    c.isGstEnabled = false
    saveCart(c)
  }
  if (typeof c.customerName !== "string") {
    c.customerName = ""
    saveCart(c)
  }
  return c
}

export function getQuantityForMenuItem(cart, menuItemId) {
  const line = cart.lines.find((l) => l.menuItemId === menuItemId)
  return line ? line.quantity : 0
}

/** Set quantity for menu item. qty 0 removes the line. */
export function setMenuItemLineQuantity(cart, { menuItemId, name, unitPrice, photoUrl }, quantity) {
  const q = Math.max(0, Math.floor(Number(quantity)))
  const idx = cart.lines.findIndex((l) => l.menuItemId === menuItemId)
  if (q === 0) {
    if (idx >= 0) cart.lines.splice(idx, 1)
  } else if (idx >= 0) {
    cart.lines[idx].quantity = q
    cart.lines[idx].photoUrl = photoUrl || cart.lines[idx].photoUrl || null
  } else {
    cart.lines.push({
      menuItemId,
      name,
      unitPrice: Number(unitPrice),
      quantity: q,
      photoUrl: photoUrl || null,
    })
  }
  saveCart(cart)
  return cart
}

export function addLine(cart, { menuItemId, name, unitPrice }) {
  const line = cart.lines.find((l) => l.menuItemId === menuItemId)
  if (line) {
    line.quantity += 1
  } else {
    cart.lines.push({
      menuItemId,
      name,
      unitPrice: Number(unitPrice),
      quantity: 1,
      photoUrl: null,
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

export function setSpecialInstructions(cart, note) {
  cart.specialInstructions = note == null ? "" : String(note).slice(0, 2000)
  saveCart(cart)
  return cart
}

export function setCustomerName(cart, name) {
  cart.customerName = name == null ? "" : String(name).trim().slice(0, 120)
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
      note: null,
    })),
    specialInstructions: cart.specialInstructions && cart.specialInstructions.trim() ? cart.specialInstructions.trim() : null,
    customerName: cart.customerName && String(cart.customerName).trim() ? String(cart.customerName).trim().slice(0, 120) : null,
  }
}
