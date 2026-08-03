const LANG_KEY = 'cafeLang_v1';

const PT = {
  'app.name': 'Quem Paga o Café',
  'app.tagline': 'quem calha pagar a próxima ronda',

  'gate.sub': 'página da malta. mete a palavra-passe para entrar.',
  'gate.password': 'palavra-passe',
  'gate.enter': 'Entrar',
  'gate.show': 'Mostrar palavra-passe',
  'gate.hide': 'Esconder palavra-passe',
  'gate.wrong': 'palavra-passe errada',
  'gate.https': 'abre a página em https ou localhost',

  'sync.cloud': 'sincronizado com a equipa',
  'sync.local': 'só neste browser',
  'sync.volatile': 'sem guardar (o browser bloqueou)',
  'sync.error': 'sem ligação à nuvem',

  'top.team': 'na equipa',
  'top.today': 'hoje',
  'top.themeDark': 'Mudar para tema escuro',
  'top.themeLight': 'Mudar para tema claro',
  'top.lang': 'Switch to English',
  'top.langCode': 'EN',

  'card.team': 'Equipa',
  'team.add': 'nome da pessoa',
  'team.addBtn': 'Adicionar pessoa',
  'team.empty': 'ainda sem ninguém — adiciona a equipa aqui em cima',
  'team.drank': 'cafés bebidos: {n}',
  'team.paid': 'cafés que pagou: {n}',
  'team.rename': 'Mudar o nome de {name}',
  'team.remove': 'Remover {name}',
  'team.removeAsk': 'Remover {name} da equipa? Os dados dessa pessoa perdem-se.',
  'team.removeOk': 'remover',
  'team.dupe': 'Já existe alguém com esse nome.',

  'card.today': 'Quem está hoje',
  'today.all': 'todos',
  'today.none': 'limpar',
  'today.empty': 'adiciona pessoas à equipa primeiro',
  'today.chance': 'hipótese de pagar',
  'today.out': 'fora',
  'today.outWhy': 'pagou a última ronda, fica de fora',
  'luck.label': 'sorte',
  'luck.fair': 'mais justo',
  'luck.lucky': 'mais sorte',
  'anim.box': 'caixa',
  'anim.wheel': 'roleta',
  'anim.group': 'Tipo de animação',
  'decide': 'Sortear quem paga',
  'result.today': 'hoje paga',
  'result.done': 'decidido',
  'undo': 'desfazer',
  'undo.done': 'Sorteio desfeito.',

  'balance.owes': 'deve {n}',
  'balance.ahead': 'à frente {n}',
  'balance.even': 'em dia',

  'card.fair': 'Quem paga a seguir',
  'fair.caption': 'saldo = cafés que pagou − cafés que bebeu',
  'fair.help': 'como funciona',
  'fair.help1': '<b>quem pagou a última fica de fora</b> da ronda seguinte. bebe na mesma, só não entra no sorteio.',
  'fair.help2': 'entre os outros, quanto mais a dever mais peso — misturado com acaso na medida da barra da <b>sorte</b>.',
  'fair.help3': 'ninguém fica a 0% nem a 100%. o nome sai primeiro; a animação só o segue.',
  'fair.next': 'próximo',
  'fair.last': 'pagou a última',
  'fair.empty': 'ainda sem pessoas para ordenar',

  'card.history': 'Histórico',
  'history.empty': 'ainda sem sorteios registados',
  'history.alone': 'sozinho',
  'history.others': '+{n}',
  'history.edit': 'Editar quem foi nesta ronda',
  'history.undo': 'Anular esta ronda',
  'history.undoAsk': 'Anular esta ronda ({payer} pagou a {n})? Os contadores voltam atrás.',
  'history.undoOk': 'anular',
  'history.undone': 'Ronda anulada.',
  'history.undoFail': 'Não dá para anular — alguém que participou já foi removido.',
  'history.saved': 'Ronda atualizada.',
  'history.editFail': 'Não dá para editar — alguém que participou já foi removido.',
  'history.today': 'hoje',
  'history.yesterday': 'ontem',
  'editor.who': 'quem esteve nesta ronda',
  'editor.payer': 'quem pagou',
  'editor.cancel': 'cancelar',
  'editor.save': 'guardar',
  'editor.needOne': 'Escolhe pelo menos uma pessoa.',
  'editor.needPayer': 'Escolhe quem pagou.',

  'card.stats': 'Números',
  'stats.rounds': 'rondas',
  'stats.coffees': 'cafés bebidos',
  'stats.avg': 'média por ronda',
  'stats.debt': 'mais em dívida',
  'stats.top': 'já pagou mais',
  'stats.nobody': 'ninguém',
  'stats.ncoffees': '{n} cafés',

  'stage.eyebrow': 'quem paga o café',
  'stage.soundOn': 'Desligar som',
  'stage.soundOff': 'Ligar som',
  'stage.close': 'Fechar',
  'stage.done': 'boa',
  'stage.sealed': 'caixa selada · {n} lá dentro',
  'stage.warm': 'a caixa aquece…',
  'stage.moving': 'alguma coisa mexe lá dentro…',
  'stage.strain': 'não aguenta mais…',
  'stage.opening': 'a abrir…',
  'stage.drawing': 'a sortear…',
  'stage.wheelReady': 'roleta carregada · {n} em jogo',
  'stage.spinning': 'a rodar…',
  'crate.sealed': 'selada',
  'crate.giving': 'a ceder',
  'crate.open': 'aberta',
  'reveal.meta': '{pct}% de hipótese · {n} na mesa',
  'reveal.metaPlain': '{n} na mesa',
  'reveal.remote': 'decidido noutro dispositivo · {n} na mesa',
  'draw.fail': 'Não deu para registar o sorteio. Tenta outra vez.',

  'modal.cancel': 'cancelar',
  'modal.confirm': 'confirmar',

  'card.charts': 'Gráficos',
  'chart.payers': 'rondas que cada um pagou',
  'chart.days': 'rondas nos últimos 8 dias',
  'chart.empty': 'ainda sem rondas para desenhar',
  'chart.tipRounds': '{name}: {n} rondas',
  'chart.tipRound': '{name}: 1 ronda',
  'chart.tipDay': '{day}: {n} rondas',
  'chart.tipDay1': '{day}: 1 ronda',
  'chart.tipDay0': '{day}: sem café',
  'top.langFlag': 'i-flag-en',

  'months': ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'],
  'weekdays': ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
};

