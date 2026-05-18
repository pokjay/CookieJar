export const CATEGORY_COLORS: Record<string, string> = {
  Investments: "#4A90D9",
  Pension: "#7B68EE",
  Hishtalmut: "#50C878",
  "Rainy Day Fund": "#FFB347",
  "Bank Account": "#87CEEB",
};

export const PERSON_COLOR_PALETTE = [
  "#4A90D9",
  "#E88D97",
  "#50C878",
  "#FFB347",
  "#9B59B6",
];

export function getPersonColor(person: string, index: number): string {
  return PERSON_COLOR_PALETTE[index % PERSON_COLOR_PALETTE.length];
}
