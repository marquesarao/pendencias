// Sincronização com a planilha (Apps Script /exec): envia a outbox, depois recebe as linhas
// alteradas no servidor desde o último pull (servidorEm > lastSync) e aplica por last-write-wins.
// URL e token ficam só no localStorage deste aparelho — nunca em arquivos do projeto.

import * as db from './db.js';
import * as store from './store.js';

const CHAVE_URL = 'pend.url';
const CHAVE_TOKEN = 'pend.token';
const LOTE = 200;
const ESPERA_EDICAO_MS = 2000;
const INTERVALO_MS = 60_000;
const TEMPO_LIMITE_MS = 30_000;
const URL_VALIDA = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

export const estado = {
  status: 'local',   // local | ok | pendente | sincronizando | offline | erro
  emAndamento: false,
  lastSync: 0,       // serverTime do último pull (cursor)
  ultimaSyncEm: 0,   // relógio local da última sincronização completa (para exibir)
  ultimoErro: '',
};

const ouvintes = new Set();
export const aoMudarStatus = fn => ouvintes.add(fn);

let repetir = false;
let timerEdicao;

// ---------------------------------------------------------------------------
// Configuração (localStorage)
// ---------------------------------------------------------------------------

export function lerConfig() {
  try {
    return { url: localStorage.getItem(CHAVE_URL) || '', token: localStorage.getItem(CHAVE_TOKEN) || '' };
  } catch (_) {
    return { url: '', token: '' };
  }
}

export const configurado = () => { const c = lerConfig(); return !!(c.url && c.token); };
export const urlValida = url => URL_VALIDA.test(url);

/** Salva URL/token. Trocar de URL (outra planilha) zera o cursor: o próximo pull traz tudo. */
export async function salvarConfig({ url, token }) {
  const anterior = lerConfig();
  localStorage.setItem(CHAVE_URL, url);
  localStorage.setItem(CHAVE_TOKEN, token);
  if (anterior.url && anterior.url !== url) {
    estado.lastSync = 0;
    await db.gravarMeta('lastSync', 0);
  }
  estado.ultimoErro = '';
  atualizarStatus();
}

/** Depois de apagar os dados deste aparelho: esquece cursor, horário e erro (a fila já foi limpa). */
export function esquecerHistorico() {
  estado.lastSync = 0;
  estado.ultimaSyncEm = 0;
  estado.ultimoErro = '';
  atualizarStatus();
}

/**
 * Primeira conexão deste aparelho (ou troca de planilha) com dados locais nunca sincronizados?
 * Corrigir só o token de uma conexão existente não pergunta de novo.
 */
export function precisaConfirmarPrimeiraVez(url) {
  const atual = lerConfig();
  const primeiraVez = !configurado() && !estado.lastSync;
  const trocaDePlanilha = !!atual.url && atual.url !== url;
  return (primeiraVez || trocaDePlanilha) && store.totalLinhas() > 0;
}

// ---------------------------------------------------------------------------
// Formato de rede ↔ local
// ---------------------------------------------------------------------------

function paraRede(table, row) {
  if (table === 'pendencias') return { ...row, tags: row.tags.join(';') };
  return { ...row };
}

function daRede(table, r) {
  const row = { ...r };
  delete row.servidorEm;
  if (table === 'pendencias') {
    row.tags = String(r.tags || '').split(';').map(s => s.trim()).filter(Boolean);
    for (const b of ['foco', 'feito', 'aguardando']) row[b] = r[b] === true;
  }
  row.excluido = r.excluido === true;
  row.atualizadoEm = Number(r.atualizadoEm) || 0;
  row.ordem = Number(r.ordem) || 0;
  return row;
}

// ---------------------------------------------------------------------------
// Chamada ao Apps Script
// ---------------------------------------------------------------------------

