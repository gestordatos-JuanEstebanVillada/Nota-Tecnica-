/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        liga: {
          primary: "#1F4E78",
          primaryDark: "#163856",
        },
      },
    },
  },
  plugins: [],
};