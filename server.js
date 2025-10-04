// =========================
// Imports
// =========================
require('dotenv').config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const cors = require('cors');
const QRCode = require('qrcode');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// =========================
// Models
// =========================
const Otp = require('./server/models/Otp.js');
const Hospital = require('./server/models/Hospital.js');
const Emergency = require('./server/models/emergency.js');

// =========================
// App setup
// =========================
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'frontpage')));

// =========================
// Environment
// =========================
const PORT = process.env.PORT || 5001;
const SERVER_IP = "172.26.95.247"; // Your laptop IP
const BASE_URL = `http://${SERVER_IP}:${PORT}`;

// =========================
// MongoDB connection
// =========================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// =========================
// State Storage
// =========================
const vehicleSessions = {}; // for vehicles
let emergencies = {}; // for emergency simulation

// =========================
// OTP Generator
// =========================
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// =========================
// OTP Request
// =========================
app.post("/api/request-otp", async (req, res) => {
  try {
    const { hospitalName, userEmail } = req.body;
    const hospital = await Hospital.findOne({ name: { $regex: `^${hospitalName}$`, $options: 'i' } });
    if (!hospital) return res.status(404).send("❌ Hospital not found");

    const otp = generateOtp();
    const expires = new Date(Date.now() + 5 * 60 * 1000);
    await Otp.create({ email: userEmail.toLowerCase(), code: otp, expires });

    const qrLink = `${BASE_URL}/api/start-qr?email=${encodeURIComponent(userEmail)}`;

    const transporter = nodemailer.createTransport({
      host: hospital.smtp.host,
      port: hospital.smtp.port,
      secure: hospital.smtp.secure,
      auth: hospital.smtp.auth,
    });

    await transporter.sendMail({
      from: hospital.emailFrom,
      to: userEmail,
      subject: "Your Emergency OTP & QR Link",
      text: `Your OTP code is: ${otp}\nScan QR here: ${qrLink}\nValid for 3 hours.`,
    });

    res.status(200).send("✅ OTP & QR link sent to your email.");
  } catch (err) {
    console.error(err);
    res.status(500).send("❌ Failed to send OTP.");
  }
});

// =========================
// OTP Verification
// =========================
app.post("/api/verify-otp", async (req, res) => {
  try {
    const { userEmail, code } = req.body;
    const otpRecord = await Otp.findOne({ email: userEmail.toLowerCase(), code });
    if (!otpRecord) return res.status(401).send("❌ Invalid OTP");
    if (otpRecord.expires < new Date()) {
      await Otp.deleteOne({ _id: otpRecord._id });
      return res.status(410).send("❌ OTP expired");
    }
    await Otp.deleteOne({ _id: otpRecord._id });
    res.status(200).send("✅ OTP verified — you can now start vehicle session.");
  } catch (err) {
    res.status(500).send("❌ Failed to verify OTP");
  }
});

// =========================
// Start QR Page
// =========================
app.get("/api/start-qr", async (req, res) => {
  const userEmail = req.query.email || null;

  const randomVehicle = "TN" +
    String.fromCharCode(65 + Math.floor(Math.random() * 26)) +
    String.fromCharCode(65 + Math.floor(Math.random() * 26)) +
    Math.floor(1000 + Math.random() * 9000);

  const token = crypto.randomBytes(8).toString('hex');

  vehicleSessions[randomVehicle] = { email: userEmail, ledStatus: 'on', trackingStatus: 'active', token, listeners: [] };

  const confirmUrl = `${BASE_URL}/api/confirm-qr/${randomVehicle}/${token}`;
  const qrDataUrl = await QRCode.toDataURL(confirmUrl, { width: 400 });

  res.send(`
    <html>
      <head>
        <style>
          body { background:#222; color:#fff; font-family:Arial; text-align:center; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; }
          h1 { font-size:36px; margin-bottom:20px; }
          img { width:400px; height:400px; margin-bottom:20px; }
          p { font-size:20px; }
        </style>
      </head>
      <body>
        <h1>Vehicle: ${randomVehicle}</h1>
        <img src="${qrDataUrl}" />
        <p>Scan this QR at hospital to stop tracking</p>

        <script>
          const vehicleId = "${randomVehicle}";
          const evtSource = new EventSource("/api/subscribe/" + vehicleId);
          evtSource.onmessage = function(event) {
            alert(event.data); // Popup when tracking is stopped
          };
        </script>
      </body>
    </html>
  `);
});

