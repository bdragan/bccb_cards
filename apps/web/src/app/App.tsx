import { useEffect, useState } from "react";

import { api } from "../api/client";
import { AuthScreen } from "../components/AuthScreen";
import { Dashboard } from "../pages/Dashboard";
import { useAuthStore } from "../stores/auth-store";

export function App() {
  const { token, user } = useAuthStore();
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    if (!token || user) {
      return;
    }

    void api
      .me(token)
      .then((nextUser) => useAuthStore.setState({ user: nextUser }))
      .catch(() => useAuthStore.getState().logout());
  }, [token, user]);

  if ((token && !user) || (showAuth && !token)) {
    return <AuthScreen />;
  }

  return <Dashboard onLogin={() => setShowAuth(true)} />;
}
