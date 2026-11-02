// Pendências — inicialização, eventos da tela principal e atalhos.

import * as store from './store.js';
import * as sync from './sync.js';
import * as pwa from './pwa.js';
import { interpretarCaptura, interpretarObservacao } from './parse.js';
import { renderizarLista } from './ui/list.js';
import { renderizarChips } from './ui/chips.js';
import { iniciarPaineis, abrirPainel, renderizarPainel, quando } from './ui/panels.js';
import { iniciarBusca, abrirBusca, fecharBusca } from './ui/search.js';
import { arrastavel } from './ui/drag.js';
import { toast } from './ui/toast.js';
import { ajustarAltura } from './ui/row.js';
import { h, reduzirMovimento } from './ui/dom.js';
import { chaveDia, FILTRO_AGUARDANDO, filtrosVazios, temFiltro, passaNosFiltros } from './util.js';

const ler = (k, padrao) => { try { return localStorage.getItem(k) ?? padrao; } catch (_) { return padrao; } };
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
const guardarFiltros = () => guardar('pend.filtros', JSON.stringify(ui.filtros));

// Filtros ativos lembrados por aparelho: { tags: [ids], aguardando: bool }.
function lerFiltros() {
  try {
    const f = JSON.parse(ler('pend.filtros', 'null'));
    if (f && Array.isArray(f.tags)) return { tags: f.tags.filter(t => typeof t === 'string'), aguardando: !!f.aguardando };
  } catch (_) {}
  return filtrosVazios();
}

// Modo padrão: lista corrida no celular, agrupada no desktop; a escolha do usuário fica salva.
const MODO_PADRAO = matchMedia('(max-width: 600px)').matches ? 'corrida' : 'agrupar';

const ui = {
  filtros: lerFiltros(),              // { tags: [ids] (OU entre si), aguardando (E) }
  modo: ler('pend.modo', MODO_PADRAO), // 'agrupar' | 'corrida'
  tema: ler('pend.tema', 'auto'),     // 'auto' | 'claro' | 'escuro'
  aberto: null,                       // id do item expandido
  selecionado: null,                  // id do item selecionado pelo teclado/clique
  confirmarExclusao: null,
  editandoTitulo: null,               // id do item com o título em edição (lápis)
  tagsAbertas: null,                  // id do item com a lista completa de tags aberta
  editandoEtapa: null,                // id da etapa com o texto em edição (uma por vez)
  buscando: false, termo: '', termoBruto: '',
  painel: null,
  armazenamento: 'verificando',       // 'verificando' | 'persistente' | 'nao' | 'indisponivel'
};

const $ = id => document.getElementById(id);

// Toda falha aparece para o usuário (aviso) e para quem depura (console). Nunca em silêncio.
function avisarErro(contexto, err) {
  console.error(`[Pendências] ${contexto}:`, err);
  toast(`${contexto}: ${(err && err.message) || err}`, { tipo: 'erro', tempo: 9000 });
}

window.addEventListener('error', e => avisarErro('Erro inesperado', e.error || e.message));
window.addEventListener('unhandledrejection', e => avisarErro('Erro inesperado', e.reason));
const main = $('main');
const captura = $('capture-input');
let ordemTela = [];
let agendado = false;

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------

function render() {
  agendado = false;
  const abertas = store.pendenciasAtivas().filter(p => !p.feito);
  const validas = ui.filtros.tags.filter(id => store.tagAtiva(id));
  const aguardando = ui.filtros.aguardando && abertas.some(p => p.aguardando); // o chip some quando não há mais nada aguardando
  if (validas.length !== ui.filtros.tags.length || aguardando !== ui.filtros.aguardando) {
    ui.filtros = { tags: validas, aguardando };
    guardarFiltros();
  }
  const aberto = ui.aberto && store.dados.pendencias.get(ui.aberto);
  if (!aberto || aberto.excluido) ui.aberto = null;
  if (ui.editandoTitulo !== ui.aberto) ui.editandoTitulo = null;
  if (ui.tagsAbertas !== ui.aberto) ui.tagsAbertas = null;
  if (ui.editandoEtapa && store.dados.observacoes.get(ui.editandoEtapa)?.pendenciaId !== ui.aberto) ui.editandoEtapa = null;

  renderizarChips($('chips'), abertas, ui.filtros);
  ordemTela = renderizarLista(ui);
  if (ui.selecionado && !ordemTela.includes(ui.selecionado)) ui.selecionado = null;
  for (const b of $('modo').children) b.setAttribute('aria-pressed', String(b.dataset.modo === ui.modo));
  renderizarPainel();
}

