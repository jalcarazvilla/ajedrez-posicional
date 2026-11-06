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
  const r = await fetch(`${RANKING.url}/rest/v1/ranking?select=id,nombre,elo,ejercicios,mejor_racha&order=elo.desc&limit=${limite}`, { headers: cabeceras() });
  if (!r.ok) throw new Error(`ranking ${r.status}`);
  return r.json();
}

export { MINIMO };
