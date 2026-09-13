const cfg = window.SAIDO_CONFIG || {};
const locations = window.SAIDO_LOCATIONS || { wilayas: [], communesUrl: "" };

const wilaya = document.getElementById("wilaya");
const commune = document.getElementById("commune");
const locationStatus = document.getElementById("locationStatus");
const productSelect = document.getElementById("productSelect");
const qty = document.getElementById("qty");
const total = document.getElementById("total");
const productsGrid = document.getElementById("productsGrid");
const deliveryLine = document.getElementById("deliveryLine");

let products = [];
let zones = {};
let communesPromise = null;
let communesByWilaya = null;

// ---------- Products ----------
async function loadProducts() {
  try {
    const res = await fetch("/api/products");
    products = await res.json();
  } catch (e) {
    console.error("تعذر تحميل المنتجات", e);
    products = [];
  }
  renderProductsGrid();
  fillProductSelect();
}

async function loadZones() {
  try {
    const res = await fetch("/api/delivery-zones");
    zones = await res.json();
  } catch {
    zones = {};
  }
}

function renderProductsGrid() {
  if (!products.length) {
    productsGrid.innerHTML = `<p class="hint">لا توجد منتجات متاحة حاليًا.</p>`;
    return;
  }
  productsGrid.innerHTML = products.map(p => {
    const minPrice = Math.min(...p.tiers.map(t => t.price));
    return `
      <div class="product-tile">
        <img src="${p.image}" alt="${p.name}">
        <div class="pt-body">
          <h3>${p.name}</h3>
          <p>${p.description || ""}</p>
          <div class="pt-price">ابتداءً من ${minPrice} دج</div>
          <a class="btn primary full" href="#order" data-product-id="${p.id}">اطلب هذا المنتج</a>
        </div>
      </div>`;
  }).join("");

  productsGrid.querySelectorAll("[data-product-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      productSelect.value = btn.dataset.productId;
      updateQtyOptions();
    });
  });
}

function fillProductSelect() {
  productSelect.innerHTML = products.map(p => `<option value="${p.id}">${p.name}</option>`).join("");
  updateQtyOptions();
}

function updateQtyOptions() {
  const product = products.find(p => p.id === productSelect.value) || products[0];
  if (!product) { qty.innerHTML = ""; updateTotal(); return; }
  qty.innerHTML = product.tiers.map(t => `<option value="${t.qty}">${t.qty} علبة — ${t.price} دج</option>`).join("");
  updateTotal();
}

function currentDeliveryFee() {
  const code = wilaya.value;
  return code && zones[code] ? Number(zones[code]) : 0;
}

function updateTotal() {
  const product = products.find(p => p.id === productSelect.value) || products[0];
  const fee = currentDeliveryFee();
  if (!product) { total.textContent = "—"; return; }
  const q = Number(qty.value);
  const tier = product.tiers.find(t => t.qty === q);
  const price = tier ? tier.price : 0;
  if (deliveryLine) {
    deliveryLine.textContent = fee > 0 ? `رسوم التوصيل: ${fee} دج` : "التوصيل: يُحدَّد حسب المنطقة";
  }
  total.textContent = tier ? `${price + fee} دج` : "—";
}

productSelect?.addEventListener("change", updateQtyOptions);
qty?.addEventListener("change", updateTotal);

// ---------- Wilaya / Commune ----------
for (const item of locations.wilayas) {
  const option = document.createElement("option");
  option.value = String(item.code);
  option.textContent = `${String(item.code).padStart(2, "0")} — ${item.name_ar}`;
  wilaya.appendChild(option);
}

function setCommuneMessage(text, disabled = true) {
  commune.innerHTML = "";
  const option = document.createElement("option");
  option.value = "";
  option.textContent = text;
  commune.appendChild(option);
  commune.disabled = disabled;
}