function agendar() {
  if (agendado) return;
  agendado = true;
  requestAnimationFrame(() => { if (agendado) render(); });
}

function linhaEl(id) {
  return main.querySelector(`.row[data-id="${CSS.escape(id)}"]`);
}

// Microinteração: aplica uma classe de animação e a remove ao terminar.
function animar(id, classe) {
  if (reduzirMovimento()) return;
  const el = linhaEl(id);
  if (!el) return;
  el.classList.remove(classe);
  void el.offsetWidth; // reinicia a animação
  el.classList.add(classe);
  el.addEventListener('animationend', () => el.classList.remove(classe), { once: true });
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

function concluir(id) {
  const p = store.alternarFeito(id);
  if (!p) return;
  render();
  if (p.feito) {
    animar(id, 'anim-feito');
    if (navigator.vibrate) navigator.vibrate(12);
  }
}

function alternarFoco(id) {
  const p = store.alternarFoco(id);
  if (!p) return;
  render();
  animar(id, 'anim-foco');
}

// Único ponto que abre/recolhe itens (só um aberto por vez). Antes de recolher, grava o título
// que estiver sendo editado no cabeçalho — o campo some sem disparar "change".
function definirAberto(id, { focarObs = false } = {}) {
  if (ui.aberto && ui.aberto !== id && ui.editandoTitulo === ui.aberto) {
    const ta = linhaEl(ui.aberto)?.querySelector('.title-edit');
    if (ta) salvarTitulo(ta);
  }
  if (ui.editandoEtapa) {
    const campo = main.querySelector('.obs-edit');
    if (campo) salvarEtapa(campo);
  }
  ui.aberto = id;
  ui.confirmarExclusao = null;
  ui.editandoTitulo = null;
  ui.tagsAbertas = null;
  ui.editandoEtapa = null;
  if (id) ui.selecionado = id;
  render();
  if (id && focarObs) linhaEl(id)?.querySelector('[data-campo="obs"]')?.focus();
}

function alternarAberto(id, focarObs = false) {
  definirAberto(ui.aberto === id ? null : id, { focarObs });
}

function criarDaCaptura() {
  const texto = captura.value.trim();
  if (!texto) return;
  const r = interpretarCaptura(texto, store.tagsAtivas());
  // Sem prefixo, com tags no filtro: nasce com a PRIMEIRA tag ativa na ordem dos chips.
  const tagsDoFiltro = store.tagsAtivas().filter(t => ui.filtros.tags.includes(t.id));
  const herdada = !r.tagId && !r.tagInexistente && tagsDoFiltro.length ? tagsDoFiltro[0] : null;
  const tags = r.tagId ? [r.tagId] : (herdada ? [herdada.id] : []);
  // Com o filtro "Aguardando" ativo, o item novo já nasce aguardando (fica visível no filtro).
  const p = store.criarPendencia({ titulo: r.titulo, tags, aguardando: ui.filtros.aguardando });
  captura.value = '';
  render();
  animar(p.id, 'anim-entrou');

  if (r.tagInexistente) {
    const nome = r.tagInexistente;
    toast(`Não existe a tag “${nome}”.`, {
      tempo: 9000,
      acao: {
        rotulo: `Criar tag “${nome}”`,
        fn: () => {
          const { tag, erro } = store.criarTag(nome);
          if (erro) return toast(erro, { tipo: 'erro' });
          store.editarPendencia(p.id, { titulo: r.tituloSemPrefixo, tags: [tag.id] });
          render();
          animar(p.id, 'anim-entrou');
        },
      },
    });
  } else if (ui.filtros.tags.length && !ui.filtros.tags.some(id => tags.includes(id))) {
    const tag = store.tagAtiva(tags[0]);
    toast(`Criada em “${tag ? tag.nome : 'Sem tag'}”, fora do filtro atual.`, {
      acao: { rotulo: 'Ver todas', fn: () => { ui.filtros = filtrosVazios(); guardarFiltros(); render(); } },
    });
  } else if (herdada && tagsDoFiltro.length > 1) {
    toast(`Criada em “${herdada.nome}” (primeira tag do filtro).`);
  }
}

function salvarTitulo(ta) {
  const id = ta.closest('.row')?.dataset.id;
  const p = id && store.dados.pendencias.get(id);
  if (!p) return;
  const novo = ta.value.replace(/\s+/g, ' ').trim();
  if (!novo) { ta.value = p.titulo; ajustarAltura(ta); return; }
  if (novo !== p.titulo) store.editarPendencia(id, { titulo: novo });
}

// Lápis: o título vira campo no mesmo lugar. Enter ou sair do campo salva; Esc cancela.
function editarTitulo(id) {
  ui.editandoTitulo = id;
  render();
  const ta = linhaEl(id)?.querySelector('.title-edit');
  if (!ta) return;
  ajustarAltura(ta);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function terminarEdicaoTitulo(ta, salvar) {
  const p = store.dados.pendencias.get(ta.closest('.row')?.dataset.id);
  if (salvar) salvarTitulo(ta);
  else if (p) ta.value = p.titulo;
  ui.editandoTitulo = null;
  render();
}

// Etapa: tocar no texto edita no lugar. Enter ou sair do campo salva; Esc cancela.
// Na edição o texto é gravado como digitado (o prefixo "ok " só vale na criação).
function editarEtapa(obsId) {
  ui.editandoEtapa = obsId;
  render();
  const campo = main.querySelector(`[data-obs="${CSS.escape(obsId)}"] .obs-edit`);
  if (!campo) return;
  ajustarAltura(campo);
  campo.focus();
  campo.setSelectionRange(campo.value.length, campo.value.length);
}

function salvarEtapa(campo) {
  const id = campo.closest('[data-obs]')?.dataset.obs;
  const etapa = id && store.dados.observacoes.get(id);
  if (!etapa) return;
  const novo = campo.value.replace(/\s+/g, ' ').trim();
  if (!novo) {
    campo.value = etapa.texto;
    toast('Para remover a etapa, use o ×');
    return;
  }
  if (novo !== etapa.texto) store.editarObservacao(id, novo); // atualizadoEm + fila de sincronização
}

function terminarEdicaoEtapa(campo, salvar) {
  if (salvar) salvarEtapa(campo);
  ui.editandoEtapa = null;
  render();
}

function alternarTag(id, tagId) {
  const p = store.dados.pendencias.get(id);
  const tags = p.tags.includes(tagId) ? p.tags.filter(t => t !== tagId) : [...p.tags, tagId];
  store.editarPendencia(id, { tags });
}

// ---------------------------------------------------------------------------
// Eventos da tela principal
// ---------------------------------------------------------------------------

main.addEventListener('click', e => {
  const chip = e.target.closest('[data-filtro]');
  if (chip) {
    const id = chip.dataset.filtro;
    if (!id) ui.filtros = filtrosVazios();
    else if (id === FILTRO_AGUARDANDO) ui.filtros.aguardando = !ui.filtros.aguardando;
    else ui.filtros.tags = ui.filtros.tags.includes(id) ? ui.filtros.tags.filter(t => t !== id) : [...ui.filtros.tags, id];
    guardarFiltros();
    ui.selecionado = null;
    return render();
  }
  const modo = e.target.closest('[data-modo]');
  if (modo) {
    ui.modo = modo.dataset.modo;
    guardar('pend.modo', ui.modo);
    return render();
  }

  const alvo = e.target.closest('[data-act]');
  const row = e.target.closest('.row');
  const id = row?.dataset.id;
  if (row && id !== ui.selecionado) ui.selecionado = id;
  if (!alvo) return row && render();

  switch (alvo.dataset.act) {
    case 'abrir-tags': return abrirPainel('tags');
    case 'feito': return concluir(id);
    case 'foco': return alternarFoco(id);
    case 'abrir': return alternarAberto(id);
    case 'fechar': return definirAberto(null);
    case 'editar-titulo': return editarTitulo(id);
    case 'tags-expandir':
      ui.tagsAbertas = id;
      render();
      linhaEl(id)?.querySelector('.tags-lista .chip-tag')?.focus();
      return;
    case 'tags-recolher':
      ui.tagsAbertas = null;
      render();
      linhaEl(id)?.querySelector('.chip-mais')?.focus();
      return;
    case 'obs-editar': return editarEtapa(alvo.closest('[data-obs]').dataset.obs);
    case 'obs-alternar': store.alternarObservacao(alvo.closest('[data-obs]').dataset.obs); break;
    case 'obs-excluir': {
      const obsId = alvo.closest('[data-obs]').dataset.obs;
      store.excluirObservacao(obsId);
      toast('Etapa excluída.', { acao: { rotulo: 'Desfazer', fn: () => store.excluirObservacao(obsId, false) } });
      break;
    }
    case 'tag-alternar': alternarTag(id, alvo.dataset.tag); break;
    case 'aguardando': store.alternarAguardando(id); break;
    case 'limpar-prazo': store.editarPendencia(id, { prazo: '' }); break;
    case 'excluir': ui.confirmarExclusao = id; break;
    case 'excluir-nao': ui.confirmarExclusao = null; break;
    case 'excluir-sim': {
      const p = store.excluirPendencia(id);
      ui.confirmarExclusao = null;
      ui.aberto = null;
      toast(`“${p.titulo}” excluída.`, {
        acao: { rotulo: 'Desfazer', fn: () => { store.editarPendencia(id, { excluido: false }); render(); } },
      });
      break;
    }
    default: return;
  }
  render();
});

main.addEventListener('input', e => {
  if (e.target.matches('.title-edit, .obs-edit')) ajustarAltura(e.target);
});

// Sair do campo do título (tocar fora, Tab, Enter) salva.
main.addEventListener('focusout', e => {
  if (e.target.matches('.title-edit') && ui.editandoTitulo) terminarEdicaoTitulo(e.target, true);
  if (e.target.matches('.obs-edit') && ui.editandoEtapa) {
    const proxima = e.relatedTarget?.matches?.('.obs-texto') ? e.relatedTarget.closest('[data-obs]').dataset.obs : null;
    terminarEdicaoEtapa(e.target, true);
    if (proxima) editarEtapa(proxima);
  }
});

main.addEventListener('change', e => {
  const t = e.target;
  const id = t.closest('.row')?.dataset.id;
  if (!id) return;
  if (t.matches('[data-campo="prazo"]')) { store.editarPendencia(id, { prazo: t.value || '' }); t.blur(); }
});

main.addEventListener('keydown', e => {
  const t = e.target;
  if (t.matches('.obs-edit')) {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      t.blur(); // o focusout salva
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // Esc aqui só cancela a edição, não recolhe o item
      const obsId = t.closest('[data-obs]').dataset.obs;
      terminarEdicaoEtapa(t, false);
      main.querySelector(`[data-obs="${CSS.escape(obsId)}"] .obs-texto`)?.focus();
    }
  }
  // Texto da etapa focado com Tab: Enter/espaço começa a editar.
  if (t.matches('.obs-texto') && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    e.stopPropagation();
    editarEtapa(t.closest('[data-obs]').dataset.obs);
  }
  if (t.matches('.title-edit')) {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      t.blur(); // o focusout salva
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // Esc aqui só cancela a edição, não recolhe o item
      terminarEdicaoTitulo(t, false);
      linhaEl(t.closest('.row').dataset.id)?.querySelector('.editar')?.focus();
    }
  }
  // Linha focada com Tab: Enter/espaço abre ou recolhe (é um botão para leitores de tela).
  if (t.matches('.line-main') && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    e.stopPropagation(); // não deixa o atalho global agir de novo
    alternarAberto(t.closest('.row').dataset.id, e.key === 'Enter');
  }
});

