const path = require("path");
const express = require("express");
const Stripe = require("stripe");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const app = express();
const port = process.env.PORT || 3000;

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("Missing STRIPE_SECRET_KEY in .env");
}

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const PRODUCT_PRICE_CENTS = 50;

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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, () => {
  console.log(`MyAgentTee server running at http://localhost:${port}`);
});
