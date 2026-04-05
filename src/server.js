app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'go2pik-api' });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'go2pik-api' });
});

const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
