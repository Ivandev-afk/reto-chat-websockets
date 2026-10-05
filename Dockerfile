FROM nginx:alpine

# Servidor estático para el cliente del chat (HTML/CSS/JS).
# Escucha en el 3000, igual que el backend, para que KyraCloud lo exponga igual.
RUN sed -i 's/listen\s*80;/listen 3000;/; s/listen\s*\[::\]:80;/listen [::]:3000;/' /etc/nginx/conf.d/default.conf

COPY index.html app.js styles.css /usr/share/nginx/html/

EXPOSE 3000
