"use client";

import React, { useState, useEffect } from "react";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const dark = document.documentElement.classList.contains("dark");
    setIsDark(dark);
  }, []);

  const toggleTheme = () => {
    const newDark = !isDark;
    setIsDark(newDark);
    document.documentElement.classList.toggle("dark", newDark);
    localStorage.setItem("theme", newDark ? "dark" : "light");
  };

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const ThemeContext = React.createContext<{ isDark: boolean; toggleTheme: () => void }>({
  isDark: true,
  toggleTheme: () => {},
});

export const useTheme = () => React.useContext(ThemeContext);
