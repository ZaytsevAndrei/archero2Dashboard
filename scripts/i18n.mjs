/**
 * i18n бота: автоопределение языка по language_code клиента Telegram
 * (кириллические клиенты → ru, остальные → en), ручное переключение /lang.
 * Русский — базовый: любой незнакомый язык/отсутствие кода fallback-ится на ru.
 * Подстановки в строках: {nick}, {clan}, {date}… — см. t().
 */

/* клиенты с кириллическим интерфейсом, которым комфортно на русском */
const RU_CLIENTS = new Set(['ru', 'be', 'uk', 'kk', 'ky']);

/* 'en-US' → 'en', 'ru-RU' → 'ru', 'de' → 'en', отсутствие кода → null */
export function normLang(code) {
  if (!code) return null;
  const base = String(code).split('-')[0].toLowerCase();
  return RU_CLIENTS.has(base) ? 'ru' : 'en';
}

export const MESSAGES = {
  startNew: {
    ru: 'Привет! Это бот календаря урона кланов Unity и Unity2 🏹\n\nНапиши свой игровой ник (как в Archero 2):',
    en: 'Hi! This is the damage calendar bot for clans Unity and Unity2 🏹\n\nSend me your in-game nickname (as in Archero 2):',
  },
  alreadyRegistered: {
    ru: 'Ты уже зарегистрирован: {nick} (клан {clan}).\n\nОтправь скриншот рейтинга — урон я распознаю сам.',
    en: "You're already registered: {nick} (clan {clan}).\n\nSend a rating screenshot — I'll recognize the damage myself.",
  },
  welcomeBack: {
    ru: 'С возвращением, {nick}!',
    en: 'Welcome back, {nick}!',
  },
  askClan: {
    ru: 'У нас теперь два клана 🏹 Из какого ты?',
    en: 'We now have two clans 🏹 Which one are you in?',
  },
  askNick: {
    ru: 'Сначала напиши свой игровой ник (как в Archero 2):',
    en: 'First, send me your in-game nickname (as in Archero 2):',
  },
  nickGreat: {
    ru: 'Отлично, {nick}! 🏹',
    en: 'Great, {nick}! 🏹',
  },
  nickSaved: {
    ru: 'Записал: {nick}.',
    en: 'Saved: {nick}.',
  },
  nickShow: {
    ru: 'Твой ник: {nick}. Сменить: /nick НовыйНик',
    en: 'Your nickname: {nick}. To change: /nick NewNick',
  },
  nickTooLong: {
    ru: 'Ник слишком длинный (макс. 24 символа)',
    en: 'Nickname is too long (max 24 characters)',
  },
  nickChanged: {
    ru: 'Ник изменён: {nick}',
    en: 'Nickname changed: {nick}',
  },
  notRegistered: {
    ru: 'Сначала /start',
    en: 'Run /start first',
  },
  clanChanged: {
    ru: 'Клан изменён: {clan} ✅ (прошлые записи остаются за прежним кланом)',
    en: 'Clan changed: {clan} ✅ (past entries stay with the previous clan)',
  },
  clanSet: {
    ru: 'Записал: клан {clan} ✅\nТеперь просто отправляй скриншот рейтинга — урон я распознаю сам.',
    en: "Saved: clan {clan} ✅\nNow just send rating screenshots — I'll recognize the damage myself.",
  },
  clanRemind: {
    ru: 'Сначала выбери клан кнопкой выше 👆',
    en: 'First, pick your clan with the button above 👆',
  },
  undoNone: {
    ru: 'У тебя пока нет записей.',
    en: 'You have no entries yet.',
  },
  undoDone: {
    ru: 'Удалил: {raw} за {date}',
    en: 'Deleted: {raw} for {date}',
  },
  statsEmpty: {
    ru: 'За последние 7 дней записей нет.',
    en: 'No entries in the last 7 days.',
  },
  statsHead: {
    ru: 'Твои записи ({nick}, клан {clan}):',
    en: 'Your entries ({nick}, clan {clan}):',
  },
  statsHeadPlain: {
    ru: 'Твои записи ({nick}):',
    en: 'Your entries ({nick}):',
  },
  unknownCommand: {
    ru: 'Не знаю такую команду. /help — список команд',
    en: 'Unknown command. /help — command list',
  },
  ocrFail: {
    ru: 'Скрин получил, но не смог разобрать твою строку 🤔\nПришли скриншот ещё раз — чётче и покрупнее: весь экран рейтинга после боя, без обрезки краёв.',
    en: "Got the screenshot, but couldn't read your row 🤔\nSend it again — sharper and bigger: the full rating screen after the battle, with no edges cut off.",
  },
  recorded: {
    ru: '✅ Записал: {nick} — {dmg} за {date} ({clan})',
    en: '✅ Recorded: {nick} — {dmg} on {date} ({clan})',
  },
  broken: {
    ru: 'Что-то сломалось, попробуй прислать скрин ещё раз.',
    en: 'Something broke — try sending the screenshot again.',
  },
  legacyButton: {
    ru: 'Кнопка больше не нужна — урон со скрина записываю сразу.\nЕсли значение не записалось или неверное: /undo и пришли скриншот заново.',
    en: "The button is no longer needed — I record damage from screenshots right away.\nIf a value wasn't recorded or is wrong: /undo and send the screenshot again.",
  },
  videoNo: {
    ru: 'Видео не принимаем 🙈 Пришли скриншот рейтинга картинкой — урон я распознаю сам.',
    en: "No videos 🙈 Send the rating screenshot as a picture — I'll recognize the damage myself.",
  },
  groupAutoreg: {
    ru: '@{username}, записал тебя как «{username}» (совпало с ником Telegram). Если игровой ник другой — /nick НовыйНик мне в личку.',
    en: '@{username}, saved you as “{username}” (matches your Telegram name). If your in-game nickname is different — send /nick NewNick to my DMs.',
  },
  groupRegister: {
    ru: 'Зарегистрируйся у меня в личке: @Archero2Unity_bot → /start (и сразу кидай скрины сюда)',
    en: 'Register with me in private messages: @Archero2Unity_bot → /start (then send screenshots right here)',
  },
  notNick: {
    ru: 'Это похоже не на ник. Напиши игровой ник (до 24 символов):',
    en: "That doesn't look like a nickname. Send your in-game nickname (up to 24 characters):",
  },
  numbersNo: {
    ru: 'Числа больше не принимаю 🙈 Пришли скриншот рейтинга — урон распознаю с него.',
    en: "I don't accept numbers anymore 🙈 Send a rating screenshot — I'll read the damage from it.",
  },
  noUnderstand: {
    ru: 'Не понял 🤔 Пришли скриншот рейтинга — урон я распознаю сам.\n/help — все команды',
    en: "I didn't get that 🤔 Send a rating screenshot — I'll recognize the damage myself.\n/help — all commands",
  },
  askLang: {
    ru: 'Язык бота · Bot language:',
    en: 'Язык бота · Bot language:',
  },
  langSetRu: {
    ru: 'Язык: русский ✅',
    en: 'Язык: русский ✅',
  },
  langSetEn: {
    ru: 'Language: English ✅',
    en: 'Language: English ✅',
  },
  help: {
    ru: [
      '🏹 Календарь урона — команды:',
      '/start — регистрация (игровой ник + клан)',
      '/nick НовыйНик — сменить ник',
      '/clan — указать или сменить клан (Unity / Unity2)',
      '/lang — язык бота (русский / english)',
      '/undo — удалить свою последнюю запись',
      '/stats — мои записи за 7 дней',
      '',
      'Как отметиться:',
      'отправь скриншот рейтинга — я сам распознаю и запишу твой урон',
      '(не разберу — попрошу скрин получше; ошибся — /undo и новый скрин)',
      '',
      'Сайт: {url}',
    ].join('\n'),
    en: [
      '🏹 Damage calendar — commands:',
      '/start — registration (nickname + clan)',
      '/nick NewNick — change nickname',
      '/clan — set or change clan (Unity / Unity2)',
      '/lang — bot language (Russian / English)',
      '/undo — delete my last entry',
      '/stats — my entries for the last 7 days',
      '',
      'How to report:',
      "send a rating screenshot — I'll recognize and record your damage myself",
      "(if I can't read it, I'll ask for a clearer one; made a mistake — /undo and a new screenshot)",
      '',
      'Site: {url}',
    ].join('\n'),
  },
};

/* строка по ключу с подстановкой {параметров}; неизвестный язык → русский */
export function t(lang, key, params = {}) {
  const m = MESSAGES[key];
  if (!m) return key;
  return String(m[lang] || m.ru).replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? ''));
}
