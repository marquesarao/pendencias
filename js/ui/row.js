// Linha compacta da pendência e o detalhe expandido no lugar (sem modal).

import { h, icone, realcar, trecho, contem } from './dom.js';
import { tagsDe, tagsAtivas, observacoesDe } from '../store.js';
import { ddmm, situacaoPrazo, rotuloPrazo, plural } from '../util.js';

const MAX_TAGS_LINHA = 2;

export function criarLinha(id) {
  const el = h('div', { class: 'row', 'data-id': id, role: 'listitem' },
    h('div', { class: 'line' },
      h('span', { class: 'grip', 'aria-hidden': 'true' }, icone('grip')),
      h('button', { class: 'check', type: 'button', role: 'checkbox', 'data-act': 'feito' },
        h('span', { class: 'check-box' }, icone('check'))),
      h('div', { class: 'line-main', 'data-act': 'abrir', role: 'button', tabindex: '0' },
        h('span', { class: 'title' }, h('span', { class: 'title-text' })),
        h('span', { class: 'line-tags' }),
        h('span', { class: 'meta' })),
      h('button', { class: 'star', type: 'button', 'data-act': 'foco' }, icone('star')),
      h('button', { class: 'fechar', type: 'button', 'data-act': 'fechar', 'aria-label': 'Fechar', title: 'Fechar (Esc)' }, icone('chevron-up'))));
  return el;
}

/**
 * @param {HTMLElement} el
 * @param {object} p pendência
 * @param {object} o { ocultarPrimeiraTag, termo (normalizado), aberto, selecionado, confirmar }
 */
export function atualizarLinha(el, p, o) {
  el.classList.toggle('is-done', p.feito);
  el.classList.toggle('is-focus', p.foco);
  el.classList.toggle('is-open', o.aberto);
  el.classList.toggle('is-selected', o.selecionado);

  const check = el.querySelector('.check');
  check.setAttribute('aria-checked', String(p.feito));
  check.setAttribute('aria-label', p.feito ? 'Reabrir' : 'Concluir');

  const star = el.querySelector('.star');
  star.setAttribute('aria-pressed', String(p.foco));
  star.setAttribute('aria-label', p.foco ? 'Tirar do foco' : 'Pôr em foco');
  star.disabled = p.feito;

  const main = el.querySelector('.line-main');
  main.setAttribute('aria-expanded', String(o.aberto));
  const tit = el.querySelector('.title-text');
  tit.replaceChildren(realcar(p.titulo, o.termo));
  el.querySelector('.title').title = p.titulo;

  // Tags na linha
  let tags = tagsDe(p);
  if (o.ocultarPrimeiraTag) tags = tags.slice(1);
  const tagsEl = el.querySelector('.line-tags');
  const chipsTag = tags.slice(0, MAX_TAGS_LINHA).map(t => h('span', { class: 'tag', 'data-cor': t.cor, text: t.nome }));
  if (tags.length > MAX_TAGS_LINHA) chipsTag.push(h('span', { class: 'tag tag-mais', text: `+${tags.length - MAX_TAGS_LINHA}` }));
  tagsEl.replaceChildren(...chipsTag);

  // Indicadores
  const obs = observacoesDe(p.id);
  const faltam = obs.filter(x => x.tipo === 'falta').length;
  const meta = [];
  if (o.termo && !contem(p.titulo, o.termo)) {
    const achada = obs.find(x => contem(x.texto, o.termo));
    if (achada) meta.push(h('span', { class: 'meta-trecho' }, realcar(trecho(achada.texto, o.termo), o.termo)));
  }
  if (obs.length) {
    meta.push(h('span', {
      class: 'meta-item num', title: `${plural(obs.length, 'observação', 'observações')}` + (faltam ? `, ${faltam} em aberto` : ''),
    }, icone('note'), faltam && faltam < obs.length ? `${obs.length - faltam}/${obs.length}` : String(obs.length)));
  }
  if (p.aguardando) meta.push(h('span', { class: 'meta-item meta-espera', title: 'Aguardando' }, icone('wait'), h('span', { class: 'meta-rotulo', text: 'aguardando' })));
  if (p.prazo) {
    meta.push(h('span', { class: `meta-item num prazo-${situacaoPrazo(p.prazo)}`, title: `Prazo: ${p.prazo.split('-').reverse().join('/')}` },
      icone('cal'), rotuloPrazo(p.prazo)));
  }
  el.querySelector('.meta').replaceChildren(...meta);

  // Detalhe
  let det = el.querySelector('.detail');
  if (o.aberto) {
    if (!det) { det = criarDetalhe(); el.append(det); }
    atualizarDetalhe(det, p, obs, o);
  } else if (det) {
    det.remove();
  }
}