const EN = {
  'app.name': 'Who Pays for Coffee',
  'app.tagline': 'whose turn it is to buy the next round',

  'gate.sub': 'the crew page. type the password to come in.',
  'gate.password': 'password',
  'gate.enter': 'Enter',
  'gate.show': 'Show password',
  'gate.hide': 'Hide password',
  'gate.wrong': 'wrong password',
  'gate.https': 'open this page over https or localhost',

  'sync.cloud': 'in sync with the team',
  'sync.local': 'this browser only',
  'sync.volatile': 'not saved (browser blocked it)',
  'sync.error': 'no connection to the cloud',

  'top.team': 'in the team',
  'top.today': 'today',
  'top.themeDark': 'Switch to dark theme',
  'top.themeLight': 'Switch to light theme',
  'top.lang': 'Mudar para português',
  'top.langCode': 'PT',

  'card.team': 'Team',
  'team.add': 'person name',
  'team.addBtn': 'Add person',
  'team.empty': 'nobody yet — add the team up above',
  'team.drank': 'coffees drunk: {n}',
  'team.paid': 'coffees paid for: {n}',
  'team.rename': 'Rename {name}',
  'team.remove': 'Remove {name}',
  'team.removeAsk': 'Remove {name} from the team? Their data is lost.',
  'team.removeOk': 'remove',
  'team.dupe': 'Someone already has that name.',

  'card.today': "Who's in today",
  'today.all': 'all',
  'today.none': 'clear',
  'today.empty': 'add people to the team first',
  'today.chance': 'chance of paying',
  'today.out': 'out',
  'today.outWhy': 'paid the last round, sits this one out',
  'luck.label': 'luck',
  'luck.fair': 'fairer',
  'luck.lucky': 'luckier',
  'anim.box': 'box',
  'anim.wheel': 'wheel',
  'anim.group': 'Animation style',
  'decide': 'Draw who pays',
  'result.today': 'paying today',
  'result.done': 'decided',
  'undo': 'undo',
  'undo.done': 'Draw undone.',

  'balance.owes': 'owes {n}',
  'balance.ahead': 'ahead {n}',
  'balance.even': 'even',

  'card.fair': 'Who pays next',
  'fair.caption': 'balance = coffees paid for − coffees drunk',
  'fair.help': 'how it works',
  'fair.help1': '<b>whoever paid last sits out</b> the next round. they still drink, they just skip the draw.',
  'fair.help2': 'among the rest, the deeper in debt the heavier the weight — blended with chance by the <b>luck</b> slider.',
  'fair.help3': 'nobody sits at 0% or 100%. the name is drawn first; the animation only follows it.',
  'fair.next': 'next up',
  'fair.last': 'paid last',
  'fair.empty': 'nobody to rank yet',

  'card.history': 'History',
  'history.empty': 'no draws recorded yet',
  'history.alone': 'alone',
  'history.others': '+{n}',
  'history.edit': 'Edit who was in this round',
  'history.undo': 'Void this round',
  'history.undoAsk': 'Void this round ({payer} paid for {n})? The counters roll back.',
  'history.undoOk': 'void',
  'history.undone': 'Round voided.',
  'history.undoFail': 'Cannot void — someone who took part was removed.',
  'history.saved': 'Round updated.',
  'history.editFail': 'Cannot edit — someone who took part was removed.',
  'history.today': 'today',
  'history.yesterday': 'yesterday',
  'editor.who': 'who was in this round',
  'editor.payer': 'who paid',
  'editor.cancel': 'cancel',
  'editor.save': 'save',
  'editor.needOne': 'Pick at least one person.',
  'editor.needPayer': 'Pick who paid.',

  'card.stats': 'Numbers',
  'stats.rounds': 'rounds',
  'stats.coffees': 'coffees drunk',
  'stats.avg': 'average per round',
  'stats.debt': 'deepest in debt',
  'stats.top': 'paid the most',
  'stats.nobody': 'nobody',
  'stats.ncoffees': '{n} coffees',

  'stage.eyebrow': 'who pays for coffee',
  'stage.soundOn': 'Turn sound off',
  'stage.soundOff': 'Turn sound on',
  'stage.close': 'Close',
  'stage.done': 'nice',
  'stage.sealed': 'box sealed · {n} inside',
  'stage.warm': 'the box is heating up…',
  'stage.moving': 'something is moving in there…',
  'stage.strain': "it can't hold much longer…",
  'stage.opening': 'opening…',
  'stage.drawing': 'drawing…',
  'stage.wheelReady': 'wheel loaded · {n} in play',
  'stage.spinning': 'spinning…',
  'crate.sealed': 'sealed',
  'crate.giving': 'giving in',
  'crate.open': 'open',
  'reveal.meta': '{pct}% chance · {n} at the table',
  'reveal.metaPlain': '{n} at the table',
  'reveal.remote': 'decided on another device · {n} at the table',
  'draw.fail': 'Could not record the draw. Try again.',

  'modal.cancel': 'cancel',
  'modal.confirm': 'confirm',

  'card.charts': 'Charts',
  'chart.payers': 'rounds paid per person',
  'chart.days': 'rounds in the last 8 days',
  'chart.empty': 'no rounds to chart yet',
  'chart.tipRounds': '{name}: {n} rounds',
  'chart.tipRound': '{name}: 1 round',
  'chart.tipDay': '{day}: {n} rounds',
  'chart.tipDay1': '{day}: 1 round',
  'chart.tipDay0': '{day}: no coffee',
  'top.langFlag': 'i-flag-pt',

  'months': ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  'weekdays': ['S', 'M', 'T', 'W', 'T', 'F', 'S']
};