main.addEventListener('submit', e => {
  if (!e.target.matches('[data-form="obs"]')) return;
  e.preventDefault();
  const input = e.target.querySelector('[data-campo="obs"]');
  const texto = input.value.trim();
  if (!texto) return;
  try {
    store.criarObservacao(input.closest('.row').dataset.id, interpretarObservacao(texto));
    input.value = '';
    render();
  } catch (err) {
    avisarErro('Não foi possível criar a etapa', err);
  }
});

// Enter físico, Enter do teclado numérico e "Enviar" do teclado virtual chegam aqui como submit.
$('capture').addEventListener('submit', e => {
  e.preventDefault();
  try {
    criarDaCaptura();
  } catch (err) {
    avisarErro('Não foi possível criar a pendência', err);
  }
});

$('busca').addEventListener('submit', e => {
  e.preventDefault();
  $('search-input').blur(); // fecha o teclado virtual; o filtro já foi aplicado ao digitar
});

captura.addEventListener('keydown', e => {
  // Seta para baixo com a captura vazia desce para a lista.
  if (e.key === 'ArrowDown' && !captura.value && ordemTela.length) {
    e.preventDefault();
    captura.blur();
    selecionar(ordemTela[0]);
  }
});

// ---------------------------------------------------------------------------
// Atalhos de teclado
// ---------------------------------------------------------------------------

