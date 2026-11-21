/* UP Inventory System · datos y lógica PEPS
   Sustituye a la base de datos y al servidor: todo vive en memoria y se guarda en localStorage. */
(function (global) {
  'use strict';

  const CLAVE = 'up-inventory-system:v1';
  const MOTIVOS = ['Caducidad', 'Daño en empaque', 'Cadena de frío', 'Extravío', 'Otro'];

  /* ---------- fechas ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const isoFecha = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const isoHora = (d) => `${isoFecha(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const leer = (s) => new Date(s.length === 10 ? s + 'T12:00:00' : s);
  const hoy = () => isoFecha(new Date());
  const sumarDias = (f, n) => { const d = leer(f); d.setDate(d.getDate() + n); return isoFecha(d); };
  const diasEntre = (a, b) => Math.round((leer(b) - leer(a)) / 86400000);
  const redondear = (n) => Math.round(n * 100) / 100;

  /* ---------- datos de ejemplo (fechas relativas a hoy) ---------- */
  function semilla() {
    const t = hoy();
    const productos = [
      [1, 'Leche entera 1 L', 'Lala', 'Lácteos', '7501020501001', 'Distribuidora Norte', 'Refrigerador A1', 28.5],
      [2, 'Yogurt natural 900 g', 'Danone', 'Lácteos', '7501020501002', 'Distribuidora Norte', 'Refrigerador A2', 42],
      [3, 'Pan de caja integral', 'Bimbo', 'Panadería', '7501020501003', 'Panificadora Sur', 'Estante B1', 46],
      [4, 'Jamón de pavo 250 g', 'FUD', 'Carnes frías', '7501020501004', 'Cárnicos del Valle', 'Refrigerador B3', 58],
      [5, 'Jugo de naranja 1 L', 'Del Valle', 'Bebidas', '7501020501005', 'Bebidas Centro', 'Estante C2', 34],
      [6, 'Galletas de avena', 'Gamesa', 'Abarrotes', '7501020501006', 'Abarrotes Unidos', 'Estante D1', 22],
      [7, 'Queso panela 400 g', 'Alpura', 'Lácteos', '7501020501007', 'Distribuidora Norte', 'Refrigerador A3', 75],
      [8, 'Atún en agua 140 g', 'Dolores', 'Enlatados', '7501020501008', 'Abarrotes Unidos', 'Estante E4', 24],
      [9, 'Cereal de maíz 500 g', 'Kellogg’s', 'Abarrotes', '7501020501009', 'Abarrotes Unidos', 'Estante D3', 52],
    ].map(([id, nombre, marca, categoria, codigo, proveedor, ubicacion, precio]) =>
      ({ id, nombre, marca, categoria, codigo, proveedor, ubicacion, precio }));

    // [producto, días desde la entrada, caduca en (días), costo, inicial, actual, mermas]
    const specs = [
      [1, 20, 2, 20, 60, 14, [[3, 'Daño en empaque']]],
      [1, 9, 9, 21, 48, 48],
      [1, 2, 16, 21.5, 36, 36],
      [2, 18, -1, 30, 24, 6, [[4, 'Caducidad']]],
      [2, 7, 5, 31, 30, 22],
      [3, 6, 1, 33, 20, 4, [[2, 'Caducidad']]],
      [3, 1, 6, 34, 25, 25],
      [4, 12, 4, 41, 20, 9],
      [4, 3, 14, 42, 24, 24],
      [5, 25, 40, 24, 48, 20],
      [5, 8, 70, 25, 60, 60],
      [6, 30, 120, 15, 80, 35],
      [6, 5, 180, 16, 100, 100],
      [7, 10, 8, 52, 16, 5, [[1, 'Cadena de frío']]],
      [7, 2, 20, 54, 20, 20],
      [8, 40, 400, 17, 100, 0, [[2, 'Daño en empaque']]],
      [8, 12, 500, 18, 120, 74],
      [9, 15, 90, 38, 30, 18],
    ];

    let r = 11;
    const azar = () => (r = (r * 9301 + 49297) % 233280) / 233280;
    const lotes = [], movimientos = [];
    let idL = 0, idM = 0;

    specs.forEach(([productoId, atras, cad, costo, ini, act, mermas = []]) => {
      const lote = {
        id: ++idL, productoId, fechaEntrada: sumarDias(t, -atras), fechaCaducidad: sumarDias(t, cad),
        costo, stockInicial: ini, stockActual: act,
      };
      lotes.push(lote);
      movimientos.push({ id: ++idM, loteId: lote.id, tipo: 'entrada', cantidad: ini, fecha: lote.fechaEntrada + 'T08:30', nota: 'Entrada del lote' });

      let ventas = ini - act;
      mermas.forEach(([c, motivo]) => {
        ventas -= c;
        const dia = sumarDias(t, -Math.floor(azar() * Math.min(atras, 5)));
        movimientos.push({ id: ++idM, loteId: lote.id, tipo: 'salida', cantidad: c, fecha: dia + 'T17:10', nota: 'Merma: ' + motivo });
      });

      const n = ventas > 0 ? Math.max(1, Math.min(6, Math.ceil(ventas / 6))) : 0;
      let falta = ventas;
      for (let i = 0; i < n; i++) {
        const parte = i === n - 1 ? falta : Math.min(falta - (n - 1 - i), Math.max(1, Math.round(ventas / n + (azar() - 0.5) * (ventas / n) * 0.6)));
        falta -= parte;
        const dia = sumarDias(t, -Math.floor(azar() * atras));
        movimientos.push({ id: ++idM, loteId: lote.id, tipo: 'salida', cantidad: parte, fecha: `${dia}T${pad(10 + Math.floor(azar() * 9))}:${pad(Math.floor(azar() * 60))}`, nota: 'Venta' });
      }
    });
    return { productos, lotes, movimientos };
  }

  /* ---------- almacenamiento ---------- */
  let estado = cargar();
  let guardadoOk = true;

  function cargar() {
    try {
      const crudo = global.localStorage.getItem(CLAVE);
      if (crudo) {
        const e = JSON.parse(crudo);
        if (e && Array.isArray(e.productos) && Array.isArray(e.lotes) && Array.isArray(e.movimientos)) return e;
      }
    } catch (_) { /* sin almacenamiento: se usa memoria */ }
    return semilla();
  }
  function guardar() {
    try { global.localStorage.setItem(CLAVE, JSON.stringify(estado)); guardadoOk = true; }
    catch (_) { guardadoOk = false; }
    return guardadoOk;
  }
  const instantanea = () => JSON.stringify(estado);
  const restaurar = (s) => { estado = JSON.parse(s); guardar(); };
  const reiniciar = () => { estado = semilla(); guardar(); };
  const siguiente = (lista) => lista.reduce((m, x) => Math.max(m, x.id), 0) + 1;

  /* ---------- consultas básicas ---------- */
  const producto = (id) => estado.productos.find((p) => p.id === id);
  const lote = (id) => estado.lotes.find((l) => l.id === id);
  const esMerma = (m) => m.tipo === 'salida' && (m.nota || '').startsWith('Merma:');
  const motivoDe = (m) => (m.nota || '').replace(/^Merma:\s*/, '').split(' · ')[0] || 'Otro';

  const stockDe = (pid) => estado.lotes.filter((l) => l.productoId === pid).reduce((s, l) => s + l.stockActual, 0);
  /* Fila PEPS: lotes con piezas, del más antiguo al más nuevo. */
  const filaPEPS = (pid) => estado.lotes
    .filter((l) => l.productoId === pid && l.stockActual > 0)
    .sort((a, b) => a.fechaEntrada.localeCompare(b.fechaEntrada) || a.id - b.id);

  /* ---------- núcleo PEPS ---------- */
  function simularSalida(pid, cantidad) {
    const prod = producto(pid);
    const fila = filaPEPS(pid);
    const disponible = fila.reduce((s, l) => s + l.stockActual, 0);
    const entero = Number.isInteger(cantidad) && cantidad >= 1;
    let restante = entero ? Math.min(cantidad, disponible) : 0;
    let costo = 0, tomado = 0;
    const pasos = fila.map((l) => {
      const tomar = Math.min(l.stockActual, restante);
      restante -= tomar; tomado += tomar; costo += tomar * l.costo;
      return { lote: l, tomar, queda: l.stockActual - tomar };
    });
    const ingreso = prod ? prod.precio * tomado : 0;
    return {
      producto: prod, pasos, disponible, cantidad, tomado,
      ingreso: redondear(ingreso), costo: redondear(costo), ganancia: redondear(ingreso - costo),
      valida: !!prod && entero && cantidad <= disponible,
    };
  }

  function registrarSalida(pid, cantidad, nota) {
    const sim = simularSalida(pid, cantidad);
    if (!sim.producto) throw new Error('El producto no existe.');
    if (!Number.isInteger(cantidad) || cantidad < 1) throw new Error('La cantidad debe ser un número entero mayor a cero.');
    if (!sim.valida) throw new Error(`Stock insuficiente: hay ${sim.disponible} piezas y se pidieron ${cantidad}.`);
    const ahora = isoHora(new Date());
    sim.pasos.filter((p) => p.tomar > 0).forEach((p) => {
      p.lote.stockActual -= p.tomar;
      estado.movimientos.push({ id: siguiente(estado.movimientos), loteId: p.lote.id, tipo: 'salida', cantidad: p.tomar, fecha: ahora, nota: nota || 'Venta' });
    });
    guardar();
    return sim;
  }

  function registrarEntrada({ productoId, cantidad, costo, fechaEntrada, fechaCaducidad }) {
    if (!producto(productoId)) throw new Error('El producto no existe.');
    const nuevo = {
      id: siguiente(estado.lotes), productoId, fechaEntrada: fechaEntrada || hoy(), fechaCaducidad: fechaCaducidad || null,
      costo: redondear(costo), stockInicial: cantidad, stockActual: cantidad,
    };
    estado.lotes.push(nuevo);
    estado.movimientos.push({ id: siguiente(estado.movimientos), loteId: nuevo.id, tipo: 'entrada', cantidad, fecha: isoHora(new Date()), nota: 'Entrada del lote' });
    guardar();
    return nuevo;
  }

  function registrarMerma(loteId, cantidad, motivo, detalle) {
    const l = lote(loteId);
    if (!l) throw new Error('El lote no existe.');
    if (!Number.isInteger(cantidad) || cantidad < 1) throw new Error('La cantidad debe ser mayor a cero.');
    if (cantidad > l.stockActual) throw new Error(`El lote solo tiene ${l.stockActual} piezas.`);
    l.stockActual -= cantidad;
    estado.movimientos.push({ id: siguiente(estado.movimientos), loteId, tipo: 'salida', cantidad, fecha: isoHora(new Date()), nota: 'Merma: ' + motivo + (detalle ? ' · ' + detalle : '') });
    guardar();
    return l;
  }

  /* ---------- catálogo y lotes (administración) ---------- */
  function revisarCodigo(codigo, idActual) {
    if (codigo && estado.productos.some((p) => p.codigo === codigo && p.id !== idActual)) throw new Error('Ese código de barras ya existe.');
  }
  function crearProducto(d) {
    revisarCodigo(d.codigo, null);
    const nuevo = { id: siguiente(estado.productos), ...d };
    estado.productos.push(nuevo); guardar(); return nuevo;
  }
  function actualizarProducto(id, d) {
    revisarCodigo(d.codigo, id);
    Object.assign(producto(id), d); guardar();
  }
  function borrarProducto(id) {
    const ids = estado.lotes.filter((l) => l.productoId === id).map((l) => l.id);
    estado.movimientos = estado.movimientos.filter((m) => !ids.includes(m.loteId));
    estado.lotes = estado.lotes.filter((l) => l.productoId !== id);
    estado.productos = estado.productos.filter((p) => p.id !== id);
    guardar();
  }
  function actualizarLote(id, d) { Object.assign(lote(id), d); guardar(); }
  function borrarLote(id) {
    estado.movimientos = estado.movimientos.filter((m) => m.loteId !== id);
    estado.lotes = estado.lotes.filter((l) => l.id !== id);
    guardar();
  }

  /* ---------- reportes ---------- */
  const diasParaVencer = (l) => (l.fechaCaducidad ? diasEntre(hoy(), l.fechaCaducidad) : null);

  function alertas(dias) {
    return estado.lotes
      .filter((l) => l.stockActual > 0 && l.fechaCaducidad && diasParaVencer(l) <= dias)
      .map((l) => ({ lote: l, producto: producto(l.productoId), dias: diasParaVencer(l) }))
      .sort((a, b) => a.dias - b.dias);
  }

  function resumen() {
    const conStock = estado.lotes.filter((l) => l.stockActual > 0);
    const mermas = estado.movimientos.filter(esMerma);
    return {
      productos: estado.productos.length,
      stock: conStock.reduce((s, l) => s + l.stockActual, 0),
      valor: redondear(conStock.reduce((s, l) => s + l.stockActual * l.costo, 0)),
      porVencer: conStock.filter((l) => { const d = diasParaVencer(l); return d !== null && d >= 0 && d <= 7; }).length,
      vencidos: conStock.filter((l) => { const d = diasParaVencer(l); return d !== null && d < 0; }).length,
      mermaPiezas: mermas.reduce((s, m) => s + m.cantidad, 0),
      mermaCosto: redondear(mermas.reduce((s, m) => s + m.cantidad * (lote(m.loteId)?.costo || 0), 0)),
    };
  }

  function serieDiaria(n) {
    const t = hoy();
    const dias = Array.from({ length: n }, (_, i) => sumarDias(t, i - (n - 1)));
    const entradas = dias.map(() => 0), salidas = dias.map(() => 0);
    estado.movimientos.forEach((m) => {
      const i = dias.indexOf(m.fecha.slice(0, 10));
      if (i < 0) return;
      if (m.tipo === 'entrada') entradas[i] += m.cantidad;
      else if (!esMerma(m)) salidas[i] += m.cantidad;
    });
    return { dias, entradas, salidas };
  }

  function mermasPorMotivo() {
    const mapa = {};
    estado.movimientos.filter(esMerma).forEach((m) => { const k = motivoDe(m); mapa[k] = (mapa[k] || 0) + m.cantidad; });
    return Object.entries(mapa).map(([motivo, piezas]) => ({ motivo, piezas })).sort((a, b) => b.piezas - a.piezas);
  }

  function inventario() {
    return estado.productos.map((p) => {
      const fila = filaPEPS(p.id);
      const cads = fila.filter((l) => l.fechaCaducidad).map((l) => l.fechaCaducidad).sort();
      return {
        ...p, fila, stock: fila.reduce((s, l) => s + l.stockActual, 0), lotes: fila.length,
        vence: cads[0] || null, diasVence: cads[0] ? diasEntre(hoy(), cads[0]) : null,
      };
    });
  }

  function movimientos() {
    return estado.movimientos.map((m) => {
      const l = lote(m.loteId), p = l && producto(l.productoId);
      return { ...m, producto: p ? p.nombre : '(eliminado)', merma: esMerma(m) };
    }).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id);
  }

  global.UP = {
    MOTIVOS, hoy, sumarDias, diasEntre, leer,
    get estado() { return estado; }, get guardadoOk() { return guardadoOk; },
    guardar, instantanea, restaurar, reiniciar,
    producto, lote, stockDe, filaPEPS, diasParaVencer,
    simularSalida, registrarSalida, registrarEntrada, registrarMerma,
    crearProducto, actualizarProducto, borrarProducto, actualizarLote, borrarLote,
    alertas, resumen, serieDiaria, mermasPorMotivo, inventario, movimientos,
  };
})(window);
