// Cálculos do painel Resumo/Relatório, feitos no aparelho a partir do IndexedDB (funciona
// offline). Sempre ignora itens, etapas e tags excluídos. Datas no fuso local; semana de
// segunda a domingo. Datas como chave "AAAA-MM-DD" (comparação lexicográfica = cronológica).

import * as store from './store.js';
import { chaveDia, dataLocal, diasDesde } from './util.js';

const somarDias = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const diaDe = iso => chaveDia(new Date(iso));

export function inicioDaSemana(d = new Date()) {
  return somarDias(d, -((d.getDay() + 6) % 7)); // segunda-feira
}

// ---------------------------------------------------------------------------
// Períodos do relatório
// ---------------------------------------------------------------------------

export const PERIODOS = [
  ['hoje', 'Hoje'], ['semana', 'Esta semana'], ['semanaPassada', 'Semana passada'],
  ['mes', 'Este mês'], ['mesPassado', 'Mês passado'], ['personalizado', 'Personalizado'],
];

function ddmmChave(chave, comAno) {
  const [a, m, d] = chave.split('-');
  return comAno ? `${d}/${m}/${a}` : `${d}/${m}`;
}

/** @returns {{ ini: string, fim: string, rotulo: string }} chaves de dia, inclusivas */
export function periodo(tipo, de, ate) {
  const hoje = new Date();
  let ini;
  let fim;
  if (tipo === 'hoje') { ini = fim = hoje; }
  else if (tipo === 'semanaPassada') { ini = somarDias(inicioDaSemana(), -7); fim = somarDias(ini, 6); }
  else if (tipo === 'mes') { ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1); fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0); }
  else if (tipo === 'mesPassado') { ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1); fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0); }
  else if (tipo === 'personalizado' && de && ate) { ini = dataLocal(de <= ate ? de : ate); fim = dataLocal(de <= ate ? ate : de); }
  else { ini = inicioDaSemana(); fim = somarDias(ini, 6); } // "Esta semana" (e personalizado incompleto)
  const p = { ini: chaveDia(ini), fim: chaveDia(fim) };
  const anoAtual = String(hoje.getFullYear());
  const comAno = !p.ini.startsWith(anoAtual) || !p.fim.startsWith(anoAtual);
  p.rotulo = p.ini === p.fim ? ddmmChave(p.ini, comAno) : `${ddmmChave(p.ini, comAno)} a ${ddmmChave(p.fim, comAno)}`;
  return p;
}

const noPeriodo = (chave, p) => chave >= p.ini && chave <= p.fim;

// ---------------------------------------------------------------------------
// Aba Resumo
// ---------------------------------------------------------------------------

export function calcularResumo() {
  const hoje = chaveDia();
  const em7 = chaveDia(somarDias(new Date(), 7));
  const segunda = chaveDia(inicioDaSemana());
  const ativas = store.pendenciasAtivas(); // já sem excluídas
  const abertas = ativas.filter(p => !p.feito);
  const porPrazo = (a, b) => a.prazo.localeCompare(b.prazo) || a.ordem - b.ordem;

  const atrasadas = abertas.filter(p => p.prazo && p.prazo < hoje).sort(porPrazo);
  const prazoHoje = abertas.filter(p => p.prazo === hoje).sort(porPrazo);
  const proximos = abertas.filter(p => p.prazo > hoje && p.prazo <= em7).sort(porPrazo);

  // Aguardando há mais tempo: data mais antiga primeiro; sem data (itens antigos) no fim.
  const aguardando = abertas.filter(p => p.aguardando).sort((a, b) => {
    if (!a.aguardandoEm !== !b.aguardandoEm) return a.aguardandoEm ? -1 : 1;
    return (a.aguardandoEm || '').localeCompare(b.aguardandoEm || '') || a.ordem - b.ordem;
  });

  const concluidasSemana = ativas.filter(p => p.feito && p.feitoEm && noPeriodo(diaDe(p.feitoEm), { ini: segunda, fim: hoje })).length;

  // Abertas por tag: um item com várias tags conta em cada uma.
  const porTag = store.tagsAtivas()
    .map((tag, i) => {
      const itens = abertas.filter(p => p.tags.includes(tag.id));
      return { tag, ordem: i, total: itens.length, aguardando: itens.filter(p => p.aguardando).length };
    })
    .filter(x => x.total > 0)
    .sort((a, b) => b.total - a.total || a.ordem - b.ordem);
  const semTagItens = abertas.filter(p => !store.tagsDe(p).length);
  const semTag = { total: semTagItens.length, aguardando: semTagItens.filter(p => p.aguardando).length };

  return {
    atrasadas, prazoHoje, proximos, aguardando, concluidasSemana, porTag, semTag,
    diasAguardando: p => (p.aguardandoEm ? diasDesde(p.aguardandoEm) : null),
  };
}

// ---------------------------------------------------------------------------
// Aba Relatório
// ---------------------------------------------------------------------------

/**
 * @param {{ ini, fim, rotulo }} per período
 * @param {string[]} filtroTags ids (OU); vazio = todas
 */
