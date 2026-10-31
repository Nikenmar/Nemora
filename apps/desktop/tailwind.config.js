/** @type {import("tailwindcss").Config} */

// import * as colors from 'tailwindcss/colors';
import plugin from 'tailwindcss/plugin';

export const content = ['./src/renderer/index.html', './src/renderer/src/**/*.{js,jsx,ts,tsx,ejs}'];
export const darkMode = 'selector';
export const theme = {
  screens: {
    // '3xl': { max: '2000px' },
    // // => @media (max-width: 2000px) { ... }
    // '2xl': { max: '1535px' },
    // // => @media (max-width: 1535px) { ... }
    xl: { max: '1279px' },
    // => @media (max-width: 1279px) { ... }
    lg: { max: '1023px' },
    // => @media (max-width: 1023px) { ... }
    md: { max: '900px' },
    // => @media (max-width: 850px) { ... }
    sm: { max: '800px' }
    // => @media (max-width: 639px) { ... }
  },
  extend: {
    colors: {
      // ? Tokens (styles.css). They switch with the theme, so no `dark:` variant is needed.
      canvas: 'rgb(var(--canvas) / <alpha-value>)',
      chrome: 'rgb(var(--chrome) / <alpha-value>)',
      'surface-1': 'rgb(var(--surface-1) / <alpha-value>)',
      'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
      'surface-3': 'rgb(var(--surface-3) / <alpha-value>)',
      line: 'rgb(var(--line) / <alpha-value>)',
      ink: 'rgb(var(--ink) / <alpha-value>)',
      'ink-dim': 'rgb(var(--ink-dim) / <alpha-value>)',
      'ink-faint': 'rgb(var(--ink-faint) / <alpha-value>)',
      accent: 'rgb(var(--accent) / <alpha-value>)',
      'accent-hover': 'rgb(var(--accent-hover) / <alpha-value>)',
      'on-accent': 'rgb(var(--on-accent) / <alpha-value>)',
      'accent-soft': 'rgb(var(--accent-soft) / <alpha-value>)',
      echo: 'rgb(var(--echo) / <alpha-value>)',
      danger: 'rgb(var(--danger) / <alpha-value>)',
      'danger-soft': 'rgb(var(--danger-soft) / <alpha-value>)',
      success: 'rgb(var(--success) / <alpha-value>)',
      warning: 'rgb(var(--warning) / <alpha-value>)',
      'on-media': 'rgb(var(--on-media) / <alpha-value>)',
      shade: 'rgb(var(--shade) / <alpha-value>)',
      glass: 'rgb(var(--glass) / var(--glass-alpha))',
      'glass-hover': 'rgb(var(--glass-hover))',
      'glass-border': 'rgb(var(--glass-border))',
      scrim: 'rgb(var(--scrim))',
      'cover-glow': 'var(--cover-glow)'
    },
    fontFamily: {
      sans: ['var(--font-ui)']
    },
    borderRadius: {
      menu: '10px',
      panel: '12px',
      dialog: '14px',
      'cover-sm': '6px',
      cover: '8px',
      'cover-lg': '12px'
    },
    fontSize: {
      micro: ['11.5px', { lineHeight: '14px' }],
      small: ['12px', { lineHeight: '16px' }],
      body: ['13.5px', { lineHeight: '18px' }],
      section: ['15px', { lineHeight: '20px' }],
      title: ['20px', { lineHeight: '26px' }],
      page: ['30px', { lineHeight: '34px', letterSpacing: '-0.01em' }],
      hero: ['34px', { lineHeight: '38px', letterSpacing: '-0.01em' }]
    },
    transitionTimingFunction: {
      out: 'var(--ease-out)',
      'in-out-strong': 'var(--ease-in-out)',
      spring: 'var(--ease-spring)'
    },
    // The motion durations of PLAN/14: duration-m1 .. duration-m4.
    transitionDuration: {
      m1: 'var(--dur-1)',
      m2: 'var(--dur-2)',
      m3: 'var(--dur-3)',
      m4: 'var(--dur-4)'
    },
    animation: {
      'spin-ease': 'spin 1000ms ease-in-out infinite',
      'dialog-appear-ease-in-out': 'dialogAppear 180ms var(--ease-out)',
      'dialog-dissappear-ease-in-out': 'dialogDisappear 120ms ease',
      skeleton: 'skeletonPulse 1.4s ease-in-out infinite'
    },
    boxShadow: {
      float: 'var(--shadow-float)',
      'inner-sm': 'inset 0 1px 2px 0 rgb(0 0 0 / 0.05)',
      'inner-md': 'inset 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
      'inner-lg': 'inset 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
      'inner-xl': 'inset 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
      'inner-2xl': 'inset 0 25px 50px -12px rgb(0 0 0 / 0.25)'
    }
  }
};
export const plugins = [
  plugin(({ matchVariant }) => {
    matchVariant(
      'nth',
      (value) => {
        return `&:nth-child(${value})`;
      },
      {
        values: {
          1: '1',
          2: '2',
          3: '3'
        }
      }
    );
  }),
  plugin(({ matchVariant }) => {
    matchVariant(
      'nth-last',
      (value) => {
        return `&:nth-last-child(${value})`;
      },
      {
        values: {
          1: '1',
          2: '2',
          3: '3'
        }
      }
    );
  }),
  plugin(({ matchUtilities, theme }) => {
    matchUtilities(
      {
        'animate-duration': (value) => ({
          animationDuration: value
        })
      },
      { values: theme('transitionDuration') }
    );
    matchUtilities(
      {
        'animate-delay': (value) => ({
          animationDelay: value
        })
      },
      { values: theme('transitionDelay') }
    );
  })
];
