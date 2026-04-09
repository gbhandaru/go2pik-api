const config = require('./config/env');
const app = require('./app');

const { port, host } = config.server;

app.listen(port, host, () => {
  console.log(`Server running on http://${host}:${port}`);
});
