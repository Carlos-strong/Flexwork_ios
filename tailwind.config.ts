import type { Config } from "tailwindcss";

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
        display: ["var(--font-display)", "Georgia", "serif"],
        body: ["var(--font-body)", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        card: "0 1px 2px rgba(22,35,62,.04), 0 12px 28px -12px rgba(22,35,62,.16)",
        pop: "0 4px 10px -2px rgba(22,35,62,.18)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
