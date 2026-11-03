// Estado do domínio em memória + persistência no IndexedDB.
// Toda ação altera a memória na hora, avisa a interface e grava (linha + outbox) em segundo plano.

import * as db from './db.js';
import { uuid, normalizar } from './util.js';

export const TABELAS = ['pendencias', 'observacoes', 'tags', 'comentarios'];
export const CORES = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'];

export const dados = {
  pendencias: new Map(),
  observacoes: new Map(),
  tags: new Map(),
  comentarios: new Map(),
};

// Limite de caracteres de uma célula do Google Sheets (o Code.gs recusa acima disso).
export const MAX_COMENTARIO = 50000;

// Espelho em memória da outbox: chave "tabela:id" → atualizadoEm da versão na fila.
const pendentes = new Map();

const ouvintes = new Set();
const ouvintesLocais = new Set();
let aoFalhar = () => {};

export const aoMudar = fn => ouvintes.add(fn);
// Só edições feitas neste aparelho (não as que chegam da planilha): disparam o envio.
export const aoEditarLocal = fn => ouvintesLocais.add(fn);
export const aoFalharGravacao = fn => { aoFalhar = fn; };
const avisar = () => ouvintes.forEach(fn => fn());

export async function carregar() {
  for (const t of TABELAS) {
    const linhas = await db.todos(t);
    dados[t] = new Map(linhas.map(l => [l.id, l]));
  }
  pendentes.clear();
  for (const e of await db.todos('outbox')) pendentes.set(e.key, e.row.atualizadoEm);
}

export const qtdPendentes = () => pendentes.size;
const chave = (table, id) => `${table}:${id}`;

// Grava as linhas e as enfileira na outbox (uma entrada por linha: a foto mais recente).
function persistir(alteracoes) {
  const pares = [];
  for (const [table, row] of alteracoes) {
    pares.push([table, row]);
    pares.push(['outbox', { key: chave(table, row.id), table, row }]);
    pendentes.set(chave(table, row.id), row.atualizadoEm);
  }
  db.gravar(pares).catch(aoFalhar);
  avisar();
  ouvintesLocais.forEach(fn => fn());
}

// ---------------------------------------------------------------------------
// Sincronização (usado por sync.js)
// ---------------------------------------------------------------------------

export const lerOutbox = () => db.todos('outbox');

// O servidor confirmou estas versões: sai da fila o que não mudou desde o envio.
export async function confirmarEnvio(confirmadas) {
  const removidas = await db.removerDaOutbox(confirmadas);
  for (const k of removidas) pendentes.delete(k);
  if (removidas.length) avisar();
}

/**
 * Aplica linhas vindas da planilha por last-write-wins (atualizadoEm).
 * Vence a remota se não há local ou se remota.atualizadoEm >= local.atualizadoEm — exceto
 * quando há na fila uma versão local MAIS NOVA que a remota (ela sobe no próximo envio).
 * Uma entrada da fila superada pela remota é descartada.
 * @returns {Promise<number>} quantas linhas mudaram aqui
 */
export async function aplicarRemoto(table, linhas) {
  const pares = [];
  const descartar = [];
  for (const remota of linhas) {
    const k = chave(table, remota.id);
    const naFila = pendentes.get(k);
    if (naFila !== undefined && naFila > remota.atualizadoEm) continue;
    const local = dados[table].get(remota.id);
    if (local && local.atualizadoEm > remota.atualizadoEm) continue;
    if (naFila !== undefined) { descartar.push(k); pendentes.delete(k); }
    dados[table].set(remota.id, remota);
    pares.push([table, remota]);
  }
  if (pares.length) await db.gravar(pares);
  await db.descartarDaOutbox(descartar);
  if (pares.length) avisar();
  return pares.length;
}

export function totalLinhas() {
  return TABELAS.reduce((n, t) => n + dados[t].size, 0);
}

// Põe todas as linhas locais na fila (primeira conexão com uma planilha: "Enviar para a planilha").
export async function enfileirarTudo() {
  const pares = [];
  for (const t of TABELAS) {
    for (const row of dados[t].values()) {
      pares.push(['outbox', { key: chave(t, row.id), table: t, row }]);
      pendentes.set(chave(t, row.id), row.atualizadoEm);
    }
  }
  if (pares.length) await db.gravar(pares);
  avisar();
}

// Apaga tudo deste aparelho (tabelas, fila e lastSync). URL/token e preferências ficam.
export async function apagarTudo() {
  await db.limparTudo();
  for (const t of TABELAS) dados[t].clear();
  pendentes.clear();
  avisar();
}

// atualizadoEm só cresce, mesmo que o relógio do aparelho esteja atrasado.
const carimbo = anterior => Math.max(Date.now(), (anterior || 0) + 1);

function alterar(table, id, patch) {
  const atual = dados[table].get(id);
  if (!atual) return null;
  const novo = { ...atual, ...patch, atualizadoEm: carimbo(atual.atualizadoEm) };
  dados[table].set(id, novo);
  return novo;
}