function criarDetalhe() {
  return h('div', { class: 'detail' },
    h('label', { class: 'd-field' },
      h('span', { class: 'd-label', text: 'Título' }),
      h('textarea', { class: 'd-title', rows: 1, 'data-campo': 'titulo', enterkeyhint: 'done' })),
    h('ul', { class: 'obs-list' }),
    // Formulário próprio: Enter (físico, numérico ou "Enviar" do celular) chega como submit.
    h('form', { class: 'obs-new', 'data-form': 'obs', autocomplete: 'off' },
      icone('plus'),
      h('input', { type: 'text', 'data-campo': 'obs', placeholder: 'Nova observação…  (“ok …” = já feita)', 'aria-label': 'Nova observação', enterkeyhint: 'send' })),
    h('div', { class: 'd-tags' }),
    h('div', { class: 'd-foot' }));
}

function atualizarDetalhe(det, p, obs, o) {
  const titulo = det.querySelector('.d-title');
  if (document.activeElement !== titulo && titulo.value !== p.titulo) titulo.value = p.titulo;
  ajustarAltura(titulo);

  det.querySelector('.obs-list').replaceChildren(...obs.map(x => h('li', { class: `obs obs-${x.tipo}`, 'data-obs': x.id },
    h('button', {
      class: 'obs-tipo', type: 'button', 'data-act': 'obs-alternar',
      'aria-label': x.tipo === 'ok' ? 'Marcar como em aberto' : 'Marcar como feita', title: x.tipo === 'ok' ? 'Feita' : 'Em aberto',
    }, icone('check')),
    h('span', { class: 'obs-data num', text: ddmm(x.data) }),
    h('span', { class: 'obs-texto' }, realcar(x.texto, o.termo)),
    h('button', { class: 'obs-x', type: 'button', 'data-act': 'obs-excluir', 'aria-label': 'Excluir observação' }, icone('x')))));

  const todas = tagsAtivas();
  const dTags = det.querySelector('.d-tags');
  if (!todas.length) {
    dTags.replaceChildren(h('span', { class: 'd-label', text: 'Tags' }),
      h('button', { class: 'chip chip-sm chip-ghost', type: 'button', 'data-act': 'abrir-tags' }, icone('plus'), 'Criar tags'));
  } else {
    dTags.replaceChildren(h('span', { class: 'd-label', text: 'Tags' }), ...todas.map(t => {
      const pos = p.tags.indexOf(t.id);
      return h('button', {
        class: 'chip chip-sm', type: 'button', 'data-act': 'tag-alternar', 'data-tag': t.id,
        'data-cor': t.cor, 'aria-pressed': String(pos >= 0),
      }, h('span', { class: 'dot' }), t.nome,
      pos >= 0 && p.tags.length > 1 ? h('span', { class: 'chip-pos num', text: String(pos + 1), title: pos === 0 ? 'Tag principal' : '' }) : null);
    }));
  }

  const foot = det.querySelector('.d-foot');
  const prazoAtual = foot.querySelector('input[type=date]');
  const editandoPrazo = prazoAtual && document.activeElement === prazoAtual;
  if (editandoPrazo) return; // não recria o seletor de data no meio do uso

  const prazo = h('label', { class: 'pill pill-data' + (p.prazo ? ' is-on' : ''), title: 'Prazo' },
    h('span', { class: 'pill-rotulo', text: 'Prazo' }),
    h('input', { type: 'date', 'data-campo': 'prazo', value: p.prazo || '', 'aria-label': 'Prazo' }));
  const limparPrazo = p.prazo
    ? h('button', { class: 'pill-x', type: 'button', 'data-act': 'limpar-prazo', 'aria-label': 'Tirar prazo' }, icone('x'))
    : null;
  const espera = h('button', {
    class: 'pill' + (p.aguardando ? ' is-on' : ''), type: 'button', 'data-act': 'aguardando', 'aria-pressed': String(p.aguardando),
  }, icone('wait'), 'Aguardando');

  const excluir = o.confirmar
    ? h('span', { class: 'confirm' },
      h('span', { text: 'Excluir esta pendência?' }),
      h('button', { class: 'btn btn-sm btn-danger', type: 'button', 'data-act': 'excluir-sim', text: 'Excluir' }),
      h('button', { class: 'btn btn-sm', type: 'button', 'data-act': 'excluir-nao', text: 'Cancelar' }))
    : h('button', { class: 'link-danger', type: 'button', 'data-act': 'excluir' }, icone('trash'), 'Excluir');

  foot.replaceChildren(h('span', { class: 'pill-group' }, prazo, limparPrazo), espera, h('span', { class: 'spacer' }), excluir);
}

export function ajustarAltura(ta) {
  if (!ta.isConnected) return; // fora da página não há como medir; o render chama de novo
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}
