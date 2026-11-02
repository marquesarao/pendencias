// Painéis (gaveta à direita no desktop, folha de baixo no celular): Concluídas, Tags, Configurações.

import { h, icone } from './dom.js';
import { arrastavel } from './drag.js';
import { toast } from './toast.js';
import * as store from '../store.js';
import * as sync from '../sync.js';
import * as pwa from '../pwa.js';
import { chaveDia, rotuloDia, hhmm, plural } from '../util.js';

const TITULOS = { concluidas: 'Concluídas', tags: 'Tags', config: 'Configurações' };
const NOMES_CORES = {
  c1: 'Azul', c2: 'Verde-água', c3: 'Verde', c4: 'Oliva',
  c5: 'Laranja', c6: 'Marrom', c7: 'Rosa', c8: 'Violeta',
};
const DIAS_POR_PAGINA = 30;

let ctx;
let dialog;
let corpo;
const estado = {
  diasConcluidas: DIAS_POR_PAGINA, paleta: null, confirmarTag: null, erroTag: '',
  rascunho: null,        // { url, token } digitados e ainda não salvos
  mostrarToken: false,
  erroConexao: '',
  primeiraVez: null,     // { url, token, n } aguardando a decisão da primeira sincronização
  confirmarApagar: false,
};

export function iniciarPaineis(contexto) {
  ctx = contexto;
  dialog = document.getElementById('panel');
  corpo = document.getElementById('panel-body');

  dialog.addEventListener('click', e => {
    if (e.target === dialog) fecharPainel(); // clique no fundo escurecido
    if (e.target.closest('[data-close]')) fecharPainel();
  });
  dialog.addEventListener('cancel', e => { e.preventDefault(); fecharPainel(); });
  dialog.addEventListener('close', () => { ctx.ui.painel = null; });

  corpo.addEventListener('click', aoClicar);
  corpo.addEventListener('keydown', aoTeclar);
  corpo.addEventListener('change', aoMudar);
  corpo.addEventListener('input', aoDigitar);
  corpo.addEventListener('submit', e => {
    if (!e.target.matches('[data-form="conexao"]')) return;
    e.preventDefault();
    salvarConexao(e.target);
  });
  arrastarParaFechar();
  sync.aoMudarStatus(() => renderizarPainel());

  arrastavel(corpo, {
    item: '.tag-row', alca: '.grip',
    soltar: (zona, el, ids, i) => store.moverTag(el.dataset.id, ids[i - 1] || null, ids[i + 1] || null, ids),
  });
}

export function abrirPainel(nome) {
  if (ctx.ui.painel === nome && dialog.open) return;
  ctx.ui.painel = nome;
  estado.paleta = null;
  estado.confirmarTag = null;
  estado.erroTag = '';
  estado.diasConcluidas = DIAS_POR_PAGINA;
  estado.rascunho = null;
  estado.mostrarToken = false;
  estado.erroConexao = '';
  estado.primeiraVez = null;
  estado.confirmarApagar = false;
  document.getElementById('panel-title').textContent = TITULOS[nome];
  dialog.dataset.painel = nome;
  renderizarPainel(true);
  if (!dialog.open) {
    dialog.classList.remove('saindo');
    dialog.showModal();
    dialog.focus(); // foco no painel, não no botão de fechar
    corpo.scrollTop = 0;
  }
}

export function fecharPainel() {
  if (!dialog.open || dialog.classList.contains('saindo')) return;
  dialog.classList.add('saindo');
  const fim = () => { dialog.classList.remove('saindo'); dialog.style.transform = ''; dialog.close(); };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return fim();
  dialog.addEventListener('animationend', fim, { once: true });
  setTimeout(() => dialog.open && fim(), 400);
}

/** Redesenha o painel aberto. Sem `forcar`, não mexe se o usuário está digitando nele. */
export function renderizarPainel(forcar = false) {
  if (!ctx.ui.painel) return;
  const ativo = document.activeElement;
  if (!forcar && dialog.contains(ativo) && ativo.matches('input, textarea')) return;
  const desenhar = { concluidas: painelConcluidas, tags: painelTags, config: painelConfig }[ctx.ui.painel];
  corpo.replaceChildren(...desenhar().filter(Boolean));
}

// ---------------------------------------------------------------------------
// Concluídas
// ---------------------------------------------------------------------------

