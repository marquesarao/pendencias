// Linha compacta da pendência e o detalhe expandido no lugar (sem modal).
// Na interface as "observações" se chamam "Etapas" (dados continuam em "observacoes").

import { h, icone, realcar, trecho, contem, reconciliar } from './dom.js';
import { tagsDe, tagsAtivas, observacoesDe } from '../store.js';
import { ddmm, situacaoPrazo, rotuloPrazo, diasDesde, DIAS_ALERTA_AGUARDANDO } from '../util.js';

const MAX_TAGS_LINHA = 2;

export function criarLinha(id) {
  const el = h('div', { class: 'row', 'data-id': id, role: 'listitem' },
    h('div', { class: 'line' },
      h('span', { class: 'grip', 'aria-hidden': 'true' }, icone('grip')),
      h('button', { class: 'check', type: 'button', role: 'checkbox', 'data-act': 'feito' },
        h('span', { class: 'check-box' }, icone('check'))),
      h('div', { class: 'line-main', 'data-act': 'abrir', role: 'button', tabindex: '0' },
        // Celular: bolinhas na cor das tags no lugar do rótulo escrito (desktop: oculto).
        h('span', { class: 'line-dots', role: 'img' }),
        h('span', { class: 'title' }, h('span', { class: 'title-text' })),
        h('span', { class: 'line-tags' }),
        h('span', { class: 'meta' })),
      // Edição do título no próprio cabeçalho (só aparece no item aberto, depois do lápis).
      h('textarea', {
        class: 'title-edit', rows: 1, 'data-campo': 'titulo', 'aria-label': 'Título', enterkeyhint: 'done', spellcheck: 'true',
      }),
      h('button', { class: 'editar', type: 'button', 'data-act': 'editar-titulo', 'aria-label': 'Editar título', title: 'Editar título' }, icone('pencil')),
      h('button', { class: 'star', type: 'button', 'data-act': 'foco' }, icone('star')),
      h('button', { class: 'fechar', type: 'button', 'data-act': 'fechar', 'aria-label': 'Fechar', title: 'Fechar (Esc)' }, icone('chevron-up'))));
  return el;
}

// "aguardando · hoje", "aguardando · 3 d"; sem data (itens antigos): só "aguardando".
function textoEspera(p) {
  if (!p.aguardandoEm) return { texto: 'aguardando', dias: null };
  const dias = diasDesde(p.aguardandoEm);
  return { texto: `aguardando · ${dias <= 0 ? 'hoje' : `${dias} d`}`, dias };
}

/**
 * @param {HTMLElement} el
 * @param {object} p pendência
 * @param {object} o { ocultarPrimeiraTag, termo (normalizado), aberto, selecionado, confirmar,
 *                     editandoTitulo, tagsAbertas, editandoEtapa (id da etapa em edição) }
 */
export function atualizarLinha(el, p, o) {
  el.classList.toggle('is-done', p.feito);
  el.classList.toggle('is-focus', p.foco);
  el.classList.toggle('is-open', o.aberto);
  el.classList.toggle('is-selected', o.selecionado);
  el.classList.toggle('is-editing', o.aberto && o.editandoTitulo);

  const check = el.querySelector('.check');
  check.setAttribute('aria-checked', String(p.feito));
  check.setAttribute('aria-label', p.feito ? 'Reabrir' : 'Concluir');

  const star = el.querySelector('.star');
  star.setAttribute('aria-pressed', String(p.foco));
  star.setAttribute('aria-label', p.foco ? 'Tirar do foco' : 'Pôr em foco');
  star.disabled = p.feito;

  const main = el.querySelector('.line-main');
  main.setAttribute('aria-expanded', String(o.aberto));
  main.setAttribute('aria-label', o.aberto ? `${p.titulo}. Recolher` : p.titulo);
  el.querySelector('.title-text').replaceChildren(realcar(p.titulo, o.termo));
  el.querySelector('.title').title = p.titulo;

  const edit = el.querySelector('.title-edit');
  if (document.activeElement !== edit && edit.value !== p.titulo) edit.value = p.titulo;

  // Bolinhas (celular): todas as tags do item, até 3, na ordem (a 1ª é a principal).
  const todasDoItem = tagsDe(p);
  const dots = el.querySelector('.line-dots');
  dots.replaceChildren(...todasDoItem.slice(0, 3).map(t => h('span', { class: 'line-dot', 'data-cor': t.cor })));
  if (todasDoItem.length) dots.setAttribute('aria-label', `Tags: ${todasDoItem.map(t => t.nome).join(', ')}`);
  else dots.removeAttribute('aria-label');
  dots.hidden = !todasDoItem.length;

  // Tags na linha
  let tags = todasDoItem;
  if (o.ocultarPrimeiraTag) tags = tags.slice(1);
  const chipsTag = tags.slice(0, MAX_TAGS_LINHA).map(t => h('span', { class: 'tag', 'data-cor': t.cor, text: t.nome }));
  if (tags.length > MAX_TAGS_LINHA) chipsTag.push(h('span', { class: 'tag tag-mais', text: `+${tags.length - MAX_TAGS_LINHA}` }));
  el.querySelector('.line-tags').replaceChildren(...chipsTag);

  // Indicadores
  const etapas = observacoesDe(p.id);
  const feitas = etapas.filter(x => x.tipo === 'ok').length;
  const meta = [];
  if (o.termo && !contem(p.titulo, o.termo)) {
    const achada = etapas.find(x => contem(x.texto, o.termo));
    if (achada) meta.push(h('span', { class: 'meta-trecho' }, realcar(trecho(achada.texto, o.termo), o.termo)));
  }
  if (etapas.length) {
    meta.push(h('span', { class: 'meta-item num', title: `Etapas: ${feitas} de ${etapas.length} feitas` },
      icone('etapas'), `${feitas}/${etapas.length}`));
  }
  if (p.aguardando) {
    const { texto, dias } = textoEspera(p);
    const alerta = dias !== null && dias >= DIAS_ALERTA_AGUARDANDO;
    meta.push(h('span', {
      class: 'meta-item meta-espera' + (alerta ? ' meta-espera-alerta' : ''),
      title: p.aguardandoEm ? `Aguardando desde ${ddmm(p.aguardandoEm)}${alerta ? ' — hora de cobrar' : ''}` : 'Aguardando',
    }, icone('wait'), h('span', { class: 'num', text: texto })));
  }
  if (p.prazo) {
    meta.push(h('span', { class: `meta-item num prazo-${situacaoPrazo(p.prazo)}`, title: `Prazo: ${p.prazo.split('-').reverse().join('/')}` },
      icone('cal'), rotuloPrazo(p.prazo)));
  }
  el.querySelector('.meta').replaceChildren(...meta);

  // Detalhe
  let det = el.querySelector('.detail');
  if (o.aberto) {
    if (!det) { det = criarDetalhe(); el.append(det); }
    atualizarDetalhe(det, p, etapas, feitas, o);
  } else if (det) {
    det.remove();
  }
}

