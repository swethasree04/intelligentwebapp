const axios = require("axios");

const SIGNAL_LOCATIONS = [
  "Signal_Guindy",
  "Signal_Tambaram",
  "Signal_AnnaNagar",
  "Signal_TNagar",
  "Signal_OMR",
  "Signal_Porur",
  "Signal_Koyambedu"
];

const DIRECTIONS = ["North","South","East","West"];
let isProcessing = false;

const SERVER_IP = "172.26.95.247"; // Your laptop IP
const PORT = 5001;

// Generate random vehicle number like TNAB1234
function generateVehicleNumber(){
  const letters = String.fromCharCode(
    65 + Math.floor(Math.random()*26),
    65 + Math.floor(Math.random()*26)
  );
  const numbers = Math.floor(1000 + Math.random()*9000);
  return `TN${letters}${numbers}`;
}

// Get random signal location
function getRandomSignalLocation(){
  return SIGNAL_LOCATIONS[Math.floor(Math.random()*SIGNAL_LOCATIONS.length)];
}

// Get random direction
function getRandomDirection(){
  return DIRECTIONS[Math.floor(Math.random()*DIRECTIONS.length)];
}

async function pollEmergencySignal(){
  if(isProcessing) return;
  isProcessing = true;

  try{
    const signalLocation = getRandomSignalLocation();
    const direction = getRandomDirection();
    const vehicleNumber = generateVehicleNumber();

    const API_URL = `http://${SERVER_IP}:${PORT}/api/signal/${signalLocation}`;
    const EMERGENCY_URL = `http://${SERVER_IP}:${PORT}/api/emergency`;
    const DEACTIVATE_URL = `http://${SERVER_IP}:${PORT}/api/clear-emergency`;

    // 1️⃣ Create emergency
    await axios.post(EMERGENCY_URL,{
      signalLocation,
      direction,
      vehicleNumber,
      active:true
    });

    console.log(`🚨 Emergency created for ${vehicleNumber} at ${signalLocation} (Direction: ${direction})`);

    // 2️⃣ Poll emergency
    const res = await axios.get(API_URL);
    const data = res.data;

    if(data.active && data.direction === direction){
      console.log("🚦 [SIMULATION] GREEN SIGNAL ON for 20 seconds");
      await new Promise(r=>setTimeout(r,20000));
      console.log("⛔ [SIMULATION] GREEN SIGNAL OFF");

      // 3️⃣ Clear emergency
      console.log("📤 Clearing emergency for:", {signalLocation, vehicleNumber: data.vehicleNumber});
      const clearRes = await axios.post(DEACTIVATE_URL,{
        signalLocation,
        vehicleNumber: data.vehicleNumber
      });
      console.log("✅ [SIMULATION] Emergency cleared:", clearRes.data);
    } else {
      console.log("✅ [SIMULATION] No emergency or not for this lane.");
    }

  } catch(err){
    console.error("❌ Error:");
    if(err.response){
      console.error("Status:", err.response.status);
      console.error("Data:", err.response.data);
    } else {
      console.error(err.message || err);
    }
  } finally {
    isProcessing = false;
  }
}

// Run every 30 seconds
setInterval(pollEmergencySignal, 30000);
