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
      { text: 'Fragments', link: '/article' }
    ],

    sidebar: [
      {
        text: 'Fragments',
        items: [
          { text: 'Article', link: '/article' },
          { text: 'Command', link: '/command' },
          { text: 'Sudo', link: '/sudo' },
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/mora-na' }
    ]
  }
})
