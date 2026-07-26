import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        cj: {
          bg:             "rgb(var(--cj-bg) / <alpha-value>)",
          surface:        "rgb(var(--cj-surface) / <alpha-value>)",
          elevated:       "rgb(var(--cj-elevated) / <alpha-value>)",
          hover:          "rgb(var(--cj-hover) / <alpha-value>)",
          border:         "rgb(var(--cj-border) / <alpha-value>)",
          "border-strong":"rgb(var(--cj-border-strong) / <alpha-value>)",
          text:           "rgb(var(--cj-text) / <alpha-value>)",
          "text-2":       "rgb(var(--cj-text-2) / <alpha-value>)",
          "text-3":       "rgb(var(--cj-text-3) / <alpha-value>)",
          "text-muted":   "rgb(var(--cj-text-muted) / <alpha-value>)",
          "text-faint":   "rgb(var(--cj-text-faint) / <alpha-value>)",
          accent:         "rgb(var(--cj-accent) / <alpha-value>)",
          "accent-hover": "rgb(var(--cj-accent-hover) / <alpha-value>)",
          "accent-text":  "rgb(var(--cj-accent-text) / <alpha-value>)",
          positive:       "rgb(var(--cj-positive) / <alpha-value>)",
          negative:       "rgb(var(--cj-negative) / <alpha-value>)",
          warning:        "rgb(var(--cj-warning) / <alpha-value>)",
        },
        fx: {
          page:        "var(--fx-page)",
          bg:          "var(--fx-bg)",
          surface:     "var(--fx-surface)",
          "surface-2": "var(--fx-surface-2)",
          ink:         "var(--fx-ink)",
          "ink-2":     "var(--fx-ink-2)",
          "ink-3":     "var(--fx-ink-3)",
          line:        "var(--fx-line)",
          "line-2":    "var(--fx-line-2)",
          accent:      "var(--fx-accent)",
          "accent-soft": "var(--fx-accent-soft)",
          positive:    "var(--fx-positive)",
          negative:    "var(--fx-negative)",
          "card-bg":   "var(--fx-card-bg)",
          "card-border": "var(--fx-card-border)",
        },
      },
      borderRadius: {
        fx: "var(--fx-radius)",
      },
      boxShadow: {
        fx: "var(--fx-shadow)",
      },
      fontFamily: {
        "fx-mono": ["var(--font-plex-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
