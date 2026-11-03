// Rascunho do comentário de cada item, só neste aparelho (localStorage, chave por item).
// Gravado enquanto se digita (a cada 0,4 s) — sobrevive a o sistema fechar o app no meio de uma
// reunião. Não sincroniza: é anotação ainda não enviada.

const PREFIXO = 'pend.rascunho:';
const ESPERA_MS = 400;

const timers = new Map();   // id do item → timer
const pendentes = new Map(); // id do item → texto ainda não gravado

const chave = id => PREFIXO + id;

export function lerRascunho(id) {
  try { return localStorage.getItem(chave(id)) || ''; } catch (_) { return ''; }
}

/** Grava já (texto vazio apaga). */
export function gravarRascunho(id, texto) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  pendentes.delete(id);
  try {
    if (texto.trim()) localStorage.setItem(chave(id), texto);
    else localStorage.removeItem(chave(id));
  } catch (err) {
    console.error('[Pendências] Não foi possível guardar o rascunho:', err);
  }
}

/** Grava daqui a 0,4 s (cada tecla reinicia a espera). */
export function agendarRascunho(id, texto) {
  pendentes.set(id, texto);
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => gravarRascunho(id, texto), ESPERA_MS));
}

export const apagarRascunho = id => gravarRascunho(id, '');

export function gravarRascunhosPendentes() {
  for (const [id, texto] of [...pendentes]) gravarRascunho(id, texto);
}

export function idsComRascunho() {
  try {
    return Object.keys(localStorage).filter(k => k.startsWith(PREFIXO)).map(k => k.slice(PREFIXO.length));
  } catch (_) {
    return [];
  }
}

export function apagarTodosRascunhos() {
  for (const id of idsComRascunho()) gravarRascunho(id, '');
}

// App indo para segundo plano / sendo fechado: grava o que ainda estava na espera.
window.addEventListener('pagehide', gravarRascunhosPendentes);
document.addEventListener('visibilitychange', () => { if (document.hidden) gravarRascunhosPendentes(); });
