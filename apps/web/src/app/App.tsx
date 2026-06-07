import { useEffect } from "react";

import { api } from "../api/client";
import { AuthScreen } from "../components/AuthScreen";
import { Dashboard } from "../pages/Dashboard";
import { useAuthStore } from "../stores/auth-store";

export function App() {
  const { token, user } = useAuthStore();

  useEffect(() => {
    if (!token || user) {
      return;
    }

    void api
      .me(token)
      .then((nextUser) => useAuthStore.setState({ user: nextUser }))
      .catch(() => useAuthStore.getState().logout());
  }, [token, user]);

  if (!token || !user) {
    return <AuthScreen />;
  }

  return <Dashboard />;
}
