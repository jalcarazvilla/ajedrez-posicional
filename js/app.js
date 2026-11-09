// Entrenador Posicional: enrutado, modos de entrenamiento y progreso.
import { Tablero, Chess, lineaSan, uciASan } from "./tablero.js";
import { Chessground } from "../vendor/chessground.js";
import { motor, aCp, textoEval } from "./motor.js";
import { aplicarResultado, estadoElo, eloEjercicio, multiplicador, problemaDelDia, marcarDiario, rachaDiariaVigente, estadoDiario, hoy, CALIBRACION } from "./elo.js";
import { rankingActivo, jugador, nombreValido, enviarElo, tabla, MINIMO, enviarPuntos, listarClubes, clubPorId, rankingClubes, miembrosClub, unirseClub, borrarJugador } from "./ranking.js";

// Súbela a la vez que versionName en movil/android/app/build.gradle.
const VERSION_APP = "1.6.2";
const app = document.getElementById("app");
let POSICIONES = [];
let CASILLAS = []; // ejercicios de "Encuentra la casilla" (datos/casillas.json)
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
  if (cambio) {
    // Puntos para el club: un acierto completo en un ejercicio de nivel 2000 vale 20.
    p.pendientes = [...(p.pendientes || []), { ejercicio: `${modo}/${pos.id}`, puntos: Math.round((puntos / maximo) * eloEjercicio(pos) / 100) }];
    p.recientes = [...(p.recientes || []), cambio.acierto].slice(-8);
    cambio.sugerencia = sugerenciaNivel(p);
  }
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
  { id: "", texto: "Azul", nota: "Azul tinta y latón", muestras: ["#0e1522", "#172133", "#d4ad5a", "#eef1f6"] },
  { id: "azul-naranja", texto: "Azul y naranja", nota: "Azul tinta y naranja", muestras: ["#0e1522", "#172133", "#ff7a1a", "#eef1f6"] },
  { id: "verde", texto: "Verde", nota: "Verde bosque y coral", muestras: ["#10241c", "#173328", "#ff8a66", "#eef5ef"] },
  { id: "negro", texto: "Negro", nota: "Negro y oro", muestras: ["#0b0b0c", "#161618", "#e9b949", "#f1f1f1"] },
  { id: "naranja", texto: "Naranja", nota: "Brasa y naranja", muestras: ["#1b120b", "#26190f", "#ff7a1a", "#fbefe5"] },
  { id: "burdeos", texto: "Burdeos", nota: "Granate y miel", muestras: ["#1d0e14", "#2a141d", "#e9b26b", "#f8eaee"] },
  { id: "morado", texto: "Morado", nota: "Violeta noche", muestras: ["#151229", "#1f1a3a", "#b69cff", "#efedfa"] },
  { id: "blanco", texto: "Blanco", nota: "Claro y azul", muestras: ["#f5f7fc", "#ffffff", "#2f54eb", "#141a33"] },
  { id: "madera", texto: "Madera", nota: "Claro y cálido", muestras: ["#f4f1ec", "#ffffff", "#8a5a2b", "#2b2622"] },
];
// Temas de versiones anteriores → el más parecido de los actuales.
const TEMAS_ANTIGUOS = { noche: "", pizarra: "negro", torneo: "blanco", oceano: "blanco", lavanda: "morado", "madera-claro": "madera" };
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
  let tema = url.has("tema") ? url.get("tema") : aj.tema || "";
  if (tema in TEMAS_ANTIGUOS) tema = TEMAS_ANTIGUOS[tema];
  const tablero = url.has("tablero") ? url.get("tablero") : aj.tablero || "";
  const piezas = url.has("piezas") ? url.get("piezas") : aj.piezas || "cburnett";
  const raiz = document.documentElement;
  tema ? raiz.setAttribute("data-tema", tema) : raiz.removeAttribute("data-tema");
  tablero ? raiz.setAttribute("data-tablero", tablero) : raiz.removeAttribute("data-tablero");
  raiz.setAttribute("data-piezas", piezas);
  const color = getComputedStyle(raiz).getPropertyValue("--fondo").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color || "#0e1522");
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
    let destino = "#/";
    try { destino = sessionStorage.getItem("tras-bienvenida") || "#/"; sessionStorage.removeItem("tras-bienvenida"); } catch {}
    location.hash = destino;
  }
}

// ---------- Ajustes ----------
// Ajustes: cada sección es un desplegable cerrado con su valor actual a la derecha.
const ajuste = (id, titulo, cuerpo) => `
  <details class="panel ajuste" id="aj-${id}">
    <summary><span class="ajuste-titulo">${titulo}</span><span class="ajuste-valor" data-valor="${id}"></span></summary>
    <div class="ajuste-cuerpo">${cuerpo}</div>
  </details>`;
function refrescarValoresAjustes() {
  const p = leerProgreso();
  const aj = p.ajustes || {};
  const tema = aj.tema in TEMAS_ANTIGUOS ? TEMAS_ANTIGUOS[aj.tema] : aj.tema || "";
  const valores = {
    nombre: jugador(p).nombre || "Sin nombre",
    tema: TEMAS.find((t) => t.id === tema)?.texto,
    tablero: TABLEROS.find((t) => t.id === (aj.tablero || ""))?.texto,
    piezas: PIEZAS.find((t) => t.id === (aj.piezas || "cburnett"))?.texto,
    nivel: tramoActual().texto,
    club: p.club?.nombre || "Sin club",
    ejercicios: aj.desplegados ? "Abiertos" : "Cerrados",
    elo: String(estadoElo(p).valor),
    cero: "",
  };
  app.querySelectorAll(".ajuste-valor").forEach((el) => { el.textContent = valores[el.dataset.valor] ?? ""; });
}