// Ordem: ETAPAS → TAGS → Prazo/Aguardando → Excluir (o título fica no cabeçalho).
function criarDetalhe() {
  return h('div', { class: 'detail' },
    h('section', { class: 'd-sec d-etapas', 'aria-label': 'Etapas' },
      h('div', { class: 'd-cab' }, h('span', { class: 'd-label', text: 'Etapas' }), h('span', { class: 'd-cont num' })),
      h('div', { class: 'etapas' },
        h('ul', { class: 'obs-list' }),
        // Formulário próprio: Enter (físico, numérico ou "Enviar" do celular) chega como submit.
        h('form', { class: 'obs-new', 'data-form': 'obs', autocomplete: 'off' },
          icone('plus'),
          h('input', { type: 'text', 'data-campo': 'obs', placeholder: 'Nova etapa…  (“ok …” = já feita)', 'aria-label': 'Nova etapa', enterkeyhint: 'send' })))),
    h('section', { class: 'd-sec d-tags-sec', 'aria-label': 'Tags' },
      h('div', { class: 'd-cab' }, h('span', { class: 'd-label', text: 'Tags' })),
      h('div', { class: 'd-tags' })),
    h('section', { class: 'd-sec d-foot' }),
    h('section', { class: 'd-sec d-fim' }));
}

