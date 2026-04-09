const express = require('express');
const cors = require('cors');
const config = require('./config/env');
const buildCorsOptions = require('./config/cors');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');

const customerAuthRoutes = require('./routes/customerAuthRoutes');
const restaurantUserAuthRoutes = require('./routes/restaurantUserAuthRoutes');
const customerRoutes = require('./routes/customerRoutes');
const restaurantRoutes = require('./routes/restaurantRoutes');
const restaurantStaffRoutes = require('./routes/restaurantStaffRoutes');
const restaurantUserRoutes = require('./routes/restaurantUserRoutes');
const orderRoutes = require('./routes/orderRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

const app = express();

app.use((req, res, next) => {
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode}`);
  });
  next();
});
app.use(cors(buildCorsOptions()));
app.use(express.json());

app.use('/api/auth', customerAuthRoutes);
app.use('/api/auth', restaurantUserAuthRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/restaurants', restaurantStaffRoutes);
app.use('/api/restaurant-users', restaurantUserRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'go2pik-api', env: config.env });
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