async function loadCommunes() {
  if (communesByWilaya) return communesByWilaya;
  if (!communesPromise) {
    communesPromise = fetch(locations.communesUrl, { cache: "force-cache" })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(rows => {
        if (!Array.isArray(rows) || rows.length !== 1541) {
          throw new Error("Dataset communes incomplet");
        }
        const map = new Map();
        for (const row of rows) {
          const code = Number(row.wilaya_code);
          if (!map.has(code)) map.set(code, []);
          map.get(code).push(row);
        }
        communesByWilaya = map;
        return map;
      });
  }
  return communesPromise;
}

wilaya.addEventListener("change", async () => {
  const code = Number(wilaya.value);
  updateTotal();
  if (!code) {
    setCommuneMessage("اختر الولاية أولًا");
    if (locationStatus) locationStatus.textContent = "اختر الولاية ثم البلدية لإكمال الطلب.";
    return;
  }

  setCommuneMessage("جاري تحميل البلديات...", true);
  if (locationStatus) locationStatus.textContent = "جاري تحميل قائمة البلديات...";

  try {
    const map = await loadCommunes();
    const rows = [...(map.get(code) || [])].sort((a, b) => String(a.name_ar).localeCompare(String(b.name_ar), "ar"));
    commune.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = rows.length ? "اختر البلدية" : "لا توجد بلديات";
    commune.appendChild(placeholder);
    for (const row of rows) {
      const option = document.createElement("option");
      option.value = row.name_ar;
      option.textContent = row.name_ar;
      commune.appendChild(option);
    }
    commune.disabled = rows.length === 0;
    if (locationStatus) locationStatus.textContent = `تم تحميل ${rows.length} بلدية لهذه الولاية.`;
  } catch (error) {
    console.error("تعذر تحميل البلديات", error);
    setCommuneMessage("تعذر تحميل البلديات — حاول مرة أخرى", true);
    if (locationStatus) locationStatus.textContent = "تعذر تحميل قائمة البلديات. تحقق من اتصال الإنترنت ثم اختر الولاية من جديد.";
  }
});

// ---------- Social links ----------
for (const key of ["facebook", "instagram", "tiktok", "youtube"]) {
  const el = document.getElementById(key);
  if (el && cfg.social && cfg.social[key]) el.href = cfg.social[key];
}

// ---------- Submit order ----------
document.getElementById("orderForm").addEventListener("submit", async e => {
  e.preventDefault();
  const number = cfg.whatsappNumber || "";
  if (!/^213\d{9}$/.test(number)) {
    alert("رقم WhatsApp غير مضبوط في config.js");
    return;
  }
  if (!wilaya.value || !commune.value) {
    alert("يرجى اختيار الولاية والبلدية.");
    return;
  }
  const product = products.find(p => p.id === productSelect.value) || products[0];
  const selectedWilaya = locations.wilayas.find(x => String(x.code) === String(wilaya.value));
  const q = Number(qty.value);
  const tier = product?.tiers.find(t => t.qty === q);
  const price = tier ? tier.price : 0;
  const fee = currentDeliveryFee();

  const orderPayload = {
    productId: product?.id || "",
    productName: product?.name || "",
    qty: q,
    price,
    name: document.getElementById("name").value,
    phone: document.getElementById("phone").value,
    wilaya: selectedWilaya ? selectedWilaya.name_ar : wilaya.value,
    wilayaCode: wilaya.value,
    commune: commune.value,
    notes: document.getElementById("notes").value || ""
  };

  // Save the order server-side so it shows up in the admin dashboard
  try {
    await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orderPayload)
    });
  } catch (err) {
    console.error("تعذر حفظ الطلب في السجل", err);
  }

  const message =
`السلام عليكم، أريد طلب Säido Nuts 🥜

المنتج: ${orderPayload.productName}
الاسم: ${orderPayload.name}
الهاتف: ${orderPayload.phone}
الولاية: ${orderPayload.wilaya}
البلدية: ${orderPayload.commune}
الكمية: ${q} علبة
سعر المنتج: ${price} دج
رسوم التوصيل: ${fee} دج
المجموع: ${price + fee} دج
ملاحظات: ${orderPayload.notes || "لا توجد"}`;

  window.open(`https://wa.me/${number}?text=${encodeURIComponent(message)}`, "_blank");
});

loadProducts();
loadZones();
