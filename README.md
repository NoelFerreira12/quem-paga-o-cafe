# Quem Paga o Café

Decide quem paga o café da equipa de forma justa, tendo em conta o **tamanho da conta** e não
só quantas vezes cada um pagou.

Cada pessoa tem um **saldo = cafés que pagou − cafés que bebeu**. Quando alguém paga uma
rodada, ganha crédito igual ao número de presentes (pagar por 8 vale +8, não +1). Quem tem o
saldo mais baixo entre os presentes é o **mais provável** a pagar a seguir — não o escolhido à
força. O quadro "quem paga a seguir" ordena por saldo; empate desempata por quem menos pagou.

Site estático, corre em GitHub Pages, sem servidor próprio.

Dá para: adicionar/remover pessoas, **mudar nomes** (reescreve o histórico), escolher quem
está presente, sortear, **desfazer a última** ou **anular qualquer ronda** do histórico, e ver
os **números** no fundo. É instalável no telemóvel (menu do browser → adicionar ao ecrã
inicial).

---

## Como o sorteio decide

Primeiro corta-se quem pagou a ronda anterior: **ninguém paga duas vezes seguidas**. Essa
pessoa continua a beber (leva `+1` nas idas), só não entra no sorteio; na lista aparece com
`fora` em vez da percentagem. A única exceção é ser a única presente — aí paga na mesma.

Entre os que sobram, com `L = sorte/100` (barra de 10% a 30%) e `saldo(p) = pago − idas`:

```text
topo     = maior saldo entre os elegíveis
peso(p)  = (topo − saldo(p)) + 1
hipótese = (1 − L) · peso(p)/Σpeso  +  L · 1/n
```

Ou seja: uma parte proporcional à dívida, mais uma parte igual para todos. Propriedades:

- entre os elegíveis as hipóteses **somam sempre 100%** e nenhuma é 0 nem 100 — quem já pagou
  muito continua a poder calhar, só que raramente;
- o saldo do grupo **soma sempre zero** (uma ronda dá `+n` a quem paga e `−1` a cada presente),
  portanto ninguém pode "desaparecer" com crédito do nada;
- **zero repetições** em 200 000 rondas simuladas com 6 pessoas, a 10%, 20% e 30% de sorte, com
  a diferença entre quem mais e quem menos pagou entre 1 e 3 rondas (~33 333 cada);
- ao fim de 3000 rondas com 6 pessoas, essa diferença fica em 2 a 4 rondas (~500 cada);
- com 2 pessoas a regra torna-se alternância estrita (A, B, A, B…); com 1 pessoa presente, paga
  ela sempre — a exclusão só se aplica enquanto sobrar alguém.

Anular uma ronda repõe o estado inteiro que existia antes dela (contadores e histórico), por
isso o sorteio seguinte é uma aposta nova com os pesos originais: quem sair pode voltar a ser o
mesmo nome que foi anulado, e quem fica de fora passa a ser quem pagou a ronda que sobrou no
topo do histórico.

O nome sai **uma vez**, no momento da gravação, com estes pesos e com `crypto.getRandomValues`.
A animação é montada **depois**, já a saber o resultado, para acabar nesse nome — as fatias da
roleta têm o tamanho da hipótese real e o cartão final mostra a percentagem que essa pessoa
tinha. A animação nunca decide nada.

A percentagem mostrada na lista é calculada com o estado que o teu browser tem nesse instante;
se outra pessoa registar uma ronda entretanto, o sorteio usa o estado já atualizado (a
transação lê o documento antes de escrever).

---

## Como funciona o armazenamento

A app tem dois modos e escolhe sozinha:

| Modo | Quando | O que acontece |
|---|---|---|
| **Nuvem** | `firebaseConfig` preenchido em [config.js](config.js) | Uma só folha partilhada. Toda a gente vê e edita os mesmos dados, em tempo real. |
| **Local** | `firebaseConfig` a `null` (estado inicial) | Cada browser tem a sua cópia em `localStorage`. Nada é partilhado. |

O canto superior direito mostra sempre em que modo estás.

Enquanto o Firebase não estiver configurado o site **já funciona** — só não é partilhado.

---

## Ligar a base de dados partilhada

> **Já está feito.** O projeto Firestore `quem-paga-o-cafe` está ligado e o site corre em modo
> nuvem. Os passos abaixo ficam registados só para o caso de ser preciso recriar o projeto.

