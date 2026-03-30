const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const Particle = require("particle-api-js");
const path = require("path");

const particle = new Particle();

const TOKEN = process.env.PARTICLE_TOKEN;
const DEVICE_ID = process.env.PARTICLE_DEVICE_ID;
const PORT = process.env.PORT || 3000;
const IDLE_TIMEOUT = 60000; // 1 minute

if (!TOKEN || !DEVICE_ID) {
  console.error(
    "Set these environment variables in your .env file:\n" +
      "  PARTICLE_TOKEN=your_access_token\n" +
      "  PARTICLE_DEVICE_ID=your_device_id"
  );
  process.exit(1);
}

const app = express();
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let currentRover = null;
let controllerId = null;
let lastCommandTime = 0;
const viewers = new Map(); // id -> ws
let nextId = 1;

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

function promoteViewer(newId) {
  const oldId = controllerId;
  const oldWs = viewers.get(oldId);
  const newWs = viewers.get(newId);

  fireCommand("stop");
  fireCommand("stop");

  controllerId = newId;
  lastCommandTime = Date.now();

  if (oldWs) send(oldWs, { type: "kicked" });
  if (newWs) send(newWs, { type: "promoted" });
  if (currentRover) send(currentRover, { type: "controller-changed", peerId: newId });

  console.log(`Controller changed: ${oldId} -> ${newId}`);
}

function promoteNextSpectator() {
  for (const [id] of viewers) {
    if (id !== controllerId) {
      promoteViewer(id);
      return;
    }
  }
}

function isControllerIdle() {
  return controllerId && Date.now() - lastCommandTime > IDLE_TIMEOUT;
}

function hasSpectators() {
  for (const [id] of viewers) {
    if (id !== controllerId) return true;
  }
  return false;
}

// Periodically check for idle controller with waiting spectators
setInterval(() => {
  if (isControllerIdle() && hasSpectators()) {
    promoteNextSpectator();
  }
}, 10000);

const VALID_ACTIONS = new Set(["forward", "reverse", "left", "right", "stop"]);
const SIGNALING_TYPES = new Set(["offer", "answer", "ice-candidate"]);

wss.on("connection", (ws) => {
  const id = String(nextId++);
  let role = null; // "rover" | "viewer"

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    // First message must be join
    if (!role) {
      if (msg.type !== "join" || !msg.role) return;

      if (msg.role === "rover") {
        if (currentRover) {
          send(ws, { type: "busy" });
          ws.close();
          return;
        }
        role = "rover";
        currentRover = ws;
        send(ws, { type: "claimed" });
        console.log("Rover tablet connected");

        // Tell rover about all existing viewers
        for (const [viewerId] of viewers) {
          send(currentRover, {
            type: "peer-joined",
            peerId: viewerId,
            isController: viewerId === controllerId,
          });
        }
        return;
      }

      if (msg.role === "controller") {
        role = "viewer";
        viewers.set(id, ws);

        if (!controllerId) {
          controllerId = id;
          lastCommandTime = Date.now();
          send(ws, { type: "claimed", roverOnline: currentRover !== null });
          console.log(`Controller ${id} connected`);
        } else if (isControllerIdle()) {
          // Kick idle controller, give control to new viewer
          const oldWs = viewers.get(controllerId);
          fireCommand("stop");
          fireCommand("stop");
          if (oldWs) send(oldWs, { type: "kicked" });
          if (currentRover) send(currentRover, { type: "controller-changed", peerId: id });
          controllerId = id;
          lastCommandTime = Date.now();
          send(ws, { type: "claimed", roverOnline: currentRover !== null });
          console.log(`Controller ${id} took over from idle controller`);
        } else {
          send(ws, { type: "watching", roverOnline: currentRover !== null });
          console.log(`Spectator ${id} connected`);
        }

        // Tell rover about new peer
        if (currentRover) {
          send(currentRover, {
            type: "peer-joined",
            peerId: id,
            isController: id === controllerId,
          });
        }
        return;
      }

      ws.close();
      return;
    }

    // Motor commands (controller only)
    if (msg.type === "command" && role === "viewer" && id === controllerId) {
      const { action } = msg;
      if (!VALID_ACTIONS.has(action)) return;
      lastCommandTime = Date.now();
      const argument = action === "stop" ? "stop" : `${action},150`;
      fireCommand(argument);
      return;
    }

    // Signaling from viewer -> rover (add peerId)
    if (SIGNALING_TYPES.has(msg.type) && role === "viewer") {
      if (currentRover) {
        send(currentRover, { ...msg, peerId: id });
      }
      return;
    }

    // Signaling from rover -> viewer (route by peerId)
    if (SIGNALING_TYPES.has(msg.type) && role === "rover") {
      const targetWs = viewers.get(msg.peerId);
      if (targetWs) {
        const fwd = { ...msg };
        delete fwd.peerId;
        send(targetWs, fwd);
      }
      return;
    }
  });

  ws.on("close", () => {
    if (role === "rover") {
      currentRover = null;
      console.log("Rover tablet disconnected");
      for (const [, vws] of viewers) {
        send(vws, { type: "rover-offline" });
      }
    } else if (role === "viewer") {
      viewers.delete(id);
      if (currentRover) {
        send(currentRover, { type: "peer-left", peerId: id });
      }
      if (id === controllerId) {
        controllerId = null;
        fireCommand("stop");
        fireCommand("stop");
        console.log(`Controller ${id} disconnected, rover stopped`);
        promoteNextSpectator();
      } else {
        console.log(`Spectator ${id} disconnected`);
      }
    }
  });

  ws.on("error", () => {
    ws.close();
  });
});

server.listen(PORT, () => {
  console.log(`Rover control server running on http://localhost:${PORT}`);
});
