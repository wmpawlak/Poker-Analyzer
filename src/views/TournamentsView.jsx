import { SessionBrowserView } from '../components/SessionBrowserView.jsx';

export const TournamentsView = ({ onHandClick }) => (
  <SessionBrowserView gameType="tournament" onHandClick={onHandClick}/>
);
