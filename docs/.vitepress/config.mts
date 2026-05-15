import {defineConfig} from 'vitepress'
// loadEnv 由 VitePress 内部的 Vite 实例导出，无需单独安装 vite
import {loadEnv} from 'vitepress/dist/node/index.js'

const base = '/'
const env = loadEnv('', process.cwd(), 'VITE')

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base,
  cleanUrls: true,
  title: "mora",
  description: "技术文章、命令备忘与游戏。",
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: `${base}favicon.png` }],
  ],
  vite: {
    define: {
      __AI_STREAM_URL__: JSON.stringify(env.VITE_AI_STREAM_URL ?? ''),
      __AI_BEARER_TOKEN__: JSON.stringify(env.VITE_AI_BEARER_TOKEN ?? ''),
    },
  },
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '碎片', link: '/ohmyzsh-starship-zinit' },
      { text: '游戏', link: '/sudoku' },
      { text: '备忘', link: '/command' },
      { text: 'AI 分身', link: '/ai' }
    ],

    sidebar: [
      {
        text: '碎片',
        items: [
          { text: 'AutoFillingForm 开发日志', link: '/autofillingform-development-log' },
          { text: 'FinderToolkit 开发日志', link: '/finder-toolkit-development-log' },
          { text: 'Sudoku Development Log', link: '/sudoku-development-log' },
          { text: '告别 oh-my-zsh 启动卡顿', link: '/ohmyzsh-starship-zinit' },
          { text: 'Clash Party TUN on macOS', link: '/clash-party-tun-macos' },
          { text: 'Cloudflare Workers 超时排障', link: '/cloudflare-workers-timeout-tracing' },
          { text: 'openclaw-gateway-startup-oom-troubleshooting', link: '/openclaw-gateway-startup-oom-troubleshooting' },
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
      },
      {
        text: 'AI 分身',
        items: [
          { text: '与 mora 对话', link: '/ai' },
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/mora-na' }
    ]
  }
})
