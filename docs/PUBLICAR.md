# Cómo publicar el panel web

El panel son archivos estáticos (HTML, CSS, JavaScript e icono): no hay servidor de aplicaciones ni paso de compilación.
El servidor solo entrega esos archivos; el ratón se conecta al ordenador de quien abre la página y es su navegador
el que habla con él por WebHID. Por eso basta con cualquier hosting estático.

Dos requisitos que se aplican a cualquier forma de publicarlo:

- **HTTPS o `localhost`.** Los navegadores solo activan WebHID en contextos seguros. `http://localhost` y
  `http://127.0.0.1` cuentan como seguros; una IP de tu red local (`http://192.168.1.10`) no.
- **Navegador Chromium de escritorio** (Chrome, Edge, Opera, Brave, Vivaldi…). En Linux, cada persona que lo use
  necesita además la regla udev del [README](../README.md#linux) en su equipo.

Los archivos que hay que publicar son `index.html`, `manifest.webmanifest`, `icon.svg` y las carpetas `css/` y `js/`.
`docs/` y `tests/` no hacen falta, aunque publicarlos no molesta.

## Opción 1: GitHub Pages (recomendada)

Gratis, con HTTPS y sin mantenimiento.

1. Sube el proyecto a un repositorio de GitHub, por ejemplo `blzkz/open-rk-mg5-web`:

   ```bash
   git remote add origin git@github.com:blzkz/open-rk-mg5-web.git
   git push -u origin main
   ```

2. En el repositorio, ve a **Settings → Pages**.
3. En **Build and deployment**, elige **Source: Deploy from a branch**, rama `main` y carpeta `/ (root)`. Guarda.
4. En un par de minutos estará en `https://blzkz.github.io/open-rk-mg5-web/`.

Cada `git push` a `main` vuelve a publicar la web. Si tienes un dominio propio, se configura en la misma pantalla
(**Custom domain**) y GitHub se encarga del certificado.

## Opción 2: otro hosting estático

Cloudflare Pages, Netlify, Codeberg Pages o cualquier servidor web sirven igual. Al configurarlos:

- Comando de compilación: ninguno (déjalo vacío).
- Carpeta a publicar: la raíz del repositorio.

## Opción 3: Docker

La imagen es un nginx que sirve los archivos, con cabeceras de seguridad (`Permissions-Policy: hid=(self)`,
`Content-Security-Policy`, etc.). El contenedor no necesita acceso al USB: el ratón lo usa el navegador del anfitrión.

Con Docker Compose:

```bash
docker compose up -d --build
```

Abre <http://localhost:8080>. Para actualizar tras cambiar el código, repite el mismo comando; para pararlo,
`docker compose down`.

Sin Compose:

```bash
docker build -t open-rk-mg5-web .
docker run -d --name open-rk-mg5-web --restart unless-stopped -p 127.0.0.1:8080:80 open-rk-mg5-web
```

El puerto se publica solo en `127.0.0.1` a propósito: así funciona en el propio ordenador sin HTTPS.

### Usarlo desde otros equipos de la red

Para abrirlo desde otro ordenador hace falta HTTPS, porque `http://IP-del-servidor` no es un contexto seguro.
Lo más sencillo es poner delante un proxy inverso con certificado, por ejemplo [Caddy](https://caddyserver.com/)
con un nombre que resuelva en tu red:

```
rk-mg5.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Caddy obtiene el certificado solo si el nombre es público; para un nombre interno (`rk-mg5.lan`) usa
`tls internal` dentro del bloque e instala la CA de Caddy en los equipos que lo vayan a abrir.

Solo para pruebas, Chrome permite tratar un origen HTTP como seguro en
`chrome://flags/#unsafely-treat-insecure-origin-as-secure`.
