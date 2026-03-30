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
let currentRover = null;

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

function send(ws, msg) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(msg));
  }
}

function getPeer(ws) {
  if (ws === currentController) return currentRover;
  if (ws === currentRover) return currentController;
  return null;
}

const VALID_ACTIONS = new Set(["forward", "reverse", "left", "right", "stop"]);
const SIGNALING_TYPES = new Set(["offer", "answer", "ice-candidate"]);

wss.on("connection", (ws) => {
  let role = null;

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    // First message must identify role
    if (!role) {
      if (msg.type !== "join" || !msg.role) return;

      if (msg.role === "controller") {
        if (currentController) {
          send(ws, { type: "busy" });
          ws.close();
          return;
        }
        role = "controller";
        currentController = ws;
        send(ws, { type: "claimed", roverOnline: currentRover !== null });
        console.log("Controller connected");

        if (currentRover) {
          send(currentRover, { type: "peer-joined" });
        }
      } else if (msg.role === "rover") {
        if (currentRover) {
          send(ws, { type: "busy" });
          ws.close();
          return;
        }
        role = "rover";
        currentRover = ws;
        send(ws, { type: "claimed", controllerOnline: currentController !== null });
        console.log("Rover tablet connected");

        if (currentController) {
          send(currentController, { type: "rover-online" });
          send(currentRover, { type: "peer-joined" });
        }
      } else {
        ws.close();
      }
      return;
    }

    // Motor commands (controller only)
    if (msg.type === "command" && role === "controller") {
      const { action, speed } = msg;
      if (!VALID_ACTIONS.has(action)) return;
      const argument =
        action === "stop" ? "stop" : `${action},${speed || 150}`;
      fireCommand(argument);
      return;
    }

    // WebRTC signaling — relay to peer
    if (SIGNALING_TYPES.has(msg.type)) {
      const peer = getPeer(ws);
      if (peer) send(peer, msg);
      return;
    }
  });

  ws.on("close", () => {
    if (ws === currentController) {
      currentController = null;
      fireCommand("stop");
      fireCommand("stop");
      console.log("Controller disconnected, rover stopped");
      send(currentRover, { type: "peer-left" });
    } else if (ws === currentRover) {
      currentRover = null;
      console.log("Rover tablet disconnected");
      send(currentController, { type: "rover-offline" });
    }
  });

  ws.on("error", () => {
    if (ws === currentController) {
      currentController = null;
      fireCommand("stop");
      fireCommand("stop");
      send(currentRover, { type: "peer-left" });
    } else if (ws === currentRover) {
      currentRover = null;
      send(currentController, { type: "rover-offline" });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Rover control server running on http://localhost:${PORT}`);
});
