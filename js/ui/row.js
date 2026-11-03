// Linha compacta da pendência e o detalhe expandido no lugar (sem modal).
// Na interface as "observações" se chamam "Etapas" (dados continuam em "observacoes").

import { h, icone, realcar, trecho, contem, reconciliar } from './dom.js';
import { tagsDe, tagsAtivas, observacoesDe, comentariosDe, MAX_COMENTARIO } from '../store.js';
import { ddmm, situacaoPrazo, rotuloPrazo, diasDesde, DIAS_ALERTA_AGUARDANDO } from '../util.js';
import { lerRascunho } from '../rascunhos.js';
import { textoComLinks, rotuloComentario, dataHora } from './comentarios.js';

const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

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
 *                     editandoTitulo, tagsAbertas, editandoEtapa (id da etapa em edição),
 *                     editandoComentario, confirmarComentario, comentariosAbertos (Set) }
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
  const comentarios = comentariosDe(p.id);
  const meta = [];
  if (o.termo && !contem(p.titulo, o.termo)) {
    const achada = etapas.find(x => contem(x.texto, o.termo)) || comentarios.find(x => contem(x.texto, o.termo));
    if (achada) meta.push(h('span', { class: 'meta-trecho' }, realcar(trecho(achada.texto.replace(/\s+/g, ' '), o.termo), o.termo)));
  }
  if (etapas.length) {
    meta.push(h('span', { class: 'meta-item num', title: `Etapas: ${feitas} de ${etapas.length} feitas` },
      icone('etapas'), `${feitas}/${etapas.length}`));
  }
  if (comentarios.length) {
    meta.push(h('span', { class: 'meta-item num', title: `Comentários: ${comentarios.length}` },
      icone('note'), String(comentarios.length)));
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
    if (!det) {
      det = criarDetalhe();
      det.querySelector('.cmt-campo').value = lerRascunho(p.id); // anotação não enviada volta
      el.append(det);
    }
    atualizarDetalhe(det, p, etapas, feitas, comentarios, o);
  } else if (det) {
    det.remove();
  }
}

// Ordem: ETAPAS → COMENTÁRIOS → TAGS → Prazo/Aguardando → Excluir (o título fica no cabeçalho).
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
    // COMENTÁRIOS: registro do que foi falado. Enter quebra linha; Ctrl+Enter (ou o botão) adiciona.
    h('section', { class: 'd-sec d-coment', 'aria-label': 'Comentários' },
      h('div', { class: 'd-cab' }, h('span', { class: 'd-label', text: 'Comentários' }), h('span', { class: 'd-cont num' })),
      h('form', { class: 'cmt-novo', 'data-form': 'cmt', autocomplete: 'off' },
        h('textarea', {
          class: 'cmt-campo', 'data-campo': 'cmt', rows: 2, placeholder: 'Escreva o que foi falado…',
          'aria-label': 'Novo comentário', 'aria-keyshortcuts': MAC ? 'Meta+Enter' : 'Control+Enter', spellcheck: 'true',
        }),
        h('div', { class: 'cmt-barra' },
          h('span', { class: 'cmt-limite num', 'aria-live': 'polite' }),
          h('span', { class: 'cmt-dica' }, h('kbd', { text: MAC ? '⌘' : 'Ctrl' }), '+', h('kbd', { text: 'Enter' }), ' adiciona'),
          h('button', { class: 'btn btn-sm btn-primary cmt-adicionar', type: 'submit', text: 'Adicionar' }))),
      h('ul', { class: 'cmt-lista' })),
    h('section', { class: 'd-sec d-tags-sec', 'aria-label': 'Tags' },
      h('div', { class: 'd-cab' }, h('span', { class: 'd-label', text: 'Tags' })),
      h('div', { class: 'd-tags' })),
    h('section', { class: 'd-sec d-foot' }),
    h('section', { class: 'd-sec d-fim' }));
}