export function calcularRelatorio(per, filtroTags) {
  const ativas = store.pendenciasAtivas();
  const ordemTags = store.tagsAtivas().filter(t => !filtroTags.length || filtroTags.includes(t.id));
  const passaTag = p => !filtroTags.length || p.tags.some(id => filtroTags.includes(id));
  // Grupo = 1ª tag do item (entre as filtradas, se houver filtro); item aparece só nele.
  const grupoDe = p => {
    const tags = store.tagsDe(p);
    const t = filtroTags.length ? tags.find(x => filtroTags.includes(x.id)) : tags[0];
    return t ? t.id : 'sem';
  };
  const etapasDe = p => store.observacoesDe(p.id); // sem excluídas
  // Comentários escritos no período (pela data de criação), do mais antigo para o mais novo.
  const comentariosDoPeriodo = p => store.comentariosDe(p.id)
    .filter(c => noPeriodo(diaDe(c.criadoEm), per))
    .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
  // Movimentação no período: o item, uma etapa ou um comentário escrito nele.
  const alteradoNoPeriodo = p =>
    noPeriodo(diaDe(p.atualizadoEm), per) || etapasDe(p).some(o => noPeriodo(diaDe(o.atualizadoEm), per)) ||
    comentariosDoPeriodo(p).length > 0;

  const concluidas = ativas.filter(p => p.feito && p.feitoEm && noPeriodo(diaDe(p.feitoEm), per) && passaTag(p))
    .sort((a, b) => a.feitoEm.localeCompare(b.feitoEm));
  // Aguardando não se repete em "Em andamento".
  const andamento = ativas.filter(p => !p.feito && !p.aguardando && passaTag(p) && alteradoNoPeriodo(p))
    .sort((a, b) => a.ordem - b.ordem);
  const aguardando = ativas.filter(p => !p.feito && p.aguardando && passaTag(p))
    .sort((a, b) => (a.aguardandoEm || '9').localeCompare(b.aguardandoEm || '9') || a.ordem - b.ordem);

  const grupos = [...ordemTags.map(t => ({ id: t.id, tag: t })), ...(filtroTags.length ? [] : [{ id: 'sem', tag: null }])]
    .map(g => ({
      ...g,
      concluidas: concluidas.filter(p => grupoDe(p) === g.id),
      andamento: andamento.filter(p => grupoDe(p) === g.id),
      aguardando: aguardando.filter(p => grupoDe(p) === g.id),
    }))
    .filter(g => g.concluidas.length || g.andamento.length || g.aguardando.length);

  const etapasResumo = p => {
    const e = etapasDe(p);
    return { lista: e, feitas: e.filter(o => o.tipo === 'ok').length, total: e.length };
  };
  return {
    periodo: per, grupos, etapasResumo, comentariosDoPeriodo,
    totais: { concluidas: concluidas.length, andamento: andamento.length, aguardando: aguardando.length },
  };
}

/**
 * Texto simples para a área de transferência (formato combinado com o usuário).
 * Com comentários: sob cada item, "    03/11 10:14 — texto", linhas seguintes recuadas.
 */
export function textoRelatorio(rel, { comentarios = false } = {}) {
  const dois = n => String(n).padStart(2, '0');
  const dm = iso => { const d = new Date(iso); return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}`; };
  const dmh = iso => { const d = new Date(iso); return `${dm(iso)} ${dois(d.getHours())}:${dois(d.getMinutes())}`; };
  const comDoItem = p => (comentarios ? rel.comentariosDoPeriodo(p).map(c => {
    const [primeira, ...resto] = c.texto.split(/\r?\n/);
    return [`    ${dmh(c.criadoEm)} — ${primeira}`, ...resto.map(l => `      ${l}`)].join('\n');
  }) : []);
  const blocos = rel.grupos.map(g => {
    const linhas = [`${g.tag ? g.tag.nome : 'Sem tag'} — ${rel.periodo.rotulo}`];
    if (g.concluidas.length) {
      linhas.push('Concluídas:');
      for (const p of g.concluidas) {
        const e = rel.etapasResumo(p);
        linhas.push(`• ${p.titulo}${e.total ? ` (${e.feitas}/${e.total} etapas)` : ''} — ${dm(p.feitoEm)}`, ...comDoItem(p));
      }
    }
    if (g.andamento.length) {
      linhas.push('Em andamento:');
      for (const p of g.andamento) {
        const e = rel.etapasResumo(p);
        linhas.push(`• ${p.titulo}${e.total ? ` — ${e.feitas}/${e.total} etapas` : ''}`, ...comDoItem(p));
      }
    }
    if (g.aguardando.length) {
      linhas.push('Aguardando:');
      for (const p of g.aguardando) linhas.push(`• ${p.titulo} — ${p.aguardandoEm ? `desde ${dm(p.aguardandoEm)}` : 'sem data'}`, ...comDoItem(p));
    }
    return linhas.join('\n');
  });
  return blocos.join('\n\n') + '\n';
}
