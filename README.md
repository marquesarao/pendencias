# Pendências

App pessoal de pendências: PWA offline-first (HTML + CSS + JS puro) que sincroniza com uma
planilha Google por meio de um Apps Script publicado como Web App.

- Desenho completo e decisões: [docs/DESENHO.md](docs/DESENHO.md)
- API (para colar no editor do Apps Script): [apps-script/Code.gs](apps-script/Code.gs)

> **Segurança:** este repositório é público. O token e a URL do Web App **nunca** entram no
> código — o token fica nas Propriedades do script (no Google) e, no app, só no `localStorage`
> de cada aparelho.

---

## 1. Instalação da planilha e da API

Pré-requisito: a planilha **pendencias.app** já existe na sua conta Google e o editor do Apps
Script foi aberto **a partir dela** (na planilha: **Extensões → Apps Script**). Assim o script
fica vinculado à planilha e não precisa do ID dela no código.

### 1.1 Colar o código

1. No editor do Apps Script, na lateral esquerda, em **Arquivos**, abra `Código.gs`.
2. Apague todo o conteúdo (o `function myFunction() {}` padrão).
3. Copie **todo** o conteúdo de [`apps-script/Code.gs`](apps-script/Code.gs) e cole.
4. Salve (**Ctrl+S** ou o ícone de disquete). Opcional: renomeie o projeto no topo
   (ex.: "Pendências API").

### 1.2 Rodar `setupSheets()` — cria as abas

