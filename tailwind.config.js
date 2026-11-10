/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./popup.html",
    "./dashboard.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cf: {
          newbie: '#808080',
          pupil: '#008000',
          specialist: '#03a89e',
          expert: '#0000ff',
          candidateMaster: '#aa00aa',
          master: '#ff8c00',
          grandmaster: '#ff0000',
          predictor: '#64748b',
          predictorLight: '#94a3b8',
        }
      }
    },
  },
  plugins: [],
}
