# Pendências — Desenho (fonte da verdade)

> Este documento descreve o que o app faz e como. Se algo mudar durante as fatias, ele é
> atualizado junto com o código. Histórico de alterações no fim.

## 0. Princípios

- PWA offline-first, HTML + CSS + JS puro (ES modules), sem frameworks e sem build.
- Hospedagem: GitHub Pages (`marquesarao/pendencias`, público). API: Google Apps Script vinculado
  à planilha `pendencias.app`.
- Nenhum segredo no repositório. URL do Web App e token ficam só no `localStorage` do aparelho.
- Interface em PT-BR. Uma fonte web local (Manrope variável, woff2, OFL).
- Pasta local: `C:\Users\leand\OneDrive\Desktop\IA\APP Pendências`.

## 1. Árvore de arquivos

```
index.html               casca única: cabeçalho, captura, chips, seções, painéis
manifest.webmanifest     (fatia 5)
sw.js                    (fatia 5)
css/app.css              tokens (:root claro/escuro), base, componentes, animações
js/app.js                inicialização, estado em memória, render, atalhos
js/db.js                 wrapper mínimo de IndexedDB
js/store.js              ações de domínio: grava local + enfileira na outbox
js/sync.js               (fatia 4) push/pull, LWW, status, agendamento
js/util.js               uuid, datas, normalização de texto, ordem fracionária
js/parse.js              captura "tag: texto", observação "ok …"
js/ui/list.js            seções Em foco / Todas, agrupamento, estados vazios
js/ui/row.js             linha compacta + expansão inline
js/ui/chips.js           chips de filtro com contagem
js/ui/drag.js            reordenação com Pointer Events (mouse e toque)
js/ui/panels.js          gaveta/folha: Concluídas, Tags, Configurações
js/ui/search.js          busca rápida
js/ui/toast.js           avisos discretos com ação
fonts/manrope-var.woff2, fonts/OFL.txt
icons/icon.svg, icon-192.png, icon-512.png, maskable-512.png
tools/                   (fatia 5) geração dos PNGs a partir do SVG — fora do app
apps-script/Code.gs      API (colado manualmente no editor do Apps Script)
docs/DESENHO.md          este documento
README.md, .gitignore
```

## 2. Planilha (linha 1 = cabeçalho)

| Aba | Colunas |
|---|---|
| `pendencias` | id, titulo, tags, foco, feito, feitoEm, prazo, aguardando, ordem, criadoEm, atualizadoEm, excluido, **servidorEm** |
| `observacoes` | id, pendenciaId, data, tipo, texto, ordem, atualizadoEm, excluido, **servidorEm** |
| `tags` | id, nome, cor, ordem, atualizadoEm, excluido, **servidorEm** |

- `id`: UUID gerado no app. `tags`: ids separados por `;` (ordem importa; a 1ª é a principal).
- `foco/feito/aguardando/excluido`: `TRUE`/`FALSE`.
- `feitoEm`, `criadoEm`, `data`: ISO 8601 completo (UTC). `prazo`: só data (`AAAA-MM-DD`).
- `atualizadoEm`: epoch ms, **definido pelo app** (base do last-write-wins).
- `servidorEm`: epoch ms, **carimbado pelo servidor** a cada gravação (base do pull incremental).
- `tipo` (observação): `ok` ou `falta`. `cor` (tag): `c1`…`c8`.
- Exclusão sempre lógica (`excluido=TRUE`).
- Todas as colunas formatadas como texto puro (`@`) para o Sheets não converter datas/números.
  O script converte por esquema ao ler e ao gravar. Texto iniciado por `=` é gravado com `'`
  na frente (para não virar fórmula) e o `'` é removido na leitura.
- O script lê o cabeçalho e localiza as colunas por nome (colunas extras são toleradas).

## 3. Modelo de dados local (IndexedDB `pendencias`, versão 1)

Tudo é carregado em memória ao abrir; a tela renderiza da memória; cada ação grava no
IndexedDB imediatamente.

