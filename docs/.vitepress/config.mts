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
      { text: 'Examples', link: '/markdown-examples' }
    ],

    sidebar: [
      {
        text: 'Examples',
        items: [
          { text: 'Markdown Examples', link: '/markdown-examples' },
          { text: 'Runtime API Examples', link: '/api-examples' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/mora-na/mora' }
    ]
  }
})
