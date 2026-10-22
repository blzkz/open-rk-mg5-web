# Open RK MG5 Web

Panel de control en el navegador para el ratón **Royal Kludge MG5**, usando [WebHID](https://developer.mozilla.org/docs/Web/API/WebHID_API).
Es la versión web de [Open RK MG5 Control Panel](https://github.com/blzkz/open-rk-mg5-control-panel) (la app de escritorio para Linux)
y hace lo mismo sin instalar nada: DPI por niveles, colores, frecuencia de sondeo, LOD, debounce, modo del sensor,
Motion Sync, Ripple Control, corrección de ángulo, modo cristal, reposo, reasignación de los seis botones y perfiles.

Funciona con el receptor 2.4G (`372e:103f`) y, en principio, por cable (`372e:1073`, aún sin probar).
El protocolo está documentado en [docs/PROTOCOL.md](docs/PROTOCOL.md).

### RK M30 (experimental, sin probar)

También reconoce el **Royal Kludge M30** (`258a:0138` receptor 2.4G, `258a:0136` cable), con un protocolo
distinto sacado del configurador web oficial. **Nadie lo ha probado todavía con un M30 real.** El panel muestra
un aviso cuando hay uno conectado y solo ofrece lo que tiene: DPI 100–24000 en pasos de 100, hasta 6 niveles,
sondeo hasta 1000 Hz, LOD, debounce (1–15 ms), Motion Sync, Ripple Control, corrección de ángulo y reposo.
No hay batería, modo del sensor ni modo cristal, y la reasignación de botones está desactivada porque el M30
no permite leerla. Cada cambio se comprueba releyendo el ratón; si no coincide, el panel da error y no insiste.

![Personalizar](docs/screenshot.png)
![Rendimiento](docs/screenshot-performance.png)

## Navegadores

WebHID solo existe en navegadores basados en Chromium de escritorio: Chrome, Edge, Opera, Brave, Vivaldi…
Firefox y Safari no lo soportan, y tampoco los navegadores de móvil. La página tiene que servirse por `https://`
o desde `localhost`.

## Uso

1. Abre la página y pulsa **Conectar ratón**.
2. Elige el ratón («RK MG5» o el M30) en la lista del navegador.

El navegador recuerda el permiso, así que las siguientes veces se conecta solo. Los cambios se guardan en el ratón
en cuanto los haces. Si el ratón está dormido, muévelo y el panel se reconecta solo.

### Linux

El navegador abre el ratón por `/dev/hidraw`, que por defecto solo puede leer root. Hace falta la misma regla udev
que la app de escritorio (la segunda línea es para el M30):

```bash
printf '%s\n' 'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="372e", ATTRS{idProduct}=="103f|1073", TAG+="uaccess"' 'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="258a", ATTRS{idProduct}=="0136|0138", TAG+="uaccess"' | sudo tee /etc/udev/rules.d/70-rk-mg5.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
```

Si falta, la propia página lo detecta y muestra estos pasos con un botón para copiar el comando, y se conecta sola
en cuanto tiene permiso. Si no lo hace, desconecta y vuelve a conectar el receptor. Si ya tienes instalada la app de
escritorio, la regla ya está puesta.

En Windows, macOS y ChromeOS no hace falta nada de esto.

### Perfiles

Un perfil guarda todo lo que el ratón almacena: botones, niveles y colores de DPI, sondeo, LOD, debounce,
modo del sensor, interruptores y reposo. El selector de la barra superior cambia de perfil y el menú `⋮`
crea, duplica, renombra, elimina, importa o exporta perfiles. Los cambios que hagas se guardan en el perfil activo.

Los perfiles viven en el almacenamiento local del navegador. Los archivos exportados tienen el mismo formato JSON
que los de la app de escritorio (`~/.config/open-rk-mg5/profiles/`), así que puedes pasarlos de una a otra.

## Publicarlo

Se puede publicar en GitHub Pages, en cualquier hosting estático o con Docker. Los pasos están en
[docs/PUBLICAR.md](docs/PUBLICAR.md). Con Docker, en local:

```bash
docker compose up -d --build
```

y abre <http://localhost:8080>.

## Desarrollo

Es HTML, CSS y JavaScript (módulos ES) sin dependencias ni paso de compilación. Para probarlo en local:

```bash
python3 -m http.server 8000
```

y abre <http://localhost:8000>. Las pruebas del protocolo se ejecutan con Node 20 o superior:

```bash
node --test tests/
```

| Archivo | Qué hace |
|---|---|
| `js/protocol.js` | Modelos, tramas, lectura y escritura de la configuración por WebHID (MG5 y M30) |
| `js/actions.js` | Acciones que se pueden asignar a los botones y captura de teclas |
| `js/mouse-view.js` | Dibujo SVG del ratón con las etiquetas de cada botón |
| `js/profiles.js` | Perfiles en `localStorage`, importar y exportar |
| `js/app.js` | Interfaz y conexión con el ratón |

## Licencia

GPL-3.0-or-later. Ver [LICENSE](LICENSE).

Royal Kludge, MG5 y M30 son marcas de sus respectivos propietarios. Este proyecto no está afiliado ni respaldado por Royal Kludge.
El protocolo HID se ha documentado a partir del configurador web oficial y de pruebas con el propio ratón, con fines de interoperabilidad.
