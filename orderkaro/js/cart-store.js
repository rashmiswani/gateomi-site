const KEY = "orderkaro_cart_v1"

function emptyCart(slug, tableNumber, restaurantName) {
  return {
    restaurantSlug: slug,
    tableNumber,
    serviceType: "DINE_IN",
    deliveryAddress: "",
    restaurantName: restaurantName || "",
    isGstEnabled: false,
    isGstInclusive: false,
    specialInstructions: "",
    customerName: "",
    customerMobile: "",
    lines: [],
  }
}

export function normalizeSelectedPortion(value) {
  const normalized = String(value || "").trim().toUpperCase()
  return normalized === "HALF" || normalized === "FULL" ? normalized : null
}

export function itemHasHalfFullOptions(item) {
  return Boolean(item?.hasHalfFullOptions)
}

export function getDisplayNameForMenuItem(name, selectedPortion = null) {
  const baseName = String(name || "Item").trim() || "Item"
  const portion = normalizeSelectedPortion(selectedPortion)
  if (!portion) return baseName
  return `${baseName} (${portion === "HALF" ? "Half" : "Full"})`
}

export function getUnitPriceForMenuItem(item, selectedPortion = null) {
  const portion = normalizeSelectedPortion(selectedPortion)
  if (itemHasHalfFullOptions(item)) {
    if (portion === "HALF") return Number(item?.halfPrice || 0)
    return Number(item?.fullPrice || item?.price || 0)
  }
  return Number(item?.price || 0)
}

export function buildCartLineKey(menuItemId, selectedPortion = null) {
  const portion = normalizeSelectedPortion(selectedPortion)
  return `${String(menuItemId || "")}::${portion || "STANDARD"}`
}

function normalizeCartLine(line) {
  const selectedPortion = normalizeSelectedPortion(line?.selectedPortion)
  const baseName = String(line?.baseName || line?.name || "Item").trim() || "Item"
  return {
    ...line,
    selectedPortion,
    baseName,
    name: getDisplayNameForMenuItem(baseName, selectedPortion),
    unitPrice: Number(line?.unitPrice || 0),
    quantity: Math.max(0, Math.floor(Number(line?.quantity || 0))),
    photoUrl: line?.photoUrl || null,
    foodType: line?.foodType || "VEG",
  }
}

