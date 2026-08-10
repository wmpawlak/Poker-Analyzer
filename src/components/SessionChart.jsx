import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export default function SessionChart({ chartData = [], isCash = false }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false}/>
        <XAxis dataKey="handIndex" stroke="#9ca3af" fontSize={11} minTickGap={20}/>
        <YAxis stroke="#9ca3af" fontSize={11} domain={['auto', 'auto']}/>
        <Tooltip/>
        <ReferenceLine y={0} stroke="#111827" strokeWidth={2} opacity={isCash ? 0.4 : 0}/>
        <Line type="monotone" dataKey={isCash ? 'profit' : 'stack'} stroke={isCash ? '#4f46e5' : '#f59e0b'} strokeWidth={2.5} dot={false}/>
      </LineChart>
    </ResponsiveContainer>
  );
}
