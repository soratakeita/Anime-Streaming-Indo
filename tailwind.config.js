/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: { DEFAULT: "#E24B4A", hover: "#c73c3b" },
        surface: {
          DEFAULT: "#0f0f0f",
          card: "#1a1a1a",
          border: "#2a2a2a",
          muted: "#222222",
        },
      },
    },
  },
  plugins: [],
};
