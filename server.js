// =========================
// Imports
// =========================
require("dotenv").config();
const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const cors = require("cors");
const QRCode = require("qrcode");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

// =========================
// Models
// =========================
const Otp = require("./server/models/Otp.js");
const Hospital = require("./server/models/Hospital.js");

// =========================
// App setup
// =========================
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "frontpage")));

// =========================
// Environment
// =========================
const PORT = process.env.PORT || 5001;

// URLs (local vs public)
const LOCAL_URL = `http://localhost:${PORT}`;
const PUBLIC_URL = "https://intelligentwebapp-1.onrender.com";

// =========================
// MongoDB
// =========================
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB error:", err));

// =========================
// In-memory storage
// =========================
const vehicleSessions = {};
const emergencies = {};

// =========================
// Helpers
// =========================
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// =========================
// ROOT HEALTH CHECK ✅
// =========================
app.get("/", (req, res) => {
  res.send("🚑 Intelligent Emergency Web App Backend is running");
});

// =========================
// OTP REQUEST
// =========================
app.post("/api/request-otp", async (req, res) => {
  try {
    const { hospitalName, userEmail } = req.body;

    const hospital = await Hospital.findOne({
      name: { $regex: `^${hospitalName}$`, $options: "i" }
    });
    if (!hospital) return res.status(404).send("❌ Hospital not found");

    const otp = generateOtp();
    const expires = new Date(Date.now() + 5 * 60 * 1000);

    await Otp.create({
      email: userEmail.toLowerCase(),
      code: otp,
      expires
    });

    const qrLink = `${PUBLIC_URL}/api/start-qr?email=${encodeURIComponent(
      userEmail
    )}`;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: userEmail,
      subject: "Emergency OTP & QR",
      text: `OTP: ${otp}\nScan QR: ${qrLink}\nValid for 5 minutes`
    });

    res.send("✅ OTP sent");
  } catch (err) {
    console.error("SMTP ERROR:", err);
    res.status(500).send("❌ OTP failed");
  }
});

// =========================
// OTP VERIFY
// =========================
app.post("/api/verify-otp", async (req, res) => {
  const { userEmail, code } = req.body;

  const otp = await Otp.findOne({
    email: userEmail.toLowerCase(),
    code
  });

  if (!otp) return res.status(401).send("❌ Invalid OTP");

  if (otp.expires < new Date()) {
    await Otp.deleteOne({ _id: otp._id });
    return res.status(410).send("❌ OTP expired");
  }

  await Otp.deleteOne({ _id: otp._id });
  res.send("✅ OTP verified");
});

// =========================
// START QR
// =========================
app.get("/api/start-qr", async (req, res) => {
  const email = req.query.email;

  const vehicle =
    "TN" +
    String.fromCharCode(65 + Math.floor(Math.random() * 26)) +
    String.fromCharCode(65 + Math.floor(Math.random() * 26)) +
    Math.floor(1000 + Math.random() * 9000);

  const token = crypto.randomBytes(8).toString("hex");

  vehicleSessions[vehicle] = {
    email,
    token,
    tracking: "active",
    listeners: []
  };

  const confirmUrl = `${PUBLIC_URL}/api/confirm-qr/${vehicle}/${token}`;
  const qr = await QRCode.toDataURL(confirmUrl, { width: 350 });

  res.send(`
    <html>
      <body style="background:#222;color:#fff;text-align:center;font-family:Arial;">
        <h1>Vehicle ${vehicle}</h1>
        <img src="${qr}" />
        <p>Scan at hospital to stop tracking</p>
        <script>
          const es = new EventSource("/api/subscribe/${vehicle}");
          es.onmessage = e => alert(e.data);
        </script>
      </body>
    </html>
  `);
});

// =========================
// CONFIRM QR
// =========================
app.get("/api/confirm-qr/:vehicle/:token", (req, res) => {
  res.send(`
    <form method="POST">
      <h3>Hospital Admin Login</h3>
      <input name="email" required placeholder="Admin Email"/><br/><br/>
      <input name="password" type="password" required placeholder="Password"/><br/><br/>
      <button>Confirm</button>
    </form>
  `);
});

app.post("/api/confirm-qr/:vehicle/:token", async (req, res) => {
  const { vehicle, token } = req.params;
  const session = vehicleSessions[vehicle];

  if (!session || session.token !== token)
    return res.send("❌ Invalid QR");

  const hospital = await Hospital.findOne({
    adminEmail: { $regex: `^${req.body.email}$`, $options: "i" }
  });

  if (!hospital) return res.send("❌ Unauthorized");

  const ok = await bcrypt.compare(
    req.body.password,
    hospital.adminPasswordHash
  );
  if (!ok) return res.send("❌ Wrong password");

  session.tracking = "stopped";

  session.listeners.forEach(r =>
    r.write("data: ✅ Tracking stopped — location disabled\n\n")
  );

  res.send("✅ Tracking stopped");
});

// =========================
// SSE
// =========================
app.get("/api/subscribe/:vehicle", (req, res) => {
  const { vehicle } = req.params;

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  if (!vehicleSessions[vehicle]) {
    vehicleSessions[vehicle] = {
      listeners: [],
      tracking: "active"
    };
  }

  vehicleSessions[vehicle].listeners.push(res);

  req.on("close", () => {
    vehicleSessions[vehicle].listeners =
      vehicleSessions[vehicle].listeners.filter(r => r !== res);
  });
});

// =========================
// 🚨 EMERGENCY ROUTES
// =========================
app.post("/api/emergency", (req, res) => {
  const { signalLocation, direction, vehicleNumber, active } = req.body;

  emergencies[signalLocation] = {
    direction,
    vehicleNumber,
    active
  };

  console.log("🚨 Emergency:", emergencies[signalLocation]);
  res.json({ success: true });
});

app.get("/api/signal/:signalLocation", (req, res) => {
  res.json(emergencies[req.params.signalLocation] || { active: false });
});

app.post("/api/clear-emergency", (req, res) => {
  const { signalLocation, vehicleNumber } = req.body;

  if (
    emergencies[signalLocation] &&
    emergencies[signalLocation].vehicleNumber === vehicleNumber
  ) {
    delete emergencies[signalLocation];
    return res.json({ success: true });
  }

  res.status(400).json({ success: false });
});

// =========================
// START SERVER
// =========================
app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Server running");
  console.log("🔁 Local access :", LOCAL_URL);
  console.log("🌐 Public URL  :", PUBLIC_URL);
});
