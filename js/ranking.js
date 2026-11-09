// Ranking online (Supabase). Sin configurar (js/config.js vacío) la app funciona igual, solo sin ranking.
// El esquema de la base de datos está en herramientas/ranking.sql.
import { RANKING } from "./config.js";

export const rankingActivo = () => Boolean(RANKING.url && RANKING.clave);
const MINIMO = 5; // ejercicios mínimos para aparecer en la tabla

function cabeceras() {
  return { apikey: RANKING.clave, Authorization: `Bearer ${RANKING.clave}`, "Content-Type": "application/json" };
}

function azarHex(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Identidad anónima del dispositivo: un id y una clave aleatorios (la clave impide que otro modifique tu fila).
export function jugador(prog) {
  if (!prog.jugador?.id) {
    const h = azarHex(16);
    prog.jugador = { id: `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`, clave: azarHex(24), nombre: "" };
  }
  return prog.jugador;
}

export const nombreValido = (s) => s.trim().length >= 1 && s.trim().length <= 24;

// Envía el Elo actual. Devuelve el puesto en el ranking (o null si no se pudo).
export async function enviarElo(prog, elo) {
  const j = jugador(prog);
  if (!rankingActivo() || !j.nombre) return null;
  try {
    const r = await fetch(`${RANKING.url}/rest/v1/rpc/guardar_jugador`, {
      method: "POST",
      headers: cabeceras(),
      body: JSON.stringify({ p_id: j.id, p_clave: j.clave, p_nombre: j.nombre, p_elo: elo.valor, p_ejercicios: elo.partidas, p_racha: elo.mejorRacha }),
    });
    if (!r.ok) return null;
    const puesto = await r.json();
    return typeof puesto === "number" ? puesto : null;
  } catch {
    return null;
  }
}

export async function tabla(limite = 50) {
  return leer(`ranking?select=id,nombre,elo,ejercicios,mejor_racha,club&order=elo.desc&limit=${limite}`);
}

// ---------- Clubes ----------
async function leer(ruta) {
  const r = await fetch(`${RANKING.url}/rest/v1/${ruta}`, { headers: cabeceras() });
  if (!r.ok) throw new Error(`${ruta.split("?")[0]} ${r.status}`);
  return r.json();
}
// Llama a una función del servidor con la identidad del jugador. Si falla, lanza el mensaje del servidor.
async function rpc(nombre, prog, datos = {}) {
  const j = jugador(prog);
  const r = await fetch(`${RANKING.url}/rest/v1/rpc/${nombre}`, {
    method: "POST", headers: cabeceras(), body: JSON.stringify({ p_id: j.id, p_clave: j.clave, ...datos }),
  });
  const texto = await r.text();
  if (!r.ok) {
    let msg = `Error ${r.status}`;
    try { msg = JSON.parse(texto).message || msg; } catch {}
    throw new Error(msg);
  }
  return texto ? JSON.parse(texto) : null;
}
// El jugador tiene que existir en el servidor antes de unirse a un club o sumar puntos.
async function asegurarJugador(prog, elo) {
  const j = jugador(prog);
  if (!j.nombre) j.nombre = "Jugador";
  if ((await enviarElo(prog, elo)) === null) throw new Error("No se pudo conectar con el servidor.");
}

const q = encodeURIComponent;
export const buscarClubes = (texto) =>
  leer(`clubes_lista?select=*&or=(nombre.ilike.*${q(texto)}*,ciudad.ilike.*${q(texto)}*)&order=miembros.desc&limit=20`);
export const listarClubes = () => leer("clubes_lista?select=*&order=nombre.asc&limit=1000");
export const clubPorId = async (id) => (await leer(`clubes_lista?select=*&id=eq.${q(id)}`))[0] || null;
export const rankingClubes = (periodo) => leer(`ranking_clubes_${periodo === "anio" ? "anio" : "mes"}?select=*&order=puntos.desc&limit=100`);
export const miembrosClub = (id) => leer(`miembros_club?select=*&club_id=eq.${q(id)}&order=puntos_mes.desc,elo.desc&limit=200`);

export async function crearClub(prog, elo, nombre, ciudad, color) {
  await asegurarJugador(prog, elo);
  return rpc("crear_club", prog, { p_nombre: nombre, p_ciudad: ciudad, p_color: color });
}
export async function unirseClub(prog, elo, club) {
  await asegurarJugador(prog, elo);
  return rpc("unirse_club", prog, { p_club: club });
}
export const borrarJugador = (prog) => rpc("borrar_jugador", prog);

// Clubes con administrador: pedir la entrada, ver el propio estado y, si eres administrador, aceptar o rechazar.
export async function solicitarClub(prog, elo, club) {
  await asegurarJugador(prog, elo);
  return rpc("solicitar_club", prog, { p_club: club });
}
export const cancelarSolicitud = (prog) => rpc("cancelar_solicitud", prog);
export const miClub = (prog) => rpc("mi_club", prog);
export async function pedirAdmin(prog, elo, club, mensaje) {
  await asegurarJugador(prog, elo);
  return rpc("pedir_admin", prog, { p_club: club, p_mensaje: mensaje });
}
export const solicitudesPendientes = (prog) => rpc("solicitudes_pendientes", prog);
export const resolverSolicitud = (prog, jugadorId, aceptar) => rpc("resolver_solicitud", prog, { p_jugador: jugadorId, p_aceptar: aceptar });
export const expulsarMiembro = (prog, jugadorId) => rpc("expulsar_miembro", prog, { p_jugador: jugadorId });
// Solo para el dueño de la app: peticiones para ser administrador de club.
export const peticionesAdmin = (prog) => rpc("peticiones_admin", prog);
export const resolverAdmin = (prog, club, jugadorId, aprobar) => rpc("resolver_admin", prog, { p_club: club, p_jugador: jugadorId, p_aprobar: aprobar });

// Envía los puntos pendientes (ejercicios resueltos por primera vez). Devuelve los que no se pudieron enviar.
export async function enviarPuntos(prog, pendientes) {
  if (!rankingActivo() || !jugador(prog).nombre) return pendientes;
  const quedan = [];
  for (const x of pendientes) {
    try { await rpc("sumar_puntos", prog, { p_ejercicio: x.ejercicio, p_puntos: x.puntos }); }
    catch (e) { if (!/límite|clave/.test(e.message)) quedan.push(x); }
  }
  return quedan;
}

export { MINIMO };
