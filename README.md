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
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-twilio-auth-token
TWILIO_PHONE_NUMBER=+15551234567
TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
OTP_EXPIRY_MINUTES=10
OTP_RESEND_COOLDOWN_SECONDS=30
OTP_MAX_ATTEMPTS=5
OTP_LENGTH=6
NOTIFICATIONS_ENABLED=true
EMAIL_PROVIDER_URL=https://api.emailprovider.com/send
EMAIL_PROVIDER_API_KEY=super-secret-key
EMAIL_FROM=no-reply@go2pik.com
EMAIL_FROM_NAME=Go2Pik
NOTIFICATION_TIMEZONE=America/New_York
SENDGRID_API_KEY=Email Provider API key (if using SendGrid)
SENDGRID_FROM_EMAIL=orders@go2pik.com
SENDGRID_FROM_NAME=Go2Pik
ADMIN_DOCS_USERNAME=admin
ADMIN_DOCS_PASSWORD=change-this-secret
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
- `PATCH /api/customers/me/phone` – authenticated customer phone update
- `POST /api/auth/restaurant-users/login|logout|refresh`, `GET /api/auth/restaurant-users/me` – restaurant staff auth
- `POST /api/restaurants` – admin-only restaurant creation
- `POST /api/customers`, `GET/PUT /api/customers/:id`, `GET /api/customers/:id/orders`, `PATCH /api/customers/:id/deactivate`
- `GET /api/restaurants` (optional `?city=`), `GET /api/restaurants/:id/menu`
- `POST /api/restaurants/:restaurantId/users`, `GET /api/restaurants/:restaurantId/users`, `PUT/PATCH /api/restaurant-users/:id`
- `POST /api/orders` creates a direct non-SMS order when `smsConsent=false`. `GET /api/orders`, `GET /api/orders/:id`
- `PATCH /api/orders/:id/accept-updated` and `PATCH /api/orders/:id/cancel` for authenticated customer review of partially accepted orders
- `GET /api/orders/review/:orderNumber?token=...`, `PATCH /api/orders/review/:orderNumber/accept-updated?token=...`, and `PATCH /api/orders/review/:orderNumber/cancel?token=...` for SMS-driven order review
- `POST /api/orders/verification/start`, `POST /api/orders/verification/confirm`, `POST /api/orders/verification/resend`, `POST /api/orders/verification/test`
- `GET /api/health/twilio-verify`
- `GET /api/dashboard/restaurants/:restaurantId/orders` plus `/orders/:orderId/(accept|preparing|ready|complete|reject)`
- `PATCH /api/dashboard/orders/:orderId/partial-accept`
- `GET /api/dashboard/restaurants/:restaurantId/reports/orders?today=true` or `?from=YYYY-MM-DD&to=YYYY-MM-DD`
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

Restaurant/menu payloads now include `pickupAvailability` and `openHours` so clients can determine:

- whether the restaurant is currently open
- today's opening and closing times
- whether ASAP pickup is allowed
- the weekly pickup windows for scheduled orders

Scheduled pickup requests are validated server-side. When a pickup time falls outside open hours, the API returns a 400 response with:

- `code: pickup_time_out_of_hours`
- `message: Pickup time is outside restaurant open hours. Please choose another time.`

If the restaurant is closed, the menu payload still includes a user-safe status message:

- `Currently the restaurant is closed, but you can still place an order for later pickup.`

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
- OpenAPI spec for admin restaurant onboarding and restaurant-user management: [`docs/openapi-admin.yaml`](/Users/Krprasa/Gap-Repos/Personal/go2pik-api/docs/openapi-admin.yaml)
- Admin-only Swagger UI: `GET /api/docs/admin`
- Admin docs access is protected with HTTP Basic Auth using `ADMIN_DOCS_USERNAME` and `ADMIN_DOCS_PASSWORD`

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

### Partial Kitchen Acceptance

Use `PATCH /api/dashboard/orders/:orderId/partial-accept` to accept some items and mark the rest unavailable.

Use the order item ids returned by `order.items[].id` in the request arrays.

Request body:

```json
{
  "accepted_item_ids": [1, 2],
  "accepted_items": [{ "id": 1 }, { "id": 2 }],
  "unavailable_item_ids": [3],
  "rejected_items": [{ "id": 3 }],
  "note": "Out of stock on item 3"
}
```

The response includes the updated order, accepted items, unavailable items, updated totals, and kitchen note.
When partial acceptance succeeds, the backend also sends an SMS to the customer with a signed review link if Twilio is configured.

### Customer Review Actions

When a kitchen partially accepts an order, the customer can review it with:

