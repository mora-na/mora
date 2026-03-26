import {h} from 'vue';
import DefaultTheme from 'vitepress/theme';
import './style.css';
import SudokuGame from '../components/SudokuGame.vue';
import DocHeader from '../components/DocHeader.vue';

export default {
  ...DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'doc-before': () => h(DocHeader),
    });
  },
  enhanceApp(ctx) {
    DefaultTheme.enhanceApp?.(ctx);
    ctx.app.component('SudokuGame', SudokuGame);
  },
};
