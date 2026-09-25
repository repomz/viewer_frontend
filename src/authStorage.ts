const AUTH_KEY = "viewer.auth.v1";

export type AuthUser = {
  id: number;
  display_name: string;
  login: string;
  role: "user" | "admin";
  quota_bytes: number;
};

export type StoredAuth = {
  token: string;
  user: AuthUser;
};

function storage(): Storage | null {
  try {
    return typeof globalThis.localStorage !== "undefined" ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

export function loadAuth(): StoredAuth | null {
  const target = storage();
  if (!target) return null;
  try {
    const value = JSON.parse(target.getItem(AUTH_KEY) ?? "null") as StoredAuth | null;
    return value?.token && value?.user ? value : null;
  } catch {
    return null;
  }
}

export function authToken(): string {
  return loadAuth()?.token ?? "";
}

export function saveAuth(value: StoredAuth): void {
  storage()?.setItem(AUTH_KEY, JSON.stringify(value));
}

export function clearAuth(): void {
  storage()?.removeItem(AUTH_KEY);
}
