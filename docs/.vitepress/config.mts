import {defineConfig} from 'vitepress'

const base = '/'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base,
  title: "mora",
  description: "just a blog",
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: `${base}favicon.png` }],
  ],
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Fragments', link: '/sudoku-development-log' }
    ],

    sidebar: [
      {
        text: 'Fragments',
        items: [
          { text: 'Sudoku', link: '/sudoku' },
          { text: 'Sudoku Development Log', link: '/sudoku-development-log' },
          { text: 'Command', link: '/command' },
          { text: 'Clash Party TUN on macOS', link: '/clash-party-tun-macos' },
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/mora-na' }
    ]
  }
})
