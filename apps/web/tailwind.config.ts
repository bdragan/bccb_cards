import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        felt: "#1f7a4d",
        ink: "#18212f",
        rail: "#d8b46a"
      }
    }
  },
  plugins: []
} satisfies Config;