| Store | Chave | Conteúdo |
|---|---|---|
| `pendencias` | `id` | `{id, titulo, tags:[id…], foco, feito, feitoEm, prazo, aguardando, ordem, criadoEm, atualizadoEm, excluido}` |
| `observacoes` | `id` (índice `pendenciaId`) | `{id, pendenciaId, data, tipo, texto, ordem, atualizadoEm, excluido}` |
| `tags` | `id` | `{id, nome, cor, ordem, atualizadoEm, excluido}` |
| `outbox` | `"tabela:id"` | `{table, row}` — foto completa e mais recente da linha |
| `meta` | `key` | `lastSync` |

- Local: booleanos JS e `tags` como array. Conversão para o formato de rede em `sync.js`.
- `servidorEm` não precisa ser guardado localmente (só o servidor usa).
- Outbox chaveada por `tabela:id`: várias edições offline do mesmo item viram uma única op
  (upsert da linha inteira).
- **`atualizadoEm` monotônico por linha:** ao editar, `atualizadoEm = max(Date.now(),
  atualizadoEmAtual + 1)`. Evita que um aparelho com relógio atrasado perca a própria edição.
- `ordem` fracionária (uma única coluna para foco e lista): ao arrastar, média dos vizinhos;
  só a linha movida muda. Novos itens entram no topo (`menor ordem − 1000`).
- Preferências (agrupar/lista corrida, tema) e URL/token: `localStorage`.
- UUID: `crypto.randomUUID()` com fallback via `crypto.getRandomValues`.

### Regras de domínio

- **Concluir:** `feito=true`, `feitoEm=agora`, `foco=false`. Fica riscado na lista enquanto
  `feitoEm` for hoje (fuso local); depois aparece só em Concluídas.
- **Reabrir:** `feito=false`, `feitoEm=""` (foco não volta).
- **Excluir pendência:** `excluido=true`; observações ficam órfãs e são ignoradas (sem cascata).
- **Excluir tag:** `excluido=true` na tag + remove o id dela de cada item (cada item vira uma op).
  Ids de tags inexistentes/excluídas são ignorados na tela.
- **Captura com prefixo:** regex `^([^:/]{1,24}):\s*(.+)$`, comparação sem maiúsculas/acentos
  (NFD). Tag existente → vincula e remove o prefixo do título. Tag inexistente → cria o item
  com o **texto original completo** e mostra "Tag 'X' não existe · Criar tag X"; ao aceitar,
  cria a tag, vincula e remove o prefixo do título.
- **Captura sem prefixo:** se há filtro de tag ativo, nasce com essa tag; senão, sem tag.
- **Observação:** começa com `ok ` ou `✓ ` → `tipo=ok` (prefixo removido); senão `falta`.
  Clique no ícone alterna. Data automática (exibida dd/mm).

## 4. Protocolo de sincronização

`POST` para a URL `/exec`, `Content-Type: text/plain`, corpo JSON. O Apps Script sempre
responde HTTP 200; o resultado está em `ok`.

```
→ { token, action: "pull", since: <epoch ms> }
← { ok: true, serverTime, pendencias: [...], observacoes: [...], tags: [...] }
   (linhas com servidorEm > since; booleanos JSON, números JSON, tags como "id1;id2")

→ { token, action: "push", ops: [ { table, row }, ... ] }      (máx. 500 ops)
← { ok: true, serverTime, results: [ { table, id, status: "aplicado"|"ignorado"|"erro", erro? } ] }

← { ok: false, erro: "mensagem" }      (token inválido, JSON inválido, ação desconhecida, etc.)
```

Servidor:
- Token em Propriedades do script (`TOKEN`), comparado em tempo constante.
- `LockService` (lock do script) em push **e** pull.
- Push: upsert por `id`; grava se `row.atualizadoEm >= atualizadoEm existente` (senão
  `ignorado`); carimba `servidorEm = Date.now()`. Campos ausentes na op mantêm o valor atual.
  Erros de validação afetam só a op.
