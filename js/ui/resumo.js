// Painel "Resumo": aba Resumo (4 blocos) e aba Relatório (concluídas por período e tag).
// Só leitura do que está no aparelho; a única ação externa é "Copiar" (área de transferência).

import { h, icone } from './dom.js';
import { toast } from './toast.js';
import * as store from '../store.js';
import { ddmm, DIAS_ALERTA_AGUARDANDO } from '../util.js';
import { calcularResumo, calcularRelatorio, textoRelatorio, periodo, PERIODOS } from '../resumo-dados.js';

const ler = (k, padrao) => { try { return localStorage.getItem(k) ?? padrao; } catch (_) { return padrao; } };
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

const estado = {
  aba: ler('pend.resumoAba', 'resumo') === 'relatorio' ? 'relatorio' : 'resumo', // lembrada no aparelho
  periodo: 'semana', de: '', ate: '',
  tags: [], // filtro do relatório (OU); vazio = todas
};

/** Abre o painel já numa aba/período (ex.: cartão "Concluídas na semana"). */
export function prepararResumo({ aba, periodo: per } = {}) {
  if (aba) definirAba(aba);
  if (per) estado.periodo = per;
}

function definirAba(aba) {
  estado.aba = aba;
  guardar('pend.resumoAba', aba);
}

const pontos = p => {
  const tags = store.tagsDe(p);
  return h('span', { class: 'res-pontos', 'aria-hidden': 'true' },
    ...(tags.length ? tags.slice(0, 3) : [null]).map(t => h('span', { class: 'line-dot', 'data-cor': t ? t.cor : 'nenhuma' })));
};

export function desenharResumo() {
  const abas = h('div', { class: 'res-abas', role: 'tablist', 'aria-label': 'Resumo ou relatório' },
    ...[['resumo', 'Resumo'], ['relatorio', 'Relatório']].map(([v, r]) => h('button', {
      type: 'button', role: 'tab', 'data-act': 'res-aba', 'data-valor': v,
      'aria-selected': String(estado.aba === v), text: r,
    })));
  return [abas, ...(estado.aba === 'resumo' ? abaResumo() : abaRelatorio())];
}

// ---------------------------------------------------------------------------
// Aba Resumo
// ---------------------------------------------------------------------------

function abaResumo() {
  const r = calcularResumo();
  const nos = [];

  // 1) Números
  const cartao = (valor, rotulo, n, extra = '') => h('button', {
    type: 'button', class: `res-cartao${extra}`, 'data-act': 'res-cartao', 'data-valor': valor,
  }, h('span', { class: 'res-cartao-n num', text: String(n) }), h('span', { class: 'res-cartao-r', text: rotulo }));
  nos.push(h('section', { class: 'res-numeros', 'aria-label': 'Números' },
    cartao('atrasadas', 'Atrasadas', r.atrasadas.length, r.atrasadas.length ? ' is-alerta' : ''),
    cartao('aguardando', 'Aguardando', r.aguardando.length),
    cartao('semana', 'Concluídas na semana', r.concluidasSemana)));

  // 2) Abertas por tag
  if (r.porTag.length || r.semTag.total) {
    const max = Math.max(1, ...r.porTag.map(x => x.total), r.semTag.total);
    const barra = (rotulo, cor, total, aguardando, tagId) => {
      const conteudo = [
        h('span', { class: 'res-barra-nome', text: rotulo }),
        h('span', { class: 'res-barra-trilho', 'aria-hidden': 'true' },
          h('span', { class: 'res-barra-cheia', style: `width:${((total - aguardando) / max) * 100}%` }),
          h('span', { class: 'res-barra-espera', style: `width:${(aguardando / max) * 100}%` })),
        h('span', { class: 'res-barra-n num' }, String(total), aguardando ? h('small', { text: ` · ${aguardando} aguard.` }) : null),
      ];
      const rotuloA11y = `${rotulo}: ${total} ${total === 1 ? 'aberta' : 'abertas'}${aguardando ? `, ${aguardando} aguardando` : ''}`;
      return tagId
        ? h('button', { type: 'button', class: 'res-barra', 'data-cor': cor, 'data-act': 'res-tag', 'data-id': tagId, 'aria-label': `${rotuloA11y}. Filtrar a lista`, title: 'Filtrar a lista por esta tag' }, ...conteudo)
        : h('div', { class: 'res-barra is-estatica', 'data-cor': cor }, ...conteudo); // "Sem tag": sem filtro possível, texto visível basta
    };
    nos.push(h('section', { class: 'res-bloco' },
      h('h3', { class: 'p-label', text: 'Abertas por tag' }),
      h('div', { class: 'res-barras' },
        ...r.porTag.map(x => barra(x.tag.nome, x.tag.cor, x.total, x.aguardando, x.tag.id)),
        r.semTag.total ? barra('Sem tag', 'nenhuma', r.semTag.total, r.semTag.aguardando, null) : null),
      h('p', { class: 'res-legenda' },
        h('span', { class: 'res-leg res-leg-cheia' }), 'abertas', h('span', { class: 'res-leg res-leg-espera' }), 'aguardando'),
      h('p', { class: 'res-nota', text: 'Um item com várias tags conta em cada uma delas.' })));
  }

  // 3) Aguardando há mais tempo
  if (r.aguardando.length) {
    nos.push(h('section', { class: 'res-bloco' },
      h('h3', { class: 'p-label', text: 'Aguardando há mais tempo' }),
      h('ul', { class: 'res-lista' }, ...r.aguardando.slice(0, 5).map(p => {
        const dias = r.diasAguardando(p);
        const texto = dias === null ? 'sem data' : dias <= 0 ? 'hoje' : `há ${dias} d`;
        return h('li', {}, h('button', { type: 'button', class: 'res-item', 'data-act': 'res-item', 'data-id': p.id },
          pontos(p), h('span', { class: 'res-item-t', text: p.titulo }),
          h('span', { class: 'res-item-d num' + (dias !== null && dias >= DIAS_ALERTA_AGUARDANDO ? ' is-alerta' : ''), text: texto })));
      }))));
  }

  // 4) Prazos
  const grupos = [['Atrasadas', r.atrasadas, ' is-alerta'], ['Hoje', r.prazoHoje, ' is-hoje'], ['Próximos 7 dias', r.proximos, '']]
    .filter(([, lista]) => lista.length);
  nos.push(h('section', { class: 'res-bloco', id: 'res-prazos' },
    h('h3', { class: 'p-label', text: 'Prazos' }),
    grupos.length
      ? grupos.map(([titulo, lista, tom]) => h('div', { class: 'res-grupo' },
        h('h4', { class: 'res-grupo-t' + tom, text: `${titulo} · ${lista.length}` }),
        h('ul', { class: 'res-lista' }, ...lista.slice(0, 5).map(p => h('li', {},
          h('button', { type: 'button', class: 'res-item', 'data-act': 'res-item', 'data-id': p.id },
            pontos(p), h('span', { class: 'res-item-t', text: p.titulo }),
            h('span', { class: 'res-item-d num' + tom, text: p.prazo.split('-').reverse().slice(0, 2).join('/') }))))),
        lista.length > 5 ? h('p', { class: 'res-mais', text: `+${lista.length - 5} mais` }) : null))
      : h('p', { class: 'res-vazio', text: 'Nenhum prazo nos próximos 7 dias.' })));

  return nos;
}