async function chamar(corpo) {
  const { url, token } = lerConfig();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TEMPO_LIMITE_MS);
  let resp;
  try {
    // Corpo como string → Content-Type text/plain → sem preflight CORS.
    resp = await fetch(url, { method: 'POST', body: JSON.stringify({ token, ...corpo }), signal: ctrl.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('A planilha demorou demais para responder.');
    throw new Error(navigator.onLine ? 'Não foi possível falar com a planilha (rede ou URL).' : 'Sem conexão.');
  } finally {
    clearTimeout(timer);
  }
  const texto = await resp.text();
  let json;
  try {
    json = JSON.parse(texto);
  } catch (_) {
    throw new Error('Resposta inesperada da planilha. Confira se a URL termina em /exec e se o acesso está como "Qualquer pessoa".');
  }
  if (!json.ok) throw new Error(json.erro || 'Erro desconhecido na planilha.');
  return json;
}

// ---------------------------------------------------------------------------
// Ciclo de sincronização
// ---------------------------------------------------------------------------

async function enviar() {
  const fila = await store.lerOutbox();
  const errosOps = [];
  for (let i = 0; i < fila.length; i += LOTE) {
    const lote = fila.slice(i, i + LOTE);
    const resp = await chamar({ action: 'push', ops: lote.map(e => ({ table: e.table, row: paraRede(e.table, e.row) })) });
    const confirmadas = [];
    resp.results.forEach((r, j) => {
      const e = lote[j];
      if (r.status === 'aplicado' || r.status === 'ignorado') confirmadas.push({ key: e.key, atualizadoEm: e.row.atualizadoEm });
      else errosOps.push(r.erro || 'erro');
    });
    await store.confirmarEnvio(confirmadas);
  }
  // Uma op recusada não trava o resto: fica na fila e vira aviso, mas o pull acontece.
  return errosOps.length ? `${errosOps.length} alteração(ões) recusada(s) pela planilha: ${errosOps[0]}` : '';
}

async function receber() {
  const resp = await chamar({ action: 'pull', since: estado.lastSync || 0 });
  // Tags primeiro: as pendências se referem a elas.
  for (const table of ['tags', 'pendencias', 'observacoes']) {
    await store.aplicarRemoto(table, (resp[table] || []).map(r => daRede(table, r)));
  }
  estado.lastSync = resp.serverTime;
  await db.gravarMeta('lastSync', resp.serverTime);
}

/** Envia a fila e recebe as novidades. Pedidos durante uma execução são reagendados. */
export async function sincronizar() {
  clearTimeout(timerEdicao);
  if (!configurado()) return atualizarStatus();
  if (!navigator.onLine) return atualizarStatus();
  if (estado.emAndamento) { repetir = true; return; }

  estado.emAndamento = true;
  atualizarStatus();
  try {
    const recusadas = await enviar();
    await receber();
    estado.ultimoErro = recusadas;
    estado.ultimaSyncEm = Date.now();
    await db.gravarMeta('ultimaSyncEm', estado.ultimaSyncEm);
  } catch (err) {
    estado.ultimoErro = err && err.message ? err.message : String(err);
    console.error('[Pendências] Sincronização falhou:', err);
  } finally {
    estado.emAndamento = false;
    atualizarStatus();
    if (repetir) { repetir = false; sincronizar(); }
  }
}

function agendarEnvio() {
  atualizarStatus();
  clearTimeout(timerEdicao);
  timerEdicao = setTimeout(sincronizar, ESPERA_EDICAO_MS);
}

function atualizarStatus() {
  let s;
  if (estado.emAndamento) s = 'sincronizando';
  else if (!configurado()) s = 'local';
  else if (!navigator.onLine) s = 'offline';
  else if (estado.ultimoErro) s = 'erro';
  else if (store.qtdPendentes()) s = 'pendente';
  else s = 'ok';
  estado.status = s;
  ouvintes.forEach(fn => fn(estado));
}

/** Liga os gatilhos: abrir, edição (2 s), aba visível, online, a cada 60 s. */
export async function iniciarSync() {
  estado.lastSync = (await db.obterMeta('lastSync')) || 0;
  estado.ultimaSyncEm = (await db.obterMeta('ultimaSyncEm')) || 0;

  store.aoEditarLocal(agendarEnvio);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sincronizar(); });
  window.addEventListener('online', sincronizar);
  window.addEventListener('offline', atualizarStatus);
  setInterval(() => { if (!document.hidden) sincronizar(); }, INTERVALO_MS);

  atualizarStatus();
  sincronizar();
}