// =========================
// Confirm QR GET & POST
// =========================
app.get("/api/confirm-qr/:vehicle/:token", (req, res) => {
  const { vehicle, token } = req.params;
  const session = vehicleSessions[vehicle];
  if (!session || session.token !== token) return res.status(400).send("❌ Invalid QR.");

  res.send(`
    <html>
      <body style="text-align:center; font-family:Arial; padding:50px;">
        <h2>Hospital Admin Login</h2>
        <form method="POST" action="/api/confirm-qr/${vehicle}/${token}">
          <input type="email" name="email" placeholder="Admin Email" required /><br/><br/>
          <input type="password" name="password" placeholder="Password" required /><br/><br/>
          <button type="submit">Confirm</button>
        </form>
      </body>
    </html>
  `);
});

app.post("/api/confirm-qr/:vehicle/:token", async (req, res) => {
  const { vehicle, token } = req.params;
  const { email, password } = req.body;
  const session = vehicleSessions[vehicle];
  if (!session || session.token !== token) return res.status(400).send("❌ Invalid QR.");

  const hospital = await Hospital.findOne({ adminEmail: { $regex: `^${email}$`, $options:'i' } });
  if (!hospital || !hospital.adminPasswordHash) return res.send("<script>alert('❌ Unauthorized'); window.history.back();</script>");

  const match = await bcrypt.compare(password, hospital.adminPasswordHash);
  if (!match) return res.send("<script>alert('❌ Invalid password'); window.history.back();</script>");

  session.trackingStatus = 'stopped';
  session.ledStatus = 'off';

  // Notify all SSE listeners
  if (session.listeners && session.listeners.length > 0) {
    session.listeners.forEach(r => r.write(`data: ✅ Tracking stopped — vehicle location turned off!\n\n`));
  }

  res.send("<script>alert('✅ Tracking stopped — vehicle location turned off.'); window.close();</script>");
});

// =========================
// SSE Subscription for real-time popup
// =========================
app.get("/api/subscribe/:vehicle", (req, res) => {
  const { vehicle } = req.params;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  if (!vehicleSessions[vehicle]) vehicleSessions[vehicle] = { listeners: [] };
  vehicleSessions[vehicle].listeners.push(res);

  req.on("close", () => {
    vehicleSessions[vehicle].listeners = vehicleSessions[vehicle].listeners.filter(r => r !== res);
  });
});

// =========================
// Vehicle Location APIs
// =========================
app.post("/api/update-location", (req, res) => {
  const { vehicleId, latitude, longitude } = req.body;
  if (!vehicleSessions[vehicleId]) vehicleSessions[vehicleId] = { trackingStatus:"active" };
  vehicleSessions[vehicleId].location = { latitude, longitude };
  res.send("✅ Location updated");
});

app.get("/api/status/:vehicleId", (req,res)=>{
  const session = vehicleSessions[req.params.vehicleId];
  if(!session) return res.json({trackingStatus:"unknown"});
  res.json({trackingStatus: session.trackingStatus});
});

// =========================
// Emergency APIs
// =========================
app.post("/api/emergency", (req,res)=>{
  const { signalLocation,direction,vehicleNumber,active } = req.body;
  emergencies[signalLocation] = { direction, vehicleNumber, active };
  console.log("🚨 Emergency created:", emergencies[signalLocation]);
  res.json({success:true, data: emergencies[signalLocation]});
});

app.post("/api/clear-emergency", (req,res)=>{
  const { signalLocation, vehicleNumber } = req.body;
  if(emergencies[signalLocation] && emergencies[signalLocation].vehicleNumber===vehicleNumber){
    delete emergencies[signalLocation];
    return res.json({success:true,message:"Emergency cleared"});
  }
  res.status(400).json({success:false,message:"No matching emergency found"});
});

app.get("/api/signal/:signalLocation",(req,res)=>{
  const {signalLocation} = req.params;
  const emergency = emergencies[signalLocation] || {active:false};
  res.json(emergency);
});

// =========================
// Start Server
// =========================
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server running at ${BASE_URL}`));
