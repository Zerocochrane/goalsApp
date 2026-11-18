import { useEffect, useState } from 'react';

export default function App() {
  const [health, setHealth] = useState('verificando…');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data) => setHealth(data.status))
      .catch(() => setHealth('indisponível'));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>Goals</h1>
      <p>API: {health}</p>
    </main>
  );
}
