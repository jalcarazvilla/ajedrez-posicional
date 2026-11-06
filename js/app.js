// Entrenador Posicional: enrutado, modos de entrenamiento y progreso.
import { Tablero, Chess, lineaSan, uciASan } from "./tablero.js";
import { motor, aCp, textoEval } from "./motor.js";
import { aplicarResultado, estadoElo, eloEjercicio, multiplicador, problemaDelDia, marcarDiario, rachaDiariaVigente, estadoDiario, hoy } from "./elo.js";
import { rankingActivo, jugador, nombreValido, enviarElo, tabla, MINIMO } from "./ranking.js";

// Súbela a la vez que versionName en movil/android/app/build.gradle.
const VERSION_APP = "1.0.3";
const app = document.getElementById("app");
let POSICIONES = [];
let tablero = null;
let generacion = 0; // invalida tareas asíncronas de vistas anteriores

// ---------- Progreso (localStorage, opcional) ----------
const CLAVE = "entrenador-posicional-v1";
function leerProgreso() {
  try { return JSON.parse(localStorage.getItem(CLAVE)) || {}; } catch { return {}; }
}
function guardarProgreso(p) {
  try { localStorage.setItem(CLAVE, JSON.stringify(p)); } catch {}
}
// Guarda el resultado y, si es el primer intento de ese ejercicio en ese modo, actualiza el Elo.
// Devuelve el cambio de Elo (o null si era una repetición).
function registrar(modo, pos, puntos, maximo) {
  const p = leerProgreso();
  p[modo] ||= {};
  const prev = p[modo][pos.id];
  p[modo][pos.id] = { mejor: Math.max(prev?.mejor ?? 0, puntos), maximo, intentos: (prev?.intentos ?? 0) + 1, ultimo: Date.now() };
  const cambio = prev ? null : aplicarResultado(p, eloEjercicio(pos), puntos / maximo);
  if (modo === "plan" && pos.id === problemaDelDia(listaDiario())?.id) {
    const racha = marcarDiario(p).racha;
    if (cambio) cambio.diario = racha;
  }
  guardarProgreso(p);
  pintarCabecera();
  if (cambio) sincronizarRanking();
  return cambio;
}

// ---------- Apariencia (tema de color y tablero) ----------
// muestras: fondo, panel, acento y color de acierto de cada paleta (para las tarjetas de elección).
const TEMAS = [
  { id: "", texto: "Madera", nota: "Claro u oscuro según el móvil", muestras: ["#f4f1ec", "#2b2622", "#8a5a2b", "#2f7d4f"] },
  { id: "madera-claro", texto: "Madera clara", nota: "Siempre claro", muestras: ["#f4f1ec", "#ffffff", "#8a5a2b", "#2f7d4f"] },
  { id: "torneo", texto: "Torneo", nota: "Verde y blanco", muestras: ["#eef3ef", "#ffffff", "#2f7d4f", "#9a6b00"] },
  { id: "oceano", texto: "Océano", nota: "Turquesa y coral", muestras: ["#eef5f7", "#ffffff", "#0e7c8c", "#d0574a"] },
  { id: "lavanda", texto: "Lavanda", nota: "Violeta y oro", muestras: ["#f5f3fa", "#ffffff", "#6a4fb3", "#a8790a"] },
  { id: "noche", texto: "Noche", nota: "Azul oscuro", muestras: ["#0f172a", "#1e293b", "#60a5fa", "#4ade80"] },
  { id: "pizarra", texto: "Pizarra", nota: "Negro y ámbar", muestras: ["#121212", "#1e1e1e", "#e0a84f", "#6cc391"] },
];
const TABLEROS = [
  { id: "", texto: "Madera", muestras: ["#f0d9b5", "#b58863"] },
  { id: "verde", texto: "Verde", muestras: ["#eeeed2", "#769656"] },
  { id: "azul", texto: "Azul", muestras: ["#dee3e6", "#8ca2ad"] },
  { id: "gris", texto: "Gris", muestras: ["#e6e6e6", "#9a9a9a"] },
  { id: "morado", texto: "Morado", muestras: ["#efefef", "#8877b7"] },
];
const PIEZAS = [
  { id: "cburnett", texto: "Clásicas" },
  { id: "merida", texto: "Mérida" },
  { id: "chessnut", texto: "Chessnut" },
  { id: "mpchess", texto: "Torneo" },
  { id: "fantasy", texto: "Fantasía" },
  { id: "spatial", texto: "Espaciales" },
  { id: "celtic", texto: "Celtas" },
  { id: "rhosgfx", texto: "Juguete" },
];
const NIVELES = [
  { elo: 1000, texto: "Empiezo ahora", nota: "Conozco las reglas" },
  { elo: 1300, texto: "Aficionado", nota: "Juego a menudo" },
  { elo: 1600, texto: "Jugador de club", nota: "Compito en torneos" },
  { elo: 1900, texto: "Club fuerte", nota: "Elo FIDE alrededor de 1900" },
  { elo: 2200, texto: "Experto", nota: "Elo FIDE de 2200 o más" },
];
// La URL (?tema=...&tablero=...&piezas=...) manda sobre lo guardado: la usa el previsualizador sin tocar los ajustes.
function aplicarApariencia() {
  const aj = leerProgreso().ajustes || {};
  const url = new URLSearchParams(location.search);
  const tema = url.has("tema") ? url.get("tema") : aj.tema || "";
  const tablero = url.has("tablero") ? url.get("tablero") : aj.tablero || "";
  const piezas = url.has("piezas") ? url.get("piezas") : aj.piezas || "cburnett";
  const raiz = document.documentElement;
  tema ? raiz.setAttribute("data-tema", tema) : raiz.removeAttribute("data-tema");
  tablero ? raiz.setAttribute("data-tablero", tablero) : raiz.removeAttribute("data-tablero");
  raiz.setAttribute("data-piezas", piezas);
  const color = getComputedStyle(raiz).getPropertyValue("--panel").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color || "#2b2622");
}
function guardarAjuste(clave, valor) {
  const p = leerProgreso();
  p.ajustes = { ...(p.ajustes || {}), [clave]: valor };
  guardarProgreso(p);
  aplicarApariencia();
}

// Tarjetas de elección reutilizadas por la bienvenida y por Ajustes.
const tarjetasTemas = (actual) => TEMAS.map((t) => `
  <button type="button" class="tarjeta ${t.id === actual ? "elegida" : ""}" data-tema="${t.id}">
    <span class="muestras">${t.muestras.map((c) => `<i style="background:${c}"></i>`).join("")}</span>
    <b>${t.texto}</b><small>${t.nota}</small></button>`).join("");
const tarjetasTableros = (actual) => TABLEROS.map((t) => `
  <button type="button" class="tarjeta ${t.id === actual ? "elegida" : ""}" data-tablero="${t.id}">
    <span class="muestras">${[0, 1, 0, 1].map((k) => `<i style="background:${t.muestras[k]}"></i>`).join("")}</span>
    <b>${t.texto}</b></button>`).join("");
