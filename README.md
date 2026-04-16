# Go2Pik API

Node.js/Express backend that powers Go2Pik food ordering workflows. It mirrors the capabilities of the legacy `foof-order-app` backend—covering customers, restaurants, menus, orders, restaurant staff/auth flows, and dashboard operations—while exposing configuration knobs for local Postgres or Google Cloud SQL deployments.

## Prerequisites

- Node.js 18+
- npm or pnpm (examples below use npm)
- Postgres database seeded with the Go2Pik schema/data

## Environment

Create a `.env` (or copy `.env.example` if present). Key variables:

```
PORT=5000
HOST=0.0.0.0
CORS_ORIGINS=http://localhost:5173,https://go2pik-app.web.app
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=postgres
PGPASSWORD=secret
PGDATABASE=food_orders_db
PGSSL=false
ACCESS_TOKEN_SECRET=your-access-secret
REFRESH_TOKEN_SECRET=your-refresh-secret
DEFAULT_TAX_RATE=0.08
NOTIFICATIONS_ENABLED=true
EMAIL_PROVIDER_URL=https://api.emailprovider.com/send
EMAIL_PROVIDER_API_KEY=super-secret-key
EMAIL_FROM=no-reply@go2pik.com
EMAIL_FROM_NAME=Go2Pik
NOTIFICATION_TIMEZONE=America/New_York
SENDGRID_API_KEY=Email Provider API key (if using SendGrid)
SENDGRID_FROM_EMAIL=orders@go2pik.com
SENDGRID_FROM_NAME=Go2Pik
```

If `CORS_ORIGINS` is absent the server falls back to the built‑in allowlist:

```
http://localhost:5173
https://go2pik-app.web.app
https://www.go2pik.com
https://go2pik.com
https://go2pik-app--ui-preview-bwdknkqw.web.app
```

Set `APP_ENV` (or `DEPLOYMENT_ENV`) to `local`, `preview`, or `production`. By default the same SendGrid credentials above are reused for every stage; optionally define `SENDGRID_API_KEY_<STAGE>`, `SENDGRID_FROM_EMAIL_<STAGE>`, or `SENDGRID_FROM_NAME_<STAGE>` if you need overrides. If a SendGrid API key is available for the active stage, the notification service automatically uses SendGrid; otherwise it falls back to the generic webhook provider configured via `EMAIL_PROVIDER_URL`/`EMAIL_PROVIDER_API_KEY`.

## Install & Run

```bash
npm install
npm run dev
```

The dev script starts `src/server.js`, which loads `src/app.js`, configures CORS, JSON parsing, routes, and request logging, then listens on `HOST:PORT`.

## API Surface

- `POST /api/auth/customers/signup|login|logout|refresh`, `GET /api/auth/customers/me` – customer auth
- `POST /api/auth/restaurant-users/login|logout|refresh`, `GET /api/auth/restaurant-users/me` – restaurant staff auth
- `POST /api/customers`, `GET/PUT /api/customers/:id`, `PATCH /api/customers/:id/deactivate`
- `GET /api/restaurants` (optional `?city=`), `GET /api/restaurants/:id/menu`
- `POST /api/restaurants/:restaurantId/users`, `GET /api/restaurants/:restaurantId/users`, `PUT/PATCH /api/restaurant-users/:id`
- `POST /api/orders`, `GET /api/orders`, `GET /api/orders/:id`
- `GET /api/dashboard/restaurants/:restaurantId/orders` plus `/orders/:orderId/(accept|preparing|ready|complete|reject)`
- Menu maintenance via `GET/POST /api/dashboard/restaurants/:restaurantId/menu` and `PUT/PATCH /api/dashboard/menu-items/:menuItemId`
- Menu category management via `GET/POST /api/dashboard/restaurants/:restaurantId/menu/categories` and `PUT /api/dashboard/restaurants/:restaurantId/menu/categories/:categoryId`
- Bulk menu sync via `GET /api/dashboard/restaurants/:restaurantId/menu/export` and `POST /api/dashboard/restaurants/:restaurantId/menu/import`

The bulk import endpoint accepts either JSON or CSV.

- JSON body can use `categories`, `items`, and `uncategorized_items`
- CSV body should be sent as raw `text/csv` content to the same import endpoint
- Multipart upload should send a file field named `file`
- CSV columns supported:
  - `category_id`
  - `category_name`
  - `category_display_order`
  - `category_is_active`
  - `item_id`
  - `item_name`
  - `item_description`
  - `item_price`
  - `item_is_available`
  - `item_is_vegetarian`
  - `item_is_vegan`
  - `item_display_order`

Example CSV:

```csv
category_id,category_name,category_display_order,category_is_active,item_id,item_name,item_description,item_price,item_is_available,item_is_vegetarian,item_is_vegan,item_display_order
31,Appetizers,1,true,101,Samosa,Crispy pastry,8,true,true,false,1
31,Appetizers,1,true,102,Pakora,Fried fritters,7,true,true,false,2
,Beverages,2,true,,Mango Lassi,Sweet yogurt drink,5,true,true,false,1
```

Multipart upload example:

```bash
curl -X POST "http://localhost:3000/api/dashboard/restaurants/12/menu/import" \
  -H "Authorization: Bearer <token>" \
  -F "file=@menu.csv;type=text/csv"
```
- OpenAPI spec for the menu endpoints: [`docs/openapi-menu.yaml`](/Users/Krprasa/Gap-Repos/Personal/go2pik-api/docs/openapi-menu.yaml)
- Swagger UI for the menu spec: `GET /api/docs/menu`

All endpoints expect/return JSON and rely on the Postgres schema from the food-order-app project. Fallback restaurant/menu data lives in `data/restaurants.json` to keep the app responsive when DB data is missing.

Order status filters supported by `GET /api/orders` and `GET /api/dashboard/restaurants/:restaurantId/orders`:

- `new`
- `accepted`
- `preparing`
- `ready_for_pickup`
- `completed`
- `rejected`

You can combine the status filter with `restaurantId` on `GET /api/orders`, for example:

- `GET /api/orders?status=new&restaurantId=12`

For restaurant-scoped filtering, use:

- `GET /api/dashboard/restaurants/12/orders?status=new`

For the Completed tab, fetch only orders completed on a specific calendar day:

- `GET /api/dashboard/restaurants/12/orders?status=completed&completedDate=2026-04-15`
- Shortcut for today only:
  - `GET /api/dashboard/restaurants/12/orders?status=completedToday`

The completed-day filter uses the dashboard timezone, defaulting to `America/Los_Angeles` unless `DASHBOARD_TIMEZONE` is set.

## Notes

- Token handling (access + refresh) is implemented locally via `src/utils/token.js` with DB persistence/fallback memory store in `src/repositories/tokenRepository.js`.
- Order placement triggers a stub automation (`src/utils/automation.js`) that can be extended to real browser automation later.
- Error handling is centralized (`src/middlewares/errorHandler.js`) to normalize responses and surface validation issues.
- Order confirmations can trigger email notifications. Configure the provider via the `NOTIFICATIONS_*` env vars and the API will POST to your provider from `src/services/notificationService.js` after a successful order.

## Testing / Next Steps

- Hit the health endpoint: `GET /` ⇒ `{ status: 'ok', service: 'go2pik-api', env: 'development' }`
- Exercise signup/login, restaurant listing, order creation, and dashboard flows using Postman or automated tests.
- Point the API to Google Cloud SQL by updating the DB env vars (and enabling `PGSSL=true` if needed).
