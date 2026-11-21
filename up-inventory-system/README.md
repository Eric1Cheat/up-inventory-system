# UP Inventory System

Sistema de inventario con método **PEPS** (primeras entradas, primeras salidas) hecho solo con HTML, CSS y JavaScript.
Sin servidor, sin base de datos, sin dependencias: abre `index.html` con doble clic.

## Estructura
- `index.html`        Estructura y diálogos
- `css/styles.css`    Estilos (barra lateral azul, paneles con scroll independiente)
- `js/datos.js`       Datos de ejemplo + lógica PEPS (reemplaza a la base de datos)
- `js/app.js`         Interfaz e interactividad
- `assets/`           Logo en PNG transparente (`logo.png`, `logo-mark.png`, `favicon.png`)

## Datos
Se guardan en `localStorage` del navegador. "Restablecer datos de ejemplo" (menú lateral) los reinicia.
La moneda se cambia en `app.js` (constante en la función `dinero`).

## Atajos
`1`–`6` secciones · `/` buscar · `N` nueva entrada · `?` ayuda · `Ctrl+Z` deshacer · `Esc` cerrar

## Diseño
La barra lateral, el encabezado y el contenido se desplazan por separado. La pantalla de acceso es de demostración (solo guarda el nombre en el navegador).
