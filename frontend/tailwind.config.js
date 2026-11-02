/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#12283a',
        muted: '#64748b',
        paper: '#f5f7fa',
        brand: '#136d67',
        'brand-dark': '#0c514d',
        line: '#e5eaf0'
      },
      boxShadow: {
        card: '0 12px 32px rgba(18, 40, 58, 0.07)'
      }
    }
  },
  plugins: []
};