const tarjetasPiezas = (actual) => PIEZAS.map((p) => `
  <button type="button" class="tarjeta ${p.id === actual ? "elegida" : ""}" data-piezas="${p.id}">
    <span class="mini-tablero">${["wK", "wN", "bQ", "bP"].map((f, k) =>
      `<span class="${k % 2 ? "casilla-b" : "casilla-a"}" style="background-image:url('vendor/piezas/${p.id}/${f}.svg')"></span>`).join("")}</span>
    <b>${p.texto}</b></button>`).join("");

// Conecta las tarjetas de un contenedor: al pulsar se guarda el ajuste y se marca la elegida.
function activarTarjetas(cont, clave) {
  cont.querySelectorAll(".tarjeta").forEach((b) => {
    b.onclick = () => {
      guardarAjuste(clave, b.dataset[clave]);
      cont.querySelectorAll(".tarjeta").forEach((x) => x.classList.toggle("elegida", x === b));
    };
  });
}

function fijarEloInicial(valor) {
  const p = leerProgreso();
  const e = estadoElo(p);
  if (e.partidas > 0) return false; // con ejercicios hechos ya no se toca (sería trampa para el ranking)
  const v = Math.max(400, Math.min(2800, Math.round(+valor) || 1500));
  p.elo = { ...e, valor: v, maximo: v, inicial: v, historial: [] };
  guardarProgreso(p);
  return true;
}

// ---------- Bienvenida (primera vez) ----------
function vistaBienvenida() {
  document.body.classList.add("sin-menu");
  const p = leerProgreso();
  const estado = { paso: 0, nombre: p.jugador?.nombre || "", elo: 1500 };
  const total = 4;
  pintar();

  function pintar() {
    const aj = leerProgreso().ajustes || {};
    const barra = `<div class="pasos">${[...Array(total)].map((_, i) => `<span class="${i <= estado.paso ? "hecho" : ""}"></span>`).join("")}</div>`;
    const cuerpos = [
      `<h1>¡Bienvenido!</h1>
       <p class="lema">Vamos a dejar la app a tu gusto. Primero, ¿cómo te llamamos?</p>
       <input class="campo-nombre" id="nombre" maxlength="24" placeholder="Tu nombre o apodo" value="${h(estado.nombre)}" autocomplete="nickname">`,
      `<h1>Elige tus colores</h1>
       <p class="lema">Toca una paleta y verás el cambio al momento.</p>
       <div class="tarjetas" id="t-temas">${tarjetasTemas(aj.tema || "")}</div>
       <h3>Tablero</h3>
       <div class="tarjetas tableros" id="t-tableros">${tarjetasTableros(aj.tablero || "")}</div>`,
      `<h1>Elige tus piezas</h1>
       <p class="lema">Se verán así en todos los ejercicios.</p>
       <div class="tarjetas" id="t-piezas">${tarjetasPiezas(aj.piezas || "cburnett")}</div>`,
      `<h1>¿Cuál es tu nivel?</h1>
       <p class="lema">Será tu Elo de partida: los ejercicios se adaptan a él desde el primer día.</p>
       <div class="tarjetas" id="t-niveles">${NIVELES.map((n) => `
         <button type="button" class="tarjeta ${n.elo === estado.elo ? "elegida" : ""}" data-elo="${n.elo}">
           <b>${n.texto}</b><small>${n.nota} · empiezas con ${n.elo}</small></button>`).join("")}</div>
       <div class="elo-propio"><label for="elo-libre">O escribe tu Elo:</label>
         <input id="elo-libre" type="number" inputmode="numeric" min="400" max="2800" step="10" value="${estado.elo}"></div>`,
    ];
    app.innerHTML = `
      <section class="panel asistente">
        ${barra}
        ${cuerpos[estado.paso]}
        <div class="navegacion">
          ${estado.paso > 0 ? `<button class="boton" id="atras">Atrás</button>` : "<span></span>"}
          <button class="boton principal" id="siguiente">${estado.paso === total - 1 ? "¡Empezar a entrenar!" : "Siguiente"}</button>
        </div>
      </section>`;
    if (estado.paso === 0) {
      const inp = document.getElementById("nombre");
      inp.focus();
      inp.oninput = () => { estado.nombre = inp.value; };
      inp.onkeydown = (ev) => { if (ev.key === "Enter") avanzar(); };
    }
    if (estado.paso === 1) {
      activarTarjetas(document.getElementById("t-temas"), "tema");
      activarTarjetas(document.getElementById("t-tableros"), "tablero");
    }
    if (estado.paso === 2) activarTarjetas(document.getElementById("t-piezas"), "piezas");
    if (estado.paso === 3) {
      const libre = document.getElementById("elo-libre");
      document.querySelectorAll("#t-niveles .tarjeta").forEach((b) => {
        b.onclick = () => {
          estado.elo = +b.dataset.elo;
          libre.value = estado.elo;
          document.querySelectorAll("#t-niveles .tarjeta").forEach((x) => x.classList.toggle("elegida", x === b));
        };
      });
      libre.oninput = () => {
        estado.elo = +libre.value || 1500;
        document.querySelectorAll("#t-niveles .tarjeta").forEach((x) => x.classList.toggle("elegida", +x.dataset.elo === estado.elo));
      };
    }
    document.getElementById("siguiente").onclick = avanzar;
    const atras = document.getElementById("atras");
    if (atras) atras.onclick = () => { estado.paso--; pintar(); };
  }

  function avanzar() {
    if (estado.paso < total - 1) { estado.paso++; pintar(); window.scrollTo(0, 0); return; }
    const p = leerProgreso();
    jugador(p).nombre = estado.nombre.trim() || "Jugador";
    p.perfil = { creado: new Date().toISOString().slice(0, 10) };
    guardarProgreso(p);
    fijarEloInicial(estado.elo);
    document.body.classList.remove("sin-menu");
    pintarCabecera();
    location.hash = "#/";
  }
}

