import type { BelotPhase, Rank, Suit } from "@card-games/shared";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { CpuLevelName } from "./progress/cpu-levels";

export const locales = ["en", "bg", "fr", "hr", "sr"] as const;
export type Locale = (typeof locales)[number];

const storageKey = "card-games-locale";
const fallbackLocale: Locale = "en";
const serbianLocaleLanguages = new Set(["bs", "cnr", "sr"]);
const serbianLocaleRegions = new Set(["ba", "me", "rs"]);
const frenchLocaleRegions = new Set(["fr"]);
const bulgarianLocaleRegions = new Set(["bg"]);
const croatianLocaleRegions = new Set(["hr"]);

function isLocale(value: string | null | undefined): value is Locale {
  return locales.includes(value as Locale);
}

function localePartsFromTag(languageTag: string) {
  const parts = languageTag.trim().toLowerCase().split("-");

  return {
    language: parts[0],
    region: parts.slice(1).find((part) => part.length === 2),
  };
}

export function detectLocaleFromLanguageTags(
  languageTags: readonly string[],
): Locale {
  for (const languageTag of languageTags) {
    const { language, region } = localePartsFromTag(languageTag);

    if (
      serbianLocaleLanguages.has(language) ||
      serbianLocaleRegions.has(region ?? "")
    ) {
      return "sr";
    }

    if (frenchLocaleRegions.has(region ?? "")) {
      return "fr";
    }

    if (language === "bg" || bulgarianLocaleRegions.has(region ?? "")) {
      return "bg";
    }

    if (language === "hr" || croatianLocaleRegions.has(region ?? "")) {
      return "hr";
    }

    if (isLocale(language)) {
      return language;
    }
  }

  return fallbackLocale;
}

export function belotRulesHref(locale: Locale) {
  return `/rules/belot-user-${locale}.html`;
}

function detectBrowserLocale(): Locale {
  if (typeof navigator === "undefined") {
    return fallbackLocale;
  }

  const languages = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];

  return detectLocaleFromLanguageTags(languages);
}

function readStoredLocale(): Locale {
  if (typeof localStorage === "undefined") {
    return detectBrowserLocale();
  }

  const stored = localStorage.getItem(storageKey);
  return isLocale(stored) ? stored : detectBrowserLocale();
}

let activeLocale: Locale = readStoredLocale();

export type Messages = {
  localeName: string;
  language: string;
  switchLanguage: (localeName: string) => string;
  menu: string;
  appTitle: string;
  authTitle: string;
  login: string;
  register: string;
  createAccount: string;
  analyticsConsentTitle: string;
  analyticsConsentBody: string;
  analyticsConsentAllow: string;
  analyticsConsentDecline: string;
  analyticsConsentAccepted: string;
  analyticsConsentRejected: string;
  analyticsConsentUnset: string;
  privacySettings: string;
  email: string;
  password: string;
  displayName: string;
  signedIn: string;
  logout: string;
  leaveMatch: string;
  resignGame: string;
  confirmResignGame: string;
  yes: string;
  no: string;
  room: string;
  createRoom: string;
  playBelotVsCpu: string;
  roomCode: string;
  join: string;
  matchHistory: string;
  completedMatches: (count: number) => string;
  lobby: string;
  game: string;
  ready: string;
  unready: string;
  waiting: string;
  lobbyAutoStart: (gameName: string) => string;
  belotName: string;
  offlineYou: string;
  cpu: string;
  requestFailed: string;
  registrationFailed: string;
  loginFailed: string;
  cpuActionFailed: string;
  cpuWorkerUnavailable: string;
  loadingCards: string;
  drawn: string;
  hiddenPickupCard: string;
  unknownPlayer: string;
  statusYou: string;
  toPlay: (playerName: string) => string;
  suits: Record<Suit, string>;
  cardLabel: (rank: Rank, suit: Suit) => string;
  phase: Record<BelotPhase, string>;
  status: string;
  mus: string;
  gameTimeline: string;
  hand: string;
  noHandsScored: string;
  total: string;
  bonus: string;
  bonusPts: (points: number) => string;
  points: (points: number) => string;
  currentRank: (rank: string) => string;
  highestRank: (rank: string) => string;
  currentRanksIntro: string;
  cpuDifficultyIncreases: string;
  cpuLevelNames: Record<CpuLevelName, string>;
  dealer: string;
  first: string;
  caller: string;
  trumpMarker: string;
  bonusMarker: string;
  trump: string;
  upcard: string;
  handResult: string;
  leftHandResult: string;
  rightHandResult: string;
  nextHand: string;
  newGame: string;
  nextGame: string;
  chooseTrump: string;
  accept: string;
  acceptSuit: (suit: string) => string;
  acceptUpcard: string;
  pass: string;
  chooseSuit: (suit: string) => string;
  trumpSelection: string;
  currentTrick: string;
  completedTrick: (trickNumber: number) => string;
  upcardIs: (rank: Rank, suit: string) => string;
  playerPassedOnSuit: (playerName: string, suit: string) => string;
  upcardSuit: string;
  playerDecidingUpcard: (playerName: string) => string;
  youDecidingUpcard: string;
  bothPlayersPassedSuit: (suit: string) => string;
  playerPassedChoosingAnotherSuit: (playerName: string) => string;
  playerChoosingOtherSuit: (playerName: string, suit: string) => string;
  youChoosingOtherSuit: (suit: string) => string;
  bothPlayersPassedTwice: string;
  playerMustChooseTrumpOnMus: (playerName: string) => string;
  youMustChooseTrumpOnMus: string;
  winner: (playerName: string) => string;
  startingCards: string;
  remainingCards: string;
  yourHand: string;
  cpuDebugHand: string;
  playLegalCard: string;
  hideDetails: string;
  showDetails: string;
  playedTricks: string;
  trickWinner: (trickNumber: number, playerName?: string) => string;
  noTricksCompleted: string;
  rules: string;
  rulesOfBelotSuffix: string;
};