function selecionar(id) {
  ui.selecionado = id;
  document.body.classList.add('teclado');
  render();
  linhaEl(id)?.scrollIntoView({ block: 'nearest', behavior: reduzirMovimento() ? 'auto' : 'smooth' });
}

document.addEventListener('pointerdown', () => document.body.classList.remove('teclado'));

// Clique/toque fora do item aberto recolhe. Usa "click" (não dispara ao rolar a página no
// celular) e composedPath(), que guarda onde o clique nasceu mesmo que um render tenha
// trocado os elementos no meio do caminho. Avisos, painéis e botões do topo não recolhem.
document.addEventListener('click', e => {
  if (!ui.aberto) return;
  const caminho = e.composedPath().filter(n => n instanceof Element);
  const dentro = caminho.some(n =>
    (n.classList.contains('row') && n.dataset.id === ui.aberto) ||
    n.matches('.toasts, dialog, .tools, .sync'));
  if (!dentro) return definirAberto(null);
  // Lista completa de tags aberta: tocar fora dela (mesmo dentro do item) recolhe a lista.
  if (ui.tagsAbertas && !caminho.some(n => n.matches('.d-tags, .toasts, dialog'))) {
    ui.tagsAbertas = null;
    render();
  }
});

document.addEventListener('keydown', e => {
  if ($('panel').open || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  const digitando = t.matches('input, textarea, select, [contenteditable]');

  if (e.key === 'Escape') {
    if (t === $('search-input') || (!digitando && !ui.aberto && ui.buscando)) { fecharBusca(); return; }
    if (digitando) {
      const linha = t.closest('.row');
      if (linha && ui.aberto === linha.dataset.id) {
        definirAberto(null); // grava o título antes de recolher
        selecionar(linha.dataset.id);
      } else {
        t.blur();
      }
      return;
    }
    if (ui.tagsAbertas) { // Esc em camadas: primeiro a lista de tags, depois o item
      const id = ui.tagsAbertas;
      ui.tagsAbertas = null;
      render();
      linhaEl(id)?.querySelector('.chip-mais')?.focus();
      return;
    }
    if (ui.aberto) { const id = ui.aberto; definirAberto(null); selecionar(id); return; }
    ui.selecionado = null;
    render();
    return;
  }
  if (digitando) return;

  const sel = ui.selecionado;
  switch (e.key) {
    case 'n':
      e.preventDefault();
      fecharBusca();
      captura.focus();
      break;
    case '/':
      e.preventDefault();
      abrirBusca();
      break;
    case 'ArrowDown':
    case 'ArrowUp': {
      if (!ordemTela.length) return;
      e.preventDefault();
      const i = ordemTela.indexOf(sel);
      const passo = e.key === 'ArrowDown' ? 1 : -1;
      const prox = i < 0 ? (passo > 0 ? 0 : ordemTela.length - 1) : Math.min(ordemTela.length - 1, Math.max(0, i + passo));
      selecionar(ordemTela[prox]);
      break;
    }
    case 'Enter':
      if (!sel || t.matches('button')) return;
      e.preventDefault();
      alternarAberto(sel, true);
      break;
    case 'f':
      if (!sel) return;
      e.preventDefault();
      alternarFoco(sel);
      break;
    case ' ':
      if (!sel || t.matches('button')) return;
      e.preventDefault();
      concluir(sel);
      break;
    default:
  }
});

// ---------------------------------------------------------------------------
// Tema e armazenamento
// ---------------------------------------------------------------------------

const COR_BARRA = { claro: '#f5f7fa', escuro: '#1c1f24' };

function definirTema(tema) {
  ui.tema = tema;
  guardar('pend.tema', tema);
  const raiz = document.documentElement;
  if (tema === 'claro') raiz.dataset.theme = 'light';
  else if (tema === 'escuro') raiz.dataset.theme = 'dark';
  else delete raiz.dataset.theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
    const automatica = m.media.includes('dark') ? COR_BARRA.escuro : COR_BARRA.claro;
    m.content = tema === 'auto' ? automatica : COR_BARRA[tema];
  });
}

