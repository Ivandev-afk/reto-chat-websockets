(() => {
  "use strict";

  const loginScreen = document.getElementById("login-screen");
  const chatScreen = document.getElementById("chat-screen");
  const loginForm = document.getElementById("login-form");
  const nameInput = document.getElementById("name-input");
  const loginError = document.getElementById("login-error");

  const connStatus = document.getElementById("conn-status");
  const usersList = document.getElementById("users-list");
  const messagesList = document.getElementById("messages-list");
  const typingIndicator = document.getElementById("typing-indicator");
  const messageForm = document.getElementById("message-form");
  const messageInput = document.getElementById("message-input");
  const sendButton = messageForm.querySelector("button");

  const READY_STATE_LABEL = {
    0: { text: "Conectando…", cls: "status--connecting" },
    1: { text: "Conectado", cls: "status--open" },
    2: { text: "Cerrando…", cls: "status--closing" },
    3: { text: "Desconectado", cls: "status--closed" },
  };

  let ws = null;
  let myName = null;
  let pendingName = null;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let manualClose = false;

  let typingSelf = false;
  let typingStopTimer = null;

  const BASE_DELAY_MS = 1000;
  const MAX_DELAY_MS = 30000;

  function wsUrl() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}`;
  }

  function updateStatus() {
    const state = ws ? ws.readyState : WebSocket.CLOSED;
    const info = READY_STATE_LABEL[state] || READY_STATE_LABEL[3];
    connStatus.textContent = info.text;
    connStatus.className = `status ${info.cls}`;
    sendButton.disabled = state !== WebSocket.OPEN;
  }

  function connect() {
    manualClose = false;
    ws = new WebSocket(wsUrl());
    updateStatus();

    ws.addEventListener("open", () => {
      reconnectAttempts = 0;
      updateStatus();
      if (pendingName) {
        send({ type: "join", name: pendingName });
      }
    });

    ws.addEventListener("message", (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      handleServerMessage(data);
    });

    ws.addEventListener("close", () => {
      updateStatus();
      if (!manualClose) scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      updateStatus();
    });
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    const delay = Math.min(BASE_DELAY_MS * 2 ** reconnectAttempts, MAX_DELAY_MS);
    reconnectAttempts++;
    reconnectTimer = setTimeout(connect, delay);
  }

  function send(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  function handleServerMessage(data) {
    switch (data.type) {
      case "joined":
        onJoined(data);
        break;
      case "message":
        appendMessage(data);
        break;
      case "system":
        appendSystem(data);
        break;
      case "users":
        renderUsers(data.users);
        break;
      case "typing":
        renderTyping(data.users);
        break;
      case "error":
        onServerError(data);
        break;
    }
  }

  function onJoined(data) {
    myName = data.name;
    pendingName = null;
    loginScreen.hidden = true;
    chatScreen.hidden = false;

    messagesList.innerHTML = "";
    for (const entry of data.history) {
      if (entry.type === "message") appendMessage(entry);
      else if (entry.type === "system") appendSystem(entry);
    }
    renderUsers(data.users);
    messageInput.focus();
  }

  function onServerError(data) {
    if (!myName) {
      loginError.textContent = data.message;
      loginError.hidden = false;
      pendingName = null;
      return;
    }
    console.warn(`[chat] ${data.code}: ${data.message}`);
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function appendMessage(entry) {
    const li = document.createElement("li");
    li.className = entry.name === myName ? "own" : "";

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `${entry.name} · ${formatTime(entry.ts)}`;

    const body = document.createElement("span");
    body.textContent = entry.text; // textContent => nunca se interpreta como HTML

    li.appendChild(meta);
    li.appendChild(body);
    messagesList.appendChild(li);
    scrollToBottom();
  }

  function appendSystem(entry) {
    const li = document.createElement("li");
    li.className = "system";
    li.textContent = entry.text;
    messagesList.appendChild(li);
    scrollToBottom();
  }

  function scrollToBottom() {
    messagesList.scrollTop = messagesList.scrollHeight;
  }

  function renderUsers(users) {
    usersList.innerHTML = "";
    for (const name of users) {
      const li = document.createElement("li");
      li.textContent = name;
      usersList.appendChild(li);
    }
  }

  function renderTyping(users) {
    const others = users.filter((n) => n !== myName);
    if (others.length === 0) {
      typingIndicator.hidden = true;
      typingIndicator.textContent = "";
      return;
    }
    const verb = others.length === 1 ? "está escribiendo…" : "están escribiendo…";
    typingIndicator.textContent = `${others.join(", ")} ${verb}`;
    typingIndicator.hidden = false;
  }

  // --- Login ---
  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    loginError.hidden = true;
    if (!name) {
      loginError.textContent = "Escribe un nombre.";
      loginError.hidden = false;
      return;
    }
    pendingName = name;
    if (ws && ws.readyState === WebSocket.OPEN) {
      send({ type: "join", name: pendingName });
    }
    // Si el socket aún no está abierto, el "open" handler enviará el join.
  });

  // --- Envío de mensajes ---
  messageForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text) return;
    send({ type: "message", text });
    messageInput.value = "";
    stopTyping();
  });

  // --- "Está escribiendo..." ---
  messageInput.addEventListener("input", () => {
    if (!typingSelf) {
      typingSelf = true;
      send({ type: "typing", isTyping: true });
    }
    clearTimeout(typingStopTimer);
    typingStopTimer = setTimeout(stopTyping, 1500);
  });

  function stopTyping() {
    clearTimeout(typingStopTimer);
    if (typingSelf) {
      typingSelf = false;
      send({ type: "typing", isTyping: false });
    }
  }

  connect();
})();
