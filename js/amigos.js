// Amigos: panel lateral (conectados, desconectados, solicitudes, añadir), enlaces de invitación,
// comparativa de progresión y «latido» para saber quién está conectado. Servidor: herramientas/amigos.sql.
import { rankingActivo, jugador, nombreValido, latido, misAmigos, buscarJugadores, verJugador, pedirAmistad, responderAmistad, quitarAmigo } from "./ranking.js";

const CONECTADO_MS = 3 * 60 * 1000; // visto en los últimos 3 minutos = conectado
const signo = (n) => (n > 0 ? `+${n}` : `${n}`);

export function crearAmigos(dep) {
  const { leerProgreso, guardarProgreso, estadoElo, h, icono, sincronizarRanking, alCambiar } = dep;
  let datos = null;        // última respuesta de mis_amigos
  let desfase = 0;         // diferencia entre el reloj del servidor y el del móvil
  let cargando = null;
  let fallo = false;       // la última carga no pudo conectar
  const cajon = document.getElementById("cajon-amigos");
  const fondo = document.getElementById("fondo-amigos");
  const boton = document.getElementById("boton-amigos");

  try { datos = JSON.parse(sessionStorage.getItem("amigos") || "null"); } catch {}

  const mostrarConexion = () => leerProgreso().ajustes?.ocultarConexion !== true;
  const tieneNombre = () => Boolean(leerProgreso().jugador?.nombre);
  const conectado = (a) => a.visto && Date.now() + desfase - new Date(a.visto).getTime() < CONECTADO_MS;

  function hace(visto) {
    if (!visto) return "Desconectado";
    const min = Math.max(1, Math.round((Date.now() + desfase - new Date(visto).getTime()) / 60000));
    if (min < 60) return `Hace ${min} min`;
    const horas = Math.round(min / 60);
    if (horas < 24) return `Hace ${horas} h`;
    const dias = Math.round(horas / 24);
    return dias === 1 ? "Ayer" : `Hace ${dias} días`;
  }

  async function cargar() {
    if (!rankingActivo() || !leerProgreso().jugador?.id) return null;
    if (cargando) return cargando;
    cargando = (async () => {
      try {
        const r = await misAmigos(leerProgreso());
        if (r && r.yo) {
          datos = r;
          desfase = new Date(r.ahora).getTime() - Date.now();
          try { sessionStorage.setItem("amigos", JSON.stringify(r)); } catch {}
        }
        fallo = false;
      } catch { fallo = true; /* sin conexión o jugador aún no registrado */ }
      cargando = null;
      pintarBoton();
      return datos;
    })();
    return cargando;
  }

  function pintarBoton() {
    if (!boton) return;
    const pend = datos?.recibidas?.length || 0;
    const online = (datos?.amigos || []).filter(conectado).length;
    boton.innerHTML = `${icono("amigos")}<span class="solo-escritorio">Amigos</span>` +
      (pend ? `<span class="insignia" title="Solicitudes de amistad">${pend}</span>` : online ? `<span class="punto-verde" title="${online} conectado${online > 1 ? "s" : ""}"></span>` : "");
    boton.setAttribute("aria-label", `Amigos${pend ? `, ${pend} solicitud${pend > 1 ? "es" : ""}` : ""}`);
  }

  // ---------- Latido ----------
  async function latir() {
    if (!rankingActivo() || !tieneNombre() || document.visibilityState !== "visible") return;
    try { await latido(leerProgreso(), mostrarConexion()); } catch { /* aún no está en el servidor */ }
  }

  // ---------- Panel lateral ----------
  function abrir() {
    cajon.hidden = false; fondo.hidden = false;
    requestAnimationFrame(() => { cajon.classList.add("abierto"); fondo.classList.add("abierto"); });
    document.body.classList.add("con-cajon");
    pintarCajon();
    cargar().then(() => { if (!cajon.hidden) pintarCajon(); });
  }
  function cerrar() {
    cajon.classList.remove("abierto"); fondo.classList.remove("abierto");
    document.body.classList.remove("con-cajon");
    setTimeout(() => { if (!cajon.classList.contains("abierto")) { cajon.hidden = true; fondo.hidden = true; } }, 250);
  }

  function filaAmigo(a) {
    const on = conectado(a);
    return `<li class="fila-amigo">
      <span class="avatar ${on ? "on" : ""}">${h((a.nombre || "?").slice(0, 1).toUpperCase())}</span>
      <span class="datos"><b>${h(a.nombre)}</b><small>${on ? "Conectado" : hace(a.visto)}${a.club ? ` · ${h(a.club)}` : ""}</small></span>
      <span class="cifras"><b>${a.elo}</b><small class="${a.semana > 0 ? "sube" : a.semana < 0 ? "baja" : ""}">${a.semana ? `${signo(a.semana)} sem.` : "= sem."}</small></span>
      <button class="mas" data-quitar="${a.id}" data-nombre="${h(a.nombre)}" title="Quitar amigo" aria-label="Quitar a ${h(a.nombre)}">×</button>
    </li>`;
  }

  function pintarCajon() {
    const cab = `<div class="cajon-cabecera"><h2>Amigos</h2><button class="cerrar" id="cerrar-amigos" aria-label="Cerrar">×</button></div>`;
    if (!rankingActivo()) {
      cajon.innerHTML = cab + `<p class="meta">Los amigos necesitan conexión con el servidor del ranking.</p>`;
      return activarCajon();
    }
    if (!tieneNombre()) {
      cajon.innerHTML = cab + `<p class="meta">Para añadir amigos necesitas un nombre o apodo, que es lo que verán ellos.</p>
        <form id="form-apodo" class="fila-form"><input id="apodo" maxlength="24" placeholder="Tu nombre o apodo" autocomplete="nickname">
        <button class="boton principal">Guardar</button></form><p class="meta" id="apodo-estado"></p>`;
      return activarCajon();
    }
    const d = datos || { amigos: [], recibidas: [], enviadas: [] };
    const on = d.amigos.filter(conectado), off = d.amigos.filter((a) => !conectado(a));
    cajon.innerHTML = cab + `
      <form id="form-buscar" class="fila-form" role="search">
        <input id="buscar-amigo" type="search" placeholder="Buscar por apodo" autocomplete="off" aria-label="Buscar jugadores por apodo">
      </form>
      <div id="resultados-amigos"></div>
      <button class="boton invitar" id="invitar">${icono("enlace")} Invitar con un enlace</button>
      ${d.recibidas.length ? `<h3 class="etiqueta-mayus">Solicitudes · ${d.recibidas.length}</h3>
        <ul class="lista-amigos">${d.recibidas.map((r) => `<li class="fila-amigo">
          <span class="avatar">${h(r.nombre.slice(0, 1).toUpperCase())}</span>
          <span class="datos"><b>${h(r.nombre)}</b><small>Elo ${r.elo} · ${r.ejercicios} ejercicios</small></span>
          <span class="acciones"><button class="boton principal mini" data-aceptar="${r.id}">Aceptar</button>
          <button class="boton mini" data-rechazar="${r.id}">No</button></span></li>`).join("")}</ul>` : ""}
      <details class="grupo-amigos" open><summary><span class="punto-verde"></span>Conectados <b>${on.length}</b></summary>
        ${on.length ? `<ul class="lista-amigos">${on.map(filaAmigo).join("")}</ul>` : `<p class="meta">Ningún amigo conectado ahora.</p>`}</details>
      <details class="grupo-amigos" open><summary><span class="punto-gris"></span>Desconectados <b>${off.length}</b></summary>
        ${off.length ? `<ul class="lista-amigos">${off.map(filaAmigo).join("")}</ul>` : `<p class="meta">${d.amigos.length ? "Todos tus amigos están conectados." : "Aún no tienes amigos. Búscalos por su apodo o envíales tu enlace."}</p>`}</details>
      ${d.enviadas.length ? `<details class="grupo-amigos"><summary>Solicitudes enviadas <b>${d.enviadas.length}</b></summary>
        <ul class="lista-amigos">${d.enviadas.map((r) => `<li class="fila-amigo"><span class="avatar">${h(r.nombre.slice(0, 1).toUpperCase())}</span>
          <span class="datos"><b>${h(r.nombre)}</b><small>Pendiente</small></span>
          <button class="boton mini" data-cancelar="${r.id}">Cancelar</button></li>`).join("")}</ul></details>` : ""}
      ${d.amigos.length ? `<a class="boton principal ancho" href="#/ranking/amigos" id="ir-comparativa">Ver la comparativa con tus amigos</a>` : ""}
      <label class="interruptor"><input type="checkbox" id="mostrar-conexion" ${mostrarConexion() ? "checked" : ""}>
        <span>Mostrar a mis amigos cuándo estoy conectado</span></label>
      ${datos ? "" : fallo ? `<p class="meta">No se pudo conectar con el servidor.</p>` : `<p class="pensando">Cargando…</p>`}`;
    activarCajon();
  }

  function activarCajon() {
    cajon.querySelector("#cerrar-amigos").onclick = cerrar;
    const fa = cajon.querySelector("#form-apodo");
    if (fa) fa.onsubmit = async (ev) => {
      ev.preventDefault();
      const v = cajon.querySelector("#apodo").value.trim();
      if (!nombreValido(v)) { cajon.querySelector("#apodo-estado").textContent = "Escribe al menos una letra (máximo 24)."; return; }
      const p = leerProgreso(); jugador(p).nombre = v; guardarProgreso(p);
      await sincronizarRanking(); await latir(); await cargar(); pintarCajon();
    };
    const fb = cajon.querySelector("#form-buscar");
    if (fb) {
      let t = 0;
      const inp = cajon.querySelector("#buscar-amigo");
      fb.onsubmit = (ev) => { ev.preventDefault(); buscar(inp.value); };
      inp.oninput = () => { clearTimeout(t); t = setTimeout(() => buscar(inp.value), 350); };
    }
    const inv = cajon.querySelector("#invitar");
    if (inv) inv.onclick = invitar;
    const mc = cajon.querySelector("#mostrar-conexion");
    if (mc) mc.onchange = async () => {
      const p = leerProgreso(); p.ajustes = { ...(p.ajustes || {}), ocultarConexion: !mc.checked }; guardarProgreso(p);
      try { await latido(leerProgreso(), mc.checked); } catch {}
    };
    const ic = cajon.querySelector("#ir-comparativa");
    if (ic) ic.onclick = cerrar;
    cajon.querySelectorAll("[data-aceptar],[data-rechazar]").forEach((b) => b.onclick = () =>
      accion(b, () => responderAmistad(leerProgreso(), b.dataset.aceptar || b.dataset.rechazar, Boolean(b.dataset.aceptar))));
    cajon.querySelectorAll("[data-cancelar]").forEach((b) => b.onclick = () => accion(b, () => quitarAmigo(leerProgreso(), b.dataset.cancelar)));
    cajon.querySelectorAll("[data-quitar]").forEach((b) => b.onclick = () => {
      if (confirm(`¿Quitar a ${b.dataset.nombre} de tus amigos?`)) accion(b, () => quitarAmigo(leerProgreso(), b.dataset.quitar));
    });
  }

  async function accion(b, f) {
    b.disabled = true;
    try { await f(); } catch (e) { alert(e.message || "No se pudo conectar."); }
    await cargar(); pintarCajon(); alCambiar?.();
  }

  async function buscar(texto) {
    const res = cajon.querySelector("#resultados-amigos");
    if (!res) return;
    texto = texto.trim();
    if (texto.length < 2) { res.innerHTML = ""; return; }
    res.innerHTML = `<p class="pensando">Buscando…</p>`;
    try {
      const filas = await buscarJugadores(leerProgreso(), texto);
      const d = datos || { amigos: [], recibidas: [], enviadas: [] };
      const estado = (id) => d.amigos.some((a) => a.id === id) ? "amigo" : d.enviadas.some((a) => a.id === id) ? "enviada"
        : d.recibidas.some((a) => a.id === id) ? "recibida" : "";
      res.innerHTML = filas.length ? `<ul class="lista-amigos resultados">${filas.map((f) => {
        const e = estado(f.id);
        return `<li class="fila-amigo"><span class="avatar">${h(f.nombre.slice(0, 1).toUpperCase())}</span>
          <span class="datos"><b>${h(f.nombre)}</b><small>Elo ${f.elo} · ${f.ejercicios} ejercicios${f.club ? ` · ${h(f.club)}` : ""}</small></span>
          ${e === "amigo" ? `<small class="meta">Amigo ✓</small>` : e === "enviada" ? `<small class="meta">Enviada</small>`
            : `<button class="boton principal mini" data-pedir="${f.id}">${e === "recibida" ? "Aceptar" : "Añadir"}</button>`}</li>`;
      }).join("")}</ul>` : `<p class="meta">No hay nadie con ese apodo.</p>`;
      res.querySelectorAll("[data-pedir]").forEach((b) => b.onclick = async () => {
        b.disabled = true;
        try {
          const r = await pedirAmistad(leerProgreso(), estadoElo(leerProgreso()), b.dataset.pedir);
          b.outerHTML = `<small class="meta">${r === "amigos" ? "Amigo ✓" : "Enviada ✓"}</small>`;
          await cargar(); alCambiar?.();
        } catch (e) { b.disabled = false; alert(e.message || "No se pudo conectar."); }
      });
    } catch {
      res.innerHTML = `<p class="meta">No se pudo buscar (¿sin conexión?).</p>`;
    }
  }

  async function invitar() {
    const p = leerProgreso();
    await sincronizarRanking();
    const url = `${location.origin}${location.pathname}#/amigo/${jugador(p).id}`;
    const texto = `Añádeme como amigo en Ajedrez: Entrenador Posicional (${jugador(p).nombre}).`;
    try {
      if (navigator.share) { await navigator.share({ title: "Entrenador Posicional", text: texto, url }); return; }
    } catch { return; }
    try { await navigator.clipboard.writeText(`${texto} ${url}`); alert("Enlace copiado. Pégalo en WhatsApp o donde quieras."); }
    catch { prompt("Copia este enlace:", url); }
  }

  // ---------- Pantalla de un enlace de invitación (#/amigo/<id>) ----------
  async function vistaAmigo(app, id, gen, generacionActual) {
    app.innerHTML = `<section class="panel invitacion"><p class="pensando">Cargando…</p></section>`;
    const caja = app.querySelector(".invitacion");
    if (!rankingActivo()) { caja.innerHTML = `<p>Los amigos necesitan conexión con el servidor.</p>`; return; }
    if (!tieneNombre()) {
      caja.innerHTML = `<h1>Invitación de amistad</h1><p class="meta">Antes de aceptar, elige tu nombre o apodo.</p>
        <form id="form-apodo-inv" class="fila-form"><input id="apodo-inv" maxlength="24" placeholder="Tu nombre o apodo" autocomplete="nickname">
        <button class="boton principal">Continuar</button></form>`;
      caja.querySelector("#form-apodo-inv").onsubmit = async (ev) => {
        ev.preventDefault();
        const v = caja.querySelector("#apodo-inv").value.trim();
        if (!nombreValido(v)) return;
        const p = leerProgreso(); jugador(p).nombre = v; guardarProgreso(p);
        await sincronizarRanking();
        vistaAmigo(app, id, gen, generacionActual);
      };
      return;
    }
    try {
      await sincronizarRanking();
      const j = await verJugador(leerProgreso(), id);
      if (gen !== generacionActual()) return;
      if (!j) { caja.innerHTML = `<h1>Jugador no encontrado</h1><p class="meta">Puede que haya borrado su cuenta.</p>`; return; }
      const yo = j.id === leerProgreso().jugador?.id;
      caja.innerHTML = `<span class="etiqueta-mayus">Invitación de amistad</span>
        <div class="tarjeta-jugador"><span class="avatar grande">${h(j.nombre.slice(0, 1).toUpperCase())}</span>
          <div><h1>${h(j.nombre)}</h1><p class="meta">Elo ${j.elo} · ${j.ejercicios} ejercicios${j.club ? ` · ${h(j.club)}` : ""}</p></div></div>
        <div id="inv-accion">${yo ? `<p class="meta">Este es tu propio enlace. Envíaselo a tus amigos para que te añadan.</p>`
          : j.estado === "amigo" ? `<p>Ya sois amigos ✓</p>`
          : j.estado === "enviada" ? `<p class="meta">Ya le has enviado una solicitud.</p>`
          : `<button class="boton principal" id="inv-pedir">${j.estado === "recibida" ? "Aceptar su solicitud" : "Añadir como amigo"}</button>`}</div>`;
      const b = caja.querySelector("#inv-pedir");
      if (b) b.onclick = async () => {
        b.disabled = true;
        try {
          const r = await pedirAmistad(leerProgreso(), estadoElo(leerProgreso()), id);
          caja.querySelector("#inv-accion").innerHTML = r === "amigos" ? `<p>¡Ya sois amigos! ✓</p>` : `<p>Solicitud enviada ✓ Cuando la acepte, aparecerá en tu lista.</p>`;
          await cargar(); alCambiar?.();
        } catch (e) { b.disabled = false; alert(e.message || "No se pudo conectar."); }
      };
    } catch {
      caja.innerHTML = `<p>No se pudo cargar la invitación (¿sin conexión?).</p>`;
    }
  }

  // ---------- Comparativa ----------
  const METRICAS = {
    semana: { texto: "Esta semana", clave: "semana", frase: "en progresión esta semana", fmt: signo },
    mes: { texto: "Este mes", clave: "mes", frase: "en progresión este mes", fmt: signo },
    puntos: { texto: "Puntos del mes", clave: "puntos_mes", frase: "en puntos este mes", fmt: String },
    elo: { texto: "Elo", clave: "elo", frase: "en Elo", fmt: String },
  };
  function clasificar(d, metrica) {
    const m = METRICAS[metrica];
    const todos = [{ ...d.yo, yo: true }, ...d.amigos];
    todos.sort((a, b) => (b[m.clave] ?? 0) - (a[m.clave] ?? 0) || b.elo - a.elo);
    return { todos, puesto: todos.findIndex((x) => x.yo) + 1, m };
  }

  async function pintarComparativa(cont, metrica, gen, generacionActual) {
    if (!datos) cont.innerHTML = `<p class="pensando">Cargando…</p>`;
    else dibujar();
    await cargar();
    if (gen !== generacionActual()) return;
    dibujar();
    function dibujar() {
      if (!datos && fallo && tieneNombre()) { cont.innerHTML = `<div class="aviso">No se pudo cargar a tus amigos (¿sin conexión?).</div>`; return; }
      if (!tieneNombre() || !datos) {
        cont.innerHTML = `<div class="aviso">Elige un apodo y añade amigos para compararte con ellos.</div>
          <button class="boton principal" data-abrir-amigos>Añadir amigos</button>`;
        return;
      }
      if (!datos.amigos.length) {
        cont.innerHTML = `<p class="meta">Aún no tienes amigos. Añádelos y aquí verás quién progresa más cada semana y cada mes.</p>
          <button class="boton principal" data-abrir-amigos>Añadir amigos</button>`;
        return;
      }
      const { todos, puesto, m } = clasificar(datos, metrica);
      cont.innerHTML = `
        <div class="segmentado" role="tablist">${Object.entries(METRICAS).map(([k, x]) =>
          `<button role="tab" class="${k === metrica ? "activo" : ""}" data-metrica="${k}">${x.texto}</button>`).join("")}</div>
        <p class="resumen-amigos">${puesto === 1 ? "🏆 " : ""}Estás en el puesto <b>${puesto}</b> de ${todos.length} ${m.frase}.</p>
        <table class="lista comparativa">
          <thead><tr><th>#</th><th>Jugador</th><th>${h(m.texto)}</th><th class="ocultar-movil">Elo</th><th class="ocultar-movil">Puntos del mes</th></tr></thead>
          <tbody>${todos.map((x, i) => `<tr class="${x.yo ? "yo" : ""}">
            <td>${i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</td>
            <td><span class="punto-${!x.yo && conectado(x) ? "verde" : "nada"}"></span>${h(x.nombre)}${x.yo ? " (tú)" : ""}</td>
            <td><b class="${metrica !== "elo" && metrica !== "puntos" ? (x[m.clave] > 0 ? "sube" : x[m.clave] < 0 ? "baja" : "") : ""}">${m.fmt(x[m.clave] ?? 0)}</b></td>
            <td class="ocultar-movil">${x.elo}</td><td class="ocultar-movil">${x.puntos_mes ?? 0}</td></tr>`).join("")}
          </tbody></table>
        <p class="meta">La progresión es tu Elo de hoy menos el de hace 7 o 30 días. Cuenta desde que empezasteis a usar los amigos.</p>`;
      cont.querySelectorAll("[data-metrica]").forEach((b) => b.onclick = () => { metrica = b.dataset.metrica; dibujar(); });
    }
  }

  // Línea de la portada: tu puesto entre tus amigos esta semana.
  async function resumenPortada(el) {
    if (!el || !rankingActivo()) return;
    const pintar = () => {
      if (!datos || !tieneNombre()) {
        el.innerHTML = `<span>${icono("amigos")} Compárate con tus amigos</span><button class="boton mini" data-abrir-amigos>Añadir amigos</button>`;
        return;
      }
      if (!datos.amigos.length) {
        el.innerHTML = `<span>${icono("amigos")} Añade amigos y mira quién progresa más</span><button class="boton mini" data-abrir-amigos>Añadir</button>`;
        return;
      }
      const { todos, puesto } = clasificar(datos, "semana");
      const on = datos.amigos.filter(conectado).length;
      el.innerHTML = `<a href="#/ranking/amigos">${icono("amigos")} <span>${puesto === 1 ? "🏆 " : ""}Puesto <b>${puesto}</b> de ${todos.length} entre tus amigos esta semana</span></a>
        <button class="boton mini" data-abrir-amigos>${on ? `<span class="punto-verde"></span>${on} conectado${on > 1 ? "s" : ""}` : "Amigos"}</button>`;
    };
    pintar();
    await cargar();
    if (el.isConnected) pintar();
  }

  // ---------- Arranque ----------
  if (boton) boton.onclick = () => (cajon.classList.contains("abierto") ? cerrar() : abrir());
  fondo.onclick = cerrar;
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && cajon.classList.contains("abierto")) cerrar(); });
  document.addEventListener("click", (ev) => { if (ev.target.closest("[data-abrir-amigos]")) { ev.preventDefault(); abrir(); } });
  pintarBoton();
  if (rankingActivo()) {
    latir().then(cargar);
    setInterval(latir, 60 * 1000);
    setInterval(() => { if (document.visibilityState === "visible") cargar().then(() => { if (cajon.classList.contains("abierto")) pintarCajon(); }); }, 90 * 1000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") latir().then(cargar); });
  }

  return { abrir, cerrar, cargar, vistaAmigo, pintarComparativa, resumenPortada };
}