// ---------------------------------------------------------------------------
// Aba Relatório
// ---------------------------------------------------------------------------

function abaRelatorio() {
  const per = periodo(estado.periodo, estado.de, estado.ate);
  const rel = calcularRelatorio(per, estado.tags);
  const tags = store.tagsAtivas();

  const filtros = h('section', { class: 'rel-filtros', 'aria-label': 'Filtros do relatório' },
    h('div', { class: 'rel-linha', role: 'group', 'aria-label': 'Período' },
      ...PERIODOS.map(([v, r]) => h('button', {
        type: 'button', class: 'chip chip-sm', 'data-act': 'rel-periodo', 'data-valor': v, 'aria-pressed': String(estado.periodo === v), text: r,
      }))),
    estado.periodo === 'personalizado'
      ? h('div', { class: 'rel-datas' },
        h('label', { class: 'campo' }, h('span', { class: 'campo-rotulo', text: 'De' }), h('input', { type: 'date', 'data-campo': 'rel-de', value: estado.de })),
        h('label', { class: 'campo' }, h('span', { class: 'campo-rotulo', text: 'Até' }), h('input', { type: 'date', 'data-campo': 'rel-ate', value: estado.ate })))
      : null,
    tags.length ? h('div', { class: 'rel-linha', role: 'group', 'aria-label': 'Tags' },
      h('button', { type: 'button', class: 'chip chip-sm', 'data-act': 'rel-tag', 'data-valor': '', 'aria-pressed': String(!estado.tags.length), text: 'Todas' }),
      ...tags.map(t => h('button', {
        type: 'button', class: 'chip chip-sm chip-tag', 'data-act': 'rel-tag', 'data-valor': t.id, 'data-cor': t.cor,
        'aria-pressed': String(estado.tags.includes(t.id)),
      }, h('span', { class: 'dot' }), icone('check', 'chip-check'), t.nome))) : null);

  const { concluidas, andamento, aguardando } = rel.totais;
  const topo = h('div', { class: 'rel-topo' },
    h('p', { class: 'rel-totais num' },
      h('strong', { text: rel.periodo.rotulo }), ` · ${concluidas} concluída${concluidas === 1 ? '' : 's'} · ${andamento} em andamento · ${aguardando} aguardando`),
    rel.grupos.length ? h('button', { type: 'button', class: 'btn btn-primary btn-sm rel-copiar', 'data-act': 'rel-copiar' }, icone('copiar'), 'Copiar') : null);

  if (!rel.grupos.length) {
    return [filtros, topo, h('p', { class: 'res-vazio', text: `Nada concluído, em andamento ou aguardando em ${rel.periodo.rotulo}${estado.tags.length ? ' nas tags escolhidas' : ''}. Troque o período ou as tags acima.` })];
  }

  const item = (p, detalhe, comEtapas) => {
    const e = rel.etapasResumo(p);
    return h('li', { class: 'rel-item' },
      h('div', { class: 'rel-item-l' }, h('span', { class: 'rel-item-t', text: p.titulo }), h('span', { class: 'rel-item-d num', text: detalhe(e) })),
      comEtapas && e.total ? h('ul', { class: 'rel-etapas' }, ...e.lista.map(o => h('li', { class: o.tipo === 'ok' ? 'is-ok' : '' },
        h('span', { class: 'rel-etapa-m', 'aria-label': o.tipo === 'ok' ? 'feita' : 'em aberto', text: o.tipo === 'ok' ? '✓' : '○' }), o.texto))) : null);
  };
  const secao = (titulo, lista, fn) => (lista.length ? h('div', { class: 'rel-sec' }, h('h4', { class: 'rel-sec-t', text: titulo }), h('ul', { class: 'rel-lista' }, ...lista.map(fn))) : null);

  const grupos = rel.grupos.map(g => h('section', { class: 'rel-grupo' },
    h('h3', { class: 'rel-grupo-t', 'data-cor': g.tag ? g.tag.cor : 'nenhuma' }, h('span', { class: 'line-dot' }), g.tag ? g.tag.nome : 'Sem tag'),
    secao('Concluídas', g.concluidas, p => item(p, e => `${e.total ? `${e.feitas}/${e.total} etapas · ` : ''}${ddmm(p.feitoEm)}`, true)),
    secao('Em andamento', g.andamento, p => item(p, e => (e.total ? `${e.feitas}/${e.total} etapas` : ''), false)),
    secao('Aguardando', g.aguardando, p => item(p, () => (p.aguardandoEm ? `desde ${ddmm(p.aguardandoEm)}` : 'sem data'), false))));

  return [filtros, topo, ...grupos];
}

