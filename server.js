const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const Particle = require("particle-api-js");
const path = require("path");

const particle = new Particle();

const TOKEN = process.env.PARTICLE_TOKEN;
const DEVICE_ID = process.env.PARTICLE_DEVICE_ID;
const PORT = process.env.PORT || 3000;

if (!TOKEN || !DEVICE_ID) {
  console.error(
    "Set these environment variables in your .env file:\n" +
      "  PARTICLE_TOKEN=your_access_token\n" +
      "  PARTICLE_DEVICE_ID=your_device_id"
  );
  process.exit(1);
}

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let currentController = null;

function fireCommand(argument) {
  particle
    .callFunction({
      deviceId: DEVICE_ID,
      name: "motor",
      argument,
      auth: TOKEN,
    })
    .catch((err) => {
      console.error("Motor command error:", err.body || err);
    });
}

const VALID_ACTIONS = new Set(["forward", "reverse", "left", "right", "stop"]);

wss.on("connection", (ws) => {
  if (currentController) {
    ws.send(JSON.stringify({ type: "busy" }));
    ws.close();
    return;
  }

  currentController = ws;
  ws.send(JSON.stringify({ type: "claimed" }));
  console.log("Controller connected");

  ws.on("message", (data) => {
    if (ws !== currentController) return;

    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    if (msg.type !== "command") return;

    const { action, speed } = msg;
    if (!VALID_ACTIONS.has(action)) return;

    const argument =
      action === "stop" ? "stop" : `${action},${speed || 150}`;
    fireCommand(argument);
  });

  ws.on("close", () => {
    if (ws === currentController) {
      currentController = null;
      fireCommand("stop");
      fireCommand("stop");
      console.log("Controller disconnected, rover stopped");
    }
  });

  ws.on("error", () => {
    if (ws === currentController) {
      currentController = null;
      fireCommand("stop");
      fireCommand("stop");
      console.log("Controller error, rover stopped");
    }
  });
});

server.listen(PORT, () => {
  console.log(`Rover control server running on http://localhost:${PORT}`);
});
