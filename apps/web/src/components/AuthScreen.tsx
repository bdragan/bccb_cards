import { FormEvent, useState } from "react";

import { useI18n } from "../i18n";
import { useAuthStore } from "../stores/auth-store";
import { Button } from "./Button";
import { LanguageToggle } from "./LanguageToggle";

export function AuthScreen() {
  const { messages } = useI18n();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const { login, register, loading, error } = useAuthStore();

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (mode === "login") {
      await login(email, password);
    } else {
      await register(email, displayName, password);
    }
  }

  return (
    <main className="app-background grid min-h-screen place-items-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-md bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-bold text-ink">{messages.authTitle}</h1>
          <LanguageToggle />
        </div>
        <div className="mt-5 grid grid-cols-2 rounded-md bg-slate-100 p-1">
          <button
            type="button"
            className={`rounded px-3 py-2 text-sm font-semibold ${mode === "login" ? "bg-white shadow" : ""}`}
            onClick={() => setMode("login")}
          >
            {messages.login}
          </button>
          <button
            type="button"
            className={`rounded px-3 py-2 text-sm font-semibold ${mode === "register" ? "bg-white shadow" : ""}`}
            onClick={() => setMode("register")}
          >
            {messages.register}
          </button>
        </div>

        <label className="mt-5 block text-sm font-medium">
          {messages.email}
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            required
          />
        </label>

        {mode === "register" ? (
          <label className="mt-4 block text-sm font-medium">
            {messages.displayName}
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
            />
          </label>
        ) : null}

        <label className="mt-4 block text-sm font-medium">
          {messages.password}
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            minLength={mode === "register" ? 8 : 1}
            required
          />
        </label>

        {error ? (
          <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <Button className="mt-5 w-full" disabled={loading}>
          {mode === "login" ? messages.login : messages.createAccount}
        </Button>
      </form>
    </main>
  );
}
