import { SessionBrowserView } from '../components/SessionBrowserView.jsx';

export const CashView = ({ onHandClick }) => (
  <SessionBrowserView gameType="cash" onHandClick={onHandClick}/>
);