export function loadCart() {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || !data.restaurantSlug || !Array.isArray(data.lines)) return null
    data.lines = data.lines.map(normalizeCartLine).filter((line) => line.quantity > 0)
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
export function ensureCart(slug, tableNumber, restaurantName, serviceType = "DINE_IN") {
  const slugNorm = String(slug || "").trim()
  const serviceNorm = String(serviceType || "").toUpperCase() === "DELIVERY" ? "DELIVERY" : "DINE_IN"
  const tableNorm = serviceNorm === "DELIVERY" ? null : Number(tableNumber)
  let c = loadCart()
  if (
    !c ||
    String(c.restaurantSlug || "").trim() !== slugNorm ||
    Number(c.tableNumber) !== Number(tableNorm) ||
    String(c.serviceType || "DINE_IN").toUpperCase() !== serviceNorm
  ) {
    c = emptyCart(slugNorm, tableNorm, restaurantName)
    c.serviceType = serviceNorm
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
  if (typeof c.isGstInclusive !== "boolean") {
    c.isGstInclusive = false
    saveCart(c)
  }
  if (typeof c.customerName !== "string") {
    c.customerName = ""
    saveCart(c)
  }
  if (typeof c.customerMobile !== "string") {
    c.customerMobile = ""
    saveCart(c)
  }
  if (typeof c.serviceType !== "string") {
    c.serviceType = serviceNorm
    saveCart(c)
  }
  if (typeof c.deliveryAddress !== "string") {
    c.deliveryAddress = ""
    saveCart(c)
  }
  return c
}

export function getQuantityForMenuItem(cart, menuItemId, selectedPortion = null) {
  const key = buildCartLineKey(menuItemId, selectedPortion)
  return cart.lines
    .filter((line) => buildCartLineKey(line.menuItemId, line.selectedPortion) === key)
    .reduce((sum, line) => sum + Number(line.quantity || 0), 0)
}

/** Set quantity for menu item. qty 0 removes the line. */
export function setMenuItemLineQuantity(
  cart,
  { menuItemId, name, unitPrice, photoUrl, foodType, selectedPortion = null },
  quantity
) {
  const q = Math.max(0, Math.floor(Number(quantity)))
  const portion = normalizeSelectedPortion(selectedPortion)
  const key = buildCartLineKey(menuItemId, portion)
  const idx = cart.lines.findIndex((line) => buildCartLineKey(line.menuItemId, line.selectedPortion) === key)
  if (q === 0) {
    if (idx >= 0) cart.lines.splice(idx, 1)
  } else if (idx >= 0) {
    cart.lines[idx].quantity = q
    cart.lines[idx].unitPrice = Number(unitPrice)
    cart.lines[idx].baseName = String(name || cart.lines[idx].baseName || cart.lines[idx].name || "Item").trim() || "Item"
    cart.lines[idx].name = getDisplayNameForMenuItem(cart.lines[idx].baseName, portion)
    cart.lines[idx].selectedPortion = portion
    cart.lines[idx].photoUrl = photoUrl || cart.lines[idx].photoUrl || null
    if (foodType != null && foodType !== "") {
      cart.lines[idx].foodType = foodType
    }
  } else {
    const baseName = String(name || "Item").trim() || "Item"
    cart.lines.push({
      menuItemId,
      baseName,
      name: getDisplayNameForMenuItem(baseName, portion),
      selectedPortion: portion,
      unitPrice: Number(unitPrice),
      quantity: q,
      photoUrl: photoUrl || null,
      foodType: foodType || "VEG",
    })
  }
  saveCart(cart)
  return cart
}

export function addLine(cart, { menuItemId, name, unitPrice, selectedPortion = null }) {
  const portion = normalizeSelectedPortion(selectedPortion)
  const key = buildCartLineKey(menuItemId, portion)
  const line = cart.lines.find((entry) => buildCartLineKey(entry.menuItemId, entry.selectedPortion) === key)
  if (line) {
    line.quantity += 1
  } else {
    const baseName = String(name || "Item").trim() || "Item"
    cart.lines.push({
      menuItemId,
      baseName,
      name: getDisplayNameForMenuItem(baseName, portion),
      selectedPortion: portion,
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

export function setCustomerMobile(cart, mobile) {
  cart.customerMobile = mobile == null ? "" : String(mobile).trim().slice(0, 32)
  saveCart(cart)
  return cart
}

export function setDeliveryAddress(cart, address) {
  cart.deliveryAddress = address == null ? "" : String(address).trim().slice(0, 500)
  saveCart(cart)
  return cart
}

export function cartTotals(cart) {
  let count = 0
  let total = 0
  for (const line of cart.lines) {
    count += line.quantity
    total += line.quantity * Number(line.unitPrice)
  }
  return { count, total }
}

export function toOrderPayload(cart) {
  const orderType = String(cart.serviceType || "").toUpperCase() === "DELIVERY" ? "DELIVERY" : "DINE_IN"
  return {
    restaurantSlug: cart.restaurantSlug,
    orderType,
    tableNumber: orderType === "DINE_IN" ? cart.tableNumber : null,
    deliveryAddress:
      orderType === "DELIVERY" && cart.deliveryAddress && String(cart.deliveryAddress).trim()
        ? String(cart.deliveryAddress).trim().slice(0, 500)
        : null,
    items: cart.lines.map((line) => ({
      menuItemId: line.menuItemId,
      quantity: line.quantity,
      selectedPortion: normalizeSelectedPortion(line.selectedPortion),
      note: null,
    })),
    specialInstructions: cart.specialInstructions && cart.specialInstructions.trim() ? cart.specialInstructions.trim() : null,
    customerName: cart.customerName && String(cart.customerName).trim() ? String(cart.customerName).trim().slice(0, 120) : null,
    customerMobile:
      cart.customerMobile && String(cart.customerMobile).trim()
        ? String(cart.customerMobile).trim().slice(0, 32)
        : null,
  }
}
