/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: "var(--bg-primary)",
        secondary: "var(--bg-secondary)",
        accent: {
          cyan: "#22D3EE",
          neon: "#06B6D4",
          purple: "#A855F7"
        },
        surface: "var(--bg-secondary)",
        border: "var(--border)",
        text: {
          main: "var(--text-main)",
          muted: "var(--text-muted)"
        }
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"Inter"', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