function atualizarDetalhe(det, p, etapas, feitas, comentarios, o) {
  // ETAPAS
  det.querySelector('.d-etapas .d-cont').textContent = etapas.length ? `${feitas}/${etapas.length}` : '';
  // Linhas reaproveitadas por id (não recriadas a cada render): um campo em edição não perde o
  // foco, e o toque em outra etapa não é "engolido" quando a edição anterior salva e redesenha.
  const lista = det.querySelector('.obs-list');
  const existentes = new Map([...lista.children].map(li => [li.dataset.obs, li]));
  reconciliar(lista, etapas.map(x => {
    const li = existentes.get(x.id) || criarEtapa(x.id);
    atualizarEtapa(li, x, o);
    return li;
  }));

  // COMENTÁRIOS (mais recente primeiro); itens reaproveitados por id, como as etapas — a edição
  // aberta não perde o foco quando chega uma sincronização.
  det.querySelector('.d-coment .d-cont').textContent = comentarios.length ? String(comentarios.length) : '';
  atualizarContador(det.querySelector('.cmt-campo'));
  const listaC = det.querySelector('.cmt-lista');
  const existentesC = new Map([...listaC.children].map(li => [li.dataset.cmt, li]));
  reconciliar(listaC, comentarios.map(c => {
    const li = existentesC.get(c.id) || criarComentario(c.id);
    atualizarComentario(li, c, o);
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
    // Alça de arraste: só no hover do desktop; no celular arrasta segurando a linha.
    h('span', { class: 'obs-grip', 'aria-hidden': 'true', title: 'Arrastar para mudar a ordem' }, icone('grip')),
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
    texto.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown'); // mover a etapa
  }
}

function criarComentario(id) {
  return h('li', { class: 'cmt', 'data-cmt': id },
    h('div', { class: 'cmt-cab' }, h('span', { class: 'cmt-data num' }), h('span', { class: 'cmt-acoes' })),
    h('div', { class: 'cmt-corpo' }),
    h('div', { class: 'cmt-pe' }));
}

// Modos: "ver" (texto + Editar/Excluir), "editar" (campo + Salvar/Cancelar), "confirmar" (excluir?).
function atualizarComentario(li, c, o) {
  const modo = o.editandoComentario === c.id ? 'editar' : o.confirmarComentario === c.id ? 'confirmar' : 'ver';
  const quando = dataHora(c.criadoEm);
  const data = li.querySelector('.cmt-data');
  data.textContent = rotuloComentario(c);
  data.title = c.editadoEm ? `Escrito em ${quando}; editado em ${dataHora(c.editadoEm)}` : `Escrito em ${quando}`;

  const corpo = li.querySelector('.cmt-corpo');
  const acoes = li.querySelector('.cmt-acoes');
  const pe = li.querySelector('.cmt-pe');
  const mudouModo = li.dataset.estado !== modo;
  li.dataset.estado = modo;

  if (modo === 'editar') {
    if (mudouModo || !corpo.querySelector('.cmt-edit')) {
      const ta = h('textarea', { class: 'cmt-edit', rows: 2, 'aria-label': `Editar comentário de ${quando}`, spellcheck: 'true' });
      ta.value = c.texto;
      corpo.replaceChildren(ta);
      acoes.replaceChildren();
      pe.replaceChildren(h('div', { class: 'cmt-barra' },
        h('span', { class: 'cmt-limite num', 'aria-live': 'polite' }),
        h('button', { class: 'btn btn-sm', type: 'button', 'data-act': 'cmt-cancelar', text: 'Cancelar' }),
        h('button', { class: 'btn btn-sm btn-primary', type: 'button', 'data-act': 'cmt-salvar', text: 'Salvar' })));
    }
    return; // o campo não é tocado enquanto se edita
  }

  // Texto: só redesenha se mudou (um link ou "Ver tudo" focado não perde o foco à toa).
  const aberto = o.comentariosAbertos.has(c.id);
  const chave = `${c.texto}\u0000${o.termo || ''}`;
  let texto = corpo.querySelector('.cmt-texto');
  if (mudouModo || !texto) {
    texto = h('div', { class: 'cmt-texto' });
    corpo.replaceChildren(texto, h('button', { class: 'cmt-mais', type: 'button', 'data-act': 'cmt-mais', hidden: true }));
  }
  if (texto.dataset.chave !== chave) {
    texto.replaceChildren(textoComLinks(c.texto, o.termo));
    texto.dataset.chave = chave;
  }
  texto.classList.toggle('is-aberto', aberto);
  const mais = corpo.querySelector('.cmt-mais');
  mais.textContent = aberto ? 'Ver menos' : 'Ver tudo';
  mais.setAttribute('aria-expanded', String(aberto));

  if (modo === 'confirmar') {
    acoes.replaceChildren();
    if (mudouModo) {
      pe.replaceChildren(h('span', { class: 'confirm' },
        h('span', { text: 'Excluir este comentário?' }),
        h('button', { class: 'btn btn-sm btn-danger', type: 'button', 'data-act': 'cmt-excluir-sim', text: 'Excluir' }),
        h('button', { class: 'btn btn-sm', type: 'button', 'data-act': 'cmt-excluir-nao', text: 'Cancelar' })));
    }
  } else if (mudouModo || !acoes.children.length) {
    acoes.replaceChildren(
      h('button', { class: 'cmt-acao', type: 'button', 'data-act': 'cmt-editar', 'aria-label': `Editar comentário de ${quando}`, text: 'Editar' }),
      h('button', { class: 'cmt-acao cmt-acao-excluir', type: 'button', 'data-act': 'cmt-excluir', 'aria-label': `Excluir comentário de ${quando}`, text: 'Excluir' }));
    pe.replaceChildren();
  }
}

/**
 * Depois do desenho: "Ver tudo" só aparece se o texto recolhido (6 linhas) realmente corta algo.
 * Precisa do elemento na página para medir.
 */
export function medirComentarios(raiz) {
  for (const mais of raiz.querySelectorAll('.cmt-mais')) {
    const texto = mais.previousElementSibling;
    mais.hidden = texto.classList.contains('is-aberto') ? false : texto.scrollHeight <= texto.clientHeight + 1;
  }
}

/** Campo de comentário (novo ou em edição): contador perto do limite; "Adicionar" só com texto. */
export function atualizarContador(campo) {
  const n = campo.value.length;
  const caixa = campo.closest('.cmt-novo, .cmt');
  const limite = caixa?.querySelector('.cmt-limite');
  if (limite) {
    limite.textContent = n > MAX_COMENTARIO * 0.9 ? `${n.toLocaleString('pt-BR')} / ${MAX_COMENTARIO.toLocaleString('pt-BR')}` : '';
    limite.classList.toggle('is-alerta', n > MAX_COMENTARIO);
  }
  const botao = caixa?.querySelector('.cmt-adicionar');
  if (botao) botao.disabled = !campo.value.trim();
}

export function ajustarAltura(ta) {
  if (!ta.isConnected) return; // fora da página não há como medir; o render chama de novo
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}
