import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1f1f1f',
        mist: '#f7f9fc',
        signal: '#1a73e8',
        warm: '#0f9d58',
        slate: '#5f6368',
        cloud: '#eef3fd',
        line: '#d7e3fd',
        shell: '#edf2fa',
      },
      fontFamily: {
        sans: ['Aptos', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        panel: '0 12px 32px rgba(32, 33, 36, 0.08)',
        float: '0 8px 24px rgba(26, 115, 232, 0.14)',
      },
    },
  },
  plugins: [],
};

export default config;
