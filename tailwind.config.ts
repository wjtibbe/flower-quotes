import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f2f8f3",
          100: "#dfeee1",
          200: "#bedcc4",
          300: "#93c29e",
          400: "#65a274",
          500: "#3f8355",
          600: "#2d6a42",
          700: "#245437",
          800: "#1e432e",
          900: "#193727",
        },
      },
    },
  },
  plugins: [],
};

export default config;
