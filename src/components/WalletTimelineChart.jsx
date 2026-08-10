import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export default function WalletTimelineChart({ timeline = [] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={timeline}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
        <XAxis dataKey="handIndex" stroke="#9ca3af" fontSize={11} minTickGap={30} />
        <YAxis stroke="#9ca3af" fontSize={11} domain={['auto', 'auto']} />
        <Tooltip />
        <Line type="monotone" dataKey="profit" stroke="#4f46e5" strokeWidth={3} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
