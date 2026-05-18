import React from 'react';

export const cookiejarTokens = {
  light: {
    bg:      '#f5ead2',
    surface: '#ecdfbb',
    ink:     '#2a1d10',
    accent:  '#a85a2e',
  },
  dark: {
    bg:      '#0f1112',
    surface: '#1a1d1e',
    ink:     '#e6e1d2',
    accent:  '#e09a47',
  },
};

function CookieChips({ color }: { color: string }) {
  return (
    <>
      <circle cx="30" cy="34" r="6.5" fill={color} />
      <circle cx="62" cy="28" r="5"   fill={color} />
      <circle cx="72" cy="56" r="7.5" fill={color} />
      <circle cx="38" cy="68" r="5.5" fill={color} />
      <circle cx="56" cy="52" r="3"   fill={color} opacity="0.55" />
      <circle cx="22" cy="58" r="2.5" fill={color} opacity="0.55" />
    </>
  );
}

export function CookieMark({
  theme = 'light',
  size = 48,
  ...rest
}: {
  theme?: 'light' | 'dark';
  size?: number;
  [key: string]: unknown;
}) {
  const t = cookiejarTokens[theme];
  const isDark = theme === 'dark';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      {...rest}
    >
      {isDark ? (
        <circle cx="50" cy="50" r="46" stroke={t.ink} strokeWidth="4" />
      ) : (
        <circle cx="50" cy="50" r="46" fill={t.accent} />
      )}
      <CookieChips color={isDark ? t.accent : t.ink} />
    </svg>
  );
}

export function CookieJarLogo({
  theme = 'light',
  size = 'md',
  showTagline = false,
  className,
  style,
}: {
  theme?: 'light' | 'dark';
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const t = cookiejarTokens[theme];
  const isDark = theme === 'dark';
  const sizes = {
    sm: { mark: 28, font: 22, gap: 8,  tagline: 9  },
    md: { mark: 48, font: 38, gap: 12, tagline: 10 },
    lg: { mark: 84, font: 68, gap: 20, tagline: 12 },
  };
  const s = sizes[size] ?? sizes.md;
  const wordmarkColor = isDark ? t.accent : t.ink;

  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        ...style,
      }}
    >
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: s.gap }}>
        <CookieMark theme={theme} size={s.mark} />
        <span
          style={{
            fontFamily: 'var(--font-manrope), Manrope, system-ui, sans-serif',
            fontWeight: 800,
            fontSize: s.font,
            letterSpacing: '-0.035em',
            lineHeight: 1,
            color: wordmarkColor,
          }}
        >
          CookieJar
        </span>
      </div>
      {showTagline && (
        <span
          style={{
            fontFamily: 'var(--font-manrope), Manrope, system-ui, sans-serif',
            fontWeight: 500,
            fontSize: s.tagline,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: isDark
              ? 'rgba(230,225,210,0.65)'
              : 'rgba(42,29,16,0.65)',
          }}
        >
          Family Money Tracker
        </span>
      )}
    </div>
  );
}

export function CookieJarFavicon({
  theme = 'light',
  size = 64,
  radius = 14,
}: {
  theme?: 'light' | 'dark';
  size?: number;
  radius?: number;
}) {
  const t = cookiejarTokens[theme];
  const isDark = theme === 'dark';
  const tileFill = isDark ? t.accent : t.ink;
  const cookieFill = isDark ? t.bg : t.accent;
  const chipColor = isDark ? t.ink : t.bg;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-label="CookieJar"
    >
      <rect width="64" height="64" rx={radius} fill={tileFill} />
      <g transform="translate(11 11) scale(0.42)">
        <circle cx="50" cy="50" r="46" fill={cookieFill} />
        <CookieChips color={chipColor} />
      </g>
    </svg>
  );
}

export default CookieJarLogo;
