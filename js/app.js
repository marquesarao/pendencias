// Pendências — inicialização, eventos da tela principal e atalhos.

import * as store from './store.js';
import * as sync from './sync.js';
import { interpretarCaptura, interpretarObservacao } from './parse.js';
import { renderizarLista } from './ui/list.js';
import { renderizarChips } from './ui/chips.js';
import { iniciarPaineis, abrirPainel, renderizarPainel, quando } from './ui/panels.js';
import { iniciarBusca, abrirBusca, fecharBusca } from './ui/search.js';
import { arrastavel } from './ui/drag.js';
import { toast } from './ui/toast.js';
import { ajustarAltura } from './ui/row.js';
import { h, reduzirMovimento } from './ui/dom.js';
import { chaveDia } from './util.js';

const ler = (k, padrao) => { try { return localStorage.getItem(k) ?? padrao; } catch (_) { return padrao; } };
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

const ui = {
  filtro: null,                       // id da tag filtrada
  modo: ler('pend.modo', 'agrupar'),  // 'agrupar' | 'corrida'
  tema: ler('pend.tema', 'auto'),     // 'auto' | 'claro' | 'escuro'
  aberto: null,                       // id do item expandido
  selecionado: null,                  // id do item selecionado pelo teclado/clique
  confirmarExclusao: null,
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
  if (ui.filtro && !store.tagAtiva(ui.filtro)) ui.filtro = null;
  const aberto = ui.aberto && store.dados.pendencias.get(ui.aberto);
  if (!aberto || aberto.excluido) ui.aberto = null;

  const abertas = store.pendenciasAtivas().filter(p => !p.feito);
  renderizarChips($('chips'), abertas, ui.filtro);
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
// que estiver sendo editado — o campo sai da tela sem disparar "change".
function definirAberto(id, { focarObs = false } = {}) {
  if (ui.aberto && ui.aberto !== id) {
    const ta = linhaEl(ui.aberto)?.querySelector('.d-title');
    if (ta) salvarTitulo(ta);
  }
  ui.aberto = id;
  ui.confirmarExclusao = null;
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
  const tags = r.tagId ? [r.tagId] : (!r.tagInexistente && ui.filtro ? [ui.filtro] : []);
  const p = store.criarPendencia({ titulo: r.titulo, tags });
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
  } else if (ui.filtro && !tags.includes(ui.filtro)) {
    const tag = store.tagAtiva(tags[0]);
    toast(`Criada em “${tag ? tag.nome : 'Sem tag'}”, fora do filtro atual.`, {
      acao: { rotulo: 'Ver todas', fn: () => { ui.filtro = null; render(); } },
    });
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
    const id = chip.dataset.filtro || null;
    ui.filtro = ui.filtro === id ? null : id;
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
    case 'obs-alternar': store.alternarObservacao(alvo.closest('[data-obs]').dataset.obs); break;
    case 'obs-excluir': {
      const obsId = alvo.closest('[data-obs]').dataset.obs;
      store.excluirObservacao(obsId);
      toast('Observação excluída.', { acao: { rotulo: 'Desfazer', fn: () => store.excluirObservacao(obsId, false) } });
      break;
    }
    case 'tag-alternar': alternarTag(id, alvo.dataset.tag); break;
    case 'aguardando': store.editarPendencia(id, { aguardando: !store.dados.pendencias.get(id).aguardando }); break;
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
  if (e.target.matches('.d-title')) ajustarAltura(e.target);
});

main.addEventListener('change', e => {
  const t = e.target;
  const id = t.closest('.row')?.dataset.id;
  if (!id) return;
  if (t.matches('.d-title')) salvarTitulo(t);
  if (t.matches('[data-campo="prazo"]')) { store.editarPendencia(id, { prazo: t.value || '' }); t.blur(); }
});

main.addEventListener('keydown', e => {
  const t = e.target;
  if (t.matches('.d-title') && e.key === 'Enter') {
    e.preventDefault();
    t.blur(); // dispara o change
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
    avisarErro('Não foi possível criar a observação', err);
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
  const dentro = e.composedPath().some(n => n instanceof Element && (
    (n.classList.contains('row') && n.dataset.id === ui.aberto) ||
    n.matches('.toasts, dialog, .tools, .sync')));
  if (!dentro) definirAberto(null);
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
    Object.assign(ui, { filtro: null, aberto: null, selecionado: null, confirmarExclusao: null });
    fecharBusca();
    render();
  };
  const ctx = { ui, render, definirTema, verificarArmazenamento, limparTela };
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

  if (matchMedia('(hover: hover) and (pointer: fine)').matches) captura.focus();
}

iniciar();