- Pull: `serverTime = Date.now() − 1` (uma gravação no mesmo milissegundo logo depois ainda cai
  no próximo pull; repetir uma linha é inofensivo).

Cliente — `sincronizar()` (uma execução por vez):
1. **Push** da outbox em lotes de até 200. `aplicado`/`ignorado` → remove da outbox (só se a
   entrada não mudou durante o envio). `erro` → fica para a próxima.
2. **Pull** desde `lastSync`.
3. **Aplicar**: grava a remota se não existe local ou `remoto.atualizadoEm >= local.atualizadoEm`
   — exceto se houver op na outbox para o mesmo id com `atualizadoEm` maior (a local vence).
4. `lastSync = serverTime` do pull; re-render.

Gatilhos: ao abrir; `visibilitychange` (visível); evento `online`; a cada 60 s (online e
visível); botão "Sincronizar agora"; push com debounce de 2 s após a última edição.

Status no cabeçalho: Sincronizado · Pendente (n) · Sincronizando · Offline · Erro (toque abre
Configurações com a mensagem) · Só local (sem URL/token).

## 5. Telas

### Desktop (coluna central ~760 px; painéis como gaveta à direita ~420 px)

```
┌──────────────────────────────────────────────────────────────────────┐
│  ◉ Pendências                         ● Sincronizado   ⌕   ✓   #   ⚙ │
├──────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ +  Nova pendência…   (tag: texto)                           n │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  (Todas 24) (igreja 5) (casa 7) (trabalho 9) (saúde 3)               │
│                                                                      │
│  EM FOCO ─────────────────────────────────────────── fundo âmbar ──  │
│  ☐ [trabalho] Fechar proposta Randon        💬3  ⏳  12/11       ★   │
│  ☐ [casa] Orçamento do telhado               💬1               ★     │
│                                                                      │
│  TODAS                                       [Agrupar | Lista corrida]│
│  igreja · 5 ──────────────────────────────────────────────────────── │
│  ☐ Comprar cadeiras                          💬2               ☆     │
│  ☐ Falar com o pastor sobre o som   [casa]          05/11      ☆     │
│  ☑ R̶e̶s̶e̶r̶v̶a̶r̶ ̶s̶a̶l̶ã̶o̶                                           ☆     │
│  casa · 7 ────────────────────────────────────────────────────────── │
│  ▾ Renovar seguro do carro                   💬2  ⏳            ☆    │
│  │  Renovar seguro do carro______________ (título editável)          │
│  │  ✓ 28/10  Cotação Porto recebida                             ×    │
│  │  ○ 30/10  Pedir cotação Azul                                 ×    │
│  │  [ + nova observação…  (ok … = feito) ]                           │
│  │  Tags: (casa✓) (igreja) (trabalho) (saúde)                        │
│  │  Prazo [__/__/____]   ⏳ aguardando [ ]          Excluir pendência │
│  Sem tag · 3 ─────────────────────────────────────────────────────── │
└──────────────────────────────────────────────────────────────────────┘
```

- Linhas ~34 px (25–30 visíveis). Indicadores em cinza; prazo âmbar (hoje) / terracota (vencido).
- Alça de arraste no hover; item selecionado pelo teclado com anel sutil.
- Exclusão com confirmação inline ("Excluir mesmo? Sim · Não").

### Celular (captura fixa no topo; painéis como folha de baixo; linhas ≥ 44 px; safe-area)

```
┌────────────────────────────┐
│ ◉ Pendências   ●  ⌕  ☰     │  ← ☰: Concluídas · Tags · Config
│ ┌────────────────────────┐ │
│ │ + Nova pendência…      │ │  ← sticky
│ └────────────────────────┘ │
│ (Todas 24)(igreja 5)(casa →│  ← rolagem horizontal só nos chips
├────────────────────────────┤
│ EM FOCO                    │
│ ☐ Fechar proposta     ★    │
│   trabalho · 💬3 · 12/11   │  ← indicadores em 2ª linha pequena
│ TODAS            [≡ | ▤]   │
│ igreja · 5                 │
│ ☐ Comprar cadeiras    ☆    │
└────────────────────────────┘
```