async function copiar() {
  const texto = textoRelatorio(calcularRelatorio(periodo(estado.periodo, estado.de, estado.ate), estado.tags));
  try {
    await navigator.clipboard.writeText(texto);
  } catch (_) {
    // Fallback (navegadores sem a API assíncrona): textarea temporária + execCommand.
    const ta = h('textarea', { text: texto, style: 'position:fixed;opacity:0' });
    document.getElementById('panel').append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) { toast('Não foi possível copiar o relatório.', { tipo: 'erro' }); return; }
  }
  toast('Relatório copiado');
}

// ---------------------------------------------------------------------------
// Eventos (chamados por panels.js)
// ---------------------------------------------------------------------------

/**
 * @param {HTMLElement} b elemento com data-act "res-*" ou "rel-*"
 * @param {{ renderizar: Function, fechar: Function, aplicarFiltros: Function, abrirItem: Function }} acoes
 */
export function aoClicarResumo(b, acoes) {
  const v = b.dataset.valor;
  switch (b.dataset.act) {
    case 'res-aba': definirAba(v); break;
    case 'res-cartao':
      if (v === 'atrasadas') { document.getElementById('res-prazos')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
      if (v === 'aguardando') { acoes.fechar(); acoes.aplicarFiltros({ tags: [], aguardando: true }); return; }
      if (v === 'semana') { definirAba('relatorio'); estado.periodo = 'semana'; }
      break;
    case 'res-tag': acoes.fechar(); acoes.aplicarFiltros({ tags: [b.dataset.id], aguardando: false }); return;
    case 'res-item': acoes.fechar(); acoes.abrirItem(b.dataset.id); return;
    case 'rel-periodo': estado.periodo = v; break;
    case 'rel-tag':
      estado.tags = !v ? [] : estado.tags.includes(v) ? estado.tags.filter(t => t !== v) : [...estado.tags, v];
      break;
    case 'rel-copiar': copiar(); return;
    default: return;
  }
  acoes.renderizar();
  // Mantém o foco do teclado no controle equivalente depois do redesenho.
  const sel = b.dataset.act === 'res-aba' ? `[data-act="res-aba"][aria-selected="true"]` : `[data-act="${b.dataset.act}"][data-valor="${CSS.escape(v || '')}"]`;
  document.querySelector(`#panel-body ${sel}`)?.focus();
}

export function aoMudarResumo(e) {
  const c = e.target.dataset.campo;
  if (c !== 'rel-de' && c !== 'rel-ate') return false;
  if (c === 'rel-de') estado.de = e.target.value; else estado.ate = e.target.value;
  return true;
}
