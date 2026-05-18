"use client";

import { useTheme } from "next-themes";

export interface ThemeColors {
  axis: string;
  label: string;
  grid: string;
  cursor: string;
}

export function useThemeColors(): ThemeColors {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  return {
    axis:   isDark ? "#9CA3AF" : "#7a5a40",
    label:  isDark ? "#D1D5DB" : "#5a3e28",
    grid:   isDark ? "#374151" : "#d4c49e",
    cursor: isDark ? "#374151" : "rgba(42,29,16,0.15)",
  };
}