async function verificarArmazenamento(pedir) {
  const s = navigator.storage;
  if (!s || !s.persist || !s.persisted) {
    ui.armazenamento = 'indisponivel';
  } else {
    try {
      let ok = await s.persisted();
      if (!ok && pedir) ok = await s.persist();
      ui.armazenamento = ok ? 'persistente' : 'nao';
    } catch (_) {
      ui.armazenamento = 'indisponivel';
    }
  }
  renderizarPainel();
}

// ---------------------------------------------------------------------------
// Indicador de sincronização no cabeçalho
// ---------------------------------------------------------------------------

function mostrarStatus(st) {
  const n = store.qtdPendentes();
  const ultima = `Última sincronização: ${quando(st.ultimaSyncEm)}`;
  const [rotulo, dica] = {
    local: ['Neste aparelho', 'Dados só neste aparelho. Conecte a planilha em Configurações.'],
    ok: ['Sincronizado', ultima],
    pendente: [`Pendente (${n})`, `${n} alteração(ões) aguardando envio. ${ultima}`],
    sincronizando: ['Sincronizando…', 'Enviando e recebendo alterações…'],
    offline: ['Offline', n ? `Sem conexão. ${n} alteração(ões) serão enviadas ao voltar.` : 'Sem conexão.'],
    erro: ['Erro', `Erro na sincronização: ${st.ultimoErro}`],
  }[st.status];
  const botao = $('sync');
  botao.dataset.state = st.status;
  botao.title = dica;
  botao.setAttribute('aria-label', `${rotulo}. ${dica}`);
  botao.querySelector('.sync-label').textContent = rotulo;
}

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------