### Regras de lista (aprovadas)

- Item em foco aparece **só** em "Em foco", não em "Todas".
- Modo **Agrupar**: grupos pela 1ª tag (cabeçalho fino com rótulo e contagem; "Sem tag" por
  último); a 1ª tag não é repetida na linha (as demais aparecem). Arraste **só dentro do grupo**;
  arrastar nunca altera tags.
- Modo **Lista corrida**: todas as tags na linha (até 2 + "+n").
- **Filtro de tag ativo** → lista corrida, sem cabeçalhos (mostra itens com a tag em qualquer
  posição).
- Chips: "Todas" + uma por tag, com contagem de abertas.
- Estados vazios convidativos ("Nada em foco. Toque na estrela de um item").

### Painéis

- **Concluídas:** por dia ("Hoje", "Ontem", "seg., 28/10"), botão "Reabrir"; últimos 30 dias +
  "Mostrar mais".
- **Tags:** criar, renomear, cor (paleta fixa de 8: azul, verde-água, verde, oliva, âmbar,
  terracota, rosa, violeta — cada uma com tom de texto e fundo suave para claro e escuro),
  reordenar, excluir (com confirmação; desvincula dos itens).
- **Configurações:** URL do Web App (valida `script.google.com/macros/s/…/exec`), token
  (mascarado), "Sincronizar agora", última sincronização/erro, tema Automático/Claro/Escuro,
  aviso suave sem configuração, e o estado do armazenamento: "Persistente" ou "Não
  persistente (o navegador pode apagar os dados se faltar espaço)" — ou "Indisponível neste
  navegador".
- **Armazenamento persistente:** ao iniciar, se `navigator.storage?.persist` existir, o app
  chama `navigator.storage.persisted()` e, se ainda não for persistente, `persist()`. O
  resultado alimenta o estado mostrado em Configurações (fatia 3).
- **Busca:** `/` ou ⌕ troca a barra de captura pela de busca; filtra título e observações dos
  itens abertos e concluídos hoje, destacando o trecho; `Esc` volta.

### Atalhos (desligados enquanto se digita)

`n` captura · `/` busca · `↑↓` seleciona · `Enter` abre/fecha · `f` foco · `espaço` feito ·
`Esc` fecha item → limpa busca → tira seleção.

### Visual

Estética calma, muito respiro, Manrope com números tabulares, tokens de cor em `:root`, claro/
escuro automáticos + manual. Microinterações (check animado, item concluído esmaece, estrela com
"pop"), respeitando `prefers-reduced-motion`; `navigator.vibrate` curto ao concluir.

## 6. Testes por fatia

- Fatia 2: função `testarApi()` no editor + chamadas externas (console do navegador /
  PowerShell / curl) descritas no README.
- Fatia 3: desktop via `http://localhost` (contexto seguro).
- Fatia 5: celular via GitHub Pages (https) — instalação como PWA.

## Histórico de alterações

- 2026-11-02 — Fatia 1 aprovada. Respostas: `servidorEm` adicionada; foco fora de "Todas";
  uma única `ordem`; arraste só dentro do grupo; filtro → lista corrida. Decisões aprovadas:
  pasta "APP Pendências", Manrope, debounce de 2 s, outbox com linha inteira, novos no topo,
  concluir tira a estrela, prefixo com tag inexistente mantém o texto, 1ª tag oculta no modo
  agrupado, script vinculado à planilha.
- 2026-11-02 — Fatia 2: detalhes do servidor (colunas como texto, `'` antes de `=`, localização
  de colunas por nome, campos ausentes mantêm valor, máx. 500 ops, `serverTime = agora − 1`,
  token gerado pelo próprio script) e regra de `atualizadoEm` monotônico no cliente.
- 2026-11-02 — Pedido para a fatia 3: `navigator.storage.persist()` ao iniciar e estado do
  armazenamento em Configurações.