const DICT = { pt: PT, en: EN };

function detect(){
  try{
    const saved = localStorage.getItem(LANG_KEY);
    if(saved === 'pt' || saved === 'en') return saved;
  }catch(e){ /* modo privado */ }
  const nav = (navigator.language || 'pt').toLowerCase();
  return nav.startsWith('pt') ? 'pt' : 'en';
}

let lang = detect();

export function getLang(){
  return lang;
}

export function setLang(next){
  lang = next === 'en' ? 'en' : 'pt';
  try{ localStorage.setItem(LANG_KEY, lang); }catch(e){ /* modo privado */ }
  document.documentElement.lang = lang === 'pt' ? 'pt-PT' : 'en';
}

export function otherLang(){
  return lang === 'pt' ? 'en' : 'pt';
}

export function t(key, vars){
  const table = DICT[lang] || PT;
  let value = table[key];
  if(value === undefined) value = PT[key];
  if(value === undefined) return key;
  if(!vars) return value;
  return String(value).replace(/\{(\w+)\}/g, (m, name) => (vars[name] === undefined ? m : vars[name]));
}

export function months(){
  return (DICT[lang] || PT).months;
}

export function weekdays(){
  return (DICT[lang] || PT).weekdays;
}

export function applyStatic(root){
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  scope.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  scope.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  scope.querySelectorAll('[data-i18n-label]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nLabel)); });
}