export const messages: Record<Locale, Messages> = {
  sr: {
    localeName: "Srpski",
    language: "Jezik",
    switchLanguage: (localeName) => `Promeni jezik na ${localeName}`,
    menu: "Meni",
    appTitle: "Bela 1v1",
    authTitle: "Bela",
    login: "Prijava",
    register: "Registracija",
    createAccount: "Napravi nalog",
    analyticsConsentTitle: "Analitika i čuvanje podataka",
    analyticsConsentBody:
      "Koristimo neophodno čuvanje u pregledaču da aplikacija radi. Uz tvoju dozvolu koristimo dodatnu analitiku da poboljšamo igru.",
    analyticsConsentAllow: "Prihvati",
    analyticsConsentDecline: "Odbij",
    analyticsConsentAccepted: "Analitika je uključena",
    analyticsConsentRejected: "Analitika je isključena",
    analyticsConsentUnset: "Nije izabrano",
    privacySettings: "Podešavanja privatnosti",
    email: "Email",
    password: "Lozinka",
    displayName: "Ime za prikaz",
    signedIn: "Prijavljen",
    logout: "Odjavi se",
    leaveMatch: "Napusti partiju",
    resignGame: "Predaj partiju",
    confirmResignGame: "Predaješ partiju?",
    yes: "Da",
    no: "Ne",
    room: "Soba",
    createRoom: "Napravi sobu",
    playBelotVsCpu: "Igraj Belu protiv CPU-a",
    roomCode: "Kod sobe",
    join: "Uđi",
    matchHistory: "Istorija partija",
    completedMatches: (count) => `${count} završenih partija`,
    lobby: "Lobi",
    game: "Igra",
    ready: "Spreman",
    unready: "Nisam spreman",
    waiting: "Čeka",
    lobbyAutoStart: (gameName) =>
      `Server pokreće igru ${gameName} automatski kada se pridruže najmanje dva igrača i svi su spremni.`,
    belotName: "Bela",
    offlineYou: "Ja",
    cpu: "AI",
    requestFailed: "Zahtev nije uspeo",
    registrationFailed: "Registracija nije uspela",
    loginFailed: "Prijava nije uspela",
    cpuActionFailed: "CPU potez nije uspeo",
    cpuWorkerUnavailable: "CPU worker nije dostupan",
    loadingCards: "Učitavanje karata...",
    drawn: "Izvučeno",
    hiddenPickupCard: "Skrivena pokupljena karta",
    unknownPlayer: "Nepoznat igrač",
    statusYou: "Ti",
    toPlay: (playerName) => `${playerName} je na potezu`,
    suits: {
      acorns: "Žir",
      bells: "Tikva",
      hearts: "Srce",
      leaves: "List",
    },
    cardLabel: (rank, suit) =>
      `${rank} ${
        {
          acorns: "žir",
          bells: "tikva",
          hearts: "srce",
          leaves: "list",
        }[suit]
      }`,
    phase: {
      "waiting-for-players": "čekanje igrača",
      "ready-check": "spremanje",
      "trump-round-one": "prvi krug aduta",
      "trump-round-two": "drugi krug aduta",
      mus: "mus",
      declarations: "zvanja",
      "trick-play": "igra štihova",
      "hand-complete": "ruka završena",
      finished: "završeno",
      error: "greška",
    },
    status: "Status",
    mus: "Mus",
    gameTimeline: "Tok igre",
    hand: "Ruka",
    noHandsScored: "Još nema upisanih ruku.",
    total: "Ukupno",
    bonus: "bonus",
    bonusPts: (points) => `${points} bonus poena`,
    points: (points) => `${points} poena`,
    currentRank: (rank) => `Tvoj trenutni rang je: ${rank}`,
    highestRank: (rank) => `Tvoj najviši rang je: ${rank}`,
    currentRanksIntro: "U igri Bela 1v1 postoje sledeći rangovi:",
    cpuDifficultyIncreases: "AI težina raste sa rangom.",
    cpuLevelNames: {
      Bronze: "Bronza",
      Silver: "Srebro",
      Gold: "Zlato",
      Platinum: "Platina",
      Diamond: "Dijamant",
      Master: "Majstor",
      Grandmaster: "Velemajstor",
    },
    dealer: "Deli",
    first: "Prvi",
    caller: "ZVAO",
    trumpMarker: "A",
    bonusMarker: "B",
    trump: "Adut",
    upcard: "Presečeno",
    handResult: "Rezultat ruke",
    leftHandResult: "Levi rezultat ruke",
    rightHandResult: "Desni rezultat ruke",
    nextHand: "Sledeća ruka",
    newGame: "Nova igra",
    nextGame: "Nova partija",
    chooseTrump: "Izaberi adut",
    accept: "Prihvati",
    acceptSuit: (suit) => `Prihvati ${suit}`,
    acceptUpcard: "Prihvati presečenu kartu",
    pass: "Dalje",
    chooseSuit: (suit) => `Izaberi ${suit}`,
    trumpSelection: "Biranje aduta",
    currentTrick: "Trenutni štih",
    completedTrick: (trickNumber) => `Završen štih ${trickNumber}`,
    upcardIs: (rank, suit) => `Presečena karta je ${rank} ${suit}.`,
    playerPassedOnSuit: (playerName, suit) =>
      `${playerName}: Dalje za ${suit}.`,
    upcardSuit: "boja presečene karte",
    playerDecidingUpcard: (playerName) =>
      `${playerName} odlučuje da li prihvata boju presečene karte.`,
    youDecidingUpcard: "Ti odlučuješ da li prihvataš boju presečene karte.",
    bothPlayersPassedSuit: (suit) => `Oba igrača: Dalje za ${suit}.`,
    playerPassedChoosingAnotherSuit: (playerName) =>
      `${playerName}: Dalje za drugu boju.`,
    playerChoosingOtherSuit: (playerName, suit) =>
      `${playerName} bira boju različitu od ${suit}.`,
    youChoosingOtherSuit: (suit) => `Ti biraš boju različitu od ${suit}.`,
    bothPlayersPassedTwice: "Oba igrača: Dalje dva puta.",
    playerMustChooseTrumpOnMus: (playerName) =>
      `${playerName} je na musu i mora izabrati adut.`,
    youMustChooseTrumpOnMus: "Ti si na musu i moraš izabrati adut.",
    winner: (playerName) => `Pobednik: ${playerName}`,
    startingCards: "Početne karte",
    remainingCards: "Van igre",
    yourHand: "Tvoje karte",
    cpuDebugHand: "AI karte",
    playLegalCard: "odigraj dozvoljenu kartu",
    hideDetails: "Sakrij detalje",
    showDetails: "Prikaži detalje",
    playedTricks: "Odigrani štihovi",
    trickWinner: (trickNumber, playerName) =>
      `Štih ${trickNumber}${playerName ? ` · ${playerName}` : ""}`,
    noTricksCompleted: "Još nema završenih štihova.",
    rules: "Pravila",
    rulesOfBelotSuffix: "za Belu 1v1.",
  },
  hr: {
    localeName: "Hrvatski",
    language: "Jezik",
    switchLanguage: (localeName) => `Promijeni jezik na ${localeName}`,
    menu: "Izbornik",
    appTitle: "Bela 1v1",
    authTitle: "Bela",
    login: "Prijava",
    register: "Registracija",
    createAccount: "Napravi račun",
    analyticsConsentTitle: "Analitika i pohrana u pregledniku",
    analyticsConsentBody:
      "Koristimo nužnu pohranu u pregledniku kako bi aplikacija radila. Uz tvoju dozvolu koristimo dodatnu analitiku za poboljšanje igre.",
    analyticsConsentAllow: "Prihvati",
    analyticsConsentDecline: "Odbij",
    analyticsConsentAccepted: "Analitika je uključena",
    analyticsConsentRejected: "Analitika je isključena",
    analyticsConsentUnset: "Nije odabrano",
    privacySettings: "Postavke privatnosti",
    email: "Email",
    password: "Lozinka",
    displayName: "Ime za prikaz",
    signedIn: "Prijavljen",
    logout: "Odjavi se",
    leaveMatch: "Napusti partiju",
    resignGame: "Predaj partiju",
    confirmResignGame: "Predaješ partiju?",
    yes: "Da",
    no: "Ne",
    room: "Soba",
    createRoom: "Napravi sobu",
    playBelotVsCpu: "Igraj Belu protiv CPU-a",
    roomCode: "Kod sobe",
    join: "Uđi",
    matchHistory: "Povijest partija",
    completedMatches: (count) => `${count} završenih partija`,
    lobby: "Lobi",
    game: "Igra",
    ready: "Spreman",
    unready: "Nisam spreman",
    waiting: "Čeka",
    lobbyAutoStart: (gameName) =>
      `Server automatski pokreće igru ${gameName} kada se pridruže najmanje dva igrača i svi su spremni.`,
    belotName: "Bela",
    offlineYou: "Ja",
    cpu: "AI",
    requestFailed: "Zahtjev nije uspio",
    registrationFailed: "Registracija nije uspjela",
    loginFailed: "Prijava nije uspjela",
    cpuActionFailed: "CPU potez nije uspio",
    cpuWorkerUnavailable: "CPU worker nije dostupan",
    loadingCards: "Učitavanje karata...",
    drawn: "Izvučeno",
    hiddenPickupCard: "Skrivena pokupljena karta",
    unknownPlayer: "Nepoznat igrač",
    statusYou: "Ti",
    toPlay: (playerName) => `${playerName} je na potezu`,
    suits: {
      acorns: "Žir",
      bells: "Tikva",
      hearts: "Srce",
      leaves: "List",
    },
    cardLabel: (rank, suit) =>
      `${rank} ${
        {
          acorns: "žir",
          bells: "tikva",
          hearts: "srce",
          leaves: "list",
        }[suit]
      }`,
    phase: {
      "waiting-for-players": "čekanje igrača",
      "ready-check": "spremanje",
      "trump-round-one": "prvi krug aduta",
      "trump-round-two": "drugi krug aduta",
      mus: "mus",
      declarations: "zvanja",
      "trick-play": "igra štihova",
      "hand-complete": "ruka završena",
      finished: "završeno",
      error: "greška",
    },
    status: "Status",
    mus: "Mus",
    gameTimeline: "Tijek igre",
    hand: "Ruka",
    noHandsScored: "Još nema upisanih ruku.",
    total: "Ukupno",
    bonus: "bonus",
    bonusPts: (points) => `${points} bonus bodova`,
    points: (points) => `${points} bodova`,
    currentRank: (rank) => `Tvoj trenutačni rang je: ${rank}`,
    highestRank: (rank) => `Tvoj najviši rang je: ${rank}`,
    currentRanksIntro: "U igri Bela 1v1 postoje sljedeći rangovi:",
    cpuDifficultyIncreases: "AI težina raste s rangom.",
    cpuLevelNames: {
      Bronze: "Bronca",
      Silver: "Srebro",
      Gold: "Zlato",
      Platinum: "Platina",
      Diamond: "Dijamant",
      Master: "Majstor",
      Grandmaster: "Velemajstor",
    },
    dealer: "Dijeli",
    first: "Prvi",
    caller: "ZVAO",
    trumpMarker: "A",
    bonusMarker: "B",
    trump: "Adut",
    upcard: "Presječeno",
    handResult: "Rezultat ruke",
    leftHandResult: "Lijevi rezultat ruke",
    rightHandResult: "Desni rezultat ruke",
    nextHand: "Sljedeća ruka",
    newGame: "Nova igra",
    nextGame: "Nova partija",
    chooseTrump: "Izaberi adut",
    accept: "Prihvati",
    acceptSuit: (suit) => `Prihvati ${suit}`,
    acceptUpcard: "Prihvati presječeno",
    pass: "Dalje",
    chooseSuit: (suit) => `Izaberi ${suit}`,
    trumpSelection: "Biranje aduta",
    currentTrick: "Trenutačni štih",
    completedTrick: (trickNumber) => `Završen štih ${trickNumber}`,
    upcardIs: (rank, suit) => `Presječena karta je ${rank} ${suit}.`,
    playerPassedOnSuit: (playerName, suit) =>
      `${playerName}: Dalje za ${suit}.`,
    upcardSuit: "boja presječene karte",
    playerDecidingUpcard: (playerName) =>
      `${playerName} odlučuje hoće li prihvatiti boju presječene karte.`,
    youDecidingUpcard:
      "Ti odlučuješ hoćeš li prihvatiti boju presječene karte.",
    bothPlayersPassedSuit: (suit) => `Oba igrača: Dalje za ${suit}.`,
    playerPassedChoosingAnotherSuit: (playerName) =>
      `${playerName}: Dalje za drugu boju.`,
    playerChoosingOtherSuit: (playerName, suit) =>
      `${playerName} bira boju različitu od ${suit}.`,
    youChoosingOtherSuit: (suit) => `Ti biraš boju različitu od ${suit}.`,
    bothPlayersPassedTwice: "Oba igrača: Dalje dva puta.",
    playerMustChooseTrumpOnMus: (playerName) =>
      `${playerName} je na musu i mora izabrati adut.`,
    youMustChooseTrumpOnMus: "Ti si na musu i moraš izabrati adut.",
    winner: (playerName) => `Pobjednik: ${playerName}`,
    startingCards: "Početne karte",
    remainingCards: "Van igre",
    yourHand: "Tvoje karte",
    cpuDebugHand: "AI karte",
    playLegalCard: "odigraj dozvoljenu kartu",
    hideDetails: "Sakrij detalje",
    showDetails: "Prikaži detalje",
    playedTricks: "Odigrani štihovi",
    trickWinner: (trickNumber, playerName) =>
      `Štih ${trickNumber}${playerName ? ` · ${playerName}` : ""}`,
    noTricksCompleted: "Još nema završenih štihova.",
    rules: "Pravila",
    rulesOfBelotSuffix: "za Belu 1v1.",
  },
  bg: {
    localeName: "Български",
    language: "Език",
    switchLanguage: (localeName) => `Смени езика на ${localeName}`,
    menu: "Меню",
    appTitle: "Белот 1v1",
    authTitle: "Белот",
    login: "Вход",
    register: "Регистрация",
    createAccount: "Създай акаунт",
    analyticsConsentTitle: "Аналитика и съхранение в браузъра",
    analyticsConsentBody:
      "Използваме задължително съхранение в браузъра, за да работи приложението. С твое разрешение използваме допълнителна аналитика, за да подобряваме играта.",
    analyticsConsentAllow: "Приемам",
    analyticsConsentDecline: "Отказвам",
    analyticsConsentAccepted: "Аналитиката е включена",
    analyticsConsentRejected: "Аналитиката е изключена",
    analyticsConsentUnset: "Няма избор",
    privacySettings: "Настройки за поверителност",
    email: "Email",
    password: "Парола",
    displayName: "Име за показване",
    signedIn: "Влязъл",
    logout: "Изход",
    leaveMatch: "Напусни мача",
    resignGame: "Предай играта",
    confirmResignGame: "Предаваш играта?",
    yes: "Да",
    no: "Не",
    room: "Стая",
    createRoom: "Създай стая",
    playBelotVsCpu: "Играй белот срещу CPU",
    roomCode: "Код на стаята",
    join: "Влез",
    matchHistory: "История на мачовете",
    completedMatches: (count) => `${count} завършени мача`,
    lobby: "Лоби",
    game: "Игра",
    ready: "Готов",
    unready: "Не съм готов",
    waiting: "Изчакване",
    lobbyAutoStart: (gameName) =>
      `Сървърът стартира ${gameName} автоматично, когато се присъединят поне двама играчи и всички са готови.`,
    belotName: "Белот",
    offlineYou: "Аз",
    cpu: "AI",
    requestFailed: "Заявката не успя",
    registrationFailed: "Регистрацията не успя",
    loginFailed: "Входът не успя",
    cpuActionFailed: "CPU ходът не успя",
    cpuWorkerUnavailable: "CPU worker не е достъпен",
    loadingCards: "Зареждане на карти...",
    drawn: "Изтеглена",
    hiddenPickupCard: "Скрита карта за взимане",
    unknownPlayer: "Непознат играч",
    statusYou: "Ти",
    toPlay: (playerName) => `${playerName} е на ход`,
    suits: {
      acorns: "Жълъди",
      bells: "Звънци",
      hearts: "Сърца",
      leaves: "Листа",
    },
    cardLabel: (rank, suit) =>
      `${rank} ${
        {
          acorns: "жълъди",
          bells: "звънци",
          hearts: "сърца",
          leaves: "листа",
        }[suit]
      }`,
    phase: {
      "waiting-for-players": "изчакване на играчи",
      "ready-check": "потвърждение за готовност",
      "trump-round-one": "първи кръг за коз",
      "trump-round-two": "втори кръг за коз",
      mus: "мус",
      declarations: "анонси",
      "trick-play": "игра на взятки",
      "hand-complete": "раздаването приключи",
      finished: "завършено",
      error: "грешка",
    },
    status: "Статус",
    mus: "Мус",
    gameTimeline: "Ход на играта",
    hand: "Раздаване",
    noHandsScored: "Още няма записани раздавания.",
    total: "Общо",
    bonus: "бонус",
    bonusPts: (points) => `${points} бонус т.`,
    points: (points) => `${points} т.`,
    currentRank: (rank) => `Текущият ти ранг е: ${rank}`,
    highestRank: (rank) => `Най-високият ти ранг е: ${rank}`,
    currentRanksIntro: "В Белот 1v1 има следните рангове:",
    cpuDifficultyIncreases: "Трудността на AI се увеличава с ранга.",
    cpuLevelNames: {
      Bronze: "Бронз",
      Silver: "Сребро",
      Gold: "Злато",
      Platinum: "Платина",
      Diamond: "Диамант",
      Master: "Майстор",
      Grandmaster: "Гросмайстор",
    },
    dealer: "Раздава",
    first: "Първи",
    caller: "ИЗБРАЛ",
    trumpMarker: "К",
    bonusMarker: "Б",
    trump: "Коз",
    upcard: "Обърната карта",
    handResult: "Резултат от раздаването",
    leftHandResult: "Ляв резултат от раздаването",
    rightHandResult: "Десен резултат от раздаването",
    nextHand: "Следващо раздаване",
    newGame: "Нова игра",
    nextGame: "Нова игра",
    chooseTrump: "Избери коз",
    accept: "Приеми",
    acceptSuit: (suit) => `Приеми ${suit}`,
    acceptUpcard: "Приеми обърнатата карта",
    pass: "Пас",
    chooseSuit: (suit) => `Избери ${suit}`,
    trumpSelection: "Избор на коз",
    currentTrick: "Текуща взятка",
    completedTrick: (trickNumber) => `Завършена взятка ${trickNumber}`,
    upcardIs: (rank, suit) => `Обърнатата карта е ${rank} ${suit}.`,
    playerPassedOnSuit: (playerName, suit) => `${playerName}: пас за ${suit}.`,
    upcardSuit: "боята на обърнатата карта",
    playerDecidingUpcard: (playerName) =>
      `${playerName} решава дали да приеме боята на обърнатата карта.`,
    youDecidingUpcard: "Ти решаваш дали да приемеш боята на обърнатата карта.",
    bothPlayersPassedSuit: (suit) => `И двамата играчи пасуваха за ${suit}.`,
    playerPassedChoosingAnotherSuit: (playerName) =>
      `${playerName}: пас за избор на друга боя.`,
    playerChoosingOtherSuit: (playerName, suit) =>
      `${playerName} избира боя, различна от ${suit}.`,
    youChoosingOtherSuit: (suit) => `Ти избираш боя, различна от ${suit}.`,
    bothPlayersPassedTwice: "И двамата играчи пасуваха два пъти.",
    playerMustChooseTrumpOnMus: (playerName) =>
      `${playerName} е на мус и трябва да избере коз.`,
    youMustChooseTrumpOnMus: "Ти си на мус и трябва да избереш коз.",
    winner: (playerName) => `Победител: ${playerName}`,
    startingCards: "Начални карти",
    remainingCards: "Извън игра",
    yourHand: "Твоите карти",
    cpuDebugHand: "AI карти",
    playLegalCard: "изиграй позволена карта",
    hideDetails: "Скрий детайлите",
    showDetails: "Покажи детайлите",
    playedTricks: "Изиграни взятки",
    trickWinner: (trickNumber, playerName) =>
      `Взятка ${trickNumber}${playerName ? ` · ${playerName}` : ""}`,
    noTricksCompleted: "Още няма завършени взятки.",
    rules: "Правила",
    rulesOfBelotSuffix: "на Белот 1v1.",
  },
  en: {
    localeName: "English",
    language: "Language",
    switchLanguage: (localeName) => `Switch language to ${localeName}`,
    menu: "Menu",
    appTitle: "Belot 1v1",
    authTitle: "Card Games",
    login: "Login",
    register: "Register",
    createAccount: "Create account",
    analyticsConsentTitle: "Analytics and browser storage",
    analyticsConsentBody:
      "We use necessary browser storage to make the app work. With your permission, we use optional analytics to improve the game.",
    analyticsConsentAllow: "Accept",
    analyticsConsentDecline: "Reject",
    analyticsConsentAccepted: "Analytics accepted",
    analyticsConsentRejected: "Analytics rejected",
    analyticsConsentUnset: "No choice selected",
    privacySettings: "Privacy settings",
    email: "Email",
    password: "Password",
    displayName: "Display name",
    signedIn: "Signed in",
    logout: "Logout",
    leaveMatch: "Leave match",
    resignGame: "Resign game",
    confirmResignGame: "Resign game?",
    yes: "Yes",
    no: "No",
    room: "Room",
    createRoom: "Create room",
    playBelotVsCpu: "Play Belot vs CPU",
    roomCode: "Room code",
    join: "Join",
    matchHistory: "Match history",
    completedMatches: (count) => `${count} completed matches`,
    lobby: "Lobby",
    game: "Game",
    ready: "Ready",
    unready: "Unready",
    waiting: "Waiting",
    lobbyAutoStart: (gameName) =>
      `The server starts ${gameName} automatically when at least two players have joined and everyone is ready.`,
    belotName: "Belot",
    offlineYou: "Me",
    cpu: "AI",
    requestFailed: "Request failed",
    registrationFailed: "Registration failed",
    loginFailed: "Login failed",
    cpuActionFailed: "CPU action failed",
    cpuWorkerUnavailable: "CPU worker is not available",
    loadingCards: "Loading cards...",
    drawn: "Drawn",
    hiddenPickupCard: "Hidden pickup card",
    unknownPlayer: "Unknown player",
    statusYou: "You",
    toPlay: (playerName) => `${playerName} to play`,
    suits: {
      acorns: "Acorns",
      bells: "Bells",
      hearts: "Hearts",
      leaves: "Leaves",
    },
    cardLabel: (rank, suit) => `${rank} of ${messages.en.suits[suit]}`,
    phase: {
      "waiting-for-players": "waiting for players",
      "ready-check": "ready check",
      "trump-round-one": "trump round one",
      "trump-round-two": "trump round two",
      mus: "mus",
      declarations: "declarations",
      "trick-play": "trick play",
      "hand-complete": "hand complete",
      finished: "finished",
      error: "error",
    },
    status: "Status",
    mus: "Mus",
    gameTimeline: "Game timeline",
    hand: "Hand",
    noHandsScored: "No hands scored yet.",
    total: "Total",
    bonus: "bonus",
    bonusPts: (points) => `${points} bonus pts`,
    points: (points) => `${points} pts`,
    currentRank: (rank) => `Your current rank is: ${rank}`,
    highestRank: (rank) => `Your highest rank: ${rank}`,
    currentRanksIntro: "There are the following ranks in Belot 1v1:",
    cpuDifficultyIncreases: "AI difficulty increases with rank.",
    cpuLevelNames: {
      Bronze: "Bronze",
      Silver: "Silver",
      Gold: "Gold",
      Platinum: "Platinum",
      Diamond: "Diamond",
      Master: "Master",
      Grandmaster: "Grandmaster",
    },
    dealer: "Dealer",
    first: "First",
    caller: "CALLER",
    trumpMarker: "T",
    bonusMarker: "B",
    trump: "Trump",
    upcard: "Upcard",
    handResult: "Hand result",
    leftHandResult: "Left hand result",
    rightHandResult: "Right hand result",
    nextHand: "Next hand",
    newGame: "New game",
    nextGame: "New game",
    chooseTrump: "Choose trump",
    accept: "Accept",
    acceptSuit: (suit) => `Accept ${suit}`,
    acceptUpcard: "Accept upcard",
    pass: "Pass",
    chooseSuit: (suit) => `Choose ${suit}`,
    trumpSelection: "Trump selection",
    currentTrick: "Current trick",
    completedTrick: (trickNumber) => `Completed trick ${trickNumber}`,
    upcardIs: (rank, suit) => `Upcard is ${rank} of ${suit}.`,
    playerPassedOnSuit: (playerName, suit) =>
      `${playerName} passed on ${suit}.`,
    upcardSuit: "the upcard suit",
    playerDecidingUpcard: (playerName) =>
      `${playerName} is deciding whether to accept the upcard suit.`,
    youDecidingUpcard: "You are deciding whether to accept the upcard suit.",
    bothPlayersPassedSuit: (suit) => `Both players passed ${suit}.`,
    playerPassedChoosingAnotherSuit: (playerName) =>
      `${playerName} passed choosing another suit.`,
    playerChoosingOtherSuit: (playerName, suit) =>
      `${playerName} is choosing a suit other than ${suit}.`,
    youChoosingOtherSuit: (suit) =>
      `You are choosing a suit other than ${suit}.`,
    bothPlayersPassedTwice: "Both players passed twice.",
    playerMustChooseTrumpOnMus: (playerName) =>
      `${playerName} is on mus and must choose trump.`,
    youMustChooseTrumpOnMus: "You are on mus and must choose trump.",
    winner: (playerName) => `Winner: ${playerName}`,
    startingCards: "Starting cards",
    remainingCards: "Remaining",
    yourHand: "Your hand",
    cpuDebugHand: "AI hand",
    playLegalCard: "play a legal card",
    hideDetails: "Hide details",
    showDetails: "Show details",
    playedTricks: "Played tricks",
    trickWinner: (trickNumber, playerName) =>
      `Trick ${trickNumber}${playerName ? ` · ${playerName}` : ""}`,
    noTricksCompleted: "No tricks completed yet.",
    rules: "Rules",
    rulesOfBelotSuffix: "of Belot 1v1.",
  },
  fr: {
    localeName: "Français",
    language: "Langue",
    switchLanguage: (localeName) => `Passer la langue en ${localeName}`,
    menu: "Menu",
    appTitle: "Belote 1v1",
    authTitle: "Jeux de cartes",
    login: "Connexion",
    register: "Inscription",
    createAccount: "Créer un compte",
    analyticsConsentTitle: "Analytique et stockage du navigateur",
    analyticsConsentBody:
      "Nous utilisons le stockage nécessaire du navigateur pour faire fonctionner l'application. Avec votre accord, nous utilisons une analytique optionnelle pour améliorer le jeu.",
    analyticsConsentAllow: "Accepter",
    analyticsConsentDecline: "Refuser",
    analyticsConsentAccepted: "Analytique acceptée",
    analyticsConsentRejected: "Analytique refusée",
    analyticsConsentUnset: "Aucun choix sélectionné",
    privacySettings: "Paramètres de confidentialité",
    email: "Email",
    password: "Mot de passe",
    displayName: "Nom affiché",
    signedIn: "Connecté",
    logout: "Déconnexion",
    leaveMatch: "Quitter la partie",
    resignGame: "Abandonner",
    confirmResignGame: "Abandonner la partie ?",
    yes: "Oui",
    no: "Non",
    room: "Salon",
    createRoom: "Créer un salon",
    playBelotVsCpu: "Jouer à la Belote contre l'IA",
    roomCode: "Code du salon",
    join: "Rejoindre",
    matchHistory: "Historique",
    completedMatches: (count) => `${count} parties terminées`,
    lobby: "Salon",
    game: "Jeu",
    ready: "Prêt",
    unready: "Pas prêt",
    waiting: "En attente",
    lobbyAutoStart: (gameName) =>
      `Le serveur lance ${gameName} automatiquement dès qu'au moins deux joueurs ont rejoint le salon et que tout le monde est prêt.`,
    belotName: "Belote",
    offlineYou: "Moi",
    cpu: "IA",
    requestFailed: "La requête a échoué",
    registrationFailed: "L'inscription a échoué",
    loginFailed: "La connexion a échoué",
    cpuActionFailed: "L'action de l'IA a échoué",
    cpuWorkerUnavailable: "Le worker de l'IA n'est pas disponible",
    loadingCards: "Chargement des cartes...",
    drawn: "Pioché",
    hiddenPickupCard: "Carte ramassée cachée",
    unknownPlayer: "Joueur inconnu",
    statusYou: "Vous",
    toPlay: (playerName) => `${playerName} doit jouer`,
    suits: {
      acorns: "Glands",
      bells: "Grelots",
      hearts: "Coeurs",
      leaves: "Feuilles",
    },
    cardLabel: (rank, suit) => `${rank} de ${messages.fr.suits[suit]}`,
    phase: {
      "waiting-for-players": "attente des joueurs",
      "ready-check": "confirmation",
      "trump-round-one": "premier tour d'atout",
      "trump-round-two": "deuxième tour d'atout",
      mus: "mus",
      declarations: "annonces",
      "trick-play": "jeu des plis",
      "hand-complete": "main terminée",
      finished: "terminé",
      error: "erreur",
    },
    status: "Statut",
    mus: "Mus",
    gameTimeline: "Déroulé du jeu",
    hand: "Main",
    noHandsScored: "Aucune main marquée.",
    total: "Total",
    bonus: "bonus",
    bonusPts: (points) => `${points} pts de bonus`,
    points: (points) => `${points} pts`,
    currentRank: (rank) => `Votre rang actuel est : ${rank}`,
    highestRank: (rank) => `Votre meilleur rang est : ${rank}`,
    currentRanksIntro: "Il y a les rangs suivants dans Belote 1v1 :",
    cpuDifficultyIncreases: "La difficulté de l'IA augmente avec le rang.",
    cpuLevelNames: {
      Bronze: "Bronze",
      Silver: "Argent",
      Gold: "Or",
      Platinum: "Platine",
      Diamond: "Diamant",
      Master: "Maître",
      Grandmaster: "Grand maître",
    },
    dealer: "Donneur",
    first: "Premier",
    caller: "PRENEUR",
    trumpMarker: "A",
    bonusMarker: "B",
    trump: "Atout",
    upcard: "Carte retournée",
    handResult: "Résultat de la main",
    leftHandResult: "Résultat de la main gauche",
    rightHandResult: "Résultat de la main droite",
    nextHand: "Main suivante",
    newGame: "Nouvelle partie",
    nextGame: "Nouvelle partie",
    chooseTrump: "Choisir l'atout",
    accept: "Accepter",
    acceptSuit: (suit) => `Accepter ${suit}`,
    acceptUpcard: "Accepter la carte retournée",
    pass: "Passer",
    chooseSuit: (suit) => `Choisir ${suit}`,
    trumpSelection: "Choix de l'atout",
    currentTrick: "Pli en cours",
    completedTrick: (trickNumber) => `Pli ${trickNumber} terminé`,
    upcardIs: (rank, suit) => `La carte retournée est ${rank} de ${suit}.`,
    playerPassedOnSuit: (playerName, suit) =>
      `${playerName} a passé sur ${suit}.`,
    upcardSuit: "la couleur de la carte retournée",
    playerDecidingUpcard: (playerName) =>
      `${playerName} décide s'il accepte la couleur de la carte retournée.`,
    youDecidingUpcard:
      "Vous décidez si vous acceptez la couleur de la carte retournée.",
    bothPlayersPassedSuit: (suit) => `Les deux joueurs ont passé ${suit}.`,
    playerPassedChoosingAnotherSuit: (playerName) =>
      `${playerName} a passé pour choisir une autre couleur.`,
    playerChoosingOtherSuit: (playerName, suit) =>
      `${playerName} choisit une couleur autre que ${suit}.`,
    youChoosingOtherSuit: (suit) =>
      `Vous choisissez une couleur autre que ${suit}.`,
    bothPlayersPassedTwice: "Les deux joueurs ont passé deux fois.",
    playerMustChooseTrumpOnMus: (playerName) =>
      `${playerName} est au mus et doit choisir l'atout.`,
    youMustChooseTrumpOnMus: "Vous êtes au mus et devez choisir l'atout.",
    winner: (playerName) => `Vainqueur : ${playerName}`,
    startingCards: "Cartes de départ",
    remainingCards: "Restantes",
    yourHand: "Votre main",
    cpuDebugHand: "Main de l'IA",
    playLegalCard: "jouer une carte autorisée",
    hideDetails: "Masquer les détails",
    showDetails: "Afficher les détails",
    playedTricks: "Plis joués",
    trickWinner: (trickNumber, playerName) =>
      `Pli ${trickNumber}${playerName ? ` · ${playerName}` : ""}`,
    noTricksCompleted: "Aucun pli terminé.",
    rules: "Règles",
    rulesOfBelotSuffix: "de la Belote 1v1.",
  },
};

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  messages: Messages;
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

function persistLocale(locale: Locale) {
  activeLocale = locale;

  if (typeof localStorage !== "undefined") {
    localStorage.setItem(storageKey, locale);
  }
}

export function getCurrentLocale() {
  return activeLocale;
}

export function getMessages(locale: Locale = activeLocale) {
  return messages[locale];
}

export function setLocaleForTests(locale: Locale) {
  persistLocale(locale);
}

export function I18nProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<Locale>(() => activeLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = messages[locale].appTitle;
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale: (nextLocale) => {
        persistLocale(nextLocale);
        setLocaleState(nextLocale);
      },
      messages: messages[locale],
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return (
    useContext(I18nContext) ?? {
      locale: activeLocale,
      setLocale: persistLocale,
      messages: messages[activeLocale],
    }
  );
}