function atualizarDetalhe(det, p, etapas, feitas, o) {
  // ETAPAS
  det.querySelector('.d-cont').textContent = etapas.length ? `${feitas}/${etapas.length}` : '';
  // Linhas reaproveitadas por id (não recriadas a cada render): um campo em edição não perde o
  // foco, e o toque em outra etapa não é "engolido" quando a edição anterior salva e redesenha.
  const lista = det.querySelector('.obs-list');
  const existentes = new Map([...lista.children].map(li => [li.dataset.obs, li]));
  reconciliar(lista, etapas.map(x => {
    const li = existentes.get(x.id) || criarEtapa(x.id);
    atualizarEtapa(li, x, o);
    return li;
  }));

  // TAGS: compactas (só as marcadas + "+ Tag"); "+ Tag" abre a lista completa.
  const todas = tagsAtivas();
  const dTags = det.querySelector('.d-tags');
  // O redesenho troca os chips: guarda qual tinha o foco (teclado) para devolver depois.
  const tagComFoco = dTags.contains(document.activeElement) ? document.activeElement.dataset.tag : null;
  const marcadas = tagsDe(p);
  const selo = t => {
    const pos = p.tags.indexOf(t.id);
    return pos >= 0 && marcadas.length > 1 ? h('span', { class: 'chip-pos num', text: String(pos + 1), title: pos === 0 ? 'Tag principal' : '' }) : null;
  };
  dTags.classList.toggle('is-aberta', o.tagsAbertas);
  if (!todas.length) {
    dTags.replaceChildren(h('button', { class: 'chip chip-sm chip-ghost', type: 'button', 'data-act': 'abrir-tags' }, icone('plus'), 'Criar tags'));
  } else if (!o.tagsAbertas) {
    dTags.replaceChildren(
      ...marcadas.map(t => h('button', {
        class: 'chip chip-sm chip-tag', type: 'button', 'data-act': 'tags-expandir', 'data-tag': t.id,
        'data-cor': t.cor, 'aria-pressed': 'true', 'aria-label': `${t.nome}. Editar tags`,
      }, icone('check', 'chip-check'), t.nome, selo(t))),
      h('button', { class: 'chip chip-sm chip-ghost chip-mais', type: 'button', 'data-act': 'tags-expandir', 'aria-expanded': 'false' }, icone('plus'), 'Tag'));
  } else {
    dTags.replaceChildren(
      h('div', { class: 'tags-lista', role: 'group', 'aria-label': 'Escolher tags' }, ...todas.map(t => h('button', {
        class: 'chip chip-sm chip-tag', type: 'button', 'data-act': 'tag-alternar', 'data-tag': t.id,
        'data-cor': t.cor, 'aria-pressed': String(p.tags.includes(t.id)),
      }, h('span', { class: 'dot' }), icone('check', 'chip-check'), t.nome, selo(t)))),
      h('button', { class: 'btn btn-sm', type: 'button', 'data-act': 'tags-recolher', text: 'Concluir' }));
  }
  if (tagComFoco) dTags.querySelector(`[data-tag="${tagComFoco}"]`)?.focus();

  // Prazo / Aguardando (não recria o seletor de data no meio do uso)
  const foot = det.querySelector('.d-foot');
  const prazoAtual = foot.querySelector('input[type=date]');
  if (!(prazoAtual && document.activeElement === prazoAtual)) {
    const prazo = h('label', { class: 'pill pill-data' + (p.prazo ? ' is-on' : ''), title: 'Prazo' },
      h('span', { class: 'pill-rotulo', text: 'Prazo' }),
      h('input', { type: 'date', 'data-campo': 'prazo', value: p.prazo || '', 'aria-label': 'Prazo' }));
    const limparPrazo = p.prazo
      ? h('button', { class: 'pill-x', type: 'button', 'data-act': 'limpar-prazo', 'aria-label': 'Tirar prazo' }, icone('x'))
      : null;
    const espera = h('button', {
      class: 'pill' + (p.aguardando ? ' is-on' : ''), type: 'button', 'data-act': 'aguardando', 'aria-pressed': String(p.aguardando),
    }, icone('wait'), p.aguardando && p.aguardandoEm ? `Aguardando desde ${ddmm(p.aguardandoEm)}` : 'Aguardando');
    foot.replaceChildren(h('span', { class: 'pill-group' }, prazo, limparPrazo), espera);
  }

  // Excluir
  det.querySelector('.d-fim').replaceChildren(o.confirmar
    ? h('span', { class: 'confirm' },
      h('span', { text: 'Excluir esta pendência?' }),
      h('button', { class: 'btn btn-sm btn-danger', type: 'button', 'data-act': 'excluir-sim', text: 'Excluir' }),
      h('button', { class: 'btn btn-sm', type: 'button', 'data-act': 'excluir-nao', text: 'Cancelar' }))
    : h('button', { class: 'link-danger', type: 'button', 'data-act': 'excluir' }, icone('trash'), 'Excluir pendência'));
}

function criarEtapa(id) {
  return h('li', { class: 'obs', 'data-obs': id },
    h('button', { class: 'obs-tipo', type: 'button', 'data-act': 'obs-alternar' }, icone('check')),
    h('span', { class: 'obs-texto', role: 'button', tabindex: '0', 'data-act': 'obs-editar' }),
    h('button', { class: 'obs-x', type: 'button', 'data-act': 'obs-excluir', 'aria-label': 'Excluir etapa' }, icone('x')));
}

// Etapa: [○/✓ alterna] [texto — tocar edita no lugar] [× exclui]
function atualizarEtapa(li, x, o) {
  li.className = `obs obs-${x.tipo}`;
  li.title = `Anotada em ${ddmm(x.data)}`;
  li.querySelector('.obs-tipo').setAttribute('aria-label', x.tipo === 'ok' ? 'Marcar etapa como em aberto' : 'Marcar etapa como feita');

  const editando = o.editandoEtapa === x.id;
  let texto = li.querySelector('.obs-texto');
  let campo = li.querySelector('.obs-edit');
  if (editando && !campo) {
    // textarea (quebra linhas como o texto); o valor inicial vem do texto gravado
    campo = h('textarea', { class: 'obs-edit', rows: 1, 'aria-label': 'Editar etapa', enterkeyhint: 'send', spellcheck: 'true', text: x.texto });
    texto.replaceWith(campo);
  } else if (!editando && campo) {
    texto = h('span', { class: 'obs-texto', role: 'button', tabindex: '0', 'data-act': 'obs-editar' });
    campo.replaceWith(texto);
  }
  if (!editando) {
    texto.replaceChildren(realcar(x.texto, o.termo));
    texto.setAttribute('aria-label', `Editar etapa: ${x.texto}`);
  }
}

export function ajustarAltura(ta) {
  if (!ta.isConnected) return; // fora da página não há como medir; o render chama de novo
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}
