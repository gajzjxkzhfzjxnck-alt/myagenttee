const path = require("path");
const fs = require("fs");
const express = require("express");
const Stripe = require("stripe");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const app = express();
const port = process.env.PORT || 3000;
const ORDERS_FILE = path.join(__dirname, "orders.json");

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("Missing STRIPE_SECRET_KEY in .env");
}

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const PRODUCT_PRICE_CENTS = 50;

function ensureOrdersFile() {
  if (!fs.existsSync(ORDERS_FILE)) {
    fs.writeFileSync(ORDERS_FILE, "[]\n", "utf8");
  }
}

function readOrders() {
  ensureOrdersFile();
  try {
    const raw = fs.readFileSync(ORDERS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Failed to parse orders.json. Resetting file.");
    fs.writeFileSync(ORDERS_FILE, "[]\n", "utf8");
    return [];
  }
}

function writeOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, `${JSON.stringify(orders, null, 2)}\n`, "utf8");
}

function upsertOrder(order) {
  const orders = readOrders();
  const index = orders.findIndex((item) => item.stripe_session_id === order.stripe_session_id);
  if (index >= 0) {
    orders[index] = order;
  } else {
    orders.unshift(order);
  }
  writeOrders(orders.slice(0, 200));
}

async function buildOrderFromSessionId(sessionId) {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (!session || session.payment_status !== "paid") {
    return null;
  }

  const amountTotal = Number(session.amount_total || 0) / 100;
  const amountSubtotal = Number(session.amount_subtotal || 0) / 100;
  const amountTax = Number(session.total_details?.amount_tax || 0) / 100;
  const amountShipping = Number(session.total_details?.amount_shipping || 0) / 100;

  const shipping = session.shipping_details || {};
  const address = shipping.address || {};

  return {
    stripe_session_id: session.id,
    stripe_payment_intent:
      typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || "",
    status: session.payment_status,
    currency: (session.currency || "usd").toUpperCase(),
    amount_total: amountTotal,
    amount_subtotal: amountSubtotal,
    amount_tax: amountTax,
    amount_shipping: amountShipping,
    email: session.customer_details?.email || session.customer_email || "",
    customer_name: shipping.name || session.customer_details?.name || "",
    shipping_address: [address.line1, address.line2, address.city, address.state, address.postal_code, address.country]
      .filter(Boolean)
      .join(", "),
    color: session.metadata?.color || "",
    size: session.metadata?.size || "",
    quantity: Number(session.metadata?.qty || 1),
    agent_name: session.metadata?.agent_name || "",
    created_at: new Date((session.created || Date.now() / 1000) * 1000).toISOString(),
    recorded_at: new Date().toISOString()
  };
}

app.use(express.urlencoded({ extended: false }));
app.use(express.static(__dirname));

app.post("/create-checkout-session", async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).send("Stripe is not configured. Add STRIPE_SECRET_KEY to .env and restart.");
    }

    const { color, size, qty, email, address, agent } = req.body;
    const quantity = Math.max(1, Number.parseInt(qty, 10) || 1);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      submit_type: "pay",
      success_url: `${req.protocol}://${req.get("host")}/thank-you.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.protocol}://${req.get("host")}/checkout.html?canceled=true`,
      billing_address_collection: "required",
      shipping_address_collection: {
        allowed_countries: ["US"]
      },
      customer_email: email,
      metadata: {
        color,
        size,
        qty: String(quantity),
        owner_address_input: address || "",
        agent_name: agent || ""
      },
      line_items: [
        {
          quantity,
          price_data: {
            currency: "usd",
            unit_amount: PRODUCT_PRICE_CENTS,
            product_data: {
              name: "MyAgentTee - Commemorative Edition",
              description: `Color: ${color}, Size: ${size}`
            }
          }
        }
      ]
    });

    return res.redirect(303, session.url);
  } catch (error) {
    console.error("Stripe checkout error:", error.message);
    return res.status(500).send("Unable to start checkout. Please check Stripe configuration.");
  }
});

app.get("/api/order-confirmation", async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId) {
      return res.status(400).json({ ok: false, message: "Missing session_id" });
    }

    const order = await buildOrderFromSessionId(String(sessionId));
    if (!order) {
      return res.status(200).json({ ok: true, paid: false, message: "Payment not completed yet." });
    }

    upsertOrder(order);
    return res.status(200).json({ ok: true, paid: true, order });
  } catch (error) {
    console.error("Order confirmation error:", error.message);
    return res.status(500).json({ ok: false, message: "Unable to confirm order." });
  }
});

app.get("/api/orders", (req, res) => {
  try {
    const orders = readOrders();
    return res.status(200).json({ ok: true, count: orders.length, orders });
  } catch (error) {
    console.error("Read orders error:", error.message);
    return res.status(500).json({ ok: false, message: "Unable to read orders." });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, () => {
  console.log(`MyAgentTee server running at http://localhost:${port}`);
});
