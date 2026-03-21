import DefaultTheme from 'vitepress/theme';
import './style.css';
import SudokuGame from '../components/SudokuGame.vue';

export default {
  ...DefaultTheme,
  enhanceApp(ctx) {
    DefaultTheme.enhanceApp?.(ctx);
    ctx.app.component('SudokuGame', SudokuGame);
  },
};
