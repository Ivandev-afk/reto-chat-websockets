# Reto: Chat con WebSockets

Chat en tiempo real. Un único proceso de Node sirve el cliente estático (`public/`)
y el servidor WebSocket (`ws`) sobre el mismo puerto.

## Cómo correrlo

```bash
npm install
npm start
```

Abre `http://localhost:3000` en dos pestañas (o dos navegadores) para probarlo
con dos usuarios a la vez.

Variables de entorno opcionales (copia `.env.example` a `.env` si quieres tocarlas):

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

1. El navegador pide `/` → el servidor HTTP responde `public/index.html`, que a su vez
   pide `/app.js` y `/styles.css` (mismo servidor, rutas estáticas).
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

## Despliegue

No incluido todavía: este proyecto está pensado para correr en local primero. Cuando
quieras publicarlo (Render, Railway, Fly.io, etc.), solo hace falta:

1. Subir esta carpeta a un repositorio de GitHub.
2. Desplegar como servicio Node (`npm install` + `npm start`), exponiendo `PORT` (la
   mayoría de plataformas lo inyectan solas).
3. Configurar `ALLOWED_ORIGINS` con la URL pública real que te asigne la plataforma.
