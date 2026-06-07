import type { AuthResponse, AuthUser, GameMetadata, LoginDto, RegisterDto } from "@card-games/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Request failed");
  }

  return response.json() as Promise<T>;
}

export const api = {
  register(dto: RegisterDto) {
    return request<AuthResponse>("/auth/register", { method: "POST", body: JSON.stringify(dto) });
  },
  login(dto: LoginDto) {
    return request<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify(dto) });
  },
  me(token: string) {
    return request<AuthUser>("/auth/me", {}, token);
  },
  games(token: string) {
    return request<GameMetadata[]>("/games", {}, token);
  },
  matches(token: string) {
    return request<unknown[]>("/matches/me", {}, token);
  }
};