1. Vai a <https://console.firebase.google.com> → **Add project**. Nome à escolha, podes
   desligar o Google Analytics.
2. No menu lateral: **Build → Firestore Database → Create database**.
   Escolhe **Production mode** e a região `eur3 (europe-west)`.
3. Separador **Rules**, cola isto e carrega em **Publish**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /cafe/ledger {
         allow read, write: if true;
       }
       match /{document=**} {
         allow read, write: if false;
       }
     }
   }
   ```

4. Ícone da engrenagem → **Project settings** → secção **Your apps** → ícone `</>` (Web) →
   dá-lhe um nome → **Register app**. O Firebase mostra um bloco `firebaseConfig`.
5. Copia esse bloco para [config.js](config.js), substituindo o `null`:

   ```js
   export const firebaseConfig = {
     apiKey: "…",
     authDomain: "….firebaseapp.com",
     projectId: "…",
     storageBucket: "….appspot.com",
     messagingSenderId: "…",
     appId: "1:…"
   };
   ```

6. `git commit` + `git push`. Na primeira visita a app cria o documento `cafe/ledger`
   já com a equipa e o histórico de [config.js](config.js).

Estas chaves são públicas por design — o Firebase conta com isso e a proteção real está nas
regras acima. Não há mais nada a manter: o plano gratuito (Spark) cobre isto muitas ordens de
grandeza acima do uso de uma equipa de 6 pessoas.

---

## Palavra-passe

Pergunta ao Noel. Não fica escrita aqui.

No código existe apenas o hash SHA-256 dela, nunca o texto. Para mudar, gera o hash novo na
consola do browser (F12):

```js
crypto.subtle.digest('SHA-256', new TextEncoder().encode('a-tua-password'))
  .then(d => console.log([...new Uint8Array(d)].map(b => b.toString(16).padStart(2,'0')).join('')));
```

e cola o resultado em `SHARED_PASSWORD_HASH` dentro de [config.js](config.js). Quem já tinha
entrado é obrigado a introduzir a nova.

> **Isto não é segurança a sério, e tornar o repositório privado não mudaria nada.**
>
> Numa página estática o browser de cada visitante tem de descarregar todos os ficheiros para
> a página funcionar. `config.js` está sempre acessível em
> `https://noelferreira12.github.io/quem-paga-o-cafe/config.js`, venha o repositório de onde
> vier. O hash e as chaves do Firebase são públicos na prática.
>
> O cadeado corre no browser do visitante, logo é sempre contornável por quem saiba ler
> código. Serve para travar cliques acidentais e curiosos, não um atacante. O pior caso é
> alguém estragar as contagens dos cafés.
>
> Para proteger mesmo os dados seria preciso Firebase Authentication com contas por pessoa e
> a regra `allow read, write: if request.auth != null` — aí o Firestore recusa servir o
> documento a quem não tenha sessão válida, e contornar o ecrã de entrada deixa de servir de
> nada.

---

## Ficheiros

| Ficheiro | Papel |
|---|---|
| [index.html](index.html) | Estrutura da página |
| [styles.css](styles.css) | Todo o aspeto visual |
| [config.js](config.js) | Password, ligação ao Firebase e dados iniciais |
| [store.js](store.js) | Camada de dados: Firestore ou `localStorage` |
| [auth.js](auth.js) | Ecrã de entrada |
| [app.js](app.js) | Regras do sorteio, palco da animação e desenho dos painéis |

O sorteio abre em ecrã inteiro. Há dois modos, escolhidos no cartão "quem está hoje" e
guardados no browser (`cafeAnim_v1`): **caixa** (a caixa abana, abre, o feixe sai e a fita
corre até ao nome) e **roleta** (roda com as fatias do tamanho da hipótese real). O botão do
altifalante liga/desliga os efeitos (`cafeSound_v1`, WebAudio, sem ficheiros). Com
`prefers-reduced-motion` a animação é reduzida ao mínimo.

---

## Correr localmente

Os módulos ES e a Web Crypto API não funcionam com `file://`. É preciso um servidor:

```bash
python -m http.server 8080
```

e abrir <http://localhost:8080>.

---

## Publicar

Já está publicado em GitHub Pages a partir do branch `main`. Cada `git push` republica em
poucos segundos. Para reativar, caso alguém desligue: **Settings → Pages → Source: Deploy from
a branch → `main` / `/ (root)`**.