function inserir(table, row) {
  dados[table].set(row.id, row);
  return row;
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

const porOrdem = (a, b) => a.ordem - b.ordem;

export function tagsAtivas() {
  return [...dados.tags.values()].filter(t => !t.excluido).sort(porOrdem);
}

export function tagAtiva(id) {
  const t = dados.tags.get(id);
  return t && !t.excluido ? t : null;
}

export function pendenciasAtivas() {
  return [...dados.pendencias.values()].filter(p => !p.excluido).sort(porOrdem);
}

// Tags do item que ainda existem, na ordem em que foram marcadas.
export function tagsDe(p) {
  return p.tags.map(tagAtiva).filter(Boolean);
}

export function observacoesDe(pendenciaId) {
  return [...dados.observacoes.values()]
    .filter(o => o.pendenciaId === pendenciaId && !o.excluido)
    .sort(porOrdem);
}

// Comentários do item, do mais recente para o mais antigo (sem excluídos).
export function comentariosDe(pendenciaId) {
  return [...dados.comentarios.values()]
    .filter(c => c.pendenciaId === pendenciaId && !c.excluido)
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}

export function buscarTagPorNome(nome) {
  const alvo = normalizar(nome);
  return tagsAtivas().find(t => normalizar(t.nome) === alvo) || null;
}

// ---------------------------------------------------------------------------
// Pendências
// ---------------------------------------------------------------------------

export function criarPendencia({ titulo, tags = [], aguardando = false }) {
  const abertas = pendenciasAtivas();
  const ordem = abertas.length ? abertas[0].ordem - 1000 : 0; // novos itens no topo
  const agora = Date.now();
  const iso = new Date(agora).toISOString();
  const p = inserir('pendencias', {
    id: uuid(), titulo, tags, foco: false, feito: false, feitoEm: '', prazo: '',
    aguardando, aguardandoEm: aguardando ? iso : '', ordem, criadoEm: iso,
    atualizadoEm: agora, excluido: false,
  });
  persistir([['pendencias', p]]);
  return p;
}

export function editarPendencia(id, patch) {
  const p = alterar('pendencias', id, patch);
  if (p) persistir([['pendencias', p]]);
  return p;
}

// Ligar "aguardando" grava desde quando; desligar limpa.
export function alternarAguardando(id) {
  const p = dados.pendencias.get(id);
  if (!p) return null;
  return editarPendencia(id, p.aguardando
    ? { aguardando: false, aguardandoEm: '' }
    : { aguardando: true, aguardandoEm: new Date().toISOString() });
}

export function alternarFeito(id) {
  const p = dados.pendencias.get(id);
  if (!p) return null;
  return editarPendencia(id, p.feito
    ? { feito: false, feitoEm: '' }
    : { feito: true, feitoEm: new Date().toISOString(), foco: false });
}

export function alternarFoco(id) {
  const p = dados.pendencias.get(id);
  if (!p || p.feito) return null;
  return editarPendencia(id, { foco: !p.foco });
}

export function excluirPendencia(id) {
  return editarPendencia(id, { excluido: true });
}

/**
 * Move um item para entre `antes` e `depois` (ids vizinhos na zona, ou null nas pontas).
 * Grava só a linha movida; renumera a zona inteira se o espaço entre vizinhos acabar.
 */
export function moverPendencia(id, antesId, depoisId, zonaIds) {
  const antes = antesId && dados.pendencias.get(antesId);
  const depois = depoisId && dados.pendencias.get(depoisId);
  let ordem;
  if (antes && depois) ordem = (antes.ordem + depois.ordem) / 2;
  else if (antes) ordem = antes.ordem + 1000;
  else if (depois) ordem = depois.ordem - 1000;
  else return;

  const apertado = antes && depois && Math.abs(depois.ordem - antes.ordem) < 1e-6;
  if (!apertado) {
    editarPendencia(id, { ordem });
    return;
  }
  // Renumera a zona na nova sequência (raro).
  const base = Math.min(...zonaIds.map(z => dados.pendencias.get(z).ordem));
  const alteradas = zonaIds.map((zid, i) => ['pendencias', alterar('pendencias', zid, { ordem: base + i * 1000 })]);
  persistir(alteradas);
}

// ---------------------------------------------------------------------------
// Observações
// ---------------------------------------------------------------------------

export function criarObservacao(pendenciaId, { tipo, texto }) {
  const existentes = observacoesDe(pendenciaId);
  const ordem = existentes.length ? existentes[existentes.length - 1].ordem + 1 : 0;
  const agora = Date.now();
  const o = inserir('observacoes', {
    id: uuid(), pendenciaId, data: new Date(agora).toISOString(), tipo, texto, ordem,
    atualizadoEm: agora, excluido: false,
  });
  persistir([['observacoes', o]]);
  return o;
}

export function alternarObservacao(id) {
  const o = dados.observacoes.get(id);
  if (!o) return null;
  const novo = alterar('observacoes', id, { tipo: o.tipo === 'ok' ? 'falta' : 'ok' });
  persistir([['observacoes', novo]]);
  return novo;
}

export function editarObservacao(id, texto) {
  const novo = alterar('observacoes', id, { texto });
  if (novo) persistir([['observacoes', novo]]);
  return novo;
}

/**
 * Move uma etapa para entre `antes` e `depois` (ids vizinhos, ou null nas pontas).
 * Grava só a etapa movida; renumera as etapas do item se o espaço entre vizinhas acabar.
 * @param {string[]} ordemIds todas as etapas do item, já na ordem nova
 */
export function moverObservacao(id, antesId, depoisId, ordemIds) {
  const antes = antesId && dados.observacoes.get(antesId);
  const depois = depoisId && dados.observacoes.get(depoisId);
  let ordem;
  if (antes && depois) ordem = (antes.ordem + depois.ordem) / 2;
  else if (antes) ordem = antes.ordem + 1;
  else if (depois) ordem = depois.ordem - 1;
  else return;

  if (!(antes && depois && Math.abs(depois.ordem - antes.ordem) < 1e-6)) {
    persistir([['observacoes', alterar('observacoes', id, { ordem })]]);
    return;
  }
  persistir(ordemIds.map((oid, i) => ['observacoes', alterar('observacoes', oid, { ordem: i })]));
}

export function excluirObservacao(id, excluido = true) {
  const novo = alterar('observacoes', id, { excluido });
  if (novo) persistir([['observacoes', novo]]);
  return novo;
}

// ---------------------------------------------------------------------------
// Comentários (registro de reunião/conversa). criadoEm nunca muda; editadoEm só muda quando o
// texto muda de fato (excluir/desfazer não conta como edição).
// ---------------------------------------------------------------------------

export function criarComentario(pendenciaId, texto) {
  const agora = Date.now();
  const c = inserir('comentarios', {
    id: uuid(), pendenciaId, criadoEm: new Date(agora).toISOString(), texto, editadoEm: '',
    atualizadoEm: agora, excluido: false,
  });
  persistir([['comentarios', c]]);
  return c;
}

export function editarComentario(id, texto) {
  const atual = dados.comentarios.get(id);
  if (!atual || atual.texto === texto) return atual || null;
  const novo = alterar('comentarios', id, { texto, editadoEm: new Date().toISOString() });
  persistir([['comentarios', novo]]);
  return novo;
}

export function excluirComentario(id, excluido = true) {
  const novo = alterar('comentarios', id, { excluido });
  if (novo) persistir([['comentarios', novo]]);
  return novo;
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export function criarTag(nome) {
  const limpo = nome.trim();
  if (!limpo) return { erro: 'Dê um nome para a tag.' };
  if (buscarTagPorNome(limpo)) return { erro: `Já existe a tag “${limpo}”.` };
  const ativas = tagsAtivas();
  const ordem = ativas.length ? ativas[ativas.length - 1].ordem + 1 : 0;
  const cor = CORES[ativas.length % CORES.length];
  const tag = inserir('tags', {
    id: uuid(), nome: limpo, cor, ordem, atualizadoEm: Date.now(), excluido: false,
  });
  persistir([['tags', tag]]);
  return { tag };
}

export function renomearTag(id, nome) {
  const limpo = nome.trim();
  if (!limpo) return { erro: 'O nome não pode ficar vazio.' };
  const outra = buscarTagPorNome(limpo);
  if (outra && outra.id !== id) return { erro: `Já existe a tag “${limpo}”.` };
  const tag = alterar('tags', id, { nome: limpo });
  persistir([['tags', tag]]);
  return { tag };
}

export function corDaTag(id, cor) {
  const tag = alterar('tags', id, { cor });
  if (tag) persistir([['tags', tag]]);
}

export function moverTag(id, antesId, depoisId, zonaIds) {
  const antes = antesId && dados.tags.get(antesId);
  const depois = depoisId && dados.tags.get(depoisId);
  if (antes && depois && Math.abs(depois.ordem - antes.ordem) > 1e-6) {
    const tag = alterar('tags', id, { ordem: (antes.ordem + depois.ordem) / 2 });
    persistir([['tags', tag]]);
    return;
  }
  if (!antes && !depois) return;
  if (!depois) return persistir([['tags', alterar('tags', id, { ordem: antes.ordem + 1 })]]);
  if (!antes) return persistir([['tags', alterar('tags', id, { ordem: depois.ordem - 1 })]]);
  persistir(zonaIds.map((zid, i) => ['tags', alterar('tags', zid, { ordem: i })]));
}

export function usoDaTag(id) {
  return pendenciasAtivas().filter(p => p.tags.includes(id)).length;
}

// Exclui a tag e a desvincula de todas as pendências que a usam.
export function excluirTag(id) {
  const alteracoes = [['tags', alterar('tags', id, { excluido: true })]];
  for (const p of pendenciasAtivas()) {
    if (p.tags.includes(id)) {
      alteracoes.push(['pendencias', alterar('pendencias', p.id, { tags: p.tags.filter(t => t !== id) })]);
    }
  }
  persistir(alteracoes);
}
