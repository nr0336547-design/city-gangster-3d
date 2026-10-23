import './styles.css';
import { CityGame } from './game';

const app = document.getElementById('app');
if (!app) {
  throw new Error('Application root not found');
}

new CityGame(app);