function painelConcluidas() {
  const feitas = store.pendenciasAtivas()
    .filter(p => p.feito && p.feitoEm)
    .sort((a, b) => b.feitoEm.localeCompare(a.feitoEm));
  if (!feitas.length) {
    return [vazioPainel('done', 'Nada concluído ainda.', 'Quando você marcar uma pendência como feita, ela aparece aqui, organizada por dia.')];
  }

  const limite = chaveDia(new Date(Date.now() - estado.diasConcluidas * 864e5));
  const dias = new Map();
  let ocultas = 0;
  for (const p of feitas) {
    const dia = chaveDia(new Date(p.feitoEm));
    if (dia < limite) { ocultas++; continue; }
    if (!dias.has(dia)) dias.set(dia, []);
    dias.get(dia).push(p);
  }

  const nos = [h('p', { class: 'p-intro' },
    'As concluídas de hoje continuam riscadas na lista até o fim do dia.')];
  for (const [dia, itens] of dias) {
    nos.push(h('section', { class: 'day' },
      h('h3', { class: 'p-label' }, rotuloDia(dia), h('span', { class: 'num', text: ` · ${itens.length}` })),
      h('ul', { class: 'done-list' }, itens.map(p => h('li', { class: 'done-item' },
        h('span', { class: 'done-check' }, icone('check')),
        h('span', { class: 'done-main' },
          h('span', { class: 'done-title', text: p.titulo }),
          h('span', { class: 'done-meta' },
            ...store.tagsDe(p).map(t => h('span', { class: 'tag', 'data-cor': t.cor, text: t.nome })),
            h('span', { class: 'num', text: hhmm(p.feitoEm) }))),
        h('button', { class: 'btn btn-sm', type: 'button', 'data-act': 'reabrir', 'data-id': p.id }, icone('undo'), 'Reabrir'))))));
  }
  if (ocultas) {
    nos.push(h('button', { class: 'btn btn-block', type: 'button', 'data-act': 'mais-concluidas' },
      `Mostrar mais (${ocultas} mais antigas)`));
  }
  return nos;
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

function painelTags() {
  const tags = store.tagsAtivas();
  const nova = h('form', { class: 'tag-new', 'data-form': 'nova-tag' },
    h('input', { type: 'text', name: 'nome', placeholder: 'Nova tag…', 'aria-label': 'Nome da nova tag', maxlength: 24, enterkeyhint: 'done', autocomplete: 'off' }),
    h('button', { class: 'btn btn-primary', type: 'submit' }, icone('plus'), 'Criar'));
  const erro = estado.erroTag ? h('p', { class: 'p-erro', text: estado.erroTag }) : null;

  if (!tags.length) {
    return [nova, erro, vazioPainel('tag', 'Nenhuma tag ainda.',
      'Tags agrupam e colorem suas pendências. Crie aqui ou direto na captura: escreva “casa: trocar a lâmpada” e toque em “Criar tag”.')];
  }

  const lista = h('ul', { class: 'tag-list' }, tags.map(t => {
    if (estado.confirmarTag === t.id) {
      const uso = store.usoDaTag(t.id);
      return h('li', { class: 'tag-row tag-confirm', 'data-id': t.id },
        h('span', {}, `Excluir “${t.nome}”?`, uso ? h('small', { text: ` Ela sai de ${plural(uso, 'pendência', 'pendências')}.` }) : null),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-sm btn-danger', type: 'button', 'data-act': 'tag-excluir-sim', 'data-id': t.id, text: 'Excluir' }),
        h('button', { class: 'btn btn-sm', type: 'button', 'data-act': 'tag-excluir-nao', text: 'Cancelar' }));
    }
    const abertas = store.pendenciasAtivas().filter(p => !p.feito && p.tags.includes(t.id)).length;
    return h('li', { class: 'tag-row', 'data-id': t.id },
      h('span', { class: 'grip', title: 'Arrastar para reordenar' }, icone('grip')),
      h('button', {
        class: 'swatch', type: 'button', 'data-act': 'paleta', 'data-id': t.id, 'data-cor': t.cor,
        'aria-label': `Cor: ${NOMES_CORES[t.cor]}. Trocar`, 'aria-expanded': String(estado.paleta === t.id),
      }),
      h('input', { class: 'tag-nome', type: 'text', value: t.nome, 'data-id': t.id, maxlength: 24, 'aria-label': 'Nome da tag', enterkeyhint: 'done', autocomplete: 'off' }),
      h('span', { class: 'tag-uso num', title: 'Pendências em aberto', text: String(abertas) }),
      h('button', { class: 'icon-btn icon-btn-sm', type: 'button', 'data-act': 'tag-excluir', 'data-id': t.id, 'aria-label': `Excluir tag ${t.nome}` }, icone('trash')),
      estado.paleta === t.id ? h('div', { class: 'palette', role: 'group', 'aria-label': 'Cores' },
        store.CORES.map(c => h('button', {
          class: 'swatch', type: 'button', 'data-act': 'cor', 'data-id': t.id, 'data-valor': c, 'data-cor': c,
          'aria-label': NOMES_CORES[c], 'aria-pressed': String(t.cor === c), title: NOMES_CORES[c],
        }))) : null);
  }));

  return [nova, erro, lista, h('p', { class: 'p-nota', text: 'Arraste pela alça para mudar a ordem — ela vale para os chips e para os grupos da lista.' })];
}

// ---------------------------------------------------------------------------
// Configurações
// ---------------------------------------------------------------------------

function painelConfig() {
  const { ui } = ctx;
  const tema = ui.tema;
  const opcaoTema = (valor, rotulo) => h('button', {
    type: 'button', 'data-act': 'tema', 'data-valor': valor, 'aria-pressed': String(tema === valor), text: rotulo,
  });

  const arm = {
    verificando: ['Verificando…', 'neutro', ''],
    persistente: ['Persistente', 'ok', 'O navegador não apaga estes dados sozinho, nem com pouco espaço livre.'],
    nao: ['Não persistente', 'aviso', 'Se faltar espaço, o navegador pode apagar os dados deste site. Instalar o app ou usá-lo com frequência costuma liberar o modo persistente.'],
    indisponivel: ['Indisponível neste navegador', 'neutro', 'Este navegador não informa se o armazenamento é persistente.'],
  }[ui.armazenamento];

  const pend = store.pendenciasAtivas();
  return [
    secaoSincronizacao(),

    secaoAplicativo(),

    h('section', { class: 'p-section' },
      h('h3', { class: 'p-label', text: 'Aparência' }),
      h('div', { class: 'seg seg-full', role: 'group', 'aria-label': 'Tema' },
        opcaoTema('auto', 'Automático'), opcaoTema('claro', 'Claro'), opcaoTema('escuro', 'Escuro'))),

    h('section', { class: 'p-section' },
      h('h3', { class: 'p-label', text: 'Armazenamento' }),
      h('div', { class: 'card' },
        h('div', { class: 'card-row' },
          h('span', { text: 'Dados neste aparelho' }),
          h('span', { class: `status status-${arm[1]}`, text: arm[0] })),
        arm[2] ? h('p', { class: 'card-nota', text: arm[2] }) : null,
        ui.armazenamento === 'nao'
          ? h('button', { class: 'btn btn-sm', type: 'button', 'data-act': 'persistir', text: 'Pedir de novo' }) : null,
        h('p', { class: 'card-nota num' },
          `${plural(pend.filter(p => !p.feito).length, 'pendência aberta', 'pendências abertas')} · ` +
          `${plural(pend.filter(p => p.feito).length, 'concluída', 'concluídas')} · ` +
          `${plural(store.tagsAtivas().length, 'tag', 'tags')}`),
        blocoApagar())),

    h('section', { class: 'p-section p-atalhos' },
      h('h3', { class: 'p-label', text: 'Atalhos de teclado' }),
      h('dl', { class: 'atalhos' }, ...[
        ['n', 'nova pendência'], ['/', 'buscar'], ['↑ ↓', 'navegar pelos itens'], ['Enter', 'abrir ou fechar o item'],
        ['f', 'pôr ou tirar do foco'], ['espaço', 'concluir ou reabrir'], ['Esc', 'fechar / limpar'],
      ].flatMap(([k, d]) => [h('dt', {}, ...k.split(' ').map(x => h('kbd', { text: x }))), h('dd', { text: d })]))),
  ];
}

const ROTULO_STATUS = {
  ok: ['Sincronizado', 'ok'], pendente: ['Pendente', 'aviso'], sincronizando: ['Sincronizando…', 'neutro'],
  offline: ['Offline', 'neutro'], erro: ['Erro', 'erro'], local: ['Não conectado', 'neutro'],
};

// "hoje às 14:32", "ontem às 09:10", "seg., 28/10 às 18:00"
export function quando(ms) {
  if (!ms) return 'nunca';
  const dia = rotuloDia(chaveDia(new Date(ms)));
  return `${/^(Hoje|Ontem)$/.test(dia) ? dia.toLowerCase() : dia} às ${hhmm(ms)}`;
}

function secaoSincronizacao() {
  const st = sync.estado;
  const conectado = sync.configurado();
  const cfg = estado.rascunho || sync.lerConfig();
  const pendentes = store.qtdPendentes();
  const [rotulo, tom] = ROTULO_STATUS[st.status];

  const situacao = conectado
    ? h('div', { class: 'card' },
      h('div', { class: 'card-row' },
        h('span', { text: 'Planilha' }),
        h('span', { class: `status status-${tom}`, text: st.status === 'pendente' ? `${rotulo} (${pendentes})` : rotulo })),
      h('p', { class: 'card-nota num' }, `Última sincronização: ${quando(st.ultimaSyncEm)}`,
        pendentes ? ` · ${plural(pendentes, 'alteração na fila', 'alterações na fila')}` : ''),
      st.ultimoErro ? h('p', { class: 'p-erro', role: 'alert' }, h('strong', { text: 'Último erro: ' }), st.ultimoErro) : null,
      h('button', {
        class: 'btn btn-primary btn-sm', type: 'button', 'data-act': 'sincronizar', disabled: st.emAndamento,
      }, icone('cloud'), st.emAndamento ? 'Sincronizando…' : 'Sincronizar agora'))
    : h('div', { class: 'card card-soft' },
      icone('cloud', 'card-icon'),
      h('div', {},
        h('strong', { text: 'Só neste aparelho, por enquanto.' }),
        h('p', { text: 'Cole abaixo a URL do App da Web (termina em /exec) e o token do Apps Script para usar o mesmo conteúdo no desktop e no celular.' })));

  const pv = estado.primeiraVez;
  const pergunta = pv
    ? h('div', { class: 'card card-alerta', role: 'alertdialog', 'aria-label': 'Primeira sincronização' },
      h('p', {}, h('strong', { text: `Este aparelho tem ${plural(pv.n, 'item', 'itens')} que nunca ${pv.n === 1 ? 'foi sincronizado' : 'foram sincronizados'}.` }),
        ' (Pendências, etapas e tags.)'),
      h('div', { class: 'botoes' },
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', 'data-act': 'primeira-enviar', text: 'Enviar para a planilha' }),
        h('button', { class: 'btn btn-danger btn-sm', type: 'button', 'data-act': 'primeira-baixar', text: 'Apagar e baixar da planilha' }),
        h('button', { class: 'btn btn-sm', type: 'button', 'data-act': 'primeira-cancelar', text: 'Cancelar' })))
    : null;

  // Um único form com botão de envio: Enter em qualquer campo envia (implicit submission).
  const form = h('form', { class: 'form-conexao', 'data-form': 'conexao', autocomplete: 'off', novalidate: true },
    h('label', { class: 'campo' },
      h('span', { class: 'campo-rotulo', text: 'URL do App da Web' }),
      h('input', {
        type: 'url', 'data-campo': 'url', value: cfg.url, inputmode: 'url', spellcheck: 'false',
        placeholder: 'https://script.google.com/macros/s/…/exec',
      })),
    h('label', { class: 'campo' },
      h('span', { class: 'campo-rotulo', text: 'Token' }),
      h('span', { class: 'campo-linha' },
        h('input', {
          type: estado.mostrarToken ? 'text' : 'password', 'data-campo': 'token', value: cfg.token,
          spellcheck: 'false', autocomplete: 'off',
        }),
        h('button', {
          class: 'btn btn-sm', type: 'button', 'data-act': 'mostrar-token',
          'aria-pressed': String(!!estado.mostrarToken), text: estado.mostrarToken ? 'Ocultar' : 'Mostrar',
        }))),
    estado.erroConexao ? h('p', { class: 'p-erro', role: 'alert', text: estado.erroConexao }) : null,
    pv ? null : h('button', { class: 'btn btn-primary', type: 'submit', text: conectado ? 'Salvar' : 'Conectar e sincronizar' }),
    h('p', { class: 'card-nota', text: 'A URL e o token ficam guardados só neste aparelho (nunca no código do app).' }));

  return h('section', { class: 'p-section' },
    h('h3', { class: 'p-label', text: 'Sincronização' }),
    situacao, form, pergunta);
}

function secaoAplicativo() {
  const p = pwa.estado;
  const situacao = p.instalado ? ['Instalado', 'ok'] : ['No navegador', 'neutro'];
  return h('section', { class: 'p-section' },
    h('h3', { class: 'p-label', text: 'Aplicativo' }),
    h('div', { class: 'card' },
      h('div', { class: 'card-row' },
        h('span', { class: 'num', text: `Versão ${p.versao || '—'}` }),
        h('span', { class: `status status-${situacao[1]}`, text: situacao[0] })),
      p.atualizacao
        ? h('div', { class: 'card-row card-row-acao' },
          h('span', { text: 'Nova versão disponível.' }),
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', 'data-act': 'atualizar-app', text: 'Atualizar' }))
        : null,
      p.podeInstalar && !p.instalado
        ? [h('p', { class: 'card-nota', text: 'Instale para abrir pelo ícone, em tela cheia e mesmo sem internet.' }),
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', 'data-act': 'instalar-app', text: 'Instalar app' })]
        : null));
}

function blocoApagar() {
  if (!estado.confirmarApagar) {
    return h('button', { class: 'link-danger', type: 'button', 'data-act': 'apagar' }, icone('trash'), 'Apagar dados deste aparelho');
  }
  const n = store.qtdPendentes();
  return h('div', { class: 'card-alerta', role: 'alertdialog', 'aria-label': 'Apagar dados deste aparelho' },
    h('p', {},
      h('strong', { text: 'Apagar tudo deste aparelho?' }),
      ' Pendências, etapas, tags e fila de envio. A planilha não é afetada.',
      sync.configurado() ? ' Como este aparelho está conectado, o conteúdo da planilha é baixado de novo em seguida.' : null,
      n ? h('strong', { class: 'texto-perigo', text: ` ${plural(n, 'alteração ainda não sincronizada será perdida', 'alterações ainda não sincronizadas serão perdidas')}.` }) : null),
    h('div', { class: 'botoes' },
      h('button', { class: 'btn btn-danger btn-sm', type: 'button', 'data-act': 'apagar-sim', text: 'Apagar' }),
      h('button', { class: 'btn btn-sm', type: 'button', 'data-act': 'apagar-nao', text: 'Cancelar' })));
}

function vazioPainel(ico, titulo, texto) {
  return h('div', { class: 'p-vazio' }, icone(ico), h('strong', { text: titulo }), h('p', { text: texto }));
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

function aoClicar(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const id = b.dataset.id;
  switch (b.dataset.act) {
    case 'reabrir': {
      store.alternarFeito(id);
      const p = store.dados.pendencias.get(id);
      toast(`“${p.titulo}” voltou para a lista.`);
      break;
    }
    case 'mais-concluidas': estado.diasConcluidas += DIAS_POR_PAGINA; break;
    case 'paleta': estado.paleta = estado.paleta === id ? null : id; break;
    case 'cor': store.corDaTag(id, b.dataset.valor); estado.paleta = null; break;
    case 'tag-excluir': estado.confirmarTag = id; estado.paleta = null; break;
    case 'tag-excluir-nao': estado.confirmarTag = null; break;
    case 'tag-excluir-sim': {
      const nome = store.dados.tags.get(id).nome;
      estado.confirmarTag = null;
      store.excluirTag(id);
      toast(`Tag “${nome}” excluída.`);
      break;
    }
    case 'tema': ctx.definirTema(b.dataset.valor); break;
    case 'persistir': ctx.verificarArmazenamento(true); break;
    case 'sincronizar': sync.sincronizar(); break;
    case 'mostrar-token': estado.mostrarToken = !estado.mostrarToken; break;
    case 'primeira-enviar': return decidirPrimeiraVez('enviar');
    case 'primeira-baixar': return decidirPrimeiraVez('baixar');
    case 'primeira-cancelar': estado.primeiraVez = null; break;
    case 'apagar': estado.confirmarApagar = true; break;
    case 'apagar-nao': estado.confirmarApagar = false; break;
    case 'apagar-sim': return apagarEsteAparelho();
    case 'atualizar-app': pwa.atualizar(); return;
    case 'instalar-app': pwa.instalar(); return;
    default: return;
  }
  renderizarPainel(true);
}

// Guarda o que foi digitado em URL/token, para um redesenho do painel não apagar o rascunho.
function aoDigitar(e) {
  const campo = e.target.dataset.campo;
  if (campo !== 'url' && campo !== 'token') return;
  estado.rascunho = { ...(estado.rascunho || sync.lerConfig()), [campo]: e.target.value };
}

async function salvarConexao(form) {
  const url = form.querySelector('[data-campo="url"]').value.trim();
  const token = form.querySelector('[data-campo="token"]').value.trim();
  estado.erroConexao = '';
  if (!sync.urlValida(url)) {
    estado.erroConexao = 'Use a URL do App da Web: https://script.google.com/macros/s/…/exec';
  } else if (!token) {
    estado.erroConexao = 'Informe o token (está em Configurações do projeto → Propriedades do script).';
  } else if (sync.precisaConfirmarPrimeiraVez(url)) {
    estado.primeiraVez = { url, token, n: store.totalLinhas() };
  } else {
    await sync.salvarConfig({ url, token });
    estado.rascunho = null;
    sync.sincronizar();
    toast('Conexão salva. Sincronizando…');
  }
  renderizarPainel(true);
}

async function decidirPrimeiraVez(opcao) {
  const { url, token } = estado.primeiraVez;
  estado.primeiraVez = null;
  try {
    await sync.salvarConfig({ url, token });
    estado.rascunho = null;
    if (opcao === 'baixar') {
      await zerarAparelho();
      sync.sincronizar(); // baixa tudo da planilha
      toast('Dados locais apagados. Baixando da planilha…');
      renderizarPainel(true);
      return;
    }
    await store.enfileirarTudo();
    sync.sincronizar();
    toast('Enviando os dados deste aparelho para a planilha…');
  } catch (err) {
    console.error('[Pendências] Primeira sincronização:', err);
    toast(`Não foi possível concluir: ${err.message || err}`, { tipo: 'erro' });
  }
  renderizarPainel(true);
}

// Limpa IndexedDB (tabelas, fila, lastSync) e a tela, sem recarregar a página — funciona offline.
// URL/token e preferências (tema, agrupar) ficam no localStorage, intocados.
async function zerarAparelho() {
  await store.apagarTudo();
  sync.esquecerHistorico();
  ctx.limparTela();
}

async function apagarEsteAparelho() {
  try {
    await zerarAparelho();
    estado.confirmarApagar = false;
    fecharPainel();
    if (sync.configurado()) {
      sync.sincronizar();
      toast(navigator.onLine
        ? 'Dados deste aparelho apagados. Baixando de novo da planilha…'
        : 'Dados deste aparelho apagados. O conteúdo da planilha volta quando houver conexão.');
    } else {
      toast('Dados deste aparelho apagados.');
    }
  } catch (err) {
    console.error('[Pendências] Apagar dados:', err);
    toast(`Não foi possível apagar: ${err.message || err}`, { tipo: 'erro', tempo: 9000 });
  }
}

function aoTeclar(e) {
  if (e.target.matches('.tag-nome') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  if (e.target.matches('.tag-nome') && e.key === 'Escape') {
    e.target.value = store.dados.tags.get(e.target.dataset.id).nome;
    e.target.blur();
    e.stopPropagation();
  }
}

function aoMudar(e) {
  if (!e.target.matches('.tag-nome')) return;
  const r = store.renomearTag(e.target.dataset.id, e.target.value);
  if (r.erro) {
    toast(r.erro, { tipo: 'erro' });
    e.target.value = store.dados.tags.get(e.target.dataset.id).nome;
  }
}

document.addEventListener('submit', e => {
  if (!e.target.matches('[data-form="nova-tag"]')) return;
  e.preventDefault();
  const input = e.target.elements.nome;
  const r = store.criarTag(input.value);
  estado.erroTag = r.erro || '';
  renderizarPainel(true);
  corpo.querySelector('[data-form="nova-tag"] input')?.focus();
});

// Folha de baixo (celular): arrastar a alça ou o cabeçalho para baixo fecha.
function arrastarParaFechar() {
  let y0 = null;
  let dy = 0;
  const alvo = e => e.target.closest('.panel-grab, .panel-head') && !e.target.closest('button');
  dialog.addEventListener('pointerdown', e => {
    if (!matchMedia('(max-width: 640px)').matches || !alvo(e)) return;
    y0 = e.clientY;
    dy = 0;
    dialog.setPointerCapture(e.pointerId);
    dialog.classList.add('puxando');
  });
  dialog.addEventListener('pointermove', e => {
    if (y0 == null) return;
    dy = Math.max(0, e.clientY - y0);
    dialog.style.transform = `translateY(${dy}px)`;
  });
  const soltar = () => {
    if (y0 == null) return;
    y0 = null;
    dialog.classList.remove('puxando');
    if (dy > 90) fecharPainel();
    else dialog.style.transform = '';
  };
  dialog.addEventListener('pointerup', soltar);
  dialog.addEventListener('pointercancel', soltar);
}