1. Na barra de cima, no seletor de função (ao lado de **Depurar**), escolha `setupSheets`.
2. Clique em **Executar**.
3. Na primeira execução o Google pede autorização — veja [1.3](#13-autorizações-da-primeira-execução).
4. No **Registro de execução** devem aparecer três linhas, uma por aba
   (`pendencias`, `observacoes`, `tags`), com as colunas criadas.
5. Confira na planilha: três abas novas, linha 1 em negrito e congelada. A aba vazia padrão
   (ex.: "Página1") pode ser apagada.

`setupSheets()` pode ser rodada de novo sem risco: só acrescenta o que falta e nunca apaga dados.
Ela também formata as colunas como **texto puro** — isso impede o Sheets de transformar datas
ISO e números em outra coisa. Se você editar a planilha à mão, mantenha `TRUE`/`FALSE` em
maiúsculas nas colunas `foco`, `feito`, `aguardando` e `excluido`.

### 1.3 Autorizações da primeira execução

Como o script é seu e não passou por verificação do Google, o fluxo é este:

1. **"Autorização necessária"** → **Revisar permissões**.
2. Escolha a conta Google dona da planilha.
3. **"O Google não verificou este app"** → clique em **Avançado** →
   **Acessar "Pendências API" (não seguro)**. É seguro: o "app" é o seu próprio script.
4. Na tela de permissões, marque o que for pedido e clique em **Permitir**/**Continuar**.
   O script declara `@OnlyCurrentDoc`, então a permissão pedida é apenas
   **"Ver e gerenciar planilhas em que este app foi instalado"** — ele só enxerga a
   planilha pendencias.app, não o resto do seu Drive.

Isso só acontece uma vez (ou de novo se uma versão futura do código pedir permissões novas).

### 1.4 Rodar `setupToken()` — cria o token secreto

1. No seletor de função, escolha `setupToken` e clique em **Executar**.
2. O **Registro de execução** mostra o token: 64 caracteres hexadecimais, gerados
   aleatoriamente pelo próprio Google (`Utilities.getUuid()` duas vezes, ~244 bits).
3. **Copie o token e guarde no seu gerenciador de senhas.** Ele será colado em
   Configurações do app em cada aparelho.

Onde o token fica: em **Configurações do projeto** (ícone de engrenagem na lateral esquerda) →
**Propriedades do script**, chave `TOKEN`. Ele **não** está no código, então o `Code.gs` pode
ficar público no GitHub sem problema. Para consultá-lo depois, abra essa tela.

- Rodar `setupToken()` de novo **não** troca um token existente (só avisa).
- Para trocar (ex.: se o token vazou), rode `trocarToken()` e depois atualize o token em
  cada aparelho. Não é preciso republicar.
- Se preferir escolher o token você mesmo: crie a propriedade `TOKEN` à mão nessa tela, com
  pelo menos 32 caracteres aleatórios (não use uma senha que você usa em outro lugar).

### 1.5 Testar no editor: `testarApi()`

1. Escolha `testarApi` e clique em **Executar**.
2. O registro deve mostrar uma série de ✓, terminando em **"Todos os testes passaram"**:
   - token inválido é recusado; requisição sem token é recusada;
   - corpo que não é JSON e ação desconhecida são recusados;
   - push grava linha nova; push mais antigo é ignorado (last-write-wins); push mais novo atualiza;
   - op com tabela desconhecida volta como erro sem derrubar o envio;
   - pull devolve a versão mais nova e não repete a linha no pull seguinte.
3. O teste deixa uma linha na aba `tags` com nome "teste da API (editado)" e
   `excluido = TRUE`. O app ignora linhas excluídas; pode apagá-la à mão.

Esse teste roda a função `doPost()` dentro do editor. O teste "de verdade", pela internet, vem
depois de publicar (1.7).

### 1.6 Publicar como Web App

1. Canto superior direito: **Implantar → Nova implantação**.
2. Em **Selecione o tipo** (engrenagem), escolha **App da Web**.
3. Preencha:
   - **Descrição:** `v1` (qualquer texto; ajuda a identificar versões).
   - **Executar como:** **Eu** (seu e-mail).
   - **Quem pode acessar:** **Qualquer pessoa**.
4. **Implantar**. Se pedir autorização de novo, repita o fluxo de 1.3.
5. Copie o **URL do app da Web** — termina em **`/exec`**. Guarde junto com o token.

Por que "Qualquer pessoa": o app chama a URL sem login do Google. Quem protege os dados é o
token — sem ele, toda requisição recebe `{"ok": false, "erro": "Token inválido."}`.

Não use a URL que termina em `/dev`: ela só funciona logado como dono e sempre roda o código
não publicado.

### 1.7 Testar pela internet

Substitua `URL` pela URL `/exec` e `TOKEN` pelo seu token. O Apps Script sempre responde
HTTP 200; o resultado está no campo `ok`.

**Opção A — console do navegador (é exatamente como o app vai chamar):**
abra qualquer página comum (ex.: `https://example.com`), pressione **F12 → Console** e cole:

```js
const URL = 'https://script.google.com/macros/s/SEU_ID/exec';
const TOKEN = 'SEU_TOKEN';
const chamar = corpo => fetch(URL, { method: 'POST', body: JSON.stringify(corpo) }).then(r => r.json());

// 1. Token inválido → { ok: false, erro: "Token inválido." }
await chamar({ token: 'errado', action: 'pull', since: 0 });

// 2. Push de uma tag de teste (excluido: true para o app ignorar)
await chamar({ token: TOKEN, action: 'push', ops: [{ table: 'tags', row: {
  id: 'teste-console', nome: 'teste console', cor: 'c2', ordem: 0,
  atualizadoEm: Date.now(), excluido: true } }] });
// → { ok: true, serverTime: ..., results: [{ table: "tags", id: "teste-console", status: "aplicado" }] }

// 3. Pull completo → { ok: true, serverTime, pendencias: [...], observacoes: [...], tags: [...] }
await chamar({ token: TOKEN, action: 'pull', since: 0 });
```

(Enviar uma string como `body` faz o navegador usar `Content-Type: text/plain`, que não
dispara preflight CORS.)

**Opção B — PowerShell (Windows):**

```powershell
$url = 'https://script.google.com/macros/s/SEU_ID/exec'
$token = 'SEU_TOKEN'

# Token inválido
Invoke-RestMethod -Uri $url -Method Post -ContentType 'text/plain' -Body '{"token":"errado","action":"pull","since":0}'

# Pull
$body = @{ token = $token; action = 'pull'; since = 0 } | ConvertTo-Json -Compress
Invoke-RestMethod -Uri $url -Method Post -ContentType 'text/plain' -Body $body | ConvertTo-Json -Depth 5
```

**Opção C — curl (Git Bash):** o `-L` é obrigatório, porque o Apps Script responde com um
redirecionamento para `script.googleusercontent.com`.

```bash
URL='https://script.google.com/macros/s/SEU_ID/exec'
TOKEN='SEU_TOKEN'

curl -sL -H 'Content-Type: text/plain' -d '{"token":"errado","action":"pull","since":0}' "$URL"

curl -sL -H 'Content-Type: text/plain' \
  -d "{\"token\":\"$TOKEN\",\"action\":\"pull\",\"since\":0}" "$URL"
```

Depois dos testes, apague à mão as linhas `teste-…` da aba `tags`, se quiser.

### 1.8 Republicar depois de alterar o código

Sempre que o `Code.gs` mudar:

1. Cole o código novo no editor e salve.
2. **Implantar → Gerenciar implantações**.
3. Selecione a implantação existente (ex.: "v1") e clique no **lápis (Editar)**.
4. Em **Versão**, escolha **Nova versão** (descrição: `v2`, `v3`…).
5. **Implantar**.

A URL `/exec` **continua a mesma** — nada muda nos aparelhos. Atenção: **Nova implantação**
cria uma URL diferente; use sempre "Gerenciar implantações → Editar".

### 1.9 Problemas comuns

| Resposta / sintoma | Causa e solução |
|---|---|
| `Token inválido.` | Token copiado errado (espaço sobrando?). Confira em Propriedades do script. |
| `Token não configurado no servidor…` | Rode `setupToken()`. |
| `Aba "…" não encontrada` / `sem a(s) coluna(s)` | Rode `setupSheets()`. |
| `Servidor ocupado…` | Duas sincronizações ao mesmo tempo demoraram; o app tenta de novo sozinho. |
| Página HTML do Google em vez de JSON | URL errada (`/dev` ou sem `/exec`), ou acesso não está como "Qualquer pessoa". |
| `Script function not found: doGet` | A URL foi aberta no navegador (GET). Normal: a API só aceita POST. |
| Mudança no código não surtiu efeito | Faltou republicar com **Nova versão** (1.8). |

---

## 2. Rodar o app localmente

*(Fatia 3.)*

## 3. Publicar no GitHub Pages

*(Fatia 5.)*
