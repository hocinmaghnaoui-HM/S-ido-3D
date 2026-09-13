const loginScreen = document.getElementById("loginScreen");
const adminScreen = document.getElementById("adminScreen");
const passwordInput = document.getElementById("passwordInput");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");
const logoutBtn = document.getElementById("logoutBtn");

let adminKey = localStorage.getItem("saido_admin_key") || "";

function apiHeaders() {
  return { "Content-Type": "application/json", "X-Admin-Key": adminKey };
}

// ================= AUTH =================

function showAdmin() {
  loginScreen.style.display = "none";
  adminScreen.style.display = "block";
  loadDashboard();
  loadOrders();
  loadProducts();
  loadZones();
}

function showLogin() {
  loginScreen.style.display = "flex";
  adminScreen.style.display = "none";
}

async function tryAutoLogin() {
  if (!adminKey) return showLogin();
  const res = await fetch("/api/admin/summary", { headers: apiHeaders() });
  if (res.ok) showAdmin();
  else { localStorage.removeItem("saido_admin_key"); showLogin(); }
}

loginBtn.addEventListener("click", async () => {
  const password = passwordInput.value;
  loginError.textContent = "";
  const res = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (data.ok) {
    adminKey = password;
    localStorage.setItem("saido_admin_key", password);
    showAdmin();
  } else {
    loginError.textContent = "كلمة المرور غير صحيحة.";
  }
});

passwordInput.addEventListener("keydown", e => { if (e.key === "Enter") loginBtn.click(); });

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("saido_admin_key");
  adminKey = "";
  showLogin();
});

// ================= TABS =================

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

// ================= DASHBOARD =================

async function loadDashboard() {
  const res = await fetch("/api/admin/summary", { headers: apiHeaders() });
  if (!res.ok) return;
  const data = await res.json();
  document.getElementById("statOrders").textContent = data.totalOrders;
  document.getElementById("statRevenue").textContent = `${data.totalRevenue} دج`;
  document.getElementById("statProducts").textContent = data.activeProducts;
  const breakdown = document.getElementById("statusBreakdown");
  const entries = Object.entries(data.byStatus || {});
  breakdown.innerHTML = entries.length
    ? entries.map(([status, count]) => `<span class="status-pill status-${status}">${status}: ${count}</span>`).join("")
    : `<p class="hint">لا توجد طلبات بعد.</p>`;
}

// ================= ORDERS =================

const ORDER_STATUSES = ["جديد", "مؤكد", "تم الشحن", "تم التسليم", "ملغى"];

