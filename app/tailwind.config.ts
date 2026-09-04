import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b0a08",
        paper: "#f3efe4",
        gold: "#d4a24a",
        moss: "#7dba6a",
        rust: "#c47a4a",
        mute: "#9a917f",
      },
      fontFamily: {
        serif: ["Fraunces", "Georgia", "serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
