/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        void: "#050505",
        glass: "rgba(255, 255, 255, 0.05)",
        "glass-hover": "rgba(255, 255, 255, 0.1)",
        "neon-blue": "#00f3ff",
        "neon-purple": "#bc13fe",
        "neon-red": "#ff0055",
        "deep-space": "#0a0a0f",
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      backgroundImage: {
        'cosmic-gradient': 'radial-gradient(circle at center, #1a1a2e 0%, #000000 100%)',
      },
      boxShadow: {
        'glow-blue': '0 0 20px rgba(0, 243, 255, 0.3)',
        'glow-purple': '0 0 20px rgba(188, 19, 254, 0.3)',
      }
    },
  },
  plugins: [],
}