async function loadOrders() {
  const list = document.getElementById("ordersList");
  list.innerHTML = `<p class="hint">جاري التحميل...</p>`;
  const res = await fetch("/api/admin/orders", { headers: apiHeaders() });
  if (!res.ok) { list.innerHTML = `<p class="hint">تعذر تحميل الطلبات.</p>`; return; }
  const orders = await res.json();
  if (!orders.length) { list.innerHTML = `<p class="hint">لا توجد طلبات بعد.</p>`; return; }

  list.innerHTML = "";
  for (const o of orders) {
    const row = document.createElement("div");
    row.className = "admin-row";
    const date = new Date(o.createdAt).toLocaleString("ar-DZ");
    row.innerHTML = `
      <div class="row-info">
        <h4>${o.name} — ${o.productName} ×${o.qty}</h4>
        <small>${o.phone} · ${o.wilaya}، ${o.commune}</small>
        <small>${date} · المجموع: ${o.total} دج (توصيل: ${o.deliveryFee || 0} دج)</small>
        ${o.notes ? `<small>ملاحظات: ${o.notes}</small>` : ""}
      </div>
      <div class="row-actions">
        <select data-id="${o.id}" class="status-select">
          ${ORDER_STATUSES.map(s => `<option value="${s}" ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}
        </select>
        <button data-action="delete" data-id="${o.id}">حذف</button>
      </div>`;
    list.appendChild(row);
  }

  list.querySelectorAll(".status-select").forEach(sel => {
    sel.addEventListener("change", async () => {
      await fetch(`/api/admin/orders/${encodeURIComponent(sel.dataset.id)}`, {
        method: "PUT",
        headers: apiHeaders(),
        body: JSON.stringify({ status: sel.value })
      });
      loadDashboard();
    });
  });

  list.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("حذف هذا الطلب نهائيًا؟")) return;
      await fetch(`/api/admin/orders/${encodeURIComponent(btn.dataset.id)}`, {
        method: "DELETE",
        headers: apiHeaders()
      });
      loadOrders();
      loadDashboard();
    });
  });
}

// ================= PRODUCTS =================

const productForm = document.getElementById("productForm");
const formTitle = document.getElementById("formTitle");
const formMsg = document.getElementById("formMsg");
const productIdField = document.getElementById("productId");
const pName = document.getElementById("pName");
const pDescription = document.getElementById("pDescription");
const pImage = document.getElementById("pImage");
const pActive = document.getElementById("pActive");
const tiersList = document.getElementById("tiersList");
const addTierBtn = document.getElementById("addTierBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const productsList = document.getElementById("productsList");

function addTierRow(qty = "", price = "") {
  const row = document.createElement("div");
  row.className = "tier-row";
  row.innerHTML = `
    <input type="number" class="tier-qty" placeholder="الكمية" value="${qty}" min="1">
    <input type="number" class="tier-price" placeholder="السعر (دج)" value="${price}" min="0">
    <button type="button">✕</button>`;
  row.querySelector("button").addEventListener("click", () => row.remove());
  tiersList.appendChild(row);
}

addTierBtn.addEventListener("click", () => addTierRow());

function readTiers() {
  return [...tiersList.querySelectorAll(".tier-row")]
    .map(row => ({
      qty: Number(row.querySelector(".tier-qty").value),
      price: Number(row.querySelector(".tier-price").value)
    }))
    .filter(t => t.qty > 0 && t.price >= 0);
}

function resetForm() {
  productForm.reset();
  productIdField.value = "";
  pActive.checked = true;
  tiersList.innerHTML = "";
  addTierRow(1, 350);
  formTitle.textContent = "إضافة منتج جديد";
  cancelEditBtn.style.display = "none";
  formMsg.textContent = "";
}

cancelEditBtn.addEventListener("click", resetForm);

async function loadProducts() {
  productsList.innerHTML = `<p class="hint">جاري التحميل...</p>`;
  const res = await fetch("/api/admin/products", { headers: apiHeaders() });
  if (!res.ok) { productsList.innerHTML = `<p class="hint">تعذر تحميل المنتجات.</p>`; return; }
  const products = await res.json();

  if (!products.length) { productsList.innerHTML = `<p class="hint">لا توجد منتجات بعد.</p>`; return; }

  productsList.innerHTML = "";
  for (const p of products) {
    const row = document.createElement("div");
    row.className = "admin-row";
    const priceSummary = p.tiers.map(t => `${t.qty}×${t.price}دج`).join(" · ");
    row.innerHTML = `
      <img src="${p.image}" alt="${p.name}">
      <div class="row-info">
        <h4>${p.name} ${p.active === false ? '<span class="inactive-badge">(مخفي)</span>' : ""}</h4>
        <small>${priceSummary}</small>
      </div>
      <div class="row-actions">
        <button data-action="edit">تعديل</button>
        <button data-action="toggle">${p.active === false ? "إظهار" : "إخفاء"}</button>
        <button data-action="delete">حذف</button>
      </div>`;
    row.querySelector('[data-action="edit"]').addEventListener("click", () => fillFormForEdit(p));
    row.querySelector('[data-action="toggle"]').addEventListener("click", () => toggleActive(p));
    row.querySelector('[data-action="delete"]').addEventListener("click", () => deleteProduct(p));
    productsList.appendChild(row);
  }
}

function fillFormForEdit(p) {
  productIdField.value = p.id;
  pName.value = p.name;
  pDescription.value = p.description || "";
  pImage.value = p.image || "";
  pActive.checked = p.active !== false;
  tiersList.innerHTML = "";
  (p.tiers || []).forEach(t => addTierRow(t.qty, t.price));
  formTitle.textContent = "تعديل المنتج";
  cancelEditBtn.style.display = "inline-flex";
  formMsg.textContent = "";
}

async function toggleActive(p) {
  await fetch(`/api/admin/products/${encodeURIComponent(p.id)}`, {
    method: "PUT",
    headers: apiHeaders(),
    body: JSON.stringify({ active: p.active === false })
  });
  loadProducts();
  loadDashboard();
}

async function deleteProduct(p) {
  if (!confirm(`حذف "${p.name}" نهائيًا؟`)) return;
  await fetch(`/api/admin/products/${encodeURIComponent(p.id)}`, {
    method: "DELETE",
    headers: apiHeaders()
  });
  loadProducts();
  loadDashboard();
}

productForm.addEventListener("submit", async e => {
  e.preventDefault();
  formMsg.textContent = "";
  const tiers = readTiers();
  if (!tiers.length) { formMsg.textContent = "أضف كمية وسعر واحد على الأقل."; return; }

  const payload = {
    name: pName.value.trim(),
    description: pDescription.value.trim(),
    image: pImage.value.trim() || "/images/product-main.jpg",
    active: pActive.checked,
    tiers
  };

  const id = productIdField.value;
  const res = await fetch(id ? `/api/admin/products/${encodeURIComponent(id)}` : "/api/admin/products", {
    method: id ? "PUT" : "POST",
    headers: apiHeaders(),
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (data.ok) {
    resetForm();
    loadProducts();
    loadDashboard();
  } else {
    formMsg.textContent = data.error || "حدث خطأ أثناء الحفظ.";
  }
});

resetForm();

// ================= DELIVERY ZONES =================

const zonesList = document.getElementById("zonesList");
const saveZonesBtn = document.getElementById("saveZonesBtn");
const zonesMsg = document.getElementById("zonesMsg");
const wilayas = (window.SAIDO_LOCATIONS && window.SAIDO_LOCATIONS.wilayas) || [];

async function loadZones() {
  zonesList.innerHTML = `<p class="hint">جاري التحميل...</p>`;
  const res = await fetch("/api/admin/delivery-zones", { headers: apiHeaders() });
  const zones = res.ok ? await res.json() : {};

  zonesList.innerHTML = "";
  for (const w of wilayas) {
    const row = document.createElement("div");
    row.className = "zone-row";
    row.innerHTML = `
      <span>${String(w.code).padStart(2, "0")} — ${w.name_ar}</span>
      <input type="number" min="0" data-code="${w.code}" value="${zones[w.code] || ""}" placeholder="دج">`;
    zonesList.appendChild(row);
  }
}

saveZonesBtn.addEventListener("click", async () => {
  const zones = {};
  zonesList.querySelectorAll("input[data-code]").forEach(input => {
    const value = Number(input.value);
    if (value > 0) zones[input.dataset.code] = value;
  });
  const res = await fetch("/api/admin/delivery-zones", {
    method: "PUT",
    headers: apiHeaders(),
    body: JSON.stringify(zones)
  });
  const data = await res.json().catch(() => ({ ok: false }));
  zonesMsg.textContent = data.ok ? "تم الحفظ بنجاح ✅" : (data.error || "حدث خطأ أثناء الحفظ.");
  setTimeout(() => { zonesMsg.textContent = ""; }, 3000);
});

tryAutoLogin();
