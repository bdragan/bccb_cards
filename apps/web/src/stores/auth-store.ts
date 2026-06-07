import type { AuthUser } from "@card-games/shared";
import { create } from "zustand";

import { api } from "../api/client";

type AuthState = {
  token?: string;
  user?: AuthUser;
  loading: boolean;
  error?: string;
  register(email: string, displayName: string, password: string): Promise<void>;
  login(email: string, password: string): Promise<void>;
  logout(): void;
};

const storedToken = localStorage.getItem("card-games-token") ?? undefined;

export const useAuthStore = create<AuthState>((set) => ({
  token: storedToken,
  loading: false,
  async register(email, displayName, password) {
    set({ loading: true, error: undefined });
    try {
      const response = await api.register({ email, displayName, password });
      localStorage.setItem("card-games-token", response.accessToken);
      set({ token: response.accessToken, user: response.user, loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Registration failed",
        loading: false,
      });
    }
  },
  async login(email, password) {
    set({ loading: true, error: undefined });
    try {
      const response = await api.login({ email, password });
      localStorage.setItem("card-games-token", response.accessToken);
      set({ token: response.accessToken, user: response.user, loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Login failed",
        loading: false,
      });
    }
  },
  logout() {
    localStorage.removeItem("card-games-token");
    set({ token: undefined, user: undefined });
  },
}));
