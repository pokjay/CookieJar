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
      },
    },
  },
  plugins: [],
};

export default config;