function vistaAjustes() {
  const p = leerProgreso();
  const aj = p.ajustes || {};
  const e = estadoElo(p);
  app.innerHTML = `
    <div class="asistente ajustes">
      <h1>Perfil y ajustes</h1>
      ${ajuste("nombre", "Tu nombre", `<div class="elo-propio">
          <input class="campo-nombre" id="nombre" maxlength="24" value="${h(jugador(p).nombre)}" placeholder="Tu nombre o apodo">
          <button class="boton principal" id="guardar-nombre">Guardar</button>
          <span id="nombre-estado" class="meta"></span>
        </div>`)}
      ${ajuste("tema", "Colores", `<div class="tarjetas" id="t-temas">${tarjetasTemas(aj.tema || "")}</div>`)}
      ${ajuste("tablero", "Tablero", `<div class="tarjetas tableros" id="t-tableros">${tarjetasTableros(aj.tablero || "")}</div>`)}
      ${ajuste("piezas", "Piezas", `<div class="tarjetas" id="t-piezas">${tarjetasPiezas(aj.piezas || "cburnett")}</div>`)}
      ${ajuste("nivel", "Nivel de los ejercicios", `<p class="meta">Tu Elo no cambia al elegir nivel: solo cambia resolviendo. Con un nivel más fácil ganas menos puntos por acierto.</p>
        <div class="tarjetas niveles" id="t-niveles">${tarjetasNiveles(tramoActual().id)}</div>`)}
      ${ajuste("club", "Club", `<p class="meta">Únete a tu club para sumar puntos en el ranking de clubes.</p>
        <a class="boton principal" href="#/club">${p.club ? `Tu club: ${h(p.club.nombre)}` : "Buscar mi club"}</a>`)}
      ${ajuste("ejercicios", "Ejercicios", `<label class="interruptor"><input type="checkbox" id="desplegados" ${aj.desplegados ? "checked" : ""}>
          <span>Mostrar el análisis de la posición y las opciones abiertos desde el principio</span></label>`)}
      ${ajuste("elo", "Elo de partida", `${e.partidas ? `<p class="meta">Tu Elo es ${e.valor}. Ya has hecho ejercicios, así que ahora solo cambia resolviendo posiciones.</p>`
          : `<div class="elo-propio"><input id="elo-libre" type="number" min="400" max="2800" step="10" value="${e.valor}">
             <button class="boton" id="guardar-elo">Guardar</button><span id="elo-estado" class="meta"></span></div>`}`)}
      ${ajuste("cero", "Empezar de cero", `<p class="meta">Borra tu Elo, tus ejercicios hechos y tu puesto en el ranking, y vuelve a la bienvenida. Los colores y el tablero se conservan. No se puede deshacer.</p>
        <button class="boton peligro" id="de-cero">Empezar de cero</button> <span id="de-cero-estado" class="meta"></span>`)}
      <p class="meta version">Versión ${VERSION_APP}</p>
    </div>`;
  activarNiveles(document.getElementById("t-niveles"));
  refrescarValoresAjustes();
  app.querySelector(".ajustes").addEventListener("click", () => setTimeout(refrescarValoresAjustes, 0));
  document.getElementById("de-cero").onclick = async () => {
    if (!confirm("¿Seguro? Se borrará todo tu progreso y tu puesto en el ranking.")) return;
    const q = leerProgreso();
    const est = document.getElementById("de-cero-estado");
    if (rankingActivo() && q.jugador?.id) {
      try { await borrarJugador(q); } catch (e) {
        if (!/clave/.test(e.message)) { est.textContent = "No se pudo conectar. Inténtalo con conexión."; return; }
      }
    }
    guardarProgreso({ ajustes: q.ajustes });
    pintarCabecera();
    location.hash = "#/bienvenida";
  };
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
  casilla: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M12 4v16M4 12h16"/><rect x="12" y="4" width="8" height="8" fill="currentColor" stroke="none" opacity=".35"/>',
  ranking: '<path d="M8 4h8v5a4 4 0 01-8 0z"/><path d="M8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8 21h8M9.5 17h5l.5 4h-6z"/>',
  entrenar: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  club: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M12 8v8M8.5 11h7"/>',
  perfil: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
  racha: '<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-9-1 3-3 4-4 4 0-3-1-5-3-7 0 4-5 7-5 12 0 4 4 7 9 7z"/>',
};
const icono = (n) => `<svg class="icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[n]}</svg>`;
const MENU = [
  { modo: "", icono: "inicio", texto: "Inicio" },
  { modo: "entrenar", icono: "entrenar", texto: "Entrenar" },
  { modo: "ranking", icono: "ranking", texto: "Ranking" },
  { modo: "club", icono: "club", texto: "Club" },
  { modo: "ajustes", icono: "perfil", texto: "Perfil" },
];
// Qué sección del menú se ilumina en cada pantalla.
function seccionMenu(modo, id) {
  if (["casilla", "plan", "adivina", "evalua", "posiciones", "revisadas", "entrenar"].includes(modo)) return "entrenar";
  if (modo === "club" || (modo === "ranking" && id === "clubes")) return "club";
  return modo;
}
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
  const pend = leerProgreso().pendientes || [];
  if (puesto && pend.length) {
    const quedan = await enviarPuntos(leerProgreso(), pend);
    const p = leerProgreso();
    p.pendientes = [...quedan, ...(p.pendientes || []).slice(pend.length)];
    guardarProgreso(p);
  }
}

