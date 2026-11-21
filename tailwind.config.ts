import type { Config } from "tailwindcss";

// Neutres lavande du prototype « Marketplace Escrow » (2026-11-11) : zinc, gray et slate
// pointent sur la même échelle, pour que les ~1 300 classes neutres des pages suivent le thème.
const ink = {
  50: "#f6f5fa",
  100: "#efeaf8",
  200: "#e7e2f0",
  300: "#d4cce3",
  400: "#9a93a8",
  500: "#6b6478",
  600: "#574f66",
  700: "#3f3850",
  800: "#2a2338",
  900: "#191224",
  950: "#120e1c",
};

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        zinc: ink,
        gray: ink,
        slate: ink,
        violet: {
          50: "#f7f3ff",
          100: "#f0eaff",
          200: "#ddd6fe",
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#6d28d9",
          700: "#5b21b6",
          800: "#4c1d95",
          900: "#3b1578",
          950: "#2e1065",
        },
        brand: {
          DEFAULT: "#4c1d95",
          dark: "#3b1578",
          soft: "#f0eaff",
          money: "#047857",
          "money-soft": "#e7f7ef",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        ok: "hsl(var(--ok))",
        filiere: {
          digital: "hsl(var(--filiere-digital))",
          "digital-bg": "hsl(var(--filiere-digital-bg))",
          artisan: "hsl(var(--filiere-artisan))",
          "artisan-bg": "hsl(var(--filiere-artisan-bg))",
          expert: "hsl(var(--filiere-expert))",
          "expert-bg": "hsl(var(--filiere-expert-bg))",
          manoeuvre: "hsl(var(--filiere-manoeuvre))",
          "manoeuvre-bg": "hsl(var(--filiere-manoeuvre-bg))",
          neutral: "hsl(var(--filiere-neutral))",
          "neutral-bg": "hsl(var(--filiere-neutral-bg))",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "1rem",
        "2xl": "1.25rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(25,18,36,.04), 0 12px 28px -14px rgba(76,29,149,.22)",
        pop: "0 4px 10px -2px rgba(76,29,149,.2)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
