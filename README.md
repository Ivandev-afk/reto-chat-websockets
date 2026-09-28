# Reto: Chat con WebSockets

Chat en tiempo real, separado en dos carpetas:

- `backend/` — servidor Node (HTTP + WebSocket con `ws`).
- `frontend/` — cliente estático (HTML/CSS/JS), servido por el propio `backend/`.

## Cómo correrlo

```bash
cd backend
npm install
npm start
```

Abre `http://localhost:3000` en dos pestañas (o dos navegadores) para probarlo
con dos usuarios a la vez.

Variables de entorno opcionales (copia `backend/.env.example` a `backend/.env` si quieres tocarlas):

- `PORT` — puerto del servidor (por defecto 3000).
- `ALLOWED_ORIGINS` — orígenes permitidos para el WebSocket, separados por comas.
  **En producción, ponlo al dominio real del frontend, nunca `*`.**
- `HISTORY_LIMIT` — cuántos mensajes se guardan en memoria para los que llegan tarde.
- `MAX_MESSAGE_LENGTH` — longitud máxima de un mensaje.
- `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` — límite de ritmo (por defecto 5 mensajes cada 5s).

## Qué implementa

- **Conectar con nombre**: pantalla de login → mensaje `join` → el servidor confirma
  con `joined` (y renombra si el nombre ya está en uso, ej. `Ana (2)`).
- **Mensajes a todos**: cada `message` válido se retransmite a todos los clientes conectados.
- **Lista de conectados**: se recalcula y se envía (`users`) en cada entrada/salida.
- **Avisos de entrada/salida**: mensajes `system` insertados en la propia conversación.
- **"Está escribiendo…"**: el cliente emite `typing` al teclear (con debounce de 1.5s de
  inactividad) y el servidor retransmite quién está escribiendo ahora mismo.
- **Historial**: los últimos `HISTORY_LIMIT` mensajes/eventos se guardan en memoria y se
  mandan dentro de `joined` a quien se conecta.
- **Estado de conexión visible**: el badge de la cabecera lee `ws.readyState` directamente.
- **Reconexión con backoff**: si el socket se cierra sin que lo pidiera el usuario, el
  cliente reintenta con espera creciente (1s, 2s, 4s… hasta 30s).
- **Ping/pong**: el servidor hace `ping()` cada 30s; si un cliente no contesta con `pong`
  antes del siguiente ciclo, se corta con `terminate()`.
- **Validación y límite de ritmo**: mensajes vacíos o mayores a `MAX_MESSAGE_LENGTH` se
  rechazan con un `error`; más de `RATE_LIMIT_MAX` mensajes en `RATE_LIMIT_WINDOW_MS` también.
- **Sin XSS**: el cliente nunca usa `innerHTML` para el contenido de un mensaje, siempre
  `textContent` — por eso `<b>hola</b>` se ve tal cual, como texto.
- **`ALLOWED_ORIGINS` cerrado**: el `verifyClient` del `WebSocketServer` comprueba la
  cabecera `Origin` de cada intento de conexión contra la lista permitida y responde 403
  si no coincide.

## Qué pasa entre el primer clic y el primer mensaje

1. El navegador pide `/` → el servidor HTTP (`backend/server.js`) responde
   `frontend/index.html`, que a su vez pide `/app.js` y `/styles.css` (mismo servidor,
   rutas estáticas).
2. `app.js` se ejecuta y abre inmediatamente un `WebSocket` hacia el mismo host
   (`ws://` o `wss://` según el protocolo de la página). El badge de estado pasa a
   "Conectando…" porque `readyState` vale `0`.
3. En el servidor, la llegada de esa conexión dispara `verifyClient`: compara el header
   `Origin` de la petición contra `ALLOWED_ORIGINS`. Si no está en la lista, corta con 403
   antes de que el handshake WebSocket llegue a completarse.
4. Si el origen es válido, el handshake HTTP se "actualiza" a WebSocket (upgrade) y se
   dispara el evento `connection` en el servidor y `open` en el cliente. El badge pasa a
   "Conectado" (`readyState === 1`).
5. El usuario escribe su nombre y envía el formulario de login. El cliente manda
   `{ type: "join", name }` por el socket ya abierto.
6. El servidor recibe ese frame en `ws.on("message")`, valida el nombre (no vacío, largo
   máximo, único), lo guarda en `ws.userName` y responde solo a ese cliente con
   `{ type: "joined", name, history, users }`. El cliente oculta el login, pinta el
   historial y la lista de conectados.
7. El servidor también difunde a todos los demás un `system` ("X se ha conectado") y un
   `users` actualizado, así que el resto ve entrar al nuevo usuario sin recargar.