// Bloque que se añade al resultado de cada ejercicio.
function bloqueElo(c) {
  if (!c) return `<p class="elo-cambio repeticion">Repetición: no cuenta para el Elo.</p>`;
  const extra = c.delta > 0 && c.mult > 1 ? ` <span class="mult">racha x${c.mult.toFixed(1)}</span>` : "";
  const sig = c.racha >= 2 ? ` · ${c.racha} aciertos seguidos: el siguiente vale <b>x${c.siguienteMult.toFixed(1)}</b>` : c.acierto ? "" : " · racha a cero";
  const diario = c.diario ? ` · 📅 ${c.diario} día${c.diario > 1 ? "s" : ""} seguido${c.diario > 1 ? "s" : ""}` : "";
  const calib = c.calibrando ? `<br><small>Calibrando tu Elo: ejercicio ${c.partidas} de ${CALIBRACION}. Al principio sube y baja más rápido.</small>` : "";
  const sug = c.sugerencia ? `
    <div class="sugerencia-nivel">${c.sugerencia.texto}
      <button class="boton principal" data-nivel="${c.sugerencia.nivel}">Cambiar a ${c.sugerencia.nombre}</button></div>` : "";
  return `<p class="elo-cambio ${c.delta >= 0 ? "sube" : "baja"}"><b>${signo(c.delta)} Elo</b> → ${c.valor}${extra}${sig}${diario}${calib}</p>${sug}`;
}

// Niveles de los ejercicios. El Elo es el marcador (solo cambia jugando); el nivel es lo que eliges entrenar.
const TRAMOS = [
  { id: "auto", texto: "Automático", nota: "Se adapta a tu Elo" },
  { id: "iniciacion", texto: "Iniciación", nota: "Hasta 1200", min: 0, max: 1200 },
  { id: "principiante", texto: "Principiante", nota: "1200–1400", min: 1200, max: 1400 },
  { id: "aficionado", texto: "Aficionado", nota: "1400–1600", min: 1400, max: 1600 },
  { id: "intermedio", texto: "Intermedio", nota: "1600–1800", min: 1600, max: 1800 },
  { id: "club", texto: "Club", nota: "1800–2200", min: 1800, max: 2200 },
  { id: "maestro", texto: "Maestro", nota: "2200 o más", min: 2200, max: 9999 },
];
const tramoActual = () => TRAMOS.find((t) => t.id === (leerProgreso().tramo || "auto")) || TRAMOS[0];
const FIJOS = TRAMOS.filter((t) => t.max);
const tramoDeElo = (elo) => FIJOS.find((t) => elo >= t.min && elo < t.max) || FIJOS[FIJOS.length - 1];

function tarjetasNiveles(actual) {
  return TRAMOS.map((t) => {
    const todas = [...POSICIONES, ...CASILLAS];
    const n = t.max ? todas.filter((p) => eloEjercicio(p) >= t.min && eloEjercicio(p) < t.max).length : todas.length;
    return `<button type="button" class="tarjeta nivel ${t.id === actual ? "elegida" : ""}" data-tramo="${t.id}">
      <b>${t.texto}</b><small>${t.nota}</small><small class="cuenta">${n} ejercicios</small></button>`;
  }).join("");
}
function activarNiveles(cont) {
  cont.querySelectorAll("[data-tramo]").forEach((b) => {
    b.onclick = () => {
      const p = leerProgreso();
      p.tramo = b.dataset.tramo;
      guardarProgreso(p);
      cont.querySelectorAll("[data-tramo]").forEach((x) => x.classList.toggle("elegida", x === b));
    };
  });
}

// Si fallas 5 de los últimos 6 (o aciertas 7 de los últimos 8), propone bajar (o subir) de nivel.
// No vuelve a proponerlo hasta pasados 8 ejercicios.
function sugerenciaNivel(p) {
  const r = p.recientes || [];
  const e = estadoElo(p);
  if (e.partidas - (p.avisoNivel ?? -99) < 8) return null;
  const actual = tramoActual().max ? tramoActual() : tramoDeElo(e.valor);
  const i = FIJOS.indexOf(actual);
  let destino = null, texto = "";
  if (r.length >= 6 && r.slice(-6).filter((x) => !x).length >= 5 && i > 0) {
    destino = FIJOS[i - 1]; texto = "Estos ejercicios te están costando. ¿Quieres probar un nivel más fácil?";
  } else if (r.length >= 8 && r.filter(Boolean).length >= 7 && i < FIJOS.length - 1) {
    destino = FIJOS[i + 1]; texto = "¡Vas sobrado! ¿Quieres subir de nivel?";
  }
  if (!destino) return null;
  p.avisoNivel = e.partidas;
  return { nivel: destino.id, nombre: destino.texto, texto };
}
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
// Análisis a fondo (solo en las posiciones revisadas): lectura de la posición e idea para recordar.
const claves = (p) => (p.claves ? `
  <h3>Claves de la posición</h3>
  <dl class="ficha claves">${p.claves.map((c) => `<dt>${h(c.etiqueta)}</dt><dd>${txt(c.texto)}</dd>`).join("")}</dl>` : "") +
  (p.idea ? `<p class="idea-recordar"><b>Para recordar:</b> ${txt(p.idea)}</p>` : "");

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
  if (new URLSearchParams(location.search).has("demo")) window.tableroDemo = tablero; // para pruebas automáticas
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
  const enTramo = (p) => (t.max ? eloEjercicio(p) >= t.min && eloEjercicio(p) < t.max : Math.abs(eloEjercicio(p) - elo) <= 250);
  const nuevas = candidatas.filter((p) => !prog[p.id]);
  if (nuevas.length) {
    const cerca = nuevas.filter(enTramo);
    // En automático, si no queda nada a ±250, la más próxima al Elo del alumno.
    const pool = cerca.length ? cerca : t.max ? nuevas : [...nuevas].sort((a, b) => Math.abs(eloEjercicio(a) - elo) - Math.abs(eloEjercicio(b) - elo)).slice(0, 5);
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
      </div>${claves(p)}`;
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
      </div>${claves(p)}`;
  }
}


