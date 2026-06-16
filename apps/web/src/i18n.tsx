import type { BelotPhase, Rank, Suit } from "@card-games/shared";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export const locales = ["sr", "en"] as const;
export type Locale = (typeof locales)[number];

const storageKey = "card-games-locale";
const defaultLocale: Locale = "sr";

function isLocale(value: string | null | undefined): value is Locale {
  return locales.includes(value as Locale);
}

function readStoredLocale(): Locale {
  if (typeof localStorage === "undefined") {
    return defaultLocale;
  }

  const stored = localStorage.getItem(storageKey);
  return isLocale(stored) ? stored : defaultLocale;
}

let activeLocale: Locale = readStoredLocale();

export type Messages = {
  localeName: string;
  language: string;
  switchLanguage: (localeName: string) => string;
  appTitle: string;
  authTitle: string;
  login: string;
  register: string;
  createAccount: string;
  email: string;
  password: string;
  displayName: string;
  signedIn: string;
  logout: string;
  leaveMatch: string;
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
  cardBack: string;
  drawn: string;
  hiddenPickupCard: string;
  hiddenPickupCardNumber: (index: number) => string;
  unknownPlayer: string;
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
  bothPlayersPassedSuit: (suit: string) => string;
  playerPassedChoosingAnotherSuit: (playerName: string) => string;
  playerChoosingOtherSuit: (playerName: string, suit: string) => string;
  bothPlayersPassedTwice: string;
  playerMustChooseTrumpOnMus: (playerName: string) => string;
  winner: (playerName: string) => string;
  startingCards: string;
  remainingCards: string;
  yourHand: string;
  playLegalCard: string;
  hideDetails: string;
  showDetails: string;
  playedTricks: string;
  trickWinner: (trickNumber: number, playerName?: string) => string;
  noTricksCompleted: string;
};

export const messages: Record<Locale, Messages> = {
  sr: {
    localeName: "Srpski",
    language: "Jezik",
    switchLanguage: (localeName) => `Promeni jezik na ${localeName}`,
    appTitle: "Bela",
    authTitle: "Bela",
    login: "Prijava",
    register: "Registracija",
    createAccount: "Napravi nalog",
    email: "Email",
    password: "Lozinka",
    displayName: "Ime za prikaz",
    signedIn: "Prijavljen",
    logout: "Odjavi se",
    leaveMatch: "Napusti partiju",
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
    offlineYou: "Vi",
    cpu: "CPU",
    requestFailed: "Zahtev nije uspeo",
    registrationFailed: "Registracija nije uspela",
    loginFailed: "Prijava nije uspela",
    cpuActionFailed: "CPU potez nije uspeo",
    cpuWorkerUnavailable: "CPU worker nije dostupan",
    cardBack: "Poleđina karte",
    drawn: "Izvučeno",
    hiddenPickupCard: "Skrivena pokupljena karta",
    hiddenPickupCardNumber: (index) => `Skrivena pokupljena karta ${index}`,
    unknownPlayer: "Nepoznat igrač",
    toPlay: (playerName) => `${playerName} je na potezu`,
    suits: {
      acorns: "Žir",
      bells: "Zvona",
      hearts: "Srca",
      leaves: "List",
    },
    cardLabel: (rank, suit) =>
      `${rank} ${
        {
          acorns: "žir",
          bells: "zvona",
          hearts: "srca",
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
    nextGame: "Sledeća igra",
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
    bothPlayersPassedSuit: (suit) => `Oba igrača: Dalje za ${suit}.`,
    playerPassedChoosingAnotherSuit: (playerName) =>
      `${playerName}: Dalje za drugu boju.`,
    playerChoosingOtherSuit: (playerName, suit) =>
      `${playerName} bira boju različitu od ${suit}.`,
    bothPlayersPassedTwice: "Oba igrača: Dalje dva puta.",
    playerMustChooseTrumpOnMus: (playerName) =>
      `${playerName} je na musu i mora izabrati adut.`,
    winner: (playerName) => `Pobednik: ${playerName}`,
    startingCards: "Početne karte",
    remainingCards: "Tesla",
    yourHand: "Vaše karte",
    playLegalCard: "odigraj dozvoljenu kartu",
    hideDetails: "Sakrij detalje",
    showDetails: "Prikaži detalje",
    playedTricks: "Odigrani štihovi",
    trickWinner: (trickNumber, playerName) =>
      `Štih ${trickNumber}${playerName ? ` · ${playerName}` : ""}`,
    noTricksCompleted: "Još nema završenih štihova.",
  },
  en: {
    localeName: "English",
    language: "Language",
    switchLanguage: (localeName) => `Switch language to ${localeName}`,
    appTitle: "Belot",
    authTitle: "Card Games",
    login: "Login",
    register: "Register",
    createAccount: "Create account",
    email: "Email",
    password: "Password",
    displayName: "Display name",
    signedIn: "Signed in",
    logout: "Logout",
    leaveMatch: "Leave match",
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
    offlineYou: "You",
    cpu: "CPU",
    requestFailed: "Request failed",
    registrationFailed: "Registration failed",
    loginFailed: "Login failed",
    cpuActionFailed: "CPU action failed",
    cpuWorkerUnavailable: "CPU worker is not available",
    cardBack: "Card back",
    drawn: "Drawn",
    hiddenPickupCard: "Hidden pickup card",
    hiddenPickupCardNumber: (index) => `Hidden pickup card ${index}`,
    unknownPlayer: "Unknown player",
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
    nextGame: "Next game",
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
    bothPlayersPassedSuit: (suit) => `Both players passed ${suit}.`,
    playerPassedChoosingAnotherSuit: (playerName) =>
      `${playerName} passed choosing another suit.`,
    playerChoosingOtherSuit: (playerName, suit) =>
      `${playerName} is choosing a suit other than ${suit}.`,
    bothPlayersPassedTwice: "Both players passed twice.",
    playerMustChooseTrumpOnMus: (playerName) =>
      `${playerName} is on mus and must choose trump.`,
    winner: (playerName) => `Winner: ${playerName}`,
    startingCards: "Starting cards",
    remainingCards: "Remaining cards",
    yourHand: "Your hand",
    playLegalCard: "play a legal card",
    hideDetails: "Hide details",
    showDetails: "Show details",
    playedTricks: "Played tricks",
    trickWinner: (trickNumber, playerName) =>
      `Trick ${trickNumber}${playerName ? ` · ${playerName}` : ""}`,
    noTricksCompleted: "No tricks completed yet.",
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