8. Cuando ese usuario escribe y envía un mensaje, el cliente manda
   `{ type: "message", text }`. El servidor valida (no vacío, longitud, límite de ritmo),
   lo añade al historial en memoria y lo reenvía (`broadcastAll`) a **todos** los sockets
   abiertos, incluido el remitente — así cada pantalla pinta el mensaje igual, usando
   siempre `textContent` para que no se pueda inyectar HTML.

## Despliegue en KyraCloud

Backend y frontend van en **dos servidores separados**. El orden importa porque cada
uno necesita la URL final del otro.

### 1. Backend (servidor tipo "Proyecto", con Docker)

1. En KyraCloud: **Nuevo Servidor** → **Proyecto** → nómbralo (ej. `chat-backend-tunombre`)
   → plan Pequeño está bien.
2. Sube `backend.zip` (ya generado en la raíz del repo, con `server.js`, `package.json`
   y `Dockerfile` en la raíz del zip, sin `node_modules`) y pulsa **Reconstruir**.
3. En **Variables de Entorno**, pon:
   - `PORT` = `3000`
   - `MAX_HISTORY` = `50`
   - `ALLOWED_ORIGINS` = *(déjalo con un valor provisional, lo ajustas en el paso 3
     de más abajo, cuando exista la URL del frontend)*
4. Guarda. Anota la URL pública que te asigna (ej. `https://chat-backend-tunombre.kyracloud.app`).
5. Verifica `https://<tu-backend>.kyracloud.app/health` → debe responder
   `{"ok":true,"conectados":0,"mensajesEnHistorial":0,"uptimeSegundos":N}`.

### 2. Frontend (servidor tipo "Hosting Web")

1. Antes de comprimir: edita `frontend/index.html` y cambia
   `window.CHAT_BACKEND_URL = "";` por la URL **wss://** de tu backend, ej.
   `window.CHAT_BACKEND_URL = "wss://chat-backend-tunombre.kyracloud.app";`
2. Regenera `frontend.zip` (PowerShell, desde la raíz del proyecto):
   ```powershell
   Compress-Archive -Path frontend/* -DestinationPath frontend.zip -Force
   ```
3. En KyraCloud: **Nuevo Servidor** → **Hosting Web** → nómbralo (ej. `chat-web-tunombre`)
   → plan Pequeño (no ejecuta código).
4. Sube `frontend.zip`. Anota su URL pública (ej. `https://chat-web-tunombre.kyracloud.app`).

### 3. Unir los dos

1. Vuelve al servidor del **backend** → Variables de Entorno → pon `ALLOWED_ORIGINS`
   con la URL exacta del frontend del paso anterior (con `https://`, sin barra final).
2. Guarda (se reconstruye solo).
3. Abre la URL del frontend, entra con un nombre, manda un mensaje.
4. En la consola del backend deberías ver líneas como:
   ```
   servidor escuchando en el puerto 3000
   [upgrade] aceptado origin=https://chat-web-tunombre.kyracloud.app
   [ws] conectado nombre="tu-nombre" total=1
   [ws] mensaje de="tu-nombre" bytes=N
   ```
   Esas capturas ([upgrade] y [cierre] al desconectarte) son parte de lo que pide
   entregar el reto.

### Regenerar los zips después de cambiar código

```powershell
# backend (sin node_modules)
Get-ChildItem backend -Force | Where-Object { $_.Name -ne "node_modules" } |
  ForEach-Object FullName | Compress-Archive -DestinationPath backend.zip -Force

# frontend
Compress-Archive -Path frontend/* -DestinationPath frontend.zip -Force
```

## Despliegue en Render

El repo incluye `render.yaml` (Blueprint) con todo listo: servicio Node, carpeta raíz
`backend/`, `npm install` como build y `npm start` como arranque.

1. Entra a [dashboard.render.com](https://dashboard.render.com) e inicia sesión
   (puedes usar tu cuenta de GitHub).
2. **New +** → **Blueprint** → conecta tu cuenta de GitHub si no lo está → elige el
   repositorio `reto-chat-websockets`. Render detecta `render.yaml` solo.
3. Pulsa **Apply** y espera a que termine el primer deploy. Te va a dar una URL del
   tipo `https://reto-chat-websockets.onrender.com` (o con un sufijo si el nombre
   estaba tomado).
4. Copia esa URL. Ve a **Environment** dentro del servicio y cambia la variable
   `ALLOWED_ORIGINS` para que sea exactamente esa URL (con `https://`, sin barra al
   final). Guarda — Render vuelve a desplegar solo.
5. Abre esa URL en dos pestañas y pruébalo igual que en local. El cliente ya detecta
   solo que la página se sirve por `https:` y usa `wss://` para el WebSocket.

**Nota:** el plan free de Render "duerme" el servicio tras ~15 min sin tráfico; la
primera conexión después de eso tarda unos 30-50s en despertar (se verá "Conectando…"
un rato antes de pasar a "Conectado" — es la reconexión con backoff haciendo su
trabajo, no un error).
