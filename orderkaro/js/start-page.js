import {
  applyRememberedThemeColor,
  getSlugFromUrl,
  rememberThemeColor,
  syncStaffOrderModeFromUrl,
  buildMenuUrlForTable,
  DEFAULT_SLUG,
  isStaffOrderMode,
} from "./config.js"
import { fetchRestaurantTables } from "./api.js"
import {
  postStaffLogin,
  postStaffLogout,
  requireStaffOrderAuth,
  staffDisplayName,
} from "./staff-auth.js"

function $(sel, root = document) {
  return root.querySelector(sel)
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function showLoginError(message) {
  const errEl = $("#start-login-error")
  if (!errEl) return
  if (!message) {
    errEl.hidden = true
    errEl.textContent = ""
    return
  }
  errEl.textContent = message
  errEl.hidden = false
}

function setTablePickerVisible(visible) {
  const picker = $("#start-table-picker")
  if (picker) picker.hidden = !visible
}

function setLoginOnlyUi() {
  const loginSection = $("#start-login-section")
  const signedInBar = $("#start-signed-in-bar")
  const lead = $("#start-lead")

  if (loginSection) {
    loginSection.hidden = false
    loginSection.setAttribute("aria-hidden", "false")
  }
  if (signedInBar) signedInBar.hidden = true
  setTablePickerVisible(false)
  if (lead) lead.textContent = "Sign in with your staff account to continue."
  showLoginError("")
}

function setSignedInUi(session) {
  const loginSection = $("#start-login-section")
  const signedInBar = $("#start-signed-in-bar")
  const signedInName = $("#start-signed-in-name")
  const lead = $("#start-lead")

  if (session) {
    if (loginSection) {
      loginSection.hidden = true
      loginSection.setAttribute("aria-hidden", "true")
    }
    if (signedInBar) signedInBar.hidden = false
    if (signedInName) signedInName.textContent = staffDisplayName(session)
    setTablePickerVisible(true)
    if (lead) lead.textContent = "Choose a table to start the order."
    showLoginError("")
    return
  }

  if (isStaffOrderMode()) {
    setLoginOnlyUi()
  }
}

function setCustomerModeUi() {
  const eyebrow = $("#start-eyebrow")
  const loginSection = $("#start-login-section")
  const signedInBar = $("#start-signed-in-bar")
  const lead = $("#start-lead")

  if (eyebrow) eyebrow.hidden = true
  if (loginSection) {
    loginSection.hidden = true
    loginSection.setAttribute("aria-hidden", "true")
  }
  if (signedInBar) signedInBar.hidden = true
  setTablePickerVisible(true)
  if (lead) lead.textContent = "Choose a table to start your order."
  showLoginError("")
}

function setStaffModeShell() {
  const eyebrow = $("#start-eyebrow")
  if (eyebrow) eyebrow.hidden = false
  setLoginOnlyUi()
}

function renderLogo(restaurant) {
  const slot = $("[data-restaurant-logo-slot]")
  if (!slot) return
  const url = String(restaurant?.logoUrl || "").trim()
  if (!url) {
    slot.hidden = true
    return
  }
  slot.hidden = false
  slot.innerHTML = `<img src="${escapeHtml(url)}" alt="" class="start-page__logo" />`
}

function bindTableGrid(slug, tables) {
  const grid = $("#start-table-grid")
  const search = $("#start-table-search")
  const noMatch = $("#start-no-match")
  if (!grid) return

  grid.innerHTML = tables
    .map(
      (t) => `<a class="start-table-card" href="${escapeHtml(buildMenuUrlForTable(slug, t.tableNumber))}" data-start-table="${t.tableNumber}" data-start-search="${escapeHtml(String(t.tableNumber))}">
        <span class="start-table-card__num">${escapeHtml(String(t.tableNumber))}</span>
        <span class="start-table-card__label">Table</span>
      </a>`,
    )
    .join("")
  grid.hidden = false

  const filter = () => {
    const q = String(search?.value || "").trim()
    let visible = 0
    grid.querySelectorAll("[data-start-table]").forEach((el) => {
      const num = String(el.getAttribute("data-start-search") || "")
      const show = !q || num.includes(q)
      el.classList.toggle("is-filter-hidden", !show)
      if (show) visible += 1
    })
    if (noMatch) noMatch.hidden = visible > 0 || !q
  }

  search?.addEventListener("input", filter)
  filter()
}

async function loadRestaurantHeader(slug) {
  const title = $("#start-restaurant-name")
  try {
    const data = await fetchRestaurantTables(slug)
    const restaurant = data?.restaurant || {}
    if (title) title.textContent = String(restaurant.name || slug)
    rememberThemeColor(restaurant.themeColor)
    renderLogo(restaurant)
  } catch {
    if (title) title.textContent = slug
  }
}

async function loadTables(slug) {
  const loading = $("#start-loading")
  const empty = $("#start-empty")
  const errEl = $("#start-error")
  const title = $("#start-restaurant-name")
  const grid = $("#start-table-grid")

  if (loading) loading.hidden = false
  if (empty) empty.hidden = true
  if (errEl) {
    errEl.hidden = true
    errEl.textContent = ""
  }
  if (grid) grid.hidden = true

  try {
    const data = await fetchRestaurantTables(slug)
    if (loading) loading.hidden = true
    const restaurant = data?.restaurant || {}
    const tables = Array.isArray(data?.tables) ? data.tables : []
    if (title) title.textContent = String(restaurant.name || slug)
    rememberThemeColor(restaurant.themeColor)
    renderLogo(restaurant)

    if (!tables.length) {
      if (empty) empty.hidden = false
      return
    }
    bindTableGrid(slug, tables)
  } catch (e) {
    if (loading) loading.hidden = true
    const msg = e instanceof Error ? e.message : "Could not load tables"
    if (errEl) {
      errEl.textContent = msg
      errEl.hidden = false
    }
    if (title) title.textContent = slug
  }
}

async function onLoginSubmit(ev) {
  ev.preventDefault()
  const fd = new FormData(ev.target)
  const login = String(fd.get("login") || "").trim()
  const password = String(fd.get("password") || "")
  const slug = getSlugFromUrl(DEFAULT_SLUG)
  showLoginError("")
  try {
    const session = await postStaffLogin(login, password)
    const actualSlug = String(session?.restaurant?.slug || "").trim()
    if (actualSlug && actualSlug !== slug) {
      await postStaffLogout()
      showLoginError("This account belongs to a different restaurant.")
      setLoginOnlyUi()
      return
    }
    setSignedInUi(session)
    await loadTables(slug)
  } catch (e) {
    showLoginError(e instanceof Error ? e.message : "Sign in failed")
  }
}

async function onLogoutClick() {
  await postStaffLogout()
  setLoginOnlyUi()
  const grid = $("#start-table-grid")
  const loading = $("#start-loading")
  const empty = $("#start-empty")
  const errEl = $("#start-error")
  if (grid) {
    grid.hidden = true
    grid.innerHTML = ""
  }
  if (loading) loading.hidden = true
  if (empty) empty.hidden = true
  if (errEl) errEl.hidden = true
}

async function main() {
  applyRememberedThemeColor()
  syncStaffOrderModeFromUrl()
  const slug = getSlugFromUrl(DEFAULT_SLUG)

  if (isStaffOrderMode()) {
    setStaffModeShell()
    $("#start-login-form")?.addEventListener("submit", onLoginSubmit)
    $("#start-logout-btn")?.addEventListener("click", onLogoutClick)
    void loadRestaurantHeader(slug)

    try {
      const session = await requireStaffOrderAuth(slug)
      if (session) {
        setSignedInUi(session)
        await loadTables(slug)
      } else {
        setLoginOnlyUi()
      }
    } catch (e) {
      if (e && e.code === "RESTAURANT_MISMATCH") {
        await postStaffLogout()
        showLoginError(e.message)
      }
      setLoginOnlyUi()
    }
    return
  }

  setCustomerModeUi()
  await loadTables(slug)
}

main()
