// Puntuación global (Elo), racha de aciertos con multiplicador y problema del día.
// Todo vive en el mismo objeto de progreso de localStorage que el resto de la app.

export const ELO_INICIAL = 1500;
const K_NOVATO = 40;      // primeros ejercicios: el Elo se ajusta rápido
const K_NORMAL = 24;
const NOVATO = 20;
const ACIERTO = 0.7;      // a partir de este porcentaje el ejercicio cuenta como acierto para la racha
const PASO_MULT = 0.1;    // cada acierto seguido a partir del segundo suma +0.1 al multiplicador
const MULT_MAX = 2;

// Dificultad (1-3) de las posiciones antiguas -> Elo del ejercicio.
const ELO_POR_DIFICULTAD = { 1: 1600, 2: 1900, 3: 2200 };
export const eloEjercicio = (p) => p.elo || ELO_POR_DIFICULTAD[p.dificultad] || 1900;

export function estadoElo(prog) {
  return { valor: ELO_INICIAL, partidas: 0, racha: 0, mejorRacha: 0, maximo: ELO_INICIAL, historial: [], ...(prog.elo || {}) };
}

// Multiplicador que se aplicará al PRÓXIMO ejercicio: x1 con 0-1 aciertos seguidos, x1.1 tras dos, x1.2 tras tres...
export function multiplicador(racha) {
  return Math.min(MULT_MAX, 1 + PASO_MULT * Math.max(0, racha - 1));
}

// Aplica el resultado (puntuación 0-1) de un ejercicio de Elo `rival`. Solo el primer intento de cada
// ejercicio y modo cuenta: repetirlo es práctica y no da puntos (si no, bastaría con memorizar).
// Devuelve lo necesario para enseñar el cambio al alumno.
export function aplicarResultado(prog, rival, puntuacion) {
  const e = estadoElo(prog);
  const esperado = 1 / (1 + 10 ** ((rival - e.valor) / 400));
  const k = e.partidas < NOVATO ? K_NOVATO : K_NORMAL;
  const mult = multiplicador(e.racha);
  let delta = k * (puntuacion - esperado);
  if (delta > 0) delta *= mult; // el multiplicador premia, no castiga
  delta = Math.round(delta);
  const acierto = puntuacion >= ACIERTO;
  e.valor += delta;
  e.partidas += 1;
  e.racha = acierto ? e.racha + 1 : 0;
  e.mejorRacha = Math.max(e.mejorRacha, e.racha);
  e.maximo = Math.max(e.maximo, e.valor);
  e.historial = [...e.historial, [Date.now(), e.valor]].slice(-200);
  prog.elo = e;
  return { delta, valor: e.valor, racha: e.racha, mult, acierto, siguienteMult: multiplicador(e.racha) };
}

// ---------- Problema del día ----------
// Todos los usuarios ven el mismo problema sin necesidad de servidor: el día se convierte en un índice
// de una permutación fija de los ejercicios (no se repite ninguno hasta agotar la lista).
export const hoy = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const diaNumero = (iso) => Math.floor(Date.UTC(...iso.split("-").map((x, i) => +x - (i === 1 ? 1 : 0))) / 864e5);

function permutacion(n, semilla) {
  const a = [...Array(n).keys()];
  let s = semilla >>> 0;
  const azar = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 2 ** 32);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function problemaDelDia(lista, iso = hoy()) {
  if (!lista.length) return null;
  // Orden estable: por id, para que todos los dispositivos calculen lo mismo.
  const orden = [...lista].sort((a, b) => (a.id < b.id ? -1 : 1));
  const n = diaNumero(iso);
  const vuelta = Math.floor(n / orden.length);
  return orden[permutacion(orden.length, 20261105 + vuelta)[n % orden.length]];
}

// Racha de días seguidos resolviendo el problema del día.
export function estadoDiario(prog) {
  return { ultimo: null, racha: 0, mejor: 0, ...(prog.diario || {}) };
}
export function marcarDiario(prog, iso = hoy()) {
  const d = estadoDiario(prog);
  if (d.ultimo === iso) return d;
  const ayer = hoy(new Date(new Date(iso + "T12:00:00").getTime() - 864e5));
  d.racha = d.ultimo === ayer ? d.racha + 1 : 1;
  d.mejor = Math.max(d.mejor, d.racha);
  d.ultimo = iso;
  prog.diario = d;
  return d;
}
export function rachaDiariaVigente(prog, iso = hoy()) {
  const d = estadoDiario(prog);
  const ayer = hoy(new Date(new Date(iso + "T12:00:00").getTime() - 864e5));
  return d.ultimo === iso || d.ultimo === ayer ? d.racha : 0;
}
