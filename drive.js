const Particle = require("particle-api-js");

const particle = new Particle();

const TOKEN = process.env.PARTICLE_TOKEN;
const DEVICE_ID = process.env.PARTICLE_DEVICE_ID;

if (!TOKEN || !DEVICE_ID) {
  console.error(
    "Set these environment variables in your .env file:\n" +
      "  PARTICLE_TOKEN=your_access_token\n" +
      "  PARTICLE_DEVICE_ID=your_device_id"
  );
  process.exit(1);
}

const DRIVE_SPEED = process.argv[2] || "120";
const TURN_SPEED = process.argv[3] || "90";
const KEEPALIVE_MS = 800;

let currentDirection = "stop";
let keepaliveInterval = null;

function fireCommand(argument) {
  particle
    .callFunction({
      deviceId: DEVICE_ID,
      name: "motor",
      argument,
      auth: TOKEN,
    })
    .catch((err) => {
      console.error("Error:", err.body || err);
    });
}

function setDirection(direction) {
  if (direction === currentDirection) return;
  currentDirection = direction;

  if (direction === "stop") {
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
    fireCommand("stop");
    fireCommand("stop");
    return;
  }

  const speed = direction === "left" || direction === "right" ? TURN_SPEED : DRIVE_SPEED;
  const argument = `${direction},${speed}`;

  fireCommand(argument);

  clearInterval(keepaliveInterval);
  keepaliveInterval = setInterval(() => {
    fireCommand(argument);
  }, KEEPALIVE_MS);
}

const pressed = new Set();

function updateDirection() {
  const up = pressed.has("up");
  const down = pressed.has("down");
  const left = pressed.has("left");
  const right = pressed.has("right");

  if (up) setDirection("forward");
  else if (down) setDirection("reverse");
  else if (left) setDirection("left");
  else if (right) setDirection("right");
  else setDirection("stop");
}

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");

console.log("Drive mode active! Use arrow keys to control the rover.");
console.log(`Drive speed: ${DRIVE_SPEED}, Turn speed: ${TURN_SPEED}`);
console.log("Usage: node drive.js [drive_speed] [turn_speed]");
console.log("Press q or Ctrl+C to quit.\n");

let stopTimer;

process.stdin.on("data", (key) => {
  if (key === "\u0003" || key === "q") {
    setDirection("stop");
    setTimeout(() => {
      console.log("\nStopped.");
      process.exit();
    }, 500);
    return;
  }

  if (key === "\u001b[A") {
    pressed.add("up");
    console.log("↑ forward");
  } else if (key === "\u001b[B") {
    pressed.add("down");
    console.log("↓ reverse");
  } else if (key === "\u001b[D") {
    pressed.add("left");
    console.log("← left");
  } else if (key === "\u001b[C") {
    pressed.add("right");
    console.log("→ right");
  }

  updateDirection();

  clearTimeout(stopTimer);
  stopTimer = setTimeout(() => {
    pressed.clear();
    updateDirection();
  }, 300);
});