// ---------- Modo: Encuentra la casilla (para empezar) ----------
function vistaCasilla(id) {
  if (!CASILLAS.length) { app.innerHTML = `<div class="panel">No se pudieron cargar los ejercicios.</div>`; return; }
  const p = CASILLAS.find((x) => x.id === id) || siguiente("casilla", CASILLAS);
  if (!id) { location.replace(`#/casilla/${p.id}`); return; }
  const bando = turnoDe(p.fen) === "w" ? "blancas" : "negras";
  let conPista = false, hecho = false;
  app.innerHTML = plantillaEjercicio(`
    <p class="meta">Encuentra la casilla · nivel ${eloEjercicio(p)}</p>
    <h1 class="titulo-casilla">${h(p.titulo)}</h1>
    <p class="pregunta"><b>Juegan las ${bando}.</b> ${h(p.pregunta)}</p>
    <p class="meta">Haz la jugada en el tablero.</p>
    <div id="resultado"></div>
    <div class="botones">
      <button class="boton" id="pista">Pista</button>
      <button class="boton principal" id="sig">Siguiente</button>
    </div>`);
  montarTablero(p.fen, { alMover: (m) => responder(m) });
  document.getElementById("sig").onclick = () => { location.hash = `#/casilla/${siguiente("casilla", CASILLAS, p.id).id}`; };
  document.getElementById("pista").onclick = (e) => {
    conPista = true; e.target.disabled = true;
    document.getElementById("resultado").insertAdjacentHTML("beforebegin", `<div class="aviso">${h(p.pista)}</div>`);
  };

  function responder(m) {
    if (hecho) return;
    hecho = true;
    tablero.bloquear(true);
    const bien = p.tipo === "mate" ? tablero.juego.isCheckmate()
      : p.tipo === "captura" ? m.to === p.solucion
      : m.from === p.desde && m.to === p.solucion;
    const puntos = bien ? (conPista ? 1 : 2) : 0;
    destello(bien ? (conPista ? "amarillo" : "verde") : "rojo");
    if (!bien) { tablero.poner(p.fen); tablero.jugar(p.jugada); }
    tablero.flechas([[p.desde, p.solucion], ...p.objetivos.map((o) => [o, null, "red"])]);
    const cambio = registrar("casilla", p, puntos, 2);
    document.getElementById("resultado").innerHTML = `
      <div class="resultado ${bien ? "bien" : "neutro"}">
        <p><b>${bien ? (conPista ? "¡Bien! (con pista)" : "¡Correcto!") : `No. La casilla era <span class="casilla-sol">${p.solucion}</span>.`}</b></p>
        <p>${h(p.explicacion)}</p>
        ${bloqueElo(cambio)}
      </div>`;
    document.getElementById("pista").disabled = true;
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
      ${p.claves ? claves(p) : `<h3>Ficha de la posición</h3>
      <dl class="ficha">
        <dt>Estructura de peones</dt><dd>${txt(f.estructura)}</dd>
        <dt>Piezas</dt><dd>${txt(f.piezas)}</dd>
        <dt>Casillas y columnas</dt><dd>${txt(f.casillas)}</dd>
        <dt>Seguridad del rey</dt><dd>${txt(f.rey)}</dd>
        <dt>Plan</dt><dd>${txt(f.plan)}</dd>
      </dl>`}`;
    tablero.flechas(ev.flechas || p.plan?.flechas || []);
    document.getElementById("botones").hidden = false;
    controlesPartida(p, document.getElementById("bajo-tablero"));
  };

  document.getElementById("sig").onclick = () => { location.hash = `#/evalua/${siguiente("evalua", lista, p.id).id}`; };
  document.getElementById("analizar").onclick = () => mostrarMotor(tablero.fen(), document.getElementById("motor"));
}

// ---------- Portada ----------
// Gráfica pequeña con la evolución del Elo (últimos 40 ejercicios).
function graficaElo(historial) {
  const pts = (historial || []).slice(-40).map((x) => x[1]);
  if (pts.length < 2) return "";
  const min = Math.min(...pts), max = Math.max(...pts), rango = Math.max(max - min, 20);
  const W = 300, H = 48;
  const d = pts.map((v, i) => `${i ? "L" : "M"}${((i / (pts.length - 1)) * W).toFixed(1)} ${(H - 4 - ((v - min) / rango) * (H - 10)).toFixed(1)}`).join(" ");
  return `<svg class="grafica-elo" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Evolución de tu Elo: de ${pts[0]} a ${pts[pts.length - 1]}">
    <path class="area" d="${d} L${W} ${H} L0 ${H} Z"/><path class="linea-elo" d="${d}"/></svg>`;
}
// Cuánto ha cambiado el Elo en los últimos 7 días.
function cambioSemana(e) {
  const hist = e.historial || [];
  if (!hist.length) return 0;
  const hace = Date.now() - 7 * 864e5;
  const previos = hist.filter((x) => x[0] <= hace);
  const base = previos.length ? previos[previos.length - 1][1] : (e.inicial ?? hist[0][1]);
  return e.valor - base;
}
// Recuadros de los modos de entrenamiento (portada y Entrenar).
function tarjetasModos(conDescripcion) {
  const prog = leerProgreso();
  const hechas = (m) => Object.keys(prog[m] || {}).length;
  const n = (f) => POSICIONES.filter(f).length;
  const modos = [
    CASILLAS.length && { modo: "casilla", titulo: "Encuentra la casilla", desc: "Dobles ataques, horquillas, piezas sin defensa y mates en una.", total: CASILLAS.length },
    { modo: "plan", titulo: "El plan", desc: "Elige el plan correcto entre cuatro y entiende por qué los demás fallan.", total: n((p) => p.plan) },
    { modo: "adivina", titulo: "Adivina la jugada", desc: "Juega como el maestro. Stockfish puntúa tus alternativas.", total: n((p) => p.partida?.jugadas) },
    { modo: "evalua", titulo: "Evalúa", desc: "Estructura, piezas y casillas débiles: ¿quién está mejor y por qué?", total: n((p) => p.evaluacion) },
  ].filter(Boolean);
  return modos.map((m) => {
    const hecho = hechas(m.modo);
    return `<a class="panel modo-v2" href="#/${m.modo}">${icono(m.modo)}<b>${m.titulo}</b>
      ${conDescripcion ? `<small>${m.desc}</small>` : ""}<small>${hecho} de ${m.total}</small>
      <span class="barra-progreso"><i style="width:${Math.min(100, Math.round((hecho / m.total) * 100))}%"></i></span></a>`;
  }).join("");
}

function vistaPortada() {
  const prog = leerProgreso();
  const e = estadoElo(prog);
  const diario = problemaDelDia(listaDiario());
  const diarioHecho = estadoDiario(prog).ultimo === hoy();
  const dias = rachaDiariaVigente(prog);
  const t = tramoActual();
  const hora = new Date().getHours();
  const saludo = hora < 14 ? "Buenos días" : hora < 21 ? "Buenas tardes" : "Buenas noches";
  const nombre = jugador(prog).nombre;
  const fecha = new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  const semana = cambioSemana(e);
  app.innerHTML = `
    <section class="portada">
      <p class="etiqueta-mayus fecha">${h(fecha)}</p>
      <h1>${saludo}${nombre ? `, ${h(nombre)}` : ""}</h1>
      <div class="inicio-rejilla">
        <a class="panel tarjeta-elo-v2" href="#/ranking">
          <div class="fila">
            <div>
              <span class="etiqueta-mayus">Tu Elo posicional</span>
              <div class="elo-grande">${e.valor}</div>
              <span class="semana ${semana > 0 ? "sube" : semana < 0 ? "baja" : ""}">${semana ? `${signo(semana)} esta semana` : `${e.partidas} ejercicio${e.partidas === 1 ? "" : "s"}`}</span>
            </div>
            <div class="racha-dias"><span>${icono("racha")}${dias} día${dias === 1 ? "" : "s"}</span><small>Racha diaria</small></div>
          </div>
          ${graficaElo(e.historial)}
          <span class="meta" style="margin:0">${e.racha >= 2 ? `${e.racha} aciertos seguidos: el siguiente vale <b>x${multiplicador(e.racha).toFixed(1)}</b>` : `Máximo ${e.maximo} · mejor racha ${e.mejorRacha}`}</span>
        </a>
        ${diario ? `<a class="panel diario-v2 ${diarioHecho ? "hecho" : ""}" href="#/plan/${diario.id}">
          <div class="tablero-mini" id="mini-diario"></div>
          <div>
            <span class="etiqueta-mayus acento">${diarioHecho ? "Hecho por hoy ✓" : "Problema del día"}</span>
            <h2>${h(nombrePartida(diario))}</h2>
            <p class="meta">Juegan las ${turnoDe(diario.fen) === "w" ? "blancas" : "negras"} · nivel ${eloEjercicio(diario)}</p>
          </div></a>` : ""}
      </div>
      <h2 class="titulo-seccion etiqueta-mayus">Entrenar · ${h(t.texto || "")}</h2>
      <div class="modos-v2">${tarjetasModos(false)}</div>
      <p class="meta version">Versión ${VERSION_APP}</p>
    </section>`;
  const mini = document.getElementById("mini-diario");
  if (mini) Chessground(mini, { fen: diario.fen, orientation: orientacion(diario.fen), viewOnly: true, coordinates: false });
}

function vistaEntrenar() {
  const t = tramoActual();
  app.innerHTML = `
    <section class="portada">
      <h1>Entrenar</h1>
      <h2 class="titulo-seccion etiqueta-mayus">Nivel de los ejercicios</h2>
      <div class="tarjetas niveles" id="niveles">${tarjetasNiveles(t.id)}</div>
      <h2 class="titulo-seccion etiqueta-mayus">Modos</h2>
      <div class="modos-v2">${tarjetasModos(true)}</div>
      <p class="meta" style="margin-top:16px"><a href="#/posiciones">Ver todas las posiciones →</a></p>
    </section>`;
  activarNiveles(document.getElementById("niveles"));
}

// ---------- Ranking (jugadores y clubes) ----------
const CORREO_CLUBES = "ajedrezposicional@gmail.com";
// Escudo del club: su logo si lo tiene; si no, un escudo genérico con un caballo de ajedrez.
function escudo(club, tam = 40) {
  if (club.logo) return `<img class="escudo logo-club" src="${h(club.logo)}" width="${tam}" height="${tam}" alt="" loading="lazy">`;
  return `<svg class="escudo" width="${tam}" height="${Math.round(tam * 1.15)}" viewBox="0 0 100 115" aria-hidden="true">
    <path d="M50 3 L95 18 V55 C95 85 72 104 50 112 C28 104 5 85 5 55 V18 Z" fill="${h(club.color || "#8a5a2b")}" stroke="rgba(0,0,0,.25)" stroke-width="3"/>
    <path d="M50 12 L86 24 V55 C86 79 68 95 50 102 C32 95 14 79 14 55 V24 Z" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="2.5"/>
    <text x="50" y="76" text-anchor="middle" font-size="52" fill="#fff">♞</text></svg>`;
}
const enlaceAltaClub = () => `mailto:${CORREO_CLUBES}?subject=${encodeURIComponent("Alta de club en Ajedrez Posicional")}&body=${encodeURIComponent(
  "Nombre del club:\nLocalidad:\nComunidad autónoma:\nCorreo de contacto del club:\n\n" +
  "Adjunta el logo del club (PNG o JPG, lo más grande posible).\n\n" +
  "Confirmo que el club nos da permiso para usar su nombre y su logo en la aplicación: SÍ / NO")}`;

async function vistaRanking(pestana) {
  const gen = generacion;
  const prog = leerProgreso();
  const yo = jugador(prog);
  guardarProgreso(prog);
  const e = estadoElo(prog);
  const clubes = pestana === "clubes";
  app.innerHTML = `
    <section class="panel ranking">
      <div class="pestanas">
        <a href="#/ranking" class="${clubes ? "" : "activa"}">Jugadores</a>
        <a href="#/ranking/clubes" class="${clubes ? "activa" : ""}">Clubes</a>
      </div>
      <div id="contenido-ranking"></div>
    </section>`;
  const cont = document.getElementById("contenido-ranking");
  if (!rankingActivo()) {
    cont.innerHTML = `<div class="aviso">El ranking online todavía no está conectado. Tu Elo se guarda en este dispositivo.</div>`;
    return;
  }
  return clubes ? pintarClubes() : pintarJugadores();

  function pintarJugadores() {
    cont.innerHTML = `
      <p class="meta">Tu Elo: <b>${e.valor}</b> · ${e.partidas} ejercicio${e.partidas === 1 ? "" : "s"}. Para aparecer hacen falta ${MINIMO} ejercicios.
        Solo cuenta el primer intento de cada ejercicio.</p>
      <form id="form-nombre" class="filtros">
        <label for="nombre">Tu nombre en el ranking:</label>
        <input id="nombre" maxlength="24" value="${h(yo.nombre)}" placeholder="Ej. Peón Pasado" autocomplete="nickname">
        <button class="boton principal">Guardar</button>
        <span id="nombre-estado" class="meta"></span>
      </form>
      <div id="tabla-ranking"><p class="pensando">Cargando…</p></div>`;
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
      if (gen === generacion) tablaJugadores();
    };
    tablaJugadores();
  }

  async function tablaJugadores() {
    const t = document.getElementById("tabla-ranking");
    try {
      const filas = await tabla(100);
      if (gen !== generacion) return;
      const id = leerProgreso().jugador?.id;
      t.innerHTML = filas.length ? `
        <table class="lista">
          <thead><tr><th>#</th><th>Jugador</th><th>Elo</th><th class="ocultar-movil">Club</th><th class="ocultar-movil">Ejercicios</th></tr></thead>
          <tbody>${filas.map((f, i) => `
            <tr class="${f.id === id ? "yo" : ""}"><td>${i + 1}</td><td>${h(f.nombre)}</td><td><b>${f.elo}</b></td>
              <td class="ocultar-movil">${h(f.club || "")}</td><td class="ocultar-movil">${f.ejercicios}</td></tr>`).join("")}
          </tbody>
        </table>` : `<p>Todavía no hay nadie. ¡Sé el primero!</p>`;
    } catch {
      if (gen === generacion) t.innerHTML = `<div class="aviso">No se pudo cargar el ranking (¿sin conexión?).</div>`;
    }
  }

  // ----- Clubes -----
  async function pintarClubes() {
    const club = leerProgreso().club;
    cont.innerHTML = `
      <div id="mi-club">${club ? tarjetaMiClub(club) : buscador()}</div>
      <h2 class="titulo-seccion">Ranking de clubes</h2>
      <div class="pestanas pequenas" id="periodo">
        <button data-periodo="mes" class="activa">Este mes</button><button data-periodo="anio">Este año</button>
      </div>
      <div id="tabla-clubes"><p class="pensando">Cargando…</p></div>
      <p class="meta explicacion-clubes">Cada ejercicio resuelto por primera vez suma puntos según su nivel (un acierto en uno de nivel 2000 = 20 puntos).
        La puntuación del club es la media de sus <b>5 mejores jugadores</b>: no gana el club más grande, sino el que mejor entrena.
        🏆 Pronto: premios para los mejores clubes del mes y del año.</p>`;
    if (club) activarMiClub(club); else activarBuscador();
    document.querySelectorAll("#periodo button").forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll("#periodo button").forEach((x) => x.classList.toggle("activa", x === b));
        tablaClubes(b.dataset.periodo);
      };
    });
    tablaClubes("mes");
    if (club) {
      // Refresca nombre, logo y miembros del club por si han cambiado.
      try {
        const c = await clubPorId(club.id);
        if (gen !== generacion || !c) return;
        const p = leerProgreso(); p.club = c; guardarProgreso(p);
        const caja = document.getElementById("mi-club");
        if (caja) { caja.innerHTML = tarjetaMiClub(c); activarMiClub(c); }
      } catch {}
    }
  }

  async function tablaClubes(periodo) {
    const t = document.getElementById("tabla-clubes");
    t.innerHTML = `<p class="pensando">Cargando…</p>`;
    try {
      const filas = await rankingClubes(periodo);
      if (gen !== generacion) return;
      const mio = leerProgreso().club?.id;
      t.innerHTML = filas.length ? `
        <table class="lista clubes">
          <thead><tr><th>#</th><th>Club</th><th>Puntos</th><th class="ocultar-movil">Activos</th></tr></thead>
          <tbody>${filas.map((f, i) => `
            <tr class="${f.id === mio ? "yo" : ""}"><td>${i + 1}</td>
              <td><span class="club-celda">${escudo(f, 26)}<span>${h(f.nombre)}<small>${h(f.ciudad)}</small></span></span></td>
              <td><b>${f.puntos}</b></td><td class="ocultar-movil">${f.activos}</td></tr>`).join("")}
          </tbody>
        </table>` : `<p>Todavía ningún club ha sumado puntos ${periodo === "anio" ? "este año" : "este mes"}. ¡El tuyo puede ser el primero!</p>`;
    } catch {
      if (gen === generacion) t.innerHTML = `<div class="aviso">No se pudo cargar el ranking de clubes (¿sin conexión?).</div>`;
    }
  }

  function tarjetaMiClub(c) {
    return `
      <div class="mi-club">
        ${escudo(c, 64)}
        <div><h2>${h(c.nombre)}</h2><p class="meta">${h(c.ciudad)}${c.miembros ? ` · ${c.miembros} miembro${c.miembros === 1 ? "" : "s"}` : ""}</p></div>
      </div>
      <h3>Jugadores del club este mes</h3>
      <div id="miembros"><p class="pensando">Cargando…</p></div>
      <p><button class="boton discreto" id="dejar-club">Cambiar de club</button> <span id="club-estado" class="meta"></span></p>`;
  }
  async function activarMiClub(c) {
    document.getElementById("dejar-club").onclick = async () => {
      if (!confirm("¿Dejar este club? Solo se puede cambiar de club una vez cada 30 días.")) return;
      try {
        await unirseClub(leerProgreso(), estadoElo(leerProgreso()), null);
        const p = leerProgreso(); delete p.club; guardarProgreso(p);
        pintarClubes();
      } catch (err) { document.getElementById("club-estado").textContent = err.message; }
    };
    try {
      const filas = await miembrosClub(c.id);
      if (gen !== generacion) return;
      const id = leerProgreso().jugador?.id;
      const m = document.getElementById("miembros");
      if (m) m.innerHTML = `
        <table class="lista">
          <thead><tr><th>#</th><th>Jugador</th><th>Puntos</th><th>Elo</th></tr></thead>
          <tbody>${filas.map((f, i) => `<tr class="${f.id === id ? "yo" : ""}"><td>${i + 1}</td><td>${h(f.nombre)}</td><td><b>${f.puntos_mes}</b></td><td>${f.elo}</td></tr>`).join("")}</tbody>
        </table>`;
    } catch {
      const m = document.getElementById("miembros");
      if (m) m.innerHTML = `<p class="meta">No se pudieron cargar los miembros.</p>`;
    }
  }

  function buscador() {
    return `
      <h2>¿Juegas en un club?</h2>
      <p class="meta">Busca tu club y únete para sumar puntos con tus compañeros.</p>
      <input id="buscar-club" class="campo-nombre" placeholder="Busca por nombre o localidad…" autocomplete="off">
      <div id="resultados-club"><p class="pensando">Cargando clubes…</p></div>
      <div class="aviso alta-club">¿No está tu club? <a href="${enlaceAltaClub()}">Pide que lo demos de alta</a>
        enviando el nombre, la localidad, un correo de contacto y el logo a <b>${CORREO_CLUBES}</b>. Revisamos cada solicitud a mano.</div>`;
  }
  async function activarBuscador() {
    const input = document.getElementById("buscar-club");
    const res = document.getElementById("resultados-club");
    let todos = [];
    const sinTildes = (t) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    const pintar = () => {
      const q = sinTildes(input.value.trim());
      const filas = todos.filter((c) => !q || sinTildes(`${c.nombre} ${c.ciudad} ${c.comunidad || ""}`).includes(q));
      res.innerHTML = filas.length ? filas.map((c) => `
        <div class="club-resultado">${escudo(c, 40)}
          <span><b>${h(c.nombre)}</b><small>${h(c.ciudad)} · ${c.miembros} miembro${c.miembros === 1 ? "" : "s"}</small></span>
          <button class="boton principal" data-club="${c.id}">Unirme</button></div>`).join("")
        : `<p class="meta">No hay ningún club con ese nombre. Si es el tuyo, pide el alta abajo.</p>`;
      res.querySelectorAll("[data-club]").forEach((b) => {
        b.onclick = async () => {
          b.disabled = true;
          try {
            await unirseClub(leerProgreso(), estadoElo(leerProgreso()), b.dataset.club);
            const p = leerProgreso(); p.club = todos.find((c) => c.id === b.dataset.club); guardarProgreso(p);
            pintarClubes();
          } catch (err) { b.disabled = false; b.insertAdjacentHTML("afterend", `<small class="error">${h(err.message)}</small>`); }
        };
      });
    };
    input.oninput = pintar;
    try {
      todos = await listarClubes();
      if (gen !== generacion) return;
      pintar();
    } catch { res.innerHTML = `<p class="meta">No se pudieron cargar los clubes (¿sin conexión?).</p>`; }
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

// ---------- Análisis revisados (apartado de prueba, sin entrada en el menú: se llega por enlace) ----------
function vistaRevisadas() {
  const lista = POSICIONES.filter((p) => p.claves);
  const prog = leerProgreso();
  const hecho = (m, id) => (prog[m]?.[id] ? " ✓" : "");
  app.innerHTML = `
    <section class="panel revisadas">
      <h2>Análisis revisados</h2>
      <p class="meta">Posiciones de nivel alto con el análisis reescrito a fondo: claves de la posición, por qué funciona la jugada, qué pasó en la partida e idea para recordar. Están en prueba: si ves algo mejorable, dínoslo con el botón «¿Ves un error en esta posición?».</p>
      <div class="rejilla-revisadas">${lista.map((p, i) => `
        <article class="tarjeta-revisada">
          <div class="tablero-mini" data-i="${i}"></div>
          <div class="info-revisada">
            <h3>${h(p.titulo)}</h3>
            <p class="meta">${h(nombrePartida(p))}${p.anio ? `, ${h(p.anio)}` : ""} · juegan las ${turnoDe(p.fen) === "w" ? "blancas" : "negras"} · nivel ${p.elo}</p>
            <p class="botones-revisada">
              <a class="boton principal" href="#/plan/${p.id}">Plan${hecho("plan", p.id)}</a>
              <a class="boton" href="#/evalua/${p.id}">Evalúa${hecho("evalua", p.id)}</a>
              <a class="boton" href="#/adivina/${p.id}">Jugada${hecho("adivina", p.id)}</a>
            </p>
          </div>
        </article>`).join("")}
      </div>
    </section>`;
  app.querySelectorAll(".tablero-mini").forEach((el) => {
    const p = lista[+el.dataset.i];
    Chessground(el, { fen: p.fen, orientation: orientacion(p.fen), viewOnly: true, coordinates: false });
  });
}

// ---------- Enrutado ----------
function enrutar() {
  generacion++;
  const [, modo = "", id = ""] = location.hash.split("/");
  const seccion = seccionMenu(modo, id);
  document.querySelectorAll(".menu a").forEach((a) => a.classList.toggle("activo", a.dataset.modo === seccion));
  if (tablero && !["plan", "adivina", "evalua", "casilla"].includes(modo)) { tablero.destruir(); tablero = null; }
  // Primera vez: el asistente de bienvenida antes que nada.
  // (?demo en la URL lo salta: lo usa el previsualizador)
  if (!leerProgreso().perfil && modo !== "bienvenida" && !new URLSearchParams(location.search).has("demo")) {
    // Si llegó por un enlace directo (p. ej. #/revisadas), vuelve allí al terminar la bienvenida.
    if (modo) try { sessionStorage.setItem("tras-bienvenida", location.hash); } catch {}
    location.replace("#/bienvenida"); return;
  }
  if (modo !== "bienvenida") document.body.classList.remove("sin-menu");
  ({ casilla: vistaCasilla, plan: vistaPlan, adivina: vistaAdivina, evalua: vistaEvalua, posiciones: vistaPosiciones, ranking: vistaRanking,
     bienvenida: vistaBienvenida, ajustes: vistaAjustes, revisadas: vistaRevisadas,
     entrenar: vistaEntrenar, club: () => vistaRanking("clubes") }[modo] || vistaPortada)(decodeURIComponent(id));
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
  try { CASILLAS = await (await fetch("datos/casillas.json")).json(); } catch { CASILLAS = []; }
  window.addEventListener("hashchange", enrutar);
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-nivel]");
    if (!b) return;
    const p = leerProgreso();
    p.tramo = b.dataset.nivel;
    guardarProgreso(p);
    b.parentElement.innerHTML = `Nivel cambiado a <b>${h(TRAMOS.find((t) => t.id === b.dataset.nivel)?.texto || "")}</b> ✓ Se nota desde la siguiente posición.`;
  });
  aplicarApariencia();
  pintarMenu();
  pintarCabecera();
  enrutar();
}
iniciar();
void uciASan;
