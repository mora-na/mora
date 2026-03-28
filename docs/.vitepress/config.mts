import {defineConfig} from 'vitepress'

const base = '/'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base,
  title: "mora",
  description: "技术文章、命令备忘与游戏。",
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: `${base}favicon.png` }],
  ],
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '碎片', link: '/ohmyzsh-starship-zinit' },
      { text: '游戏', link: '/sudoku' },
      { text: '备忘', link: '/command' }
    ],

    sidebar: [
      {
        text: '碎片',
        items: [
          { text: '告别 oh-my-zsh 启动卡顿', link: '/ohmyzsh-starship-zinit' },
          { text: 'Clash Party TUN on macOS', link: '/clash-party-tun-macos' },
          { text: 'Cloudflare Workers 超时排障', link: '/cloudflare-workers-timeout-tracing' },
          { text: 'Sudoku Development Log', link: '/sudoku-development-log' },
        ]
      },
      {
        text: '游戏',
        items: [
          { text: 'Sudoku', link: '/sudoku' },
        ]
      },
      {
        text: '备忘',
        items: [
          { text: 'Command', link: '/command' },
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/mora-na' }
    ]
  }
})
