import {h} from 'vue';
import DefaultTheme from 'vitepress/theme';
import './style.css';
import SudokuGame from '../components/SudokuGame.vue';
import DocHeader from '../components/DocHeader.vue';
import AiChat from '../components/AiChat.vue';
import AppearanceMenu from '../components/AppearanceMenu.vue';

export default {
  ...DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'nav-bar-content-after': () => h(AppearanceMenu, { variant: 'bar' }),
      'nav-screen-content-after': () => h(AppearanceMenu, { variant: 'screen' }),
      'doc-before': () => h(DocHeader),
    });
  },
  enhanceApp(ctx) {
    DefaultTheme.enhanceApp?.(ctx);
    ctx.app.component('SudokuGame', SudokuGame);
    ctx.app.component('AiChat', AiChat);
  },
};