// ---------- Ajustes ----------
function vistaAjustes() {
  const p = leerProgreso();
  const aj = p.ajustes || {};
  const e = estadoElo(p);
  app.innerHTML = `
    <div class="asistente ajustes">
      <section class="panel">
        <h2>Tu nombre</h2>
        <div class="elo-propio">
          <input class="campo-nombre" id="nombre" maxlength="24" value="${h(jugador(p).nombre)}" placeholder="Tu nombre o apodo">
          <button class="boton principal" id="guardar-nombre">Guardar</button>
          <span id="nombre-estado" class="meta"></span>
        </div>
      </section>
      <section class="panel"><h2>Colores</h2><div class="tarjetas" id="t-temas">${tarjetasTemas(aj.tema || "")}</div></section>
      <section class="panel"><h2>Tablero</h2><div class="tarjetas tableros" id="t-tableros">${tarjetasTableros(aj.tablero || "")}</div></section>
      <section class="panel"><h2>Piezas</h2><div class="tarjetas" id="t-piezas">${tarjetasPiezas(aj.piezas || "cburnett")}</div></section>
      <section class="panel">
        <h2>Ejercicios</h2>
        <label class="interruptor"><input type="checkbox" id="desplegados" ${aj.desplegados ? "checked" : ""}>
          <span>Mostrar el análisis de la posición y las opciones abiertos desde el principio</span></label>
      </section>
      <section class="panel">
        <h2>Elo de partida</h2>
        ${e.partidas ? `<p class="meta">Tu Elo es ${e.valor}. Ya has hecho ejercicios, así que ahora solo cambia resolviendo posiciones.</p>`
          : `<div class="elo-propio"><input id="elo-libre" type="number" min="400" max="2800" step="10" value="${e.valor}">
             <button class="boton" id="guardar-elo">Guardar</button><span id="elo-estado" class="meta"></span></div>`}
      </section>
      <p class="meta version">Versión ${VERSION_APP}</p>
    </div>`;
  activarTarjetas(document.getElementById("t-temas"), "tema");
  activarTarjetas(document.getElementById("t-tableros"), "tablero");
  activarTarjetas(document.getElementById("t-piezas"), "piezas");
  document.getElementById("desplegados").onchange = (ev) => guardarAjuste("desplegados", ev.target.checked);
  document.getElementById("guardar-nombre").onclick = async () => {
    const q = leerProgreso();
    jugador(q).nombre = document.getElementById("nombre").value.trim() || "Jugador";
    guardarProgreso(q);
    document.getElementById("nombre-estado").textContent = "Guardado ✓";
    await sincronizarRanking();
  };
  const ge = document.getElementById("guardar-elo");
  if (ge) ge.onclick = () => {
    fijarEloInicial(document.getElementById("elo-libre").value);
    pintarCabecera();
    document.getElementById("elo-estado").textContent = `Guardado: ${estadoElo(leerProgreso()).valor} ✓`;
  };
}

// ---------- Menú de modos (recuadros; en el móvil, barra fija abajo) ----------
const ICONOS = {
  inicio: '<path d="M3 11l9-8 9 8"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/>',
  plan: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  adivina: '<path d="M8 20h9"/><path d="M9 20c0-4 2-6 2-9l-3 1-2-2 4-5c3 0 7 2 7 8 0 3-1 5-1 7"/><circle cx="12.5" cy="8.5" r=".8" fill="currentColor"/>',
  evalua: '<path d="M12 4v16M6 20h12M5 7h14"/><path d="M5 7l-3 6a3 3 0 006 0zM19 7l-3 6a3 3 0 006 0z"/>',
  ranking: '<path d="M8 4h8v5a4 4 0 01-8 0z"/><path d="M8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8 21h8M9.5 17h5l.5 4h-6z"/>',
};
const icono = (n) => `<svg class="icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[n]}</svg>`;
const MENU = [
  { modo: "", icono: "inicio", texto: "Inicio" },
  { modo: "plan", icono: "plan", texto: "Plan" },
  { modo: "adivina", icono: "adivina", texto: "Jugada" },
  { modo: "evalua", icono: "evalua", texto: "Evalúa" },
  { modo: "ranking", icono: "ranking", texto: "Ranking" },
];
function pintarMenu() {
  document.getElementById("menu").innerHTML = MENU.map((m) =>
    `<a href="#/${m.modo}" data-modo="${m.modo}">${icono(m.icono)}<span>${m.texto}</span></a>`).join("");
}

// ---------- Elo, racha y ranking ----------
const listaDiario = () => POSICIONES.filter((p) => p.plan);
const signo = (n) => (n > 0 ? `+${n}` : `${n}`);

function pintarCabecera() {
  const el = document.getElementById("elo-cabecera");
  if (!el) return;
  const prog = leerProgreso();
  const e = estadoElo(prog);
  const puesto = prog.jugador?.puesto;
  el.innerHTML = `<b>${e.valor}</b><span class="elo-etq">Elo</span>` +
    (e.racha >= 2 ? `<span class="racha" title="Aciertos seguidos">🔥${e.racha} · x${multiplicador(e.racha).toFixed(1)}</span>` : "") +
    (puesto ? `<span class="puesto">#${puesto}</span>` : "");
}

async function sincronizarRanking() {
  const prog = leerProgreso();
  const puesto = await enviarElo(prog, estadoElo(prog));
  if (puesto) {
    const p = leerProgreso();
    if (p.jugador) { p.jugador.puesto = puesto; guardarProgreso(p); pintarCabecera(); }
  }
}

// Bloque que se añade al resultado de cada ejercicio.
function bloqueElo(c) {
  if (!c) return `<p class="elo-cambio repeticion">Repetición: no cuenta para el Elo.</p>`;
  const extra = c.delta > 0 && c.mult > 1 ? ` <span class="mult">racha x${c.mult.toFixed(1)}</span>` : "";
  const sig = c.racha >= 2 ? ` · ${c.racha} aciertos seguidos: el siguiente vale <b>x${c.siguienteMult.toFixed(1)}</b>` : c.acierto ? "" : " · racha a cero";
  const diario = c.diario ? ` · 📅 ${c.diario} día${c.diario > 1 ? "s" : ""} seguido${c.diario > 1 ? "s" : ""}` : "";
  return `<p class="elo-cambio ${c.delta >= 0 ? "sube" : "baja"}"><b>${signo(c.delta)} Elo</b> → ${c.valor}${extra}${sig}${diario}</p>`;
}

const TRAMOS = [
  { id: "auto", texto: "Según mi Elo" },
  { id: "1400-1800", texto: "1400–1800", min: 1400, max: 1800 },
  { id: "1800-2200", texto: "1800–2200", min: 1800, max: 2200 },
  { id: "2200-2600", texto: "2200–2600", min: 2200, max: 2600 },
];
const tramoActual = () => TRAMOS.find((t) => t.id === (leerProgreso().tramo || "auto")) || TRAMOS[0];
function marcarDudosa(id, nota) {
  const p = leerProgreso();
  p.dudosas ||= {};
  p.dudosas[id] = { nota, fecha: new Date().toISOString().slice(0, 10) };
  guardarProgreso(p);
}