- `PATCH /api/orders/:id/accept-updated`
- `PATCH /api/orders/:id/cancel`

These endpoints require a valid customer bearer token and only work for partially accepted orders belonging to that customer.

For SMS-driven review flows, the backend also exposes public tokenized endpoints:

- `GET /api/orders/review/:orderNumber?token=...`
- `PATCH /api/orders/review/:orderNumber/accept-updated?token=...`
- `PATCH /api/orders/review/:orderNumber/cancel?token=...`

The SMS link format is:

`https://go2pik.com/order/<orderNumber>?token=<signed-token>`

### Restaurant Orders Report

Use `GET /api/dashboard/restaurants/:restaurantId/reports/orders` for an owner summary report.

Supported query params:

- `today=true` to pull today’s report in the dashboard timezone
- `date=YYYY-MM-DD` to pull a single day
- `from=YYYY-MM-DD&to=YYYY-MM-DD` to pull a date range

The response includes:

- total number of orders
- total amount
- status counts
- aggregated item summary

Example:

```bash
GET /api/dashboard/restaurants/12/reports/orders?from=2026-04-01&to=2026-04-20
```

## Notes

- Token handling (access + refresh) is implemented locally via `src/utils/token.js` with DB persistence/fallback memory store in `src/repositories/tokenRepository.js`.
- Order placement triggers a stub automation (`src/utils/automation.js`) that can be extended to real browser automation later.
- Error handling is centralized (`src/middlewares/errorHandler.js`) to normalize responses and surface validation issues.
- Order confirmations can trigger email and SMS notifications. Configure the provider via the `NOTIFICATIONS_*` env vars and Twilio via `TWILIO_*`; the API will send the confirmation email and, when the customer has opted in, an SMS from `src/services/notificationService.js` after a successful order.
- OTP verification is handled through Twilio SMS for opted-in users only. The service uses `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER` plus the OTP timing values above to manage pending order verification sessions before the final order is created.

### OTP Flow

1. `POST /api/orders/verification/start`
   - Body:
     ```json
     {
       "phoneNumber": "+15105550123",
       "smsConsent": true
     }
     ```
   - The full order draft can be included alongside `phoneNumber` and `smsConsent`
   - If `smsConsent=true`: sends OTP and returns `{ success, message, verification }`
   - If `smsConsent=false`: skips OTP, creates the order, and returns `{ success, message, order }`
2. `POST /api/orders`
   - Body includes `phoneNumber` and `smsConsent=false`
   - Response: `{ success, message, order }`
3. `POST /api/orders/verification/confirm`
   - Body: `{ verificationId, code }`
   - Response: `{ success, message, verification, order, automation, notification }`
   - Failure cases:
     - wrong code: `400 Bad Request`
     - expired code: `400 Bad Request`
     - consumed session: `409 Conflict`
4. `POST /api/orders/verification/resend`
   - Body: `{ verificationId }`
   - Response: `{ success, message, verification }`
5. `POST /api/orders/verification/test`
   - Body: optional `{ phone }`
   - Response: `{ success, message, service, verification }`

### SMS Consent Fields

- `phoneNumber: string`
- `smsConsent: true | false`
- Optional consent audit fields:
  - `smsConsentText`
  - `smsConsentVersion`
  - `smsOptInSource`
- Stored on the order:
  - `sms_consent`
  - `sms_consent_at`
  - `sms_consent_phone`
  - `sms_consent_text`
  - `sms_consent_version`
  - `sms_opt_in_source`

### Customer Phone Update

- `PATCH /api/customers/me/phone`
  - Headers:
    - `Authorization: Bearer <customer_access_token>`
    - `Content-Type: application/json`
  - Body:
    ```json
    {
      "phone": "+15103787548"
    }
    ```
  - Response:
    ```json
    {
      "message": "Customer phone updated",
      "customer": {
        "id": 1,
        "full_name": "Aarav Patel",
        "phone": "+15103787548",
        "email": "aarav@example.com",
        "is_active": true,
        "created_at": "2026-04-19T18:00:00.000Z",
        "updated_at": "2026-04-19T18:10:00.000Z"
      }
    }
    ```

### Health Check

- `GET /api/health/twilio-verify`
  - Checks Twilio SMS configuration and fetches the Twilio account metadata
  - Response: `{ status, service, configured, reachable, otpLength, serviceDetails }`

## Testing / Next Steps

- Hit the health endpoint: `GET /` ⇒ `{ status: 'ok', service: 'go2pik-api', env: 'development' }`
- Exercise signup/login, restaurant listing, order creation, and dashboard flows using Postman or automated tests.
- Point the API to Google Cloud SQL by updating the DB env vars (and enabling `PGSSL=true` if needed).
