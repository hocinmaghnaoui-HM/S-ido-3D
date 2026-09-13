// Säido Nuts — Worker backend (Professional Edition)
// Static site + Products API + Orders API + Delivery Zones + Admin dashboard

const PRODUCTS_KEY = "products";
const ORDERS_KEY = "orders";
const ZONES_KEY = "delivery_zones";

const DEFAULT_PRODUCTS = [
  {
    id: "peanut-butter-300",
    name: "زبدة الفول السوداني الطبيعية",
    description: "طعم غني وقوام كريمي، مناسبة مع الخبز، الفواكه، الشوفان والوجبات الخفيفة. 300 غرام، 100% طبيعية.",
    image: "/images/product-main.jpg",
    active: true,
    tiers: [
      { qty: 1, price: 350 },
      { qty: 3, price: 1000 },
      { qty: 10, price: 3000 }
    ]
  }
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function isAdmin(request, env) {
  const key = request.headers.get("X-Admin-Key") || "";
  return !!env.ADMIN_PASSWORD && key === env.ADMIN_PASSWORD;
}

async function kvGetJson(env, key, fallback) {
  if (!env.PRODUCTS_KV) return fallback;
  const raw = await env.PRODUCTS_KV.get(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

async function kvPutJson(env, key, value) {
  await env.PRODUCTS_KV.put(key, JSON.stringify(value));
}

async function getProducts(env) {
  const existing = await env.PRODUCTS_KV?.get(PRODUCTS_KEY);
  if (!existing) {
    await kvPutJson(env, PRODUCTS_KEY, DEFAULT_PRODUCTS);
    return DEFAULT_PRODUCTS;
  }
  try { return JSON.parse(existing); } catch { return DEFAULT_PRODUCTS; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    // ================= PUBLIC =================

    if (pathname === "/api/products" && method === "GET") {
      const all = await getProducts(env);
      return json(all.filter(p => p.active !== false));
    }

    if (pathname === "/api/delivery-zones" && method === "GET") {
      const zones = await kvGetJson(env, ZONES_KEY, {});
      return json(zones);
    }

    if (pathname === "/api/orders" && method === "POST") {
      if (!env.PRODUCTS_KV) return json({ ok: false, error: "لم يتم ربط KV بعد" }, 500);
      const body = await request.json().catch(() => null);
      if (!body || !body.name || !body.phone || !body.wilaya || !body.commune) {
        return json({ ok: false, error: "بيانات ناقصة" }, 400);
      }
      const zones = await kvGetJson(env, ZONES_KEY, {});
      const deliveryFee = Number(zones[body.wilayaCode]) || 0;
      const order = {
        id: crypto.randomUUID(),
        productId: body.productId || "",
        productName: body.productName || "",
        qty: Number(body.qty) || 1,
        price: Number(body.price) || 0,
        deliveryFee,
        total: (Number(body.price) || 0) + deliveryFee,
        name: body.name,
        phone: body.phone,
        wilaya: body.wilaya,
        wilayaCode: body.wilayaCode || null,
        commune: body.commune,
        notes: body.notes || "",
        status: "جديد",
        createdAt: new Date().toISOString()
      };
      const orders = await kvGetJson(env, ORDERS_KEY, []);
      orders.unshift(order);
      await kvPutJson(env, ORDERS_KEY, orders);
      return json({ ok: true, order });
    }

    // ================= ADMIN AUTH =================

    if (pathname === "/api/admin/login" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const ok = !!env.ADMIN_PASSWORD && body.password === env.ADMIN_PASSWORD;
      return json({ ok });
    }

    if (pathname.startsWith("/api/admin/")) {
      if (!isAdmin(request, env)) return json({ ok: false, error: "غير مصرح" }, 401);
      if (!env.PRODUCTS_KV) return json({ ok: false, error: "لم يتم ربط KV بعد. راجع تعليمات الإعداد." }, 500);
    } else if (pathname.startsWith("/api/")) {
      // fall through handled above; unknown /api/* public route
    } else {
      return env.ASSETS.fetch(request);
    }

    // ================= ADMIN: SUMMARY =================

    if (pathname === "/api/admin/summary" && method === "GET") {
      const orders = await kvGetJson(env, ORDERS_KEY, []);
      const products = await getProducts(env);
      const totalRevenue = orders
        .filter(o => o.status !== "ملغى")
        .reduce((sum, o) => sum + (o.total || 0), 0);
      const byStatus = {};
      for (const o of orders) byStatus[o.status] = (byStatus[o.status] || 0) + 1;
      return json({
        totalOrders: orders.length,
        totalRevenue,
        activeProducts: products.filter(p => p.active !== false).length,
        byStatus
      });
    }

    // ================= ADMIN: PRODUCTS =================

    if (pathname.startsWith("/api/admin/products")) {
      const products = await getProducts(env);

      if (pathname === "/api/admin/products" && method === "GET") return json(products);

      if (pathname === "/api/admin/products" && method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body || !body.name) return json({ ok: false, error: "بيانات ناقصة" }, 400);
        const product = {
          id: crypto.randomUUID(),
          name: body.name,
          description: body.description || "",
          image: body.image || "/images/product-main.jpg",
          active: body.active !== false,
          tiers: Array.isArray(body.tiers) && body.tiers.length ? body.tiers : [{ qty: 1, price: Number(body.price) || 0 }]
        };
        products.push(product);
        await kvPutJson(env, PRODUCTS_KEY, products);
        return json({ ok: true, product });
      }

      const idMatch = pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);
        const index = products.findIndex(p => p.id === id);

        if (method === "PUT") {
          if (index === -1) return json({ ok: false, error: "غير موجود" }, 404);
          const body = await request.json().catch(() => null);
          if (!body) return json({ ok: false, error: "بيانات غير صالحة" }, 400);
          products[index] = { ...products[index], ...body, id };
          await kvPutJson(env, PRODUCTS_KEY, products);
          return json({ ok: true, product: products[index] });
        }
        if (method === "DELETE") {
          if (index === -1) return json({ ok: false, error: "غير موجود" }, 404);
          const [removed] = products.splice(index, 1);
          await kvPutJson(env, PRODUCTS_KEY, products);
          return json({ ok: true, removed });
        }
      }
      return json({ ok: false, error: "غير مدعوم" }, 405);
    }

    // ================= ADMIN: ORDERS =================

    if (pathname.startsWith("/api/admin/orders")) {
      const orders = await kvGetJson(env, ORDERS_KEY, []);

      if (pathname === "/api/admin/orders" && method === "GET") return json(orders);

      const idMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)$/);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);
        const index = orders.findIndex(o => o.id === id);
        if (index === -1) return json({ ok: false, error: "غير موجود" }, 404);

        if (method === "PUT") {
          const body = await request.json().catch(() => null);
          if (!body || !body.status) return json({ ok: false, error: "بيانات غير صالحة" }, 400);
          orders[index].status = body.status;
          await kvPutJson(env, ORDERS_KEY, orders);
          return json({ ok: true, order: orders[index] });
        }
        if (method === "DELETE") {
          const [removed] = orders.splice(index, 1);
          await kvPutJson(env, ORDERS_KEY, orders);
          return json({ ok: true, removed });
        }
      }
      return json({ ok: false, error: "غير مدعوم" }, 405);
    }

    // ================= ADMIN: DELIVERY ZONES =================

    if (pathname === "/api/admin/delivery-zones") {
      if (method === "GET") {
        const zones = await kvGetJson(env, ZONES_KEY, {});
        return json(zones);
      }
      if (method === "PUT") {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") return json({ ok: false, error: "بيانات غير صالحة" }, 400);
        await kvPutJson(env, ZONES_KEY, body);
        return json({ ok: true, zones: body });
      }
      return json({ ok: false, error: "غير مدعوم" }, 405);
    }

    return json({ ok: false, error: "غير موجود" }, 404);
  }
};
