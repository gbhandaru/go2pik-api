require('dotenv').config();
const express = require('express');
const cors = require('cors');
const orderRoutes = require('./routes/orderRoutes');
const restaurantRoutes = require('./routes/restaurantRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const customerAuthRoutes = require('./routes/customerAuthRoutes');
const restaurantUserAuthRoutes = require('./routes/restaurantUserAuthRoutes');
const customerRoutes = require('./routes/customerRoutes');
const restaurantStaffRoutes = require('./routes/restaurantStaffRoutes');
const restaurantUserRoutes = require('./routes/restaurantUserRoutes');

const app = express();

app.use((req, res, next) => {
  console.log(req.method, req.url);
  next();
});

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  : [];

const corsOptions =
  allowedOrigins.length === 0
    ? {}
    : {
        origin(origin, callback) {
          if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
          }
          callback(new Error('Not allowed by CORS'));
        },
      };

app.use(cors(corsOptions));
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
  res.json({ status: 'ok', service: 'go2pik-api' });
});

const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