// ---------- Utilidades ----------
const h = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// Permite **negrita** en los textos de contenido.
const txt = (s) => h(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
const barajar = (a) => a.map((x) => [Math.random(), x]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
const turnoDe = (fen) => fen.split(" ")[1];
const nombreTurno = (fen) => (turnoDe(fen) === "w" ? "Juegan las blancas" : "Juegan las negras");
const orientacion = (fen) => (turnoDe(fen) === "w" ? "white" : "black");

const VEREDICTOS = [
  { id: "B+", texto: "Blancas claramente mejor", min: 150 },
  { id: "B", texto: "Blancas algo mejor", min: 50 },
  { id: "=", texto: "Igualdad", min: -50 },
  { id: "N", texto: "Negras algo mejor", min: -150 },
  { id: "N+", texto: "Negras claramente mejor", min: -Infinity },
];
const veredictoDe = (cp) => VEREDICTOS.find((v) => cp >= v.min).id;

// El título del ejercicio resume la idea, así que no se muestra hasta después de responder.
function nombrePartida(p) {
  return p.negras ? `${p.blancas} – ${p.negras}` : p.blancas;
}
function cabeceraPosicion(p) {
  const lugar = [p.lugar, p.anio].filter(Boolean).join(" ");
  return `
    ${p.plan && p.id === problemaDelDia(listaDiario())?.id ? `<span class="insignia-diario">📅 Problema del día</span>` : ""}
    <h2>${h(nombrePartida(p))}</h2>
    <div class="meta">${lugar ? h(lugar) + " · " : ""}${h(p.fuente)}</div>
    <span class="turno ${turnoDe(p.fen)}">${nombreTurno(p.fen)}</span>
    <span class="elo-ejercicio" title="Dificultad del ejercicio">Nivel ${eloEjercicio(p)}</span>`;
}
// Desplegable cerrado por defecto (Ajustes > Ejercicios permite tenerlos siempre abiertos).
const abiertos = () => Boolean(leerProgreso().ajustes?.desplegados);
const desplegable = (id, titulo, contenido) => `
  <details class="desplegable" id="${id}" ${abiertos() ? "open" : ""}>
    <summary>${titulo}</summary><div class="desplegable-cuerpo">${contenido}</div>
  </details>`;
const abrir = (id) => { const d = document.getElementById(id); if (d) d.open = true; };
const concepto = (p) => `<p class="concepto">Idea clave: <b>${h(p.titulo)}</b></p>`;

// Ilumina el tablero entero: verde (buena), amarillo (imprecisión) o rojo (error).
function destello(tipo) {
  const z = document.querySelector(".zona-tablero");
  if (!z) return;
  z.classList.remove("destello-verde", "destello-amarillo", "destello-rojo");
  void z.offsetWidth; // reinicia la animación si se repite el mismo color
  z.classList.add(`destello-${tipo}`);
}
const sinAdornos = (san) => san.replace(/[+#!?]/g, "");

function montarTablero(fen, opciones = {}) {
  if (tablero) tablero.destruir();
  tablero = new Tablero(document.getElementById("tablero"), fen, { orientacion: orientacion(fen), ...opciones });
  return tablero;
}

function plantillaEjercicio(panel) {
  return `
    <section class="ejercicio">
      <div class="zona-tablero">
        <div id="tablero" class="tablero"></div>
        <div class="bajo-tablero" id="bajo-tablero"></div>
      </div>
      <aside class="panel" id="panel">${panel}</aside>
    </section>`;
}

// Elige la siguiente posición de un modo: primero las no hechas del tramo elegido (o cercanas al Elo
// del alumno en modo automático); si ya están todas hechas, las peor resueltas.
function siguiente(modo, lista, actual) {
  const todo = leerProgreso();
  const prog = todo[modo] || {};
  let candidatas = lista.filter((p) => p.id !== actual);
  if (!candidatas.length) return lista[0];
  const t = tramoActual();
  const elo = estadoElo(todo).valor;
  const enTramo = (p) => (t.min ? eloEjercicio(p) >= t.min && eloEjercicio(p) < t.max : Math.abs(eloEjercicio(p) - elo) <= 250);
  const nuevas = candidatas.filter((p) => !prog[p.id]);
  if (nuevas.length) {
    const cerca = nuevas.filter(enTramo);
    // En automático, si no queda nada a ±250, la más próxima al Elo del alumno.
    const pool = cerca.length ? cerca : t.min ? nuevas : [...nuevas].sort((a, b) => Math.abs(eloEjercicio(a) - elo) - Math.abs(eloEjercicio(b) - elo)).slice(0, 5);
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const nota = (p) => prog[p.id].mejor / prog[p.id].maximo;
  const min = Math.min(...candidatas.map(nota));
  const peores = candidatas.filter((p) => nota(p) === min);
  return peores[Math.floor(Math.random() * peores.length)];
}

function botonDudosa(p) {
  return `<button class="boton discreto" id="dudosa">¿Ves un error en esta posición?</button>`;
}
function activarDudosa(p) {
  const b = document.getElementById("dudosa");
  if (!b) return;
  b.onclick = () => {
    const nota = prompt("¿Qué está mal? (plan, explicación, posición…). Se guardará en la lista de posiciones dudosas.");
    if (nota === null) return;
    marcarDudosa(p.id, nota);
    b.textContent = "Marcada como dudosa ✓";
    b.disabled = true;
  };
}

// Reproduce la continuación de la partida en el tablero, jugada a jugada.
function controlesPartida(p, contenedor) {
  if (!p.partida?.jugadas) return;
  const jugadas = p.partida.jugadas.split(" ");
  let i = 0;
  contenedor.innerHTML = `
    <span>Partida: <span id="pj">posición inicial</span></span>
    <span>
      <button class="boton" id="pj-ini" title="Inicio">⏮</button>
      <button class="boton" id="pj-atras" title="Atrás">◀</button>
      <button class="boton" id="pj-adelante" title="Adelante">▶</button>
    </span>`;
  const juego = new Chess(p.fen);
  const etiqueta = document.getElementById("pj");
  const pintar = () => {
    const j = new Chess(p.fen);
    jugadas.slice(0, i).forEach((m) => j.move(m));
    tablero.poner(j.fen());
    tablero.flechas([]);
    etiqueta.textContent = i === 0 ? "posición inicial" : lineaPartida(p.fen, jugadas.slice(0, i)).split(" ").slice(-2).join(" ");
  };
  document.getElementById("pj-ini").onclick = () => { i = 0; pintar(); };
  document.getElementById("pj-atras").onclick = () => { if (i > 0) { i--; pintar(); } };
  document.getElementById("pj-adelante").onclick = () => { if (i < jugadas.length) { i++; pintar(); } };
  void juego;
}

// SAN numerado a partir de un FEN y una lista de jugadas SAN.
function lineaPartida(fen, sans) {
  let n = +fen.split(" ")[5], blancas = turnoDe(fen) === "w", out = [];
  sans.forEach((s, i) => {
    if (blancas) out.push(`${n}. ${s}`);
    else { out.push(i === 0 ? `${n}...${s}` : s); n++; }
    blancas = !blancas;
  });
  return out.join(" ");
}

async function mostrarMotor(fen, el, tiempo = 4000) {
  const gen = generacion;
  el.innerHTML = `<div class="motor"><span class="pensando">Stockfish está analizando…</span></div>`;
  try {
    const [l] = await motor.analizar(fen, { tiempo });
    if (gen !== generacion) return;
    const cp = aCp(l) * (turnoDe(fen) === "w" ? 1 : -1);
    el.innerHTML = `<div class="motor">Stockfish: <b>${textoEval(cp)}</b> <span class="linea">(prof. ${l.prof})</span><br><span class="linea">${h(lineaSan(fen, l.movs, 10))}</span></div>`;
  } catch {
    if (gen === generacion) el.innerHTML = `<div class="motor">No se pudo arrancar Stockfish en este dispositivo.</div>`;
  }
}

// ---------- Modo 1: Encuentra el plan ----------
function vistaPlan(id) {
  const lista = POSICIONES.filter((p) => p.plan);
  const p = lista.find((x) => x.id === id) || siguiente("plan", lista);
  if (!id) { location.replace(`#/plan/${p.id}`); return; }

  app.innerHTML = plantillaEjercicio(`
    ${cabeceraPosicion(p)}
    ${desplegable("d-analisis", "Ver análisis de la posición", `<p class="contexto">${txt(p.contexto)}</p>`)}
    <p class="pregunta"><b>${txt(p.plan.pregunta)}</b></p>
    <p class="meta" id="pista-tablero">Juega tu jugada en el tablero o elige entre las opciones.</p>
    ${desplegable("d-opciones", "Ver opciones", `<div class="opciones" id="opciones"></div>`)}
    <div id="resultado"></div>
    <div id="motor"></div>
    <div class="botones" id="botones" hidden>
      <button class="boton principal" id="sig">Siguiente posición</button>
      <button class="boton" id="analizar">Analizar con Stockfish</button>
    </div>
    ${botonDudosa(p)}`);
  montarTablero(p.fen, { alMover: (m) => jugadaTablero(m) });
  activarDudosa(p);
  const gen = generacion;

  const opciones = barajar(p.plan.opciones);
  const cont = document.getElementById("opciones");
  cont.innerHTML = opciones.map((o, i) => `<button class="opcion" data-i="${i}">${txt(o.texto)}</button>`).join("");
  cont.querySelectorAll(".opcion").forEach((b) => {
    b.onclick = () => responder(+b.dataset.i);
    b.onmouseenter = () => { if (!cont.dataset.hecho && opciones[+b.dataset.i].jugada) mostrarJugada(opciones[+b.dataset.i]); };
    b.onmouseleave = () => { if (!cont.dataset.hecho) tablero.flechas([]); };
  });

  function mostrarJugada(o) {
    const j = new Chess(p.fen);
    try { const m = j.move(o.jugada); tablero.flechas([[m.from, m.to, "blue"]]); } catch {}
  }

  // Descubre las opciones con su explicación (marcando la elegida, si la hay) y bloquea el ejercicio.
  function descubrir(elegida) {
    cont.dataset.hecho = "1";
    tablero.bloquear(true);
    document.getElementById("pista-tablero").hidden = true;
    cont.querySelectorAll(".opcion").forEach((b, k) => {
      const o = opciones[k];
      b.disabled = true;
      if (o.correcta) b.classList.add("correcta");
      else if (k === elegida) b.classList.add("incorrecta");
      b.insertAdjacentHTML("beforeend", `<span class="exp">${o.jugada ? `<b>${h(o.jugada)}</b> · ` : ""}${txt(o.explicacion)}</span>`);
    });
    abrir("d-opciones");
    abrir("d-analisis");
  }

  function terminar(clase, titulo, detalle, puntos, flechasExtra = []) {
    const cambio = registrar("plan", p, puntos, 1);
    document.getElementById("resultado").innerHTML = `
      <div class="resultado ${clase}">
        <p><b>${titulo}</b></p>
        ${detalle ? `<p>${detalle}</p>` : ""}
        ${bloqueElo(cambio)}
        ${concepto(p)}
        <p>${txt(p.plan.explicacion)}</p>
      </div>`;
    tablero.flechas([...(p.plan.flechas || []), ...flechasExtra]);
    document.getElementById("botones").hidden = false;
    controlesPartida(p, document.getElementById("bajo-tablero"));
  }

  function responder(i) {
    if (cont.dataset.hecho) return;
    descubrir(i);
    const bien = opciones[i].correcta;
    destello(bien ? "verde" : "rojo");
    terminar(bien ? "bien" : "mal", bien ? "¡Correcto!" : "No es el mejor plan.", "", bien ? 1 : 0);
  }

  // Jugada hecha en el tablero: si es la del plan correcto, acierto; si no, Stockfish la compara con la mejor.
  async function jugadaTablero(m) {
    if (cont.dataset.hecho) return;
    cont.dataset.hecho = "1";
    tablero.bloquear(true);
    const estado = document.getElementById("pista-tablero");
    estado.innerHTML = `<span class="pensando">Stockfish está valorando ${h(m.san)}…</span>`;
    const buena = opciones.find((o) => o.correcta)?.jugada;
    const uci = m.from + m.to + (m.promotion || "");
    let tipo, detalle, extra = [];
    if (buena && sinAdornos(buena) === sinAdornos(m.san)) {
      tipo = "verde"; detalle = `${h(m.san)} es justo la jugada del plan correcto.`;
    } else {
      try {
        const [mejor] = await motor.analizar(p.fen, { tiempo: 2500 });
        const tuya = mejor.movs[0] === uci ? mejor : (await motor.analizar(p.fen, { tiempo: 2500, movimientos: [uci] }))[0];
        if (gen !== generacion) return;
        const dif = Math.max(0, aCp(mejor) - aCp(tuya));
        const sanMejor = uciASan(p.fen, mejor.movs[0]);
        const peones = (Math.min(dif, 9999) / 100).toFixed(1);
        if (dif <= 30) { tipo = "verde"; detalle = `${h(m.san)} es tan buena como la mejor según Stockfish.`; }
        else if (dif <= 100) { tipo = "amarillo"; detalle = `${h(m.san)} es una imprecisión (−${peones}). Stockfish prefiere <b>${h(sanMejor)}</b>.`; }
        else { tipo = "rojo"; detalle = `${h(m.san)} es un error (−${peones}). Stockfish prefiere <b>${h(sanMejor)}</b>.`; }
        if (tipo !== "verde") extra = [[mejor.movs[0].slice(0, 2), mejor.movs[0].slice(2, 4), "blue"]];
      } catch {
        if (gen !== generacion) return;
        tipo = buena ? "rojo" : "amarillo";
        detalle = `No se pudo usar Stockfish en este dispositivo.${buena ? ` La jugada del plan era <b>${h(buena)}</b>.` : ""}`;
      }
    }
    descubrir(null);
    destello(tipo);
    const [clase, titulo, puntos] = { verde: ["bien", "¡Buena jugada!", 1], amarillo: ["neutro", "Imprecisión", 0.5], rojo: ["mal", "Error", 0] }[tipo];
    terminar(clase, titulo, detalle, puntos, extra);
  }

  document.getElementById("sig").onclick = () => { location.hash = `#/plan/${siguiente("plan", lista, p.id).id}`; };
  document.getElementById("analizar").onclick = () => mostrarMotor(tablero.fen(), document.getElementById("motor"));
}

// ---------- Modo 2: Adivina la jugada ----------
function vistaAdivina(id) {
  const lista = POSICIONES.filter((p) => p.partida?.jugadas);
  const p = lista.find((x) => x.id === id) || siguiente("adivina", lista);
  if (!id) { location.replace(`#/adivina/${p.id}`); return; }

  const jugadas = p.partida.jugadas.split(" ");
  const turnosAlumno = Math.ceil(jugadas.length / 2);
  let indice = 0, puntos = 0, fenAntes = p.fen;
  const gen = generacion;

  app.innerHTML = plantillaEjercicio(`
    ${cabeceraPosicion(p)}
    ${desplegable("d-analisis", "Ver análisis de la posición", `<p class="contexto">${txt(p.contexto)}</p>`)}
    <p>Juega las jugadas de las <b>${turnoDe(p.fen) === "w" ? "blancas" : "negras"}</b> como lo haría el maestro.
       Si coincides sumas 3 puntos; si no, Stockfish compara tu jugada con la de la partida.</p>
    <div class="marcador"><span>Puntos <b id="pts">0</b> / ${turnosAlumno * 3}</span><span>Jugada <b id="num">1</b> / ${turnosAlumno}</span></div>
    <div id="estado" class="pensando">Tu turno.</div>
    <ol class="historial" id="historial"></ol>
    <div id="final"></div>
    <div class="botones">
      <button class="boton" id="pista">Pista: plan</button>
      <button class="boton principal" id="sig">Siguiente posición</button>
    </div>
    ${botonDudosa(p)}`);
  montarTablero(p.fen, { alMover: (m) => intentar(m) });
  activarDudosa(p);

  const estado = document.getElementById("estado");
  const historial = document.getElementById("historial");
  document.getElementById("sig").onclick = () => { location.hash = `#/adivina/${siguiente("adivina", lista, p.id).id}`; };
  document.getElementById("pista").onclick = (e) => {
    e.target.disabled = true;
    estado.insertAdjacentHTML("afterend", `<div class="aviso">${txt(p.partida.pista || p.plan?.explicacion || p.evaluacion?.resumen || "Sin pista.")}</div>`);
  };

  async function intentar(m) {
    tablero.bloquear(true);
    const maestro = jugadas[indice];
    const jm = new Chess(fenAntes).move(maestro);
    let pts, comentario;
    if (m.san === maestro) {
      pts = 3; comentario = "¡Como en la partida!";
    } else {
      estado.textContent = "Stockfish compara tu jugada con la de la partida…";
      try {
        const uciTuya = m.from + m.to + (m.promotion || "");
        const uciMaestro = jm.from + jm.to + (jm.promotion || "");
        const [a] = await motor.analizar(fenAntes, { tiempo: 2500, movimientos: [uciTuya] });
        const [b] = await motor.analizar(fenAntes, { tiempo: 2500, movimientos: [uciMaestro] });
        if (gen !== generacion) return;
        const dif = aCp(b) - aCp(a); // > 0: la del maestro es mejor
        if (dif <= 30) { pts = 2; comentario = dif < -30 ? "Stockfish incluso la prefiere a la de la partida." : "Igual de buena según Stockfish."; }
        else if (dif <= 100) { pts = 1; comentario = `Algo peor (${(dif / 100).toFixed(1)} peones).`; }
        else { pts = 0; comentario = `Peor (${(Math.min(dif, 9999) / 100).toFixed(1)} peones).`; }
      } catch {
        if (gen !== generacion) return;
        pts = 0; comentario = "Sin motor para comparar.";
      }
    }
    puntos += pts;
    destello(pts >= 2 ? "verde" : pts === 1 ? "amarillo" : "rojo");
    document.getElementById("pts").textContent = puntos;
    historial.insertAdjacentHTML("beforeend",
      `<li><span class="pts pts${pts}">+${pts}</span>Tú: <b>${h(m.san)}</b> · Partida: <b>${h(maestro)}</b><br><small>${h(comentario)}</small></li>`);

    // Vuelve a la posición y juega la del maestro y la respuesta del rival.
    tablero.poner(fenAntes);
    tablero.jugar(maestro);
    indice++;
    if (indice < jugadas.length) {
      await new Promise((r) => setTimeout(r, 600));
      if (gen !== generacion) return;
      tablero.jugar(jugadas[indice]);
      indice++;
    }
    fenAntes = tablero.fen();
    if (indice >= jugadas.length) return terminar();
    document.getElementById("num").textContent = Math.floor(indice / 2) + 1;
    estado.textContent = "Tu turno.";
    tablero.bloquear(false);
  }

  function terminar() {
    const cambio = registrar("adivina", p, puntos, turnosAlumno * 3);
    estado.textContent = "";
    const pct = Math.round((puntos / (turnosAlumno * 3)) * 100);
    document.getElementById("final").innerHTML = `
      <div class="resultado ${pct >= 60 ? "bien" : "neutro"}">
        <p><b>Resultado: ${puntos} / ${turnosAlumno * 3} (${pct}%)</b></p>
        ${bloqueElo(cambio)}
        ${concepto(p)}
        <p>${txt(p.partida.comentario || "")}</p>
      </div>`;
  }
}

// ---------- Modo 3: Evalúa desequilibrios ----------
function vistaEvalua(id) {
  const lista = POSICIONES.filter((p) => p.evaluacion);
  const p = lista.find((x) => x.id === id) || siguiente("evalua", lista);
  if (!id) { location.replace(`#/evalua/${p.id}`); return; }
  const ev = p.evaluacion;
  const afirm = barajar(ev.afirmaciones.map((a, i) => ({ ...a, i })));
  const respuestas = {};
  let veredicto = null;

  app.innerHTML = plantillaEjercicio(`
    ${cabeceraPosicion(p)}
    ${desplegable("d-analisis", "Ver análisis de la posición", `<p class="contexto">${txt(p.contexto)}</p>`)}
    <h3>1. ¿Verdadero o falso?</h3>
    <div id="afirmaciones">${afirm.map((a, k) => `
      <div class="afirmacion" data-k="${k}">
        <div class="vf"><button data-v="1">V</button><button data-v="0">F</button></div>
        <div>${txt(a.texto)}<span class="porque" hidden>${txt(a.porque)}</span></div>
      </div>`).join("")}
    </div>
    <h3>2. ¿Quién está mejor?</h3>
    <div class="veredictos">${VEREDICTOS.map((v) => `<button class="veredicto" data-v="${v.id}">${v.texto}</button>`).join("")}</div>
    <div class="botones"><button class="boton principal" id="comprobar" disabled>Comprobar</button></div>
    <div id="resultado"></div>
    <div id="motor"></div>
    <div class="botones" id="botones" hidden>
      <button class="boton principal" id="sig">Siguiente posición</button>
      <button class="boton" id="analizar">Analizar con Stockfish</button>
    </div>
    ${botonDudosa(p)}`);
  montarTablero(p.fen);
  activarDudosa(p);

  const comprobar = document.getElementById("comprobar");
  const listo = () => { comprobar.disabled = !(veredicto && Object.keys(respuestas).length === afirm.length); };
  document.querySelectorAll(".afirmacion").forEach((fila) => {
    fila.querySelectorAll("button").forEach((b) => {
      b.onclick = () => {
        if (comprobar.dataset.hecho) return;
        fila.querySelectorAll("button").forEach((x) => x.classList.remove("marcada"));
        b.classList.add("marcada");
        respuestas[fila.dataset.k] = b.dataset.v === "1";
        listo();
      };
    });
  });
  document.querySelectorAll(".veredicto").forEach((b) => {
    b.onclick = () => {
      if (comprobar.dataset.hecho) return;
      document.querySelectorAll(".veredicto").forEach((x) => x.classList.remove("marcada"));
      b.classList.add("marcada");
      veredicto = b.dataset.v;
      listo();
    };
  });

  comprobar.onclick = () => {
    comprobar.dataset.hecho = "1";
    comprobar.hidden = true;
    let aciertos = 0;
    document.querySelectorAll(".afirmacion").forEach((fila) => {
      const a = afirm[fila.dataset.k];
      const ok = respuestas[fila.dataset.k] === a.verdadera;
      aciertos += ok;
      fila.querySelector(`button[data-v="${a.verdadera ? 1 : 0}"]`).classList.add("correcta");
      if (!ok) fila.querySelector(`button[data-v="${a.verdadera ? 0 : 1}"]`).classList.add("incorrecta");
      fila.querySelector(".porque").hidden = false;
    });
    const real = veredictoDe(ev.sf);
    const orden = VEREDICTOS.map((v) => v.id);
    const distancia = Math.abs(orden.indexOf(real) - orden.indexOf(veredicto));
    const ptsVer = distancia === 0 ? 2 : distancia === 1 ? 1 : 0;
    document.querySelector(`.veredicto[data-v="${real}"]`).classList.add("correcta");
    const total = aciertos + ptsVer, maximo = afirm.length + 2;
    const cambio = registrar("evalua", p, total, maximo);
    const f = ev.ficha;
    document.getElementById("resultado").innerHTML = `
      <div class="resultado ${total / maximo >= 0.7 ? "bien" : "neutro"}">
        <p><b>${total} / ${maximo} puntos.</b> Afirmaciones: ${aciertos}/${afirm.length}. Veredicto: ${ptsVer === 2 ? "exacto" : ptsVer === 1 ? "cerca" : "lejos"}
        (Stockfish 19: ${textoEval(ev.sf)}).</p>
        ${bloqueElo(cambio)}
        ${concepto(p)}
        <p>${txt(ev.resumen)}</p>
      </div>
      <h3>Ficha de la posición</h3>
      <dl class="ficha">
        <dt>Estructura de peones</dt><dd>${txt(f.estructura)}</dd>
        <dt>Piezas</dt><dd>${txt(f.piezas)}</dd>
        <dt>Casillas y columnas</dt><dd>${txt(f.casillas)}</dd>
        <dt>Seguridad del rey</dt><dd>${txt(f.rey)}</dd>
        <dt>Plan</dt><dd>${txt(f.plan)}</dd>
      </dl>`;
    tablero.flechas(ev.flechas || p.plan?.flechas || []);
    document.getElementById("botones").hidden = false;
    controlesPartida(p, document.getElementById("bajo-tablero"));
  };

  document.getElementById("sig").onclick = () => { location.hash = `#/evalua/${siguiente("evalua", lista, p.id).id}`; };
  document.getElementById("analizar").onclick = () => mostrarMotor(tablero.fen(), document.getElementById("motor"));
}

// ---------- Portada ----------
function vistaPortada() {
  const prog = leerProgreso();
  const hechas = (m) => Object.keys(prog[m] || {}).length;
  const pct = (m) => {
    const v = Object.values(prog[m] || {});
    if (!v.length) return "–";
    return Math.round((v.reduce((s, x) => s + x.mejor / x.maximo, 0) / v.length) * 100) + "%";
  };
  const n = (f) => POSICIONES.filter(f).length;
  const e = estadoElo(prog);
  const diario = problemaDelDia(listaDiario());
  const diarioHecho = estadoDiario(prog).ultimo === hoy();
  const dias = rachaDiariaVigente(prog);
  const t = tramoActual();
  app.innerHTML = `
    <section class="portada">
      <h1>${jugador(prog).nombre ? `Hola, ${h(jugador(prog).nombre)}` : "Entrena tu comprensión posicional"}</h1>
      <p class="lema">${POSICIONES.length} posiciones de partidas magistrales, comprobadas con Stockfish 19.</p>
      <div class="resumen-jugador">
        ${diario ? `<a class="panel diario ${diarioHecho ? "hecho" : ""}" href="#/plan/${diario.id}">
          <span class="insignia-diario">📅 Problema del día</span>
          <h2>${diarioHecho ? "Hecho por hoy ✓" : "Resuelve el de hoy"}</h2>
          <p>${h(nombrePartida(diario))} · nivel ${eloEjercicio(diario)}</p>
          <p>${dias ? `🔥 ${dias} día${dias > 1 ? "s" : ""} seguido${dias > 1 ? "s" : ""}` : "Empieza una racha de días"}</p></a>` : ""}
        <a class="panel tarjeta-elo" href="#/ranking">
          <span class="elo-grande">${e.valor}</span><span class="elo-etq">Elo</span>
          <p>${e.partidas} ejercicio${e.partidas === 1 ? "" : "s"} · máximo ${e.maximo} · mejor racha ${e.mejorRacha}</p>
          <p>${e.racha >= 2 ? `🔥 ${e.racha} aciertos seguidos: el siguiente vale <b>x${multiplicador(e.racha).toFixed(1)}</b>` : "Acierta dos seguidos y el tercero suma más (x1.1, x1.2…)"}</p>
          <p class="ver-ranking">Ver ranking →</p></a>
      </div>
      <div class="filtros">
        <label for="tramo">Nivel de los ejercicios:</label>
        <select id="tramo">${TRAMOS.map((x) => `<option value="${x.id}" ${x.id === t.id ? "selected" : ""}>${x.texto}</option>`).join("")}</select>
      </div>
      <div class="modos">
        <a class="panel modo" href="#/plan">${icono("plan")}<h2>Encuentra el plan</h2>
          <p>Elige el plan correcto entre cuatro y lee por qué los demás fallan.</p>
          <p>${hechas("plan")}/${n((p) => p.plan)} hechas · acierto ${pct("plan")}</p></a>
        <a class="panel modo" href="#/adivina">${icono("adivina")}<h2>Adivina la jugada</h2>
          <p>Juega como el maestro. Stockfish puntúa tus alternativas.</p>
          <p>${hechas("adivina")}/${n((p) => p.partida?.jugadas)} hechas · media ${pct("adivina")}</p></a>
        <a class="panel modo" href="#/evalua">${icono("evalua")}<h2>Evalúa desequilibrios</h2>
          <p>Estructura, piezas, casillas débiles: ¿quién está mejor y por qué?</p>
          <p>${hechas("evalua")}/${n((p) => p.evaluacion)} hechas · media ${pct("evalua")}</p></a>
      </div>
      <p class="meta apariencia"><a href="#/posiciones">Ver todas las posiciones →</a> · Colores, tablero y piezas: <a href="#/ajustes">Ajustes ⚙</a></p>
      <p class="meta version">Versión ${VERSION_APP}</p>
    </section>`;
  document.getElementById("tramo").onchange = (ev) => {
    const p = leerProgreso();
    p.tramo = ev.target.value;
    guardarProgreso(p);
  };
}

// ---------- Ranking ----------
async function vistaRanking() {
  const gen = generacion;
  const prog = leerProgreso();
  const yo = jugador(prog);
  guardarProgreso(prog);
  const e = estadoElo(prog);
  app.innerHTML = `
    <section class="panel ranking">
      <h2>Ranking</h2>
      <p class="meta">Tu Elo: <b>${e.valor}</b> · ${e.partidas} ejercicio${e.partidas === 1 ? "" : "s"}. Para aparecer hacen falta ${MINIMO} ejercicios.
        Solo cuenta el primer intento de cada ejercicio.</p>
      <form id="form-nombre" class="filtros">
        <label for="nombre">Tu nombre en el ranking:</label>
        <input id="nombre" maxlength="24" value="${h(yo.nombre)}" placeholder="Ej. Peón Pasado" autocomplete="nickname">
        <button class="boton principal">Guardar</button>
        <span id="nombre-estado" class="meta"></span>
      </form>
      <div id="tabla-ranking"><p class="pensando">Cargando…</p></div>
    </section>`;
  document.getElementById("form-nombre").onsubmit = async (ev) => {
    ev.preventDefault();
    const v = document.getElementById("nombre").value.trim();
    const est = document.getElementById("nombre-estado");
    if (!nombreValido(v)) { est.textContent = "Escribe al menos una letra (máximo 24)."; return; }
    const p = leerProgreso();
    jugador(p).nombre = v;
    guardarProgreso(p);
    est.textContent = "Guardado ✓";
    await sincronizarRanking();
    if (gen === generacion) pintarTabla();
  };
  pintarTabla();

  async function pintarTabla() {
    const cont = document.getElementById("tabla-ranking");
    if (!rankingActivo()) {
      cont.innerHTML = `<div class="aviso">El ranking online todavía no está conectado (falta configurar el servidor en <code>js/config.js</code>).
        Tu Elo se guarda en este dispositivo y se subirá en cuanto se active.</div>`;
      return;
    }
    try {
      const filas = await tabla(100);
      if (gen !== generacion) return;
      const id = leerProgreso().jugador?.id;
      cont.innerHTML = filas.length ? `
        <table class="lista">
          <thead><tr><th>#</th><th>Jugador</th><th>Elo</th><th class="ocultar-movil">Ejercicios</th><th class="ocultar-movil">Mejor racha</th></tr></thead>
          <tbody>${filas.map((f, i) => `
            <tr class="${f.id === id ? "yo" : ""}"><td>${i + 1}</td><td>${h(f.nombre)}</td><td><b>${f.elo}</b></td>
              <td class="ocultar-movil">${f.ejercicios}</td><td class="ocultar-movil">${f.mejor_racha}</td></tr>`).join("")}
          </tbody>
        </table>` : `<p>Todavía no hay nadie. ¡Sé el primero!</p>`;
    } catch {
      if (gen === generacion) cont.innerHTML = `<div class="aviso">No se pudo cargar el ranking (¿sin conexión?).</div>`;
    }
  }
}

// ---------- Lista de posiciones ----------
function vistaPosiciones() {
  const prog = leerProgreso();
  const ok = (m, id) => (prog[m]?.[id] ? `<span class="check" title="Mejor: ${prog[m][id].mejor}/${prog[m][id].maximo}">${Math.round((prog[m][id].mejor / prog[m][id].maximo) * 100)}%</span>` : "");
  const dudosas = prog.dudosas || {};
  app.innerHTML = `
    <section class="panel">
      <h2>Posiciones (${POSICIONES.length})</h2>
      <table class="lista">
        <thead><tr><th>Posición</th><th class="ocultar-movil">Temas</th><th>Plan</th><th>Adivina</th><th>Evalúa</th></tr></thead>
        <tbody>${POSICIONES.map((p) => `
          <tr>
            <td>${h(nombrePartida(p))}${p.anio ? `, ${h(p.anio)}` : ""}<br><small>${"★".repeat(p.dificultad)}</small>
              ${dudosas[p.id] ? `<br><small class="dudosa">⚠ Dudosa: ${h(dudosas[p.id].nota)}</small>` : ""}</td>
            <td class="ocultar-movil"><small>${p.temas.map(h).join(", ")}</small></td>
            <td>${p.plan ? `<a href="#/plan/${p.id}">Abrir</a> ${ok("plan", p.id)}` : "–"}</td>
            <td>${p.partida?.jugadas ? `<a href="#/adivina/${p.id}">Abrir</a> ${ok("adivina", p.id)}` : "–"}</td>
            <td>${p.evaluacion ? `<a href="#/evalua/${p.id}">Abrir</a> ${ok("evalua", p.id)}` : "–"}</td>
          </tr>`).join("")}
        </tbody>
      </table>
      ${Object.keys(dudosas).length ? `<div class="aviso">Tienes ${Object.keys(dudosas).length} posición(es) marcadas como dudosas. Pásale la lista a quien mantiene el contenido.
        <button class="boton" id="copiar">Copiar lista</button></div>` : ""}
    </section>`;
  const c = document.getElementById("copiar");
  if (c) c.onclick = async () => {
    const t = Object.entries(dudosas).map(([id, d]) => `${id}: ${d.nota}`).join("\n");
    try { await navigator.clipboard.writeText(t); c.textContent = "Copiada ✓"; } catch { prompt("Copia la lista:", t); }
  };
}

// ---------- Enrutado ----------
function enrutar() {
  generacion++;
  const [, modo = "", id = ""] = location.hash.split("/");
  document.querySelectorAll(".menu a").forEach((a) => a.classList.toggle("activo", a.dataset.modo === modo));
  if (tablero && !["plan", "adivina", "evalua"].includes(modo)) { tablero.destruir(); tablero = null; }
  // Primera vez: el asistente de bienvenida antes que nada.
  // (?demo en la URL lo salta: lo usa el previsualizador)
  if (!leerProgreso().perfil && modo !== "bienvenida" && !new URLSearchParams(location.search).has("demo")) { location.replace("#/bienvenida"); return; }
  if (modo !== "bienvenida") document.body.classList.remove("sin-menu");
  ({ plan: vistaPlan, adivina: vistaAdivina, evalua: vistaEvalua, posiciones: vistaPosiciones, ranking: vistaRanking,
     bienvenida: vistaBienvenida, ajustes: vistaAjustes }[modo] || vistaPortada)(decodeURIComponent(id));
  window.scrollTo(0, 0);
}

async function iniciar() {
  aplicarApariencia();
  try {
    POSICIONES = await (await fetch("datos/posiciones.json")).json();
  } catch {
    app.innerHTML = `<div class="panel">No se pudieron cargar las posiciones.</div>`;
    return;
  }
  window.addEventListener("hashchange", enrutar);
  aplicarApariencia();
  pintarMenu();
  pintarCabecera();
  enrutar();
}
iniciar();
void uciASan;
