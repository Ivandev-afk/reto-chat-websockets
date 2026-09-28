"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { WebSocketServer } = require("ws");

// --- Config (con valores por defecto, y override desde .env si existe) ---
loadDotEnvIfPresent();

const PORT = Number(process.env.PORT) || 3000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const HISTORY_LIMIT = Number(process.env.HISTORY_LIMIT) || 50;
const MAX_MESSAGE_LENGTH = Number(process.env.MAX_MESSAGE_LENGTH) || 500;
const MAX_NAME_LENGTH = 20;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 5;
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 5000;
const HEARTBEAT_INTERVAL_MS = 30000;

const PUBLIC_DIR = path.join(__dirname, "..", "frontend");

// --- Servidor HTTP: sirve los archivos estáticos del cliente ---
const server = http.createServer((req, res) => {
  serveStatic(req, res);
});

// --- Servidor WebSocket, colgado del mismo servidor HTTP ---
const wss = new WebSocketServer({
  server,
  verifyClient: (info, done) => {
    const origin = info.origin || info.req.headers.origin;
    // Sin cabecera Origin (p.ej. clientes no-navegador) la dejamos pasar;
    // si viene Origin, tiene que estar en la lista blanca.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      done(true);
    } else {
      done(false, 403, "Origin no permitido");
    }
  },
});

/** Historial de mensajes en memoria (los últimos HISTORY_LIMIT) */
const history = [];

/** Estado de escritura: quién está escribiendo ahora mismo */
const typingUsers = new Set();

function pushHistory(entry) {
  history.push(entry);
  if (history.length > HISTORY_LIMIT) history.shift();
}

function now() {
  return Date.now();
}

function broadcast(payload, exceptWs) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN && client !== exceptWs) {
      client.send(data);
    }
  }
}

function broadcastAll(payload) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(data);
    }
  }
}

function getUserList() {
  const names = [];
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN && client.userName) {
      names.push(client.userName);
    }
  }
  return names;
}

function uniqueName(base) {
  const taken = new Set(getUserList());
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base} (${i})`)) i++;
  return `${base} (${i})`;
}

function sanitizeName(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, MAX_NAME_LENGTH);
}

wss.on("connection", (ws, req) => {
  ws.isAlive = true;
  ws.userName = null;
  ws.joinedAt = null;
  ws.msgTimestamps = [];

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return sendError(ws, "bad_json", "Mensaje mal formado.");
    }
    if (!msg || typeof msg.type !== "string") {
      return sendError(ws, "bad_type", "Falta el tipo de mensaje.");
    }

    switch (msg.type) {
      case "join":
        return handleJoin(ws, msg);
      case "message":
        return handleMessage(ws, msg);
      case "typing":
        return handleTyping(ws, msg);
      default:
        return sendError(ws, "unknown_type", `Tipo desconocido: ${msg.type}`);
    }
  });

  ws.on("close", () => {
    if (ws.userName) {
      typingUsers.delete(ws.userName);
      const text = `${ws.userName} se ha desconectado.`;
      pushHistory({ type: "system", text, ts: now() });
      broadcastAll({ type: "system", text, ts: now() });
      broadcastAll({ type: "users", users: getUserList() });
      broadcastAll({ type: "typing", users: [...typingUsers] });
    }
  });
});

function handleJoin(ws, msg) {
  if (ws.userName) {
    return sendError(ws, "already_joined", "Ya te has unido a la sala.");
  }
  const clean = sanitizeName(msg.name);
  if (!clean) {
    return sendError(ws, "invalid_name", "El nombre no puede estar vacío.");
  }
  const finalName = uniqueName(clean);
  ws.userName = finalName;
  ws.joinedAt = now();

  ws.send(
    JSON.stringify({
      type: "joined",
      name: finalName,
      history,
      users: getUserList(),
    })
  );

  const text = `${finalName} se ha conectado.`;
  pushHistory({ type: "system", text, ts: now() });
  broadcast({ type: "system", text, ts: now() }, ws);
  broadcastAll({ type: "users", users: getUserList() });
}

function isRateLimited(ws) {
  const t = now();
  ws.msgTimestamps = ws.msgTimestamps.filter((ts) => t - ts < RATE_LIMIT_WINDOW_MS);
  if (ws.msgTimestamps.length >= RATE_LIMIT_MAX) return true;
  ws.msgTimestamps.push(t);
  return false;
}

function handleMessage(ws, msg) {
  if (!ws.userName) {
    return sendError(ws, "not_joined", "Tienes que unirte antes de escribir.");
  }
  if (isRateLimited(ws)) {
    return sendError(ws, "rate_limited", "Estás enviando mensajes demasiado rápido.");
  }
  const text = typeof msg.text === "string" ? msg.text.trim() : "";
  if (!text) {
    return sendError(ws, "empty_message", "El mensaje no puede estar vacío.");
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return sendError(
      ws,
      "message_too_long",
      `El mensaje supera el límite de ${MAX_MESSAGE_LENGTH} caracteres.`
    );
  }

  const entry = {
    type: "message",
    id: crypto.randomUUID(),
    name: ws.userName,
    text,
    ts: now(),
  };
  pushHistory(entry);
  broadcastAll(entry);
}

function handleTyping(ws, msg) {
  if (!ws.userName) return;
  if (msg.isTyping) {
    typingUsers.add(ws.userName);
  } else {
    typingUsers.delete(ws.userName);
  }
  broadcast({ type: "typing", users: [...typingUsers] }, ws);
}

function sendError(ws, code, message) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: "error", code, message }));
  }
}

// --- Ping/pong: cierra conexiones que no responden ---
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_INTERVAL_MS);

wss.on("close", () => clearInterval(heartbeat));

// --- Servir el cliente estático de forma sencilla y segura ---
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const safePath = path.normalize(urlPath === "/" ? "/index.html" : urlPath);
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Prohibido");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("No encontrado");
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function loadDotEnvIfPresent() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

server.listen(PORT, () => {
  console.log(`Servidor de chat escuchando en http://localhost:${PORT}`);
  console.log(`Orígenes permitidos: ${ALLOWED_ORIGINS.join(", ")}`);
});
