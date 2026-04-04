/** Format amounts from API (numeric) for display — matches existing ₹ UI. */
export function formatMoney(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return "—"
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

export function formatOrderId(id) {
  if (!id || typeof id !== "string") return "—"
  const short = id.replace(/-/g, "").slice(0, 8).toUpperCase()
  return `#${short}`
}

/** ISO string → local date + time for track page (12-hour clock). */
export function formatTrackDateTime(iso) {
  if (!iso || typeof iso !== "string") return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}
