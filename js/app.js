// Entrenador Posicional: enrutado, modos de entrenamiento y progreso.
import { Tablero, Chess, lineaSan, uciASan } from "./tablero.js";
import { motor, aCp, textoEval } from "./motor.js";
import { aplicarResultado, estadoElo, eloEjercicio, multiplicador, problemaDelDia, marcarDiario, rachaDiariaVigente, estadoDiario, hoy, CALIBRACION } from "./elo.js";
import { rankingActivo, jugador, nombreValido, enviarElo, tabla, MINIMO, enviarPuntos, buscarClubes, clubPorId, rankingClubes, miembrosClub, crearClub, unirseClub, borrarJugador } from "./ranking.js";

// Súbela a la vez que versionName en movil/android/app/build.gradle.
const VERSION_APP = "1.2.0";
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
        <h2>Nivel de los ejercicios</h2>
        <p class="meta">Tu Elo no cambia al elegir nivel: solo cambia resolviendo. Con un nivel más fácil ganas menos puntos por acierto.</p>
        <div class="tarjetas niveles" id="t-niveles">${tarjetasNiveles(tramoActual().id)}</div>
      </section>
      <section class="panel">
        <h2>Club</h2>
        <p class="meta">Únete a tu club para sumar puntos en el ranking de clubes.</p>
        <a class="boton principal" href="#/ranking/clubes">${p.club ? `Tu club: ${h(p.club.nombre)}` : "Buscar mi club"}</a>
      </section>
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
      <section class="panel">
        <h2>Empezar de cero</h2>
        <p class="meta">Borra tu Elo, tus ejercicios hechos y tu puesto en el ranking, y vuelve a la bienvenida. Los colores y el tablero se conservan. No se puede deshacer.</p>
        <button class="boton peligro" id="de-cero">Empezar de cero</button> <span id="de-cero-estado" class="meta"></span>
      </section>
      <p class="meta version">Versión ${VERSION_APP}</p>
    </div>`;
  activarNiveles(document.getElementById("t-niveles"));
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
  { id: "principiante", texto: "Principiante", nota: "Hasta 1400", min: 0, max: 1400 },
  { id: "aficionado", texto: "Aficionado", nota: "1400–1900", min: 1400, max: 1900 },
  { id: "club", texto: "Club", nota: "1900–2300", min: 1900, max: 2300 },
  { id: "maestro", texto: "Maestro", nota: "2300 o más", min: 2300, max: 9999 },
];
const tramoActual = () => TRAMOS.find((t) => t.id === (leerProgreso().tramo || "auto")) || TRAMOS[0];
const FIJOS = TRAMOS.filter((t) => t.max);
const tramoDeElo = (elo) => FIJOS.find((t) => elo >= t.min && elo < t.max) || FIJOS[FIJOS.length - 1];

function tarjetasNiveles(actual) {
  return TRAMOS.map((t) => {
    const n = t.max ? POSICIONES.filter((p) => eloEjercicio(p) >= t.min && eloEjercicio(p) < t.max).length : POSICIONES.length;
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
      <h2 class="titulo-seccion">Nivel de los ejercicios</h2>
      <div class="tarjetas niveles" id="niveles">${tarjetasNiveles(t.id)}</div>
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
  activarNiveles(document.getElementById("niveles"));
}

// ---------- Ranking (jugadores y clubes) ----------
const COLORES_CLUB = ["#8a5a2b", "#b03a2e", "#2f7d4f", "#1f5fa8", "#6a4fb3", "#0e7c8c", "#c46a1a", "#2b2622"];
const PALABRAS_VACIAS = new Set(["club", "de", "del", "la", "el", "los", "las", "y", "ajedrez", "c.a.", "ca", "cda", "a.d.", "ad", "sociedad", "escuela", "círculo", "circulo", "chess"]);
function iniciales(nombre) {
  const p = nombre.split(/\s+/).filter((x) => x && !PALABRAS_VACIAS.has(x.toLowerCase()));
  return ((p.length ? p : nombre.split(/\s+/)).slice(0, 3).map((x) => x[0]).join("") || "?").toUpperCase();
}
// Escudo automático: forma de escudo con el color del club y sus iniciales.
function escudo(club, tam = 40) {
  const ini = iniciales(club.nombre);
  const fs = ini.length >= 3 ? 30 : 38;
  return `<svg class="escudo" width="${tam}" height="${Math.round(tam * 1.15)}" viewBox="0 0 100 115" aria-hidden="true">
    <path d="M50 3 L95 18 V55 C95 85 72 104 50 112 C28 104 5 85 5 55 V18 Z" fill="${h(club.color || "#8a5a2b")}" stroke="rgba(0,0,0,.25)" stroke-width="3"/>
    <path d="M50 12 L86 24 V55 C86 79 68 95 50 102 C32 95 14 79 14 55 V24 Z" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="2.5"/>
    <text x="50" y="66" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="800" font-size="${fs}" fill="#fff">${h(ini)}</text></svg>`;
}

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
      // Refresca nombre, color y miembros del club por si han cambiado.
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
      <p class="meta">Busca tu club por nombre o ciudad y únete para sumar puntos con tus compañeros.</p>
      <input id="buscar-club" class="campo-nombre" placeholder="Ej. Murcia, Club Ajedrez…" autocomplete="off">
      <div id="resultados-club"></div>
      <details class="desplegable" id="nuevo-club">
        <summary>¿No está tu club? Añádelo</summary>
        <div class="desplegable-cuerpo">
          <form id="form-club" class="form-club">
            <label>Nombre del club <input id="club-nombre" maxlength="60" required placeholder="Ej. Club de Ajedrez Ejemplo"></label>
            <label>Ciudad <input id="club-ciudad" maxlength="40" required placeholder="Ej. Murcia"></label>
            <span>Color del escudo</span>
            <div class="colores-club">${COLORES_CLUB.map((c, i) => `<button type="button" data-color="${c}" class="${i ? "" : "elegido"}" style="background:${c}" aria-label="Color ${c}"></button>`).join("")}</div>
            <div class="vista-escudo" id="vista-escudo"></div>
            <button class="boton principal">Crear club y unirme</button>
            <span id="crear-estado" class="meta"></span>
          </form>
        </div>
      </details>`;
  }
  function activarBuscador() {
    const input = document.getElementById("buscar-club");
    const res = document.getElementById("resultados-club");
    let espera, color = COLORES_CLUB[0];
    input.oninput = () => {
      clearTimeout(espera);
      const texto = input.value.trim();
      if (texto.length < 2) { res.innerHTML = ""; return; }
      espera = setTimeout(async () => {
        try {
          const filas = await buscarClubes(texto);
          if (gen !== generacion || input.value.trim() !== texto) return;
          res.innerHTML = filas.length ? filas.map((c) => `
            <div class="club-resultado">${escudo(c, 34)}
              <span><b>${h(c.nombre)}</b><small>${h(c.ciudad)} · ${c.miembros} miembro${c.miembros === 1 ? "" : "s"}</small></span>
              <button class="boton principal" data-club="${c.id}">Unirme</button></div>`).join("")
            : `<p class="meta">No hay ningún club con ese nombre. Puedes añadirlo abajo.</p>`;
          res.querySelectorAll("[data-club]").forEach((b) => {
            b.onclick = async () => {
              b.disabled = true;
              try {
                await unirseClub(leerProgreso(), estadoElo(leerProgreso()), b.dataset.club);
                const p = leerProgreso(); p.club = filas.find((c) => c.id === b.dataset.club); guardarProgreso(p);
                pintarClubes();
              } catch (err) { b.disabled = false; b.insertAdjacentHTML("afterend", `<small class="error">${h(err.message)}</small>`); }
            };
          });
        } catch { res.innerHTML = `<p class="meta">Sin conexión.</p>`; }
      }, 300);
    };
    const nombre = document.getElementById("club-nombre"), ciudad = document.getElementById("club-ciudad");
    const vista = () => { document.getElementById("vista-escudo").innerHTML = escudo({ nombre: nombre.value || "Mi Club", color }, 56); };
    nombre.oninput = vista;
    vista();
    document.querySelectorAll(".colores-club button").forEach((b) => {
      b.onclick = () => {
        color = b.dataset.color;
        document.querySelectorAll(".colores-club button").forEach((x) => x.classList.toggle("elegido", x === b));
        vista();
      };
    });
    document.getElementById("form-club").onsubmit = async (ev) => {
      ev.preventDefault();
      const est = document.getElementById("crear-estado");
      const n = nombre.value.trim(), c = ciudad.value.trim();
      if (n.length < 3 || c.length < 2) { est.textContent = "Escribe el nombre (3 letras o más) y la ciudad."; return; }
      est.textContent = "Creando…";
      try {
        const id = await crearClub(leerProgreso(), estadoElo(leerProgreso()), n, c, color);
        const p = leerProgreso(); p.club = { id, nombre: n, ciudad: c, color, miembros: 1 }; guardarProgreso(p);
        pintarClubes();
      } catch (err) {
        est.textContent = /duplicate|unique|clubes_unico/.test(err.message) ? "Ese club ya existe en esa ciudad: búscalo arriba." : err.message;
      }
    };
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