async function iniciar() {
  try {
    await store.carregar();
  } catch (err) {
    console.error('[Pendências] Falha ao abrir o IndexedDB:', err);
    main.replaceChildren(h('div', { class: 'empty empty-erro' },
      h('strong', { text: 'Não foi possível abrir os dados deste aparelho.' }),
      h('span', { text: ` ${err && err.message ? err.message : err}` })));
    return;
  }

  // Depois de apagar os dados deste aparelho: zera o estado da tela (filtro, item aberto, busca).
  const limparTela = () => {
    Object.assign(ui, { filtros: filtrosVazios(), aberto: null, selecionado: null, confirmarExclusao: null });
    guardarFiltros();
    fecharBusca();
    render();
  };
  // Toques no painel Resumo: filtrar a lista ou abrir um item nela.
  const aplicarFiltros = filtros => {
    ui.filtros = filtros;
    guardarFiltros();
    fecharBusca();
    render();
    scrollTo({ top: 0, behavior: reduzirMovimento() ? 'auto' : 'smooth' });
  };
  const abrirItem = id => {
    const p = store.dados.pendencias.get(id);
    if (!p || p.excluido) return;
    fecharBusca();
    if (!passaNosFiltros(p, ui.filtros)) { ui.filtros = filtrosVazios(); guardarFiltros(); } // item escondido pelo filtro
    definirAberto(id);
    linhaEl(id)?.scrollIntoView({ block: 'center', behavior: reduzirMovimento() ? 'auto' : 'smooth' });
  };
  const ctx = { ui, render, definirTema, verificarArmazenamento, limparTela, aplicarFiltros, abrirItem };
  store.aoMudar(agendar);
  store.aoFalharGravacao(err => avisarErro('Não foi possível salvar neste aparelho', err));
  iniciarPaineis(ctx);
  iniciarBusca(ctx);
  document.querySelectorAll('[data-panel]').forEach(b => b.addEventListener('click', () => abrirPainel(b.dataset.panel)));

  arrastavel(main, {
    item: '.row',
    ignorar: 'button, input, textarea, select, label, a, .detail',
    pode: el => !el.classList.contains('is-done'),
    soltar: (zona, el, ids, i) => {
      store.moverPendencia(el.dataset.id, ids[i - 1] || null, ids[i + 1] || null, ids);
      render();
    },
  });

  // Virada do dia: concluídas de ontem saem da lista.
  let dia = chaveDia();
  const conferirDia = () => { if (chaveDia() !== dia) { dia = chaveDia(); render(); } };
  setInterval(conferirDia, 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) conferirDia(); });

  definirTema(ui.tema);
  render();
  document.body.classList.add('pronto');
  verificarArmazenamento(true);

  $('sync').addEventListener('click', () => abrirPainel('config'));
  sync.aoMudarStatus(mostrarStatus);
  sync.iniciarSync().catch(err => avisarErro('Não foi possível iniciar a sincronização', err));

  pwa.aoMudar(() => renderizarPainel());
  // Depois de instalar, o navegador costuma liberar o armazenamento persistente: pede de novo.
  pwa.iniciarPwa({ aoInstalar: () => verificarArmazenamento(true) });

  if (matchMedia('(hover: hover) and (pointer: fine)').matches) captura.focus();
}

iniciar();
