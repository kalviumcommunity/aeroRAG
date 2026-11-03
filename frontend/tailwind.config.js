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
        hud: {
          cyan: '#00f0ff',
          amber: '#ffb800',
          red: '#ff3838',
          green: '#00ff88',
          dark: '#050814',
        }
      },
      fontFamily: {
        orbitron: ['Orbitron', 'monospace'],
        mono: ['"JetBrains Mono"', 'monospace'],
        sans: ['Rajdhani', 'Inter', 'sans-serif'],
      }
    },
  },
  plugins: [],
}

