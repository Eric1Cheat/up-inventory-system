/* UP Inventory System · interfaz
   Interactividad: PEPS en vivo, filtros, formularios validados, deshacer, atajos de teclado. */
(function () {
  'use strict';

  /* =====================================================
     Utilidades
     ===================================================== */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const num = (n) => (+n).toLocaleString('es-MX');
  const dinero = (n) => (+n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  const fFecha = (s) => (s ? UP.leer(s).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '') : '—');
  const fCorta = (s) => UP.leer(s).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }).replace('.', '');
  const fHora = (s) => UP.leer(s).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', '');
  const plural = (n, uno, varios) => `${num(n)} ${n === 1 ? uno : varios}`;
  const reducirMovimiento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const ic = (n, c = '') => `<svg class="i ${c}" aria-hidden="true" focusable="false"><use href="#i-${n}"/></svg>`;
  const etiqueta = (color, html) => `<span class="etiqueta ${color}">${html}</span>`;

  /* Etiqueta de caducidad: color + ícono + texto (nunca solo color). */
  function tagCad(dias) {
    if (dias === null) return etiqueta('gris', 'Sin caducidad');
    if (dias < 0) return etiqueta('rojo', ic('alerta') + `Vencido hace ${-dias} d`);
    if (dias === 0) return etiqueta('rojo', ic('alerta') + 'Vence hoy');
    if (dias <= 3) return etiqueta('ambar', ic('reloj') + `Vence en ${dias} d`);
    if (dias <= 7) return etiqueta('ambar', ic('reloj') + `Vence en ${dias} d`);
    return etiqueta('verde', ic('ok') + `En ${num(dias)} d`);
  }

  /* =====================================================
     Estado de la interfaz
     ===================================================== */
  const RUTAS = ['resumen', 'alertas', 'salida', 'inventario', 'movimientos', 'administrar'];
  const ui = {
    vista: 'resumen',
    salida: { pid: null, tocado: false },
    inv: { q: '', estado: 'todos', cat: '', orden: 'nombre', dir: 1, abiertos: new Set() },
    mov: { q: '', tipo: 'todos', max: 15 },
    admin: { tab: 'productos', filtroProd: '', agotados: false },
    alertDias: 7,
    rango: 14,
    animarGrafica: true,
    ultimo: null, // función para deshacer el último cambio
    primeraCarga: true,
  };

  /* =====================================================
     Avisos (toasts), confirmación y cambios con "Deshacer"
     ===================================================== */
  function toast({ tipo = 'info', msg, deshacer = null, duracion }) {
    const cont = $('#toasts');
    cont.setAttribute('aria-live', 'polite');
    while (cont.children.length >= 3) cont.firstElementChild.remove();
    const el = document.createElement('div');
    el.className = 'toast ' + tipo;
    el.innerHTML = `${ic(tipo === 'error' ? 'alerta' : tipo === 'ok' ? 'ok' : 'info')}<p>${esc(msg)}</p>
      ${deshacer ? `<button type="button" class="btn" data-deshacer>${ic('deshacer')}Deshacer</button>` : ''}
      <button type="button" class="btn icono-solo" aria-label="Cerrar aviso">${ic('cerrar')}</button>`;
    cont.appendChild(el);

    let temporizador;
    const cerrar = () => { clearTimeout(temporizador); el.classList.add('saliendo'); setTimeout(() => el.remove(), 250); };
    const armar = () => { clearTimeout(temporizador); temporizador = setTimeout(cerrar, duracion || (deshacer ? 9000 : 5000)); };
    armar();
    el.addEventListener('mouseenter', () => clearTimeout(temporizador));
    el.addEventListener('mouseleave', armar);
    el.addEventListener('focusin', () => clearTimeout(temporizador));
    $('.icono-solo', el).addEventListener('click', cerrar);
    if (deshacer) $('[data-deshacer]', el).addEventListener('click', () => { cerrar(); deshacer(); });
    return { el, cerrar };
  }

  function confirmar({ titulo, texto, boton = 'Confirmar', peligro = false }) {
    return new Promise((resolver) => {
      const d = $('#dlgConfirmar');
      $('#tituloConf').textContent = titulo;
      $('#textoConf').textContent = texto;
      const si = $('#confSi');
      si.textContent = boton;
      si.className = 'btn ' + (peligro ? 'peligro' : 'primario');
      d.returnValue = '';
      d.addEventListener('close', () => resolver(d.returnValue === 'si'), { once: true });
      d.showModal();
      $('#confNo').focus();
    });
  }

  /* Solo existe un "Deshacer" vigente: el del último cambio. Así nunca se pisan cambios más nuevos. */
  function avisoConDeshacer(mensaje, antes, { mensajeDeshecho = 'Cambio deshecho.', alDeshacer } = {}) {
    if (ui.toastDeshacer) ui.toastDeshacer.cerrar();
    let vigente = true;
    const deshacer = () => {
      if (!vigente) return;
      vigente = false;
      ui.toastDeshacer?.cerrar();
      UP.restaurar(antes);
      ui.ultimo = null;
      if (alDeshacer) alDeshacer();
      renderTodo();
      toast({ tipo: 'info', msg: mensajeDeshecho });
    };
    ui.ultimo = deshacer;
    ui.toastDeshacer = toast({ tipo: 'ok', msg: mensaje, deshacer });
  }

  /* Ejecuta un cambio, vuelve a pintar y ofrece deshacerlo. */
  function cambio(fn, mensaje) {
    const antes = UP.instantanea();
    const resultado = fn();
    renderTodo();
    avisoConDeshacer(mensaje, antes);
    return resultado;
  }

  /* =====================================================
     Navegación
     ===================================================== */
  const hoyLargo = () => { const t = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); };
  const VISTAS = {
    resumen: ['Resumen general', () => hoyLargo()],
    alertas: ['Alertas de caducidad', () => 'Lotes por vencer o ya vencidos que todavía tienen piezas'],
    salida: ['Registrar salida', () => 'Venta o retiro de mercancía con método PEPS'],
    inventario: ['Inventario', () => 'Existencias de cada producto y su fila de lotes'],
    movimientos: ['Movimientos', () => 'Historial de entradas, salidas y mermas'],
    administrar: ['Administrar', () => 'Productos y lotes del inventario'],
  };

  function ir(vista) { location.hash = '#' + vista; }

  function mostrarVista() {
    const pedida = location.hash.slice(1);
    const vista = VISTAS[pedida] ? pedida : 'resumen';
    ui.vista = vista;
    $$('.vista').forEach((v) => { v.hidden = v.id !== 'vista-' + vista; });
    $$('#menu a').forEach((a) => {
      if (a.dataset.vista === vista) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const [titulo, sub] = VISTAS[vista];
    $('#titulo').textContent = titulo;
    $('#subtitulo').textContent = sub();
    $('#miga').textContent = titulo;
    document.title = `${titulo} · UP Inventory System`;
    cerrarMenu(false);
    renderTodo();
    $('#contenido').scrollTo({ top: 0, behavior: 'instant' });
    ui.animarGrafica = true;
    if (!ui.primeraCarga) $('#titulo').focus({ preventScroll: true });
    ui.primeraCarga = false;
  }

  /* Menú lateral en móvil */
  function abrirMenu() {
    document.body.classList.add('menu-abierto');
    $('#velo').hidden = false;
    $('#btnMenu').setAttribute('aria-expanded', 'true');
    $('#menu a').focus();
  }
  function cerrarMenu(devolverFoco = true) {
    if (!document.body.classList.contains('menu-abierto')) return;
    document.body.classList.remove('menu-abierto');
    $('#velo').hidden = true;
    $('#btnMenu').setAttribute('aria-expanded', 'false');
    if (devolverFoco) $('#btnMenu').focus();
  }

  /* =====================================================
     Render general
     ===================================================== */
  function renderTodo() {
    pintarInsignia();
    pintarGuardado();
    switch (ui.vista) {
      case 'resumen': pintarResumen(); break;
      case 'alertas': pintarAlertas(); break;
      case 'salida': pintarSalida(); break;
      case 'inventario': pintarInventario(); break;
      case 'movimientos': pintarMovimientos(); break;
      case 'administrar': pintarAdmin(); break;
    }
  }

  function pintarInsignia() {
    const r = UP.resumen();
    const n = r.porVencer + r.vencidos;
    const b = $('#insigniaAlertas');
    b.textContent = n;
    b.hidden = !n;
    b.setAttribute('aria-label', `${n} alertas`);
  }

  function pintarGuardado() {
    const p = $('#estadoGuardado');
    if (UP.guardadoOk) {
      p.classList.remove('error');
      $('span', p).textContent = 'Guardado automáticamente · ' + new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
    } else {
      p.classList.add('error');
      $('span', p).textContent = 'No se pudo guardar: tu navegador bloquea el almacenamiento.';
    }
  }

  /* =====================================================
     RESUMEN
     ===================================================== */
  function pintarResumen() {
    const r = UP.resumen();
    const tarjetas = [
      ['caja', '', 'Productos', num(r.productos), 'registrados', '#inventario'],
      ['capas', '', 'Piezas en stock', num(r.stock), 'todos los lotes', '#inventario'],
      ['dinero', 'verde', 'Valor a costo', dinero(r.valor), 'inventario actual', '#inventario'],
      ['reloj', r.porVencer ? 'ambar' : '', 'Por vencer', num(r.porVencer), 'lotes en los próximos 7 días', '#alertas'],
      ['alerta', r.vencidos ? 'rojo' : '', 'Vencidos', num(r.vencidos), 'con piezas por dar de baja', '#alertas'],
      ['basura', '', 'Merma acumulada', num(r.mermaPiezas) + ' pzas', dinero(r.mermaCosto) + ' a costo', '#movimientos', 'merma'],
    ];
    $('#kpis').innerHTML = tarjetas.map(([i, c, t, v, n, href, filtro]) =>
      `<a class="kpi ${c}" href="${href}" ${filtro ? `data-filtro-mov="${filtro}"` : ''}><span class="icono">${ic(i)}</span><span><small>${t}</small><b>${v}</b><i>${n}</i></span></a>`).join('');

    graficaSerie();
    graficaMermas();

    const proximos = UP.estado.productos
      .map((p) => ({ p, cabeza: UP.filaPEPS(p.id)[0] }))
      .filter((x) => x.cabeza)
      .sort((a, b) => (a.cabeza.fechaCaducidad || '9999').localeCompare(b.cabeza.fechaCaducidad || '9999'))
      .slice(0, 6);
    $('#listaProximos').innerHTML = proximos.length
      ? `<div class="lista-items">${proximos.map(({ p, cabeza }) => {
        const d = UP.diasParaVencer(cabeza);
        const clase = d !== null && d < 0 ? 'rojo' : d !== null && d <= 3 ? 'ambar' : '';
        return `<div class="item ${clase}">
          <span class="icono">${ic('caja')}</span>
          <div class="texto"><b>${esc(p.nombre)}</b><small>Lote #${cabeza.id} · entró el ${fFecha(cabeza.fechaEntrada)} · ${plural(cabeza.stockActual, 'pieza', 'piezas')}</small></div>
          <div class="fin">${tagCad(d)}<button type="button" class="btn chico secundario" data-salida="${p.id}" aria-label="Registrar salida de ${esc(p.nombre)}">Registrar salida</button></div>
        </div>`;
      }).join('')}</div>`
      : `<div class="vacio">No hay existencias registradas.<br><button type="button" class="btn primario" data-nuevo="lote">${ic('mas')}Registrar una entrada</button></div>`;

    // Guía de bienvenida (solo la primera vez)
    let vista = false;
    try { vista = localStorage.getItem('up-inventory-system:bienvenida') === 'cerrada'; } catch (_) { /* sin almacenamiento */ }
    $('#bienvenida').hidden = vista || ui.bienvenidaCerrada;
  }

  /* ---- gráfica de líneas suaves con área (SVG, sin librerías) ---- */
  function pasoLindo(max) {
    const crudo = max / 4;
    const base = Math.pow(10, Math.floor(Math.log10(crudo)));
    return [1, 2, 2.5, 5, 10].map((m) => m * base).find((p) => p >= crudo);
  }

  /* Curva suave (Catmull-Rom → Bézier) que pasa por todos los puntos */
  function curva(pts, ymin, ymax) {
    if (pts.length < 2) return '';
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let k = 0; k < pts.length - 1; k++) {
      const p0 = pts[k - 1] || pts[k], p1 = pts[k], p2 = pts[k + 1], p3 = pts[k + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      // los controles se limitan al área de la gráfica: la curva nunca "rebota" bajo cero
      c1[1] = Math.min(Math.max(c1[1], ymin), ymax); c2[1] = Math.min(Math.max(c2[1], ymin), ymax);
      d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  }

  function graficaSerie() {
    const n = ui.rango;
    const { dias, entradas, salidas } = UP.serieDiaria(n);
    const W = 640, H = 290, m = { l: 40, r: 24, t: 16, b: 40 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const max = Math.max(4, ...entradas, ...salidas);
    const paso = pasoLindo(max);
    const techo = paso * Math.ceil(max / paso);
    const y = (v) => m.t + ih - (v / techo) * ih;
    const x = (i) => m.l + (i / (n - 1)) * iw;
    const base = m.t + ih;
    const ptsE = entradas.map((v, i) => [x(i), y(v)]);
    const ptsS = salidas.map((v, i) => [x(i), y(v)]);
    const cada = n <= 7 ? 1 : n <= 14 ? 2 : 4;

    let svg = `<defs>
      <linearGradient id="gradE" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1FA463" stop-opacity=".28"/><stop offset="1" stop-color="#1FA463" stop-opacity="0"/></linearGradient>
      <linearGradient id="gradS" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1366F2" stop-opacity=".30"/><stop offset="1" stop-color="#1366F2" stop-opacity="0"/></linearGradient>
    </defs>`;
    for (let v = 0; v <= techo; v += paso) {
      svg += `<line class="rejilla" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="eje" x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    }
    const area = (pts) => `${curva(pts, m.t, base)} L${pts[pts.length - 1][0]},${base} L${pts[0][0]},${base} Z`;
    svg += `<path class="area-e" d="${area(ptsE)}"/><path class="area-s" d="${area(ptsS)}"/>`;
    const anim = ui.animarGrafica && !reducirMovimiento() ? ' dibuja' : '';
    svg += `<path class="linea-e${anim}" pathLength="1" d="${curva(ptsE, m.t, base)}"/><path class="linea-s${anim}" pathLength="1" d="${curva(ptsS, m.t, base)}"/>`;
    ui.animarGrafica = false;

    dias.forEach((d, i) => {
      if ((n - 1 - i) % cada === 0) svg += `<text class="eje" x="${x(i)}" y="${H - 16}" text-anchor="middle">${fCorta(d)}</text>`;
    });
    svg += `<line class="guia" id="guiaSerie" y1="${m.t}" y2="${base}" x1="0" x2="0" hidden/><circle class="punto-e" id="pE" r="5" hidden/><circle class="punto-s" id="pS" r="5" hidden/>`;
    const gw = iw / (n - 1);
    dias.forEach((d, i) => {
      svg += `<rect class="zona" x="${x(i) - gw / 2}" y="${m.t}" width="${gw}" height="${ih + 20}" tabindex="0" role="img" data-i="${i}" aria-label="${fCorta(d)}: ${entradas[i]} piezas de entrada y ${salidas[i]} de salida"/>`;
    });

    const totE = entradas.reduce((a, b) => a + b, 0), totS = salidas.reduce((a, b) => a + b, 0);
    $('#subSerie').textContent = `Piezas por día, últimos ${n} días`;
    $$('#rangoSerie button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v === n)));
    const cont = $('#grafSerie');
    cont.innerHTML = `
      <div class="leyenda" style="margin-bottom:8px"><span><i class="lg e"></i>Entradas</span><span><i class="lg s"></i>Salidas (ventas)</span></div>
      <svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Gráfica de líneas de entradas y salidas por día">${svg}</svg>
      <p class="resumen-grafica">En ${n} días: <b>${num(totE)}</b> piezas entraron y <b>${num(totS)}</b> salieron por venta.</p>
      <div class="tip" hidden></div>`;

    const tip = $('.tip', cont), guia = $('#guiaSerie', cont), pE = $('#pE', cont), pS = $('#pS', cont), svgEl = $('svg', cont);
    const mostrar = (zona) => {
      const i = +zona.dataset.i;
      [guia, pE, pS].forEach((el) => { el.hidden = false; });
      guia.setAttribute('x1', x(i)); guia.setAttribute('x2', x(i));
      pE.setAttribute('cx', x(i)); pE.setAttribute('cy', y(entradas[i]));
      pS.setAttribute('cx', x(i)); pS.setAttribute('cy', y(salidas[i]));
      tip.innerHTML = `<b>${fFecha(dias[i])}</b>Entradas: ${entradas[i]}<br>Salidas: ${salidas[i]}`;
      tip.hidden = false;
      const r = svgEl.getBoundingClientRect(), rc = cont.getBoundingClientRect();
      tip.style.left = Math.min(Math.max(r.left - rc.left + (x(i) / W) * r.width, 60), rc.width - 60) + 'px';
      tip.style.top = r.top - rc.top + (Math.min(y(entradas[i]), y(salidas[i])) / H) * r.height - 4 + 'px';
    };
    const ocultar = () => { tip.hidden = true; [guia, pE, pS].forEach((el) => { el.hidden = true; }); };
    $$('.zona', cont).forEach((z) => {
      z.addEventListener('mouseenter', () => mostrar(z));
      z.addEventListener('focus', () => mostrar(z));
      z.addEventListener('mouseleave', ocultar);
      z.addEventListener('blur', ocultar);
    });
  }

  /* ---- dona de mermas por motivo ---- */
  const COLORES_DONA = ['#14338A', '#1366F2', '#6DAEF3', '#4BC0E8', '#A9CDF8'];

  function graficaMermas() {
    const datos = UP.mermasPorMotivo();
    const cont = $('#grafMermas');
    if (!datos.length) { cont.innerHTML = '<div class="vacio-bueno">' + ic('ok') + 'Sin mermas registradas</div>'; return; }
    const total = datos.reduce((a, d) => a + d.piezas, 0);
    const R = 80, C = 2 * Math.PI * R, hueco = datos.length > 1 ? 4 : 0;
    let acum = 0;
    const segs = datos.map((d, i) => {
      const len = (d.piezas / total) * C;
      const el = `<circle class="seg" data-i="${i}" cx="110" cy="110" r="${R}" stroke="${COLORES_DONA[i % COLORES_DONA.length]}" stroke-dasharray="${Math.max(len - hueco, 1)} ${C}" stroke-dashoffset="${-acum}" transform="rotate(-90 110 110)" tabindex="0" role="img" aria-label="${esc(d.motivo)}: ${plural(d.piezas, 'pieza', 'piezas')}, ${Math.round((d.piezas / total) * 100)} %"/>`;
      acum += len;
      return el;
    }).join('');
    cont.innerHTML = `<div class="grafica-dona">
      <div class="dona-caja" id="donaCaja"><svg viewBox="0 0 220 220" role="group" aria-label="Dona de mermas por motivo">${segs}</svg>
        <div class="dona-centro" aria-hidden="true"><b id="donaNum">${num(total)}</b><small id="donaTxt">piezas dadas de baja</small></div></div>
      <div class="dona-leyenda">${datos.map((d, i) => `<button type="button" data-i="${i}"><i style="background:${COLORES_DONA[i % COLORES_DONA.length]}"></i>${esc(d.motivo)} <em>${num(d.piezas)}</em></button>`).join('')}</div></div>`;
    const caja = $('#donaCaja', cont);
    const marcar = (i) => {
      caja.classList.toggle('hay-foco', i !== null);
      $$('.seg', cont).forEach((e) => e.classList.toggle('activo', +e.dataset.i === i));
      $$('.dona-leyenda button', cont).forEach((e) => e.classList.toggle('activo', +e.dataset.i === i));
      $('#donaNum').textContent = i === null ? num(total) : num(datos[i].piezas);
      $('#donaTxt').textContent = i === null ? 'piezas dadas de baja' : `${datos[i].motivo} · ${Math.round((datos[i].piezas / total) * 100)} %`;
    };
    $$('.seg, .dona-leyenda button', cont).forEach((e) => {
      e.addEventListener('mouseenter', () => marcar(+e.dataset.i));
      e.addEventListener('focus', () => marcar(+e.dataset.i));
      e.addEventListener('mouseleave', () => marcar(null));
      e.addEventListener('blur', () => marcar(null));
    });
  }

  /* =====================================================
     ALERTAS
     ===================================================== */
  function pintarAlertas() {
    const lista = UP.alertas(ui.alertDias);
    $('#diasAlerta').value = String(ui.alertDias);
    if (!lista.length) {
      $('#listaAlertas').innerHTML = `<div class="vacio-bueno">${ic('ok')}Todo en orden: ningún lote vence en los próximos ${ui.alertDias} días.</div>`;
      return;
    }
    $('#listaAlertas').innerHTML = `<p class="contador">${plural(lista.length, 'lote requiere', 'lotes requieren')} atención.</p><div class="lista-items">${lista.map(({ lote, producto, dias }) => {
      const clase = dias < 0 ? 'rojo' : dias <= 3 ? 'ambar' : '';
      const accion = dias < 0
        ? `<button type="button" class="btn chico primario" data-merma="${lote.id}" aria-label="Dar de baja el lote ${lote.id} de ${esc(producto.nombre)}">Dar de baja</button>`
        : `<button type="button" class="btn chico secundario" data-salida="${producto.id}" aria-label="Registrar salida de ${esc(producto.nombre)}">Registrar salida</button>`;
      return `<div class="item ${clase}">
        <span class="icono">${ic(dias < 0 ? 'alerta' : 'reloj')}</span>
        <div class="texto"><b>${esc(producto.nombre)}</b><small>Lote #${lote.id} · caduca el ${fFecha(lote.fechaCaducidad)} · ${esc(producto.ubicacion || 'Sin ubicación')}</small></div>
        <div class="fin">${tagCad(dias)}<small>${plural(lote.stockActual, 'pieza', 'piezas')}</small>${accion}</div>
      </div>`;
    }).join('')}</div>`;
  }

  /* =====================================================
     REGISTRAR SALIDA · PEPS EN VIVO
     ===================================================== */
  const leerCantidad = () => {
    const v = $('#cant').value.trim();
    return v === '' ? NaN : Number(v);
  };

  function pintarSalida() {
    const prods = UP.inventario();
    const conStock = prods.filter((p) => p.stock > 0);
    const sel = $('#prod');
    if (ui.salida.pid === null || !conStock.some((p) => p.id === ui.salida.pid)) ui.salida.pid = conStock[0]?.id ?? null;

    sel.innerHTML = conStock.length
      ? conStock.map((p) => `<option value="${p.id}">${esc(p.nombre)} — ${plural(p.stock, 'pieza', 'piezas')}</option>`).join('')
        + prods.filter((p) => p.stock === 0).map((p) => `<option value="${p.id}" disabled>${esc(p.nombre)} — agotado</option>`).join('')
      : '<option value="">Sin productos con existencias</option>';
    if (ui.salida.pid !== null) sel.value = String(ui.salida.pid);
    sel.disabled = !conStock.length;
    $('#cant').disabled = !conStock.length;

    pintarInfoProducto();
    pintarChips();
    pintarSimulacion();
  }

  function pintarInfoProducto() {
    const p = UP.producto(ui.salida.pid);
    $('#prodInfo').innerHTML = p
      ? `Precio de venta <b>${dinero(p.precio)}</b> · Ubicación: ${esc(p.ubicacion || 'sin definir')} · Existencias: <b>${plural(UP.stockDe(p.id), 'pieza', 'piezas')}</b>`
      : 'Registra una entrada de mercancía para poder hacer salidas.';
  }

  function pintarChips() {
    const disp = ui.salida.pid ? UP.stockDe(ui.salida.pid) : 0;
    const valores = [1, 5, 10, 25].filter((n) => n < disp);
    const botones = valores.map((n) => `<button type="button" class="chip" data-n="${n}" aria-label="Usar ${plural(n, 'pieza', 'piezas')}">${n}</button>`);
    if (disp > 0) botones.push(`<button type="button" class="chip" data-n="${disp}" aria-label="Usar todas las ${disp} piezas">Todo (${num(disp)})</button>`);
    $('#chipsCant').innerHTML = botones.join('');
    $('#cantAyuda').textContent = disp ? `Máximo disponible: ${num(disp)} piezas.` : '';
    $('#cant').max = disp || '';
  }

  /* Valida la cantidad y devuelve un mensaje (o ''). */
  function mensajeCantidad() {
    const disp = ui.salida.pid ? UP.stockDe(ui.salida.pid) : 0;
    const n = leerCantidad();
    if (!disp) return 'No hay existencias de este producto.';
    if (Number.isNaN(n)) return 'Escribe cuántas piezas van a salir.';
    if (!Number.isInteger(n)) return 'Usa un número entero, sin decimales.';
    if (n < 1) return 'La cantidad debe ser al menos 1.';
    if (n > disp) return `Solo hay ${num(disp)} piezas disponibles.`;
    return '';
  }

  function pintarErrorCantidad(forzar = false) {
    const msg = mensajeCantidad();
    const n = leerCantidad();
    const disp = ui.salida.pid ? UP.stockDe(ui.salida.pid) : 0;
    const exceso = Number.isInteger(n) && n > disp;
    const mostrar = msg && (forzar || ui.salida.tocado || exceso);
    const err = $('#cantError'), campo = $('#cant');
    // solo se vuelve a pintar si cambió: así un blur no reemplaza el botón justo antes de que reciba el clic
    const html = mostrar ? esc(msg) + (exceso && disp ? ` <button type="button" data-usar="${disp}">Usar ${num(disp)}</button>` : '') : '';
    if (err.dataset.html !== html) { err.innerHTML = html; err.dataset.html = html; }
    if (mostrar) campo.setAttribute('aria-invalid', 'true'); else campo.removeAttribute('aria-invalid');
    return msg;
  }

  function pintarSimulacion() {
    const pid = ui.salida.pid;
    const n = leerCantidad();
    const cola = $('#cola');
    const btn = $('#btnSalida');
    pintarErrorCantidad();

    if (!pid) {
      cola.innerHTML = `<li class="vacio">No hay lotes con existencias.<br><button type="button" class="btn primario" data-nuevo="lote">${ic('mas')}Registrar una entrada</button></li>`;
      $('#totalesSim').innerHTML = '';
      $('#avisosSim').innerHTML = '';
      $('span', btn).textContent = 'Registrar salida';
      return;
    }

    const sim = UP.simularSalida(pid, n);
    cola.innerHTML = sim.pasos.map((p, i) => {
      const l = p.lote, ini = l.stockInicial || 1;
      const dias = UP.diasParaVencer(l);
      const cls = ['lote-peps', p.tomar > 0 ? 'activo' : 'inactivo', dias !== null && dias < 0 ? 'vencido' : ''].join(' ');
      return `<li class="${cls}">
        <span class="orden" title="Posición en la fila PEPS">${i + 1}</span>
        <div class="lote-info"><b>Lote #${l.id}${i === 0 ? ' · sale primero' : ''}</b><small>Entró el ${fFecha(l.fechaEntrada)}</small><small>${l.fechaCaducidad ? 'Caduca el ' + fFecha(l.fechaCaducidad) : 'Sin caducidad'}</small></div>
        <div class="barra-lote" role="img" aria-label="Lote ${l.id}: quedarán ${p.queda} de ${l.stockInicial} piezas${p.tomar ? ', se retiran ' + p.tomar : ''}">
          <span class="resto" style="width:${p.queda / ini * 100}%"></span>${p.tomar ? `<span class="toma" style="width:${p.tomar / ini * 100}%"></span>` : ''}
        </div>
        <div class="lote-num">${p.tomar ? `<span class="toma-txt">Se retiran ${num(p.tomar)}</span><br>` : ''}<b>${num(p.queda)}</b> de ${num(l.stockInicial)} quedan</div>
      </li>`;
    }).join('');

    // avisos inteligentes
    const avisos = [];
    const tocados = sim.pasos.filter((p) => p.tomar > 0);
    const vencidoTocado = tocados.find((p) => { const d = UP.diasParaVencer(p.lote); return d !== null && d < 0; });
    if (vencidoTocado) {
      avisos.push(`<div class="aviso rojo" role="alert">${ic('alerta')}<span><b>El lote #${vencidoTocado.lote.id} ya está vencido.</b> No conviene venderlo: dalo de baja como merma.</span><button type="button" class="btn chico secundario" data-merma="${vencidoTocado.lote.id}">Dar de baja</button></div>`);
    }
    const noTocados = sim.pasos.filter((p) => p.tomar === 0 && p.lote.fechaCaducidad);
    const adelantado = tocados.length && noTocados.find((q) => tocados.some((t) => t.lote.fechaCaducidad && q.lote.fechaCaducidad < t.lote.fechaCaducidad));
    if (adelantado) {
      avisos.push(`<div class="aviso ambar">${ic('info')}<span>El lote #${adelantado.lote.id} caduca antes que otro lote que sí se está usando. PEPS respeta el orden de entrada; revisa si te conviene venderlo primero.</span></div>`);
    }
    $('#avisosSim').innerHTML = avisos.join('');

    $('#totalesSim').innerHTML = `
      <div><dt>Piezas</dt><dd>${num(sim.tomado)}</dd></div>
      <div><dt>Ingreso por venta</dt><dd>${dinero(sim.ingreso)}</dd></div>
      <div><dt>Costo (lotes PEPS)</dt><dd>${dinero(sim.costo)}</dd></div>
      <div class="destacado"><dt>Ganancia</dt><dd>${dinero(sim.ganancia)}</dd></div>`;

    $('span', btn).textContent = sim.valida ? `Registrar salida de ${plural(n, 'pieza', 'piezas')}` : 'Registrar salida';
  }

  function fijarCantidad(v) {
    $('#cant').value = v;
    ui.salida.tocado = true;
    pintarSimulacion();
  }

  async function enviarSalida(e) {
    e.preventDefault();
    ui.salida.tocado = true;
    const msg = pintarErrorCantidad(true);
    if (msg) { $('#cant').focus(); return; }

    const pid = ui.salida.pid, n = leerCantidad();
    const btn = $('#btnSalida');
    btn.classList.add('cargando');
    const sim0 = UP.simularSalida(pid, n);

    // animación: lo que se retira desaparece de cada lote antes de confirmar
    $('#simulacion').classList.add('consumiendo');
    await esperar(reducirMovimiento() ? 0 : 600);
    $('#simulacion').classList.remove('consumiendo');
    btn.classList.remove('cargando');

    const antes = UP.instantanea();
    let sim;
    try { sim = UP.registrarSalida(pid, n); }
    catch (err) { toast({ tipo: 'error', msg: err.message }); pintarSalida(); return; }

    ui.salida.tocado = false;
    $('#cant').value = 1;
    renderTodo();
    pintarRecibo(sim0);
    avisoConDeshacer(`Salida registrada: ${plural(n, 'pieza', 'piezas')} de ${sim0.producto.nombre}.`, antes, {
      mensajeDeshecho: 'Salida deshecha: las piezas volvieron a sus lotes.',
      alDeshacer: () => { $('#recibo').hidden = true; },
    });
  }

  function pintarRecibo(sim) {
    const r = $('#recibo');
    const filas = sim.pasos.filter((p) => p.tomar > 0).map((p) => `<tr><td>Lote #${p.lote.id}</td><td>${fFecha(p.lote.fechaEntrada)}</td><td class="der"><b>${num(p.tomar)}</b></td><td class="der">${dinero(p.lote.costo)}</td><td class="der">${num(p.queda)}</td></tr>`).join('');
    r.innerHTML = `
      <h2 tabindex="-1" id="tituloRecibo">${ic('ok')}Salida registrada</h2>
      <p>${plural(sim.tomado, 'pieza', 'piezas')} de <b>${esc(sim.producto.nombre)}</b>, descontadas con PEPS de ${plural(sim.pasos.filter((p) => p.tomar).length, 'lote', 'lotes')}:</p>
      <div class="tabla-scroll"><table><thead><tr><th>Lote</th><th>Entró</th><th class="der">Piezas</th><th class="der">Costo c/u</th><th class="der">Quedan</th></tr></thead><tbody>${filas}</tbody></table></div>
      <dl class="totales"><div><dt>Ingreso</dt><dd>${dinero(sim.ingreso)}</dd></div><div><dt>Costo</dt><dd>${dinero(sim.costo)}</dd></div><div class="destacado"><dt>Ganancia</dt><dd>${dinero(sim.ganancia)}</dd></div></dl>
      <div class="fila-botones" style="margin-top:16px"><button type="button" class="btn primario" id="otraSalida">Registrar otra salida</button><a class="btn secundario" href="#movimientos">Ver movimientos</a></div>`;
    r.hidden = false;
    if (!reducirMovimiento()) r.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* =====================================================
     INVENTARIO
     ===================================================== */
  function pintarInventario() {
    const todos = UP.inventario();

    // categorías (conserva la selección)
    const cats = [...new Set(todos.map((p) => p.categoria).filter(Boolean))].sort();
    $('#catInv').innerHTML = '<option value="">Todas</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
    $('#catInv').value = cats.includes(ui.inv.cat) ? ui.inv.cat : '';
    ui.inv.cat = $('#catInv').value;

    const q = norm(ui.inv.q);
    let datos = todos.filter((p) => {
      if (q && !norm([p.nombre, p.marca, p.categoria, p.codigo, p.proveedor, p.ubicacion].join(' ')).includes(q)) return false;
      if (ui.inv.cat && p.categoria !== ui.inv.cat) return false;
      if (ui.inv.estado === 'agotado') return p.stock === 0;
      if (ui.inv.estado === 'alerta') return p.fila.some((l) => { const d = UP.diasParaVencer(l); return d !== null && d <= 7; });
      return true;
    });

    const k = ui.inv.orden, dir = ui.inv.dir;
    const valor = (p) => k === 'vence' ? (p.vence || '9999') : k === 'stock' || k === 'precio' ? p[k] : norm(p[k] || '');
    datos.sort((a, b) => (valor(a) < valor(b) ? -1 : valor(a) > valor(b) ? 1 : 0) * dir);

    $('#contInv').textContent = `Mostrando ${datos.length} de ${todos.length} productos`;
    if (!datos.length) {
      $('#tInv').innerHTML = `<div class="vacio">No encontramos productos con esos filtros.<br><button type="button" class="btn secundario" id="limpiarInv">Limpiar filtros</button></div>`;
      return;
    }

    const maximo = Math.max(1, ...todos.map((p) => p.stock));
    const th = (clave, texto, der = false) => {
      const activo = ui.inv.orden === clave;
      const sort = activo ? (ui.inv.dir === 1 ? 'ascending' : 'descending') : 'none';
      return `<th scope="col" aria-sort="${sort}" ${der ? 'class="der"' : ''}><button type="button" data-orden="${clave}">${texto}<span class="flecha" aria-hidden="true">${activo ? (ui.inv.dir === 1 ? '▲' : '▼') : '↕'}</span></button></th>`;
    };

    $('#tInv').innerHTML = `<table>
      <caption class="sr">Inventario por producto. Usa los encabezados para ordenar y pulsa el nombre de un producto para ver sus lotes.</caption>
      <thead><tr>${th('nombre', 'Producto')}${th('ubicacion', 'Ubicación')}<th scope="col">Lotes</th>${th('stock', 'Stock')}${th('vence', 'Próx. vencimiento')}${th('precio', 'Precio', true)}<th scope="col"><span class="sr">Acciones</span></th></tr></thead>
      <tbody>${datos.map((p) => {
        const abierto = ui.inv.abiertos.has(p.id);
        const fila = `<tr>
          <td><button type="button" class="btn-fila" data-abrir="${p.id}" aria-expanded="${abierto}" aria-controls="det-${p.id}">${ic('chevron')}<span><b>${esc(p.nombre)}</b><span class="sub">${esc([p.categoria, p.marca].filter(Boolean).join(' · ') || 'Sin categoría')}</span></span></button></td>
          <td>${esc(p.ubicacion) || '—'}</td>
          <td>${p.lotes}</td>
          <td>${p.stock > 0 ? `${num(p.stock)}<span class="barra-stock"><i style="width:${Math.round(p.stock / maximo * 100)}%"></i></span>` : etiqueta('rojo', ic('alerta') + 'Agotado')}</td>
          <td>${p.vence ? `${fFecha(p.vence)}<span class="sub">${tagCad(p.diasVence)}</span>` : '—'}</td>
          <td class="der">${dinero(p.precio)}</td>
          <td class="der">${p.stock > 0
            ? `<button type="button" class="btn chico secundario" data-salida="${p.id}" aria-label="Registrar salida de ${esc(p.nombre)}">Salida</button>`
            : `<button type="button" class="btn chico secundario" data-nuevo="lote" data-prod="${p.id}" aria-label="Registrar entrada de ${esc(p.nombre)}">Entrada</button>`}</td>
        </tr>`;
        const detalle = abierto ? `<tr class="fila-detalle" id="det-${p.id}"><td colspan="7">${colaMini(p)}</td></tr>` : '';
        return fila + detalle;
      }).join('')}</tbody></table>`;
  }

  function colaMini(p) {
    if (!p.fila.length) return '<p>Sin lotes con existencias. Registra una entrada para reponer este producto.</p>';
    return `<p class="contador" style="margin-bottom:10px"><b>Fila PEPS:</b> el lote 1 es el que sale primero.</p><ol class="mini-cola">${p.fila.map((l, i) => `
      <li><span class="orden">${i + 1}</span>
        <span><b>Lote #${l.id}</b><br><small>Entró el ${fFecha(l.fechaEntrada)}</small></span>
        <span class="barra-lote" role="img" aria-label="${l.stockActual} de ${l.stockInicial} piezas"><span class="resto" style="width:${l.stockActual / l.stockInicial * 100}%"></span></span>
        <span>${num(l.stockActual)} de ${num(l.stockInicial)} pzas ${tagCad(UP.diasParaVencer(l))}</span></li>`).join('')}</ol>`;
  }

  function exportarCsv() {
    const celdas = (a) => a.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',');
    const filas = [['Producto', 'Marca', 'Categoría', 'Código de barras', 'Proveedor', 'Ubicación', 'Stock', 'Lotes con piezas', 'Próximo vencimiento', 'Precio de venta']]
      .concat(UP.inventario().map((p) => [p.nombre, p.marca, p.categoria, p.codigo, p.proveedor, p.ubicacion, p.stock, p.lotes, p.vence || '', p.precio]));
    const blob = new Blob(['﻿' + filas.map(celdas).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `inventario-${UP.hoy()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast({ tipo: 'ok', msg: 'Inventario exportado a CSV.' });
  }

  /* =====================================================
     MOVIMIENTOS
     ===================================================== */
  function pintarMovimientos() {
    $$('#tipoMov button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === ui.mov.tipo)));
    const q = norm(ui.mov.q);
    const todos = UP.movimientos();
    const datos = todos.filter((m) => {
      if (ui.mov.tipo === 'entrada' && m.tipo !== 'entrada') return false;
      if (ui.mov.tipo === 'salida' && (m.tipo !== 'salida' || m.merma)) return false;
      if (ui.mov.tipo === 'merma' && !m.merma) return false;
      return !q || norm([m.producto, '#' + m.loteId, 'lote ' + m.loteId, m.nota].join(' ')).includes(q);
    });
    const visibles = datos.slice(0, ui.mov.max);
    $('#contMov').textContent = `Mostrando ${visibles.length} de ${datos.length} movimientos`;
    $('#verMas').hidden = datos.length <= visibles.length;

    if (!datos.length) { $('#tMov').innerHTML = '<div class="vacio">No hay movimientos con esos filtros.</div>'; return; }
    $('#tMov').innerHTML = `<table><caption class="sr">Historial de movimientos</caption>
      <thead><tr><th scope="col">Fecha</th><th scope="col">Producto</th><th scope="col">Lote</th><th scope="col">Tipo</th><th scope="col" class="der">Cantidad</th><th scope="col">Nota</th></tr></thead>
      <tbody>${visibles.map((m) => `<tr>
        <td>${fHora(m.fecha)}</td><td><b>${esc(m.producto)}</b></td><td>#${m.loteId}</td>
        <td>${m.tipo === 'entrada' ? etiqueta('verde', 'Entrada') : m.merma ? etiqueta('rojo', 'Merma') : etiqueta('', 'Salida')}</td>
        <td class="der">${m.tipo === 'entrada' ? `<span class="mas">+${num(m.cantidad)}</span>` : `<span class="menos">−${num(m.cantidad)}</span>`}</td>
        <td>${esc(m.nota)}</td></tr>`).join('')}</tbody></table>`;
  }

  /* =====================================================
     ADMINISTRAR
     ===================================================== */
  function pintarAdmin() {
    const tab = ui.admin.tab;
    $$('[role="tab"]').forEach((t) => { const act = t.id === 'tab-' + tab; t.setAttribute('aria-selected', String(act)); t.tabIndex = act ? 0 : -1; });
    $('#panel-productos').hidden = tab !== 'productos';
    $('#panel-lotes').hidden = tab !== 'lotes';
    if (tab === 'productos') pintarTablaProductos(); else pintarTablaLotes();
  }

  function pintarTablaProductos() {
    const prods = UP.estado.productos;
    if (!prods.length) { $('#tProductos').innerHTML = `<div class="vacio">Todavía no hay productos.<br><button type="button" class="btn primario" data-nuevo="producto">${ic('mas')}Crear el primero</button></div>`; return; }
    $('#tProductos').innerHTML = `<table><caption class="sr">Catálogo de productos</caption>
      <thead><tr><th scope="col">Producto</th><th scope="col">Categoría</th><th scope="col">Código</th><th scope="col">Proveedor</th><th scope="col">Ubicación</th><th scope="col" class="der">Precio</th><th scope="col" class="der">Stock</th><th scope="col"><span class="sr">Acciones</span></th></tr></thead>
      <tbody>${prods.map((p) => `<tr>
        <td><b>${esc(p.nombre)}</b><span class="sub">${esc(p.marca) || '—'}</span></td><td>${esc(p.categoria) || '—'}</td><td>${esc(p.codigo) || '—'}</td>
        <td>${esc(p.proveedor) || '—'}</td><td>${esc(p.ubicacion) || '—'}</td><td class="der">${dinero(p.precio)}</td><td class="der">${num(UP.stockDe(p.id))}</td>
        <td><div class="acciones">
          <button type="button" class="btn chico secundario" data-editar-prod="${p.id}" aria-label="Editar ${esc(p.nombre)}">${ic('editar')}Editar</button>
          <button type="button" class="btn chico secundario" data-borrar-prod="${p.id}" aria-label="Borrar ${esc(p.nombre)}">${ic('basura')}Borrar</button>
        </div></td></tr>`).join('')}</tbody></table>`;
  }

  function pintarTablaLotes() {
    const sel = $('#filtroLoteProd');
    sel.innerHTML = '<option value="">Todos los productos</option>' + UP.estado.productos.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');
    sel.value = UP.producto(+ui.admin.filtroProd) ? ui.admin.filtroProd : '';
    ui.admin.filtroProd = sel.value;
    $('#verAgotados').checked = ui.admin.agotados;

    const lotes = UP.estado.lotes
      .filter((l) => (!ui.admin.filtroProd || l.productoId === +ui.admin.filtroProd) && (ui.admin.agotados || l.stockActual > 0))
      .sort((a, b) => b.fechaEntrada.localeCompare(a.fechaEntrada) || b.id - a.id);
    if (!lotes.length) { $('#tLotes').innerHTML = `<div class="vacio">No hay lotes con existencias para este filtro.<br><button type="button" class="btn primario" data-nuevo="lote">${ic('mas')}Registrar una entrada</button></div>`; return; }
    $('#tLotes').innerHTML = `<table><caption class="sr">Lotes de mercancía</caption>
      <thead><tr><th scope="col">Producto</th><th scope="col">Lote</th><th scope="col">Entrada</th><th scope="col">Caducidad</th><th scope="col" class="der">Costo</th><th scope="col" class="der">Inicial</th><th scope="col" class="der">Actual</th><th scope="col"><span class="sr">Acciones</span></th></tr></thead>
      <tbody>${lotes.map((l) => {
        const p = UP.producto(l.productoId), d = UP.diasParaVencer(l);
        return `<tr>
          <td><b>${esc(p?.nombre)}</b></td><td>#${l.id}</td><td>${fFecha(l.fechaEntrada)}</td>
          <td>${l.fechaCaducidad ? `${fFecha(l.fechaCaducidad)}<span class="sub">${l.stockActual > 0 ? tagCad(d) : ''}</span>` : '—'}</td>
          <td class="der">${dinero(l.costo)}</td><td class="der">${num(l.stockInicial)}</td>
          <td class="der">${l.stockActual > 0 ? `<b>${num(l.stockActual)}</b>` : etiqueta('gris', 'Agotado')}</td>
          <td><div class="acciones">
            ${l.stockActual > 0 ? `<button type="button" class="btn chico secundario" data-merma="${l.id}" aria-label="Dar de baja piezas del lote ${l.id}">Merma</button>` : ''}
            <button type="button" class="btn chico secundario" data-editar-lote="${l.id}" aria-label="Editar lote ${l.id}">${ic('editar')}Editar</button>
            <button type="button" class="btn chico secundario" data-borrar-lote="${l.id}" aria-label="Borrar lote ${l.id}">${ic('basura')}Borrar</button>
          </div></td></tr>`;
      }).join('')}</tbody></table>`;
  }

  /* =====================================================
     Formularios en diálogos (con validación en línea)
     ===================================================== */
  function campoHTML({ id, label, tipo = 'text', req = false, ayuda = '', attrs = '', select = false, completo = false }) {
    const desc = (ayuda ? `${id}-ay ` : '') + `${id}-err`;
    const control = select
      ? `<select id="${id}" ${attrs} aria-describedby="${desc}"></select>`
      : `<input id="${id}" type="${tipo}" ${attrs} ${req ? 'aria-required="true"' : ''} aria-describedby="${desc}">`;
    return `<div class="campo ${completo ? 'completo' : ''}" id="c-${id}"><label for="${id}">${label}${req ? ' <span class="req" title="Obligatorio" aria-hidden="true">*</span>' : ''}</label>${control}${ayuda ? `<p class="ayuda-campo" id="${id}-ay">${ayuda}</p>` : ''}<p class="error-texto" id="${id}-err" role="alert"></p></div>`;
  }
  function setError(id, msg) {
    const el = $('#' + id);
    $('#' + id + '-err').textContent = msg || '';
    if (msg) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
  }
  /* Valida todas las reglas visibles; enfoca el primer error. */
  function validar(reglas) {
    let primero = null;
    Object.entries(reglas).forEach(([id, regla]) => {
      if ($('#c-' + id).hidden) return;
      const msg = regla($('#' + id).value.trim());
      setError(id, msg);
      if (msg && !primero) primero = $('#' + id);
    });
    if (primero) primero.focus();
    return !primero;
  }
  /* Valida al salir de cada campo y limpia el error mientras se corrige. */
  function conectarValidacion(form, obtenerReglas) {
    form.addEventListener('focusout', (e) => {
      if (e.relatedTarget && e.relatedTarget.closest('[data-cerrar]')) return;
      const regla = obtenerReglas()[e.target.id];
      if (regla && !$('#c-' + e.target.id).hidden) setError(e.target.id, regla(e.target.value.trim()));
    });
    form.addEventListener('input', (e) => {
      if (e.target.getAttribute('aria-invalid')) {
        const regla = obtenerReglas()[e.target.id];
        if (regla) setError(e.target.id, regla(e.target.value.trim()));
      }
    });
  }
  const limpiarErrores = (form) => $$('[aria-invalid]', form).forEach((el) => setError(el.id, ''));

  const esNumero = (v) => v !== '' && !Number.isNaN(Number(v));

  /* ---- producto ---- */
  let editandoProd = null;
  const reglasProd = () => ({
    pNombre: (v) => (v.length < 2 ? 'Escribe el nombre del producto (mínimo 2 letras).' : ''),
    pPrecio: (v) => (!esNumero(v) ? 'Escribe el precio de venta (puede ser 0).' : Number(v) < 0 ? 'El precio no puede ser negativo.' : ''),
    pCodigo: (v) => (v && UP.estado.productos.some((p) => p.codigo === v && p.id !== editandoProd) ? 'Ese código de barras ya está en otro producto.' : ''),
  });

  function abrirProducto(p) {
    editandoProd = p ? p.id : null;
    $('#tituloProd').textContent = p ? `Editar «${p.nombre}»` : 'Nuevo producto';
    const f = $('#formProducto');
    limpiarErrores(f);
    $('#pNombre').value = p?.nombre ?? '';
    $('#pMarca').value = p?.marca ?? '';
    $('#pCategoria').value = p?.categoria ?? '';
    $('#pCodigo').value = p?.codigo ?? '';
    $('#pPrecio').value = p?.precio ?? '';
    $('#pProveedor').value = p?.proveedor ?? '';
    $('#pUbicacion').value = p?.ubicacion ?? '';
    $('#dlCategorias').innerHTML = [...new Set(UP.estado.productos.map((x) => x.categoria).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join('');
    $('#dlgProducto').showModal();
    $('#pNombre').focus();
  }

  function guardarProducto(e) {
    e.preventDefault();
    if (!validar(reglasProd())) return;
    const datos = {
      nombre: $('#pNombre').value.trim(), marca: $('#pMarca').value.trim(), categoria: $('#pCategoria').value.trim(),
      codigo: $('#pCodigo').value.trim(), proveedor: $('#pProveedor').value.trim(), ubicacion: $('#pUbicacion').value.trim(),
      precio: Math.round(Number($('#pPrecio').value) * 100) / 100,
    };
    const editando = editandoProd;
    cambio(() => (editando ? UP.actualizarProducto(editando, datos) : UP.crearProducto(datos)), editando ? `Producto «${datos.nombre}» actualizado.` : `Producto «${datos.nombre}» creado. Ahora registra su primera entrada.`);
    $('#dlgProducto').close();
  }

  async function borrarProducto(id) {
    const p = UP.producto(id);
    const lotes = UP.estado.lotes.filter((l) => l.productoId === id);
    const nMov = UP.estado.movimientos.filter((m) => lotes.some((l) => l.id === m.loteId)).length;
    const ok = await confirmar({ titulo: `¿Borrar «${p.nombre}»?`, texto: `También se eliminarán sus ${plural(lotes.length, 'lote', 'lotes')} y ${plural(nMov, 'movimiento', 'movimientos')}. Podrás deshacerlo justo después.`, boton: 'Borrar producto', peligro: true });
    if (ok) cambio(() => UP.borrarProducto(id), `Producto «${p.nombre}» borrado.`);
  }

  /* ---- lote ---- */
  let editandoLote = null;
  const reglasLote = () => ({
    lProducto: (v) => (v ? '' : 'Elige un producto.'),
    lCantidad: (v) => (!esNumero(v) ? 'Escribe cuántas piezas llegaron.' : !Number.isInteger(Number(v)) || Number(v) < 1 ? 'Usa un número entero mayor a 0.' : ''),
    lCosto: (v) => (!esNumero(v) ? 'Escribe el costo por pieza.' : Number(v) < 0 ? 'El costo no puede ser negativo.' : ''),
    lEntrada: (v) => (!v ? 'Indica la fecha de entrada.' : v > UP.hoy() ? 'La fecha de entrada no puede ser futura.' : ''),
    lCaducidad: (v) => { const ent = $('#lEntrada').value; return v && ent && v < ent ? 'La caducidad no puede ser anterior a la fecha de entrada.' : ''; },
  });

  function abrirLote(l, productoId) {
    if (!l && !UP.estado.productos.length) { toast({ tipo: 'info', msg: 'Primero crea un producto en Administrar.' }); ir('administrar'); return; }
    editandoLote = l ? l.id : null;
    const f = $('#formLote');
    limpiarErrores(f);
    $('#tituloLote').textContent = l ? `Editar lote #${l.id} · ${UP.producto(l.productoId)?.nombre}` : 'Nueva entrada de lote';
    ['lProducto', 'lCantidad', 'lEntrada'].forEach((id) => { $('#c-' + id).hidden = !!l; });
    $('#lProducto').innerHTML = UP.estado.productos.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');
    $('#lProducto').value = String(productoId || (ui.vista === 'salida' && ui.salida.pid) || UP.estado.productos[0].id);
    $('#lCantidad').value = '';
    $('#lCosto').value = l?.costo ?? '';
    $('#lEntrada').value = l?.fechaEntrada ?? UP.hoy();
    $('#lEntrada').max = UP.hoy();
    $('#lCaducidad').value = l?.fechaCaducidad ?? '';
    $('#dlgLote').showModal();
    (l ? $('#lCosto') : $('#lCantidad')).focus();
  }

  function guardarLote(e) {
    e.preventDefault();
    if (!validar(reglasLote())) return;
    const costo = Math.round(Number($('#lCosto').value) * 100) / 100;
    const cad = $('#lCaducidad').value || null;
    const prod = UP.producto(+$('#lProducto').value);
    if (editandoLote) {
      const id = editandoLote;
      cambio(() => UP.actualizarLote(id, { costo, fechaCaducidad: cad }), `Lote #${id} actualizado.`);
    } else {
      const cantidad = Number($('#lCantidad').value);
      cambio(() => UP.registrarEntrada({ productoId: prod.id, cantidad, costo, fechaEntrada: $('#lEntrada').value, fechaCaducidad: cad }), `Entrada registrada: ${plural(cantidad, 'pieza', 'piezas')} de ${prod.nombre}.`);
    }
    $('#dlgLote').close();
  }

  async function borrarLote(id) {
    const l = UP.lote(id), p = UP.producto(l.productoId);
    const ok = await confirmar({ titulo: `¿Borrar el lote #${id}?`, texto: `Se eliminará el lote de «${p?.nombre}» con ${plural(l.stockActual, 'pieza', 'piezas')} y todos sus movimientos. Podrás deshacerlo justo después.`, boton: 'Borrar lote', peligro: true });
    if (ok) cambio(() => UP.borrarLote(id), `Lote #${id} borrado.`);
  }

  /* ---- merma ---- */
  let mermaLote = null;
  const reglasMerma = () => ({
    mCantidad: (v) => {
      const max = UP.lote(mermaLote)?.stockActual ?? 0;
      if (!esNumero(v)) return 'Escribe cuántas piezas se dan de baja.';
      if (!Number.isInteger(Number(v)) || Number(v) < 1) return 'Usa un número entero mayor a 0.';
      return Number(v) > max ? `Este lote solo tiene ${num(max)} piezas.` : '';
    },
    mMotivo: (v) => (v ? '' : 'Elige un motivo.'),
  });

  function abrirMerma(id) {
    const l = UP.lote(id);
    if (!l || l.stockActual < 1) { toast({ tipo: 'info', msg: 'Este lote ya no tiene piezas.' }); return; }
    mermaLote = id;
    const p = UP.producto(l.productoId), d = UP.diasParaVencer(l);
    limpiarErrores($('#formMerma'));
    $('#resumenMerma').innerHTML = `<b>${esc(p?.nombre)}</b> · Lote #${l.id} · entró el ${fFecha(l.fechaEntrada)} · quedan <b>${plural(l.stockActual, 'pieza', 'piezas')}</b> ${tagCad(d)}`;
    $('#mCantidad').max = l.stockActual;
    $('#mCantidad').value = d !== null && d < 0 ? l.stockActual : 1;
    $('#mMotivo').value = d !== null && d < 0 ? 'Caducidad' : '';
    $('#mNota').value = '';
    $('#dlgMerma').showModal();
    $('#mCantidad').focus();
    $('#mCantidad').select();
  }

  function guardarMerma(e) {
    e.preventDefault();
    if (!validar(reglasMerma())) return;
    const id = mermaLote, cant = Number($('#mCantidad').value), motivo = $('#mMotivo').value, nota = $('#mNota').value.trim();
    cambio(() => UP.registrarMerma(id, cant, motivo, nota), `Merma registrada: ${plural(cant, 'pieza', 'piezas')} del lote #${id} (${motivo.toLowerCase()}).`);
    $('#dlgMerma').close();
  }

  /* ---- abrir según el botón pulsado ---- */
  function nuevo(tipo, productoId) {
    if (tipo === 'producto') abrirProducto(null);
    else abrirLote(null, productoId);
  }

  /* =====================================================
     Ayuda
     ===================================================== */
  const abrirAyuda = () => $('#dlgAyuda').showModal();

  /* =====================================================
     Eventos
     ===================================================== */
  function iniciarEventos() {
    window.addEventListener('hashchange', mostrarVista);

    // menú móvil
    $('#btnMenu').addEventListener('click', () => (document.body.classList.contains('menu-abierto') ? cerrarMenu() : abrirMenu()));
    $('#velo').addEventListener('click', () => cerrarMenu());

    // ayuda y cabecera
    ['#btnAyuda', '#btnAyudaLateral', '#btnAyudaBienvenida'].forEach((s) => $(s).addEventListener('click', abrirAyuda));
    $('#btnNuevoLoteTop').addEventListener('click', () => nuevo('lote'));
    $('#cerrarBienvenida').addEventListener('click', () => {
      ui.bienvenidaCerrada = true;
      try { localStorage.setItem('up-inventory-system:bienvenida', 'cerrada'); } catch (_) { /* sin almacenamiento */ }
      $('#bienvenida').hidden = true;
      $('#titulo').focus();
    });
    $('#btnReiniciar').addEventListener('click', async () => {
      const ok = await confirmar({ titulo: '¿Restablecer los datos de ejemplo?', texto: 'Se reemplazarán todos los productos, lotes y movimientos actuales. Podrás deshacerlo justo después.', boton: 'Restablecer', peligro: true });
      if (ok) { cambio(() => { UP.reiniciar(); ui.salida.pid = null; $('#recibo').hidden = true; }, 'Datos de ejemplo restablecidos.'); cerrarMenu(false); }
    });

    // alertas
    $('#diasAlerta').addEventListener('change', (e) => { ui.alertDias = +e.target.value; pintarAlertas(); });

    // salida
    $('#prod').addEventListener('change', (e) => { ui.salida.pid = +e.target.value; ui.salida.tocado = false; $('#cant').value = 1; $('#recibo').hidden = true; pintarInfoProducto(); pintarChips(); pintarSimulacion(); });
    $('#cant').addEventListener('input', () => pintarSimulacion());
    $('#cant').addEventListener('blur', () => { ui.salida.tocado = true; pintarErrorCantidad(); });
    $('#menosCant').addEventListener('click', () => { const n = Number.isNaN(leerCantidad()) ? 1 : Math.floor(leerCantidad()); fijarCantidad(Math.max(1, n - 1)); });
    $('#masCant').addEventListener('click', () => { const disp = UP.stockDe(ui.salida.pid); const n = Number.isNaN(leerCantidad()) ? 0 : Math.floor(leerCantidad()); fijarCantidad(Math.min(disp || 1, n + 1)); });
    $('#chipsCant').addEventListener('click', (e) => { const b = e.target.closest('[data-n]'); if (b) { fijarCantidad(+b.dataset.n); $('#cant').focus(); } });
    $('#cantError').addEventListener('click', (e) => { const b = e.target.closest('[data-usar]'); if (b) { fijarCantidad(+b.dataset.usar); $('#cant').focus(); } });
    $('#formSalida').addEventListener('submit', enviarSalida);
    $('#vista-salida').addEventListener('click', (e) => { if (e.target.closest('#otraSalida')) { $('#recibo').hidden = true; $('#cant').focus(); $('#contenido').scrollTo({ top: 0 }); } });

    // inventario
    $('#busqInv').addEventListener('input', (e) => { ui.inv.q = e.target.value; pintarInventario(); });
    $('#catInv').addEventListener('change', (e) => { ui.inv.cat = e.target.value; pintarInventario(); });
    $('#estadoInv').addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]'); if (!b) return;
      ui.inv.estado = b.dataset.v;
      $$('#estadoInv button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      pintarInventario();
    });
    $('#tInv').addEventListener('click', (e) => {
      const orden = e.target.closest('[data-orden]');
      if (orden) {
        const k = orden.dataset.orden;
        ui.inv.dir = ui.inv.orden === k ? -ui.inv.dir : 1; ui.inv.orden = k;
        pintarInventario();
        $(`[data-orden="${k}"]`)?.focus();
        return;
      }
      const abrir = e.target.closest('[data-abrir]');
      if (abrir) {
        const id = +abrir.dataset.abrir;
        if (ui.inv.abiertos.has(id)) ui.inv.abiertos.delete(id); else ui.inv.abiertos.add(id);
        pintarInventario();
        $(`[data-abrir="${id}"]`)?.focus();
        return;
      }
      if (e.target.closest('#limpiarInv')) {
        Object.assign(ui.inv, { q: '', cat: '', estado: 'todos' });
        $('#busqInv').value = '';
        $$('#estadoInv button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === 'todos')));
        pintarInventario();
      }
    });
    $('#btnCsv').addEventListener('click', exportarCsv);

    // movimientos
    $('#busqMov').addEventListener('input', (e) => { ui.mov.q = e.target.value; ui.mov.max = 15; pintarMovimientos(); });
    $('#tipoMov').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) { ui.mov.tipo = b.dataset.v; ui.mov.max = 15; pintarMovimientos(); } });
    $('#verMas').addEventListener('click', () => { ui.mov.max += 15; pintarMovimientos(); });

    // administrar: pestañas con teclado de flechas
    const tabs = $$('[role="tab"]');
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => { ui.admin.tab = t.id.replace('tab-', ''); pintarAdmin(); });
      t.addEventListener('keydown', (e) => {
        const salto = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (salto === undefined && e.key !== 'Home' && e.key !== 'End') return;
        e.preventDefault();
        const destino = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + salto + tabs.length) % tabs.length;
        ui.admin.tab = tabs[destino].id.replace('tab-', ''); pintarAdmin(); tabs[destino].focus();
      });
    });
    $('#filtroLoteProd').addEventListener('change', (e) => { ui.admin.filtroProd = e.target.value; pintarTablaLotes(); });
    $('#verAgotados').addEventListener('change', (e) => { ui.admin.agotados = e.target.checked; pintarTablaLotes(); });

    // diálogos
    $('#camposProducto').innerHTML =
      campoHTML({ id: 'pNombre', label: 'Nombre', req: true, completo: true, attrs: 'maxlength="150" autocomplete="off"', ayuda: 'Ejemplo: Leche entera 1 L' }) +
      campoHTML({ id: 'pMarca', label: 'Marca', attrs: 'maxlength="100"' }) +
      campoHTML({ id: 'pCategoria', label: 'Categoría', attrs: 'maxlength="100" list="dlCategorias"' }) +
      campoHTML({ id: 'pCodigo', label: 'Código de barras', attrs: 'maxlength="50" inputmode="numeric"', ayuda: 'Opcional. No puede repetirse.' }) +
      campoHTML({ id: 'pPrecio', label: 'Precio de venta', tipo: 'number', req: true, attrs: 'min="0" step="0.01" inputmode="decimal"', ayuda: 'Se usa para calcular la ganancia.' }) +
      campoHTML({ id: 'pProveedor', label: 'Proveedor', attrs: 'maxlength="150"' }) +
      campoHTML({ id: 'pUbicacion', label: 'Ubicación', attrs: 'maxlength="150"', ayuda: 'Ejemplo: Estante B2' }) +
      '<datalist id="dlCategorias"></datalist>';
    $('#camposLote').innerHTML =
      campoHTML({ id: 'lProducto', label: 'Producto', req: true, select: true, completo: true }) +
      campoHTML({ id: 'lCantidad', label: 'Piezas que llegaron', tipo: 'number', req: true, attrs: 'min="1" step="1" inputmode="numeric"' }) +
      campoHTML({ id: 'lCosto', label: 'Costo por pieza', tipo: 'number', req: true, attrs: 'min="0" step="0.01" inputmode="decimal"' }) +
      campoHTML({ id: 'lEntrada', label: 'Fecha de entrada', tipo: 'date', req: true, ayuda: 'Define el orden PEPS: la más antigua sale primero.' }) +
      campoHTML({ id: 'lCaducidad', label: 'Fecha de caducidad', tipo: 'date', ayuda: 'Déjala vacía si no caduca.' });
    $('#camposMerma').innerHTML =
      campoHTML({ id: 'mCantidad', label: 'Piezas a dar de baja', tipo: 'number', req: true, attrs: 'min="1" step="1" inputmode="numeric"' }) +
      campoHTML({ id: 'mMotivo', label: 'Motivo', req: true, select: true }) +
      campoHTML({ id: 'mNota', label: 'Detalle (opcional)', completo: true, attrs: 'maxlength="120" autocomplete="off"' });
    $('#mMotivo').innerHTML = '<option value="">Elige un motivo…</option>' + UP.MOTIVOS.map((m) => `<option>${m}</option>`).join('');

    $('#formProducto').addEventListener('submit', guardarProducto);
    $('#formLote').addEventListener('submit', guardarLote);
    $('#formMerma').addEventListener('submit', guardarMerma);
    conectarValidacion($('#formProducto'), reglasProd);
    conectarValidacion($('#formLote'), reglasLote);
    conectarValidacion($('#formMerma'), reglasMerma);
    $('#lEntrada').addEventListener('change', () => { if ($('#lCaducidad').value) setError('lCaducidad', reglasLote().lCaducidad($('#lCaducidad').value)); });

    $$('dialog').forEach((d) => {
      let pulsoFuera = false;
      d.addEventListener('mousedown', (e) => { pulsoFuera = e.target === d; });
      d.addEventListener('click', (e) => { if (pulsoFuera && e.target === d) d.close(); pulsoFuera = false; });
    });
    document.addEventListener('click', (e) => { const c = e.target.closest('[data-cerrar]'); if (c) c.closest('dialog').close(); });

    // acciones delegadas (botones repartidos por distintas vistas)
    document.addEventListener('click', (e) => {
      const t = e.target;
      let b;
      if ((b = t.closest('[data-salida]'))) { ui.salida.pid = +b.dataset.salida; ui.salida.tocado = false; $('#cant').value = 1; $('#recibo').hidden = true; ir('salida'); if (location.hash === '#salida') renderTodo(); return; }
      if ((b = t.closest('[data-merma]'))) { abrirMerma(+b.dataset.merma); return; }
      if ((b = t.closest('[data-nuevo]'))) { nuevo(b.dataset.nuevo, b.dataset.prod && +b.dataset.prod); return; }
      if ((b = t.closest('[data-editar-prod]'))) { abrirProducto(UP.producto(+b.dataset.editarProd)); return; }
      if ((b = t.closest('[data-borrar-prod]'))) { borrarProducto(+b.dataset.borrarProd); return; }
      if ((b = t.closest('[data-editar-lote]'))) { abrirLote(UP.lote(+b.dataset.editarLote)); return; }
      if ((b = t.closest('[data-borrar-lote]'))) { borrarLote(+b.dataset.borrarLote); return; }
      if ((b = t.closest('[data-filtro-mov]'))) { ui.mov.tipo = b.dataset.filtroMov; ui.mov.max = 15; }
    });

    // atajos de teclado
    document.addEventListener('keydown', (e) => {
      if (!$('#acceso').hidden) return;
      if (e.key === 'Escape') { cerrarMenu(); return; }
      const enCampo = e.target.closest('input, select, textarea, [contenteditable]');
      const hayDialogo = document.querySelector('dialog[open]');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !enCampo && !hayDialogo && ui.ultimo) { e.preventDefault(); ui.ultimo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || enCampo || hayDialogo) return;
      if (e.key >= '1' && e.key <= '6') { ir(RUTAS[+e.key - 1]); }
      else if (e.key === '/') {
        e.preventDefault();
        if (ui.vista === 'movimientos') $('#busqMov').focus();
        else if (ui.vista === 'inventario') $('#busqInv').focus();
        else { ir('inventario'); setTimeout(() => $('#busqInv').focus(), 0); }
      }
      else if (e.key === '?') { abrirAyuda(); }
      else if (e.key.toLowerCase() === 'n') { e.preventDefault(); nuevo('lote'); }
    });

    // si el tamaño cambia, la gráfica se redibuja
    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (ui.vista === 'resumen') graficaSerie(); }, 150); });
  }

  /* =====================================================
     Sesión de demostración (solo guarda el nombre en este navegador)
     ===================================================== */
  const LS_USER = 'up-inventory-system:usuario', LS_SESION = 'up-inventory-system:sesion';
  const leerLS = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const escribirLS = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { /* sin almacenamiento */ } };
  ui.usuario = leerLS(LS_USER) || '';

  function pintarUsuario() {
    const n = ui.usuario || 'Usuario';
    $('#nombreUsuario').textContent = n;
    $('#avatarUsuario').textContent = n.charAt(0).toUpperCase();
  }
  function abrirAcceso() {
    $('#acceso').hidden = false;
    document.body.style.overflow = 'hidden';
    const campo = $('#accesoNombre');
    campo.value = ui.usuario;
    $('#accesoError').textContent = '';
    campo.removeAttribute('aria-invalid');
    setTimeout(() => campo.focus(), 30);
  }
  function entrar(e) {
    e.preventDefault();
    const nombre = $('#accesoNombre').value.trim();
    if (!nombre) {
      $('#accesoError').textContent = 'Escribe tu nombre para continuar.';
      $('#accesoNombre').setAttribute('aria-invalid', 'true');
      $('#accesoNombre').focus();
      return;
    }
    ui.usuario = nombre;
    escribirLS(LS_USER, nombre);
    escribirLS(LS_SESION, 'activa');
    $('#acceso').hidden = true;
    document.body.style.overflow = '';
    pintarUsuario();
    ui.animarGrafica = true;
    renderTodo();
    toast({ tipo: 'ok', msg: `Hola, ${nombre}. Tu inventario está listo.` });
  }

  /* =====================================================
     Inicio
     ===================================================== */
  $('#formAcceso').addEventListener('submit', entrar);
  $('#accesoNombre').addEventListener('input', () => { $('#accesoError').textContent = ''; $('#accesoNombre').removeAttribute('aria-invalid'); });
  $('#btnSalir').addEventListener('click', () => { escribirLS(LS_SESION, null); abrirAcceso(); });
  $('#btnUsuario').addEventListener('click', abrirAcceso);
  $('#rangoSerie').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    ui.rango = +b.dataset.v; ui.animarGrafica = true; graficaSerie();
  });
  pintarUsuario();
  iniciarEventos();
  mostrarVista();
  if (!ui.usuario || leerLS(LS_SESION) !== 'activa') abrirAcceso();
})();
